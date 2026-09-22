import { createChangePreview } from "./change-planner.js";
import { normalizeDeploymentMethod } from "./deployment-recognition.js";
import { classifyNetworkError, sanitizePublicError } from "./network-error-classifier.js";
import { mergeVerificationEvidence } from "./probe-attempt-policy.js";
import { cloudIdentityKey, normalizeVmIdentity, recordIdForIdentity } from "./vm-identity.js";

function json(status, body) {
  return { status, body };
}

function parseUrl(rawUrl) {
  return new URL(rawUrl || "/", "http://gcp-vm-console.local");
}

function recordIdFrom(pathname, suffix = "") {
  const prefix = "/api/vm-records/";
  if (!pathname.startsWith(prefix) || !pathname.endsWith(suffix)) return "";
  return decodeURIComponent(pathname.slice(prefix.length, suffix ? -suffix.length : undefined));
}

function baseErrorStatus(error) {
  if (/not found/i.test(error?.message || "")) return 404;
  if (/already running/i.test(error?.message || "")) return 409;
  if (/required|invalid|stale|fingerprint|确认|敏感|选择明确|过期|请先启动|当前状态/i.test(error?.message || "")) return 400;
  return 500;
}

function errorStatus(error) {
  return classifyError(error).status;
}

function safeMessage(message) {
  return sanitizePublicError(message);
}

function classifyError(error) {
  if (error?.code === "WARP_STATUS_UNCONFIRMED") {
    return {
      status: 502,
      category: "warp",
      code: "warp_status_unconfirmed",
      message: "WARP 重连结果未确认；请重新检测 WARP 状态。"
    };
  }
  const network = classifyNetworkError(error);
  if (network.recognized) return network;
  const message = String(error?.message || "");
  const status = baseErrorStatus(error);
  if (status >= 500) {
    return { status: 500, category: "generic", code: "generic", message: "服务器内部错误" };
  }
  return {
    status,
    category: "generic",
    code: "generic",
    message: safeMessage(message) || "请求无法处理。"
  };
}

function applyFirewallGovernanceRisk(result = {}, governance = null) {
  if (!governance || typeof governance !== "object") return result;
  const severity = String(governance.severity || "").toLowerCase();
  const risky = (Array.isArray(governance.findings) ? governance.findings : [])
    .filter((finding) => ["critical", "high"].includes(String(finding?.severity || "").toLowerCase()))
    .sort((a, b) => {
      const severityRank = (finding) => String(finding?.severity || "").toLowerCase() === "critical" ? 0 : 1;
      return severityRank(a) - severityRank(b)
        || (Array.isArray(b?.affectedInstances) ? b.affectedInstances.length : 0)
          - (Array.isArray(a?.affectedInstances) ? a.affectedInstances.length : 0);
    });
  if (!["critical", "high"].includes(severity) || !risky.length) {
    return { ...result, firewallGovernance: governance };
  }

  const ruleNames = risky.map((finding) => String(finding?.name || "").slice(0, 80)).filter(Boolean).slice(0, 3);
  const affectedCount = Array.isArray(governance.affectedInstances) ? governance.affectedInstances.length : 0;
  const riskLabel = severity === "critical" ? "严重风险" : "高风险";
  const ownedActions = Array.isArray(governance.ownedActions) ? governance.ownedActions : [];
  const ownedStatus = result.firewall?.ownedStatus
    || (governance.coverage?.ready && !ownedActions.length ? "matched" : "")
    || (ownedActions.length ? "missing" : "")
    || result.firewall?.status
    || "unknown";
  const detail = `自有规则${ownedStatus === "matched" ? "已匹配" : "状态已读取"}；外部共享规则${ruleNames.length ? `「${ruleNames.join("、")}」` : ""}存在${riskLabel}${affectedCount ? `，影响 ${affectedCount} 台实例` : ""}`;
  const checks = Array.isArray(result.checks) ? result.checks.map((check) => ({ ...check })) : [];
  const firewallIndex = checks.findIndex((check) => String(check?.id || "").toLowerCase() === "firewall");
  const firewallCheck = { id: "firewall", label: "防火墙", status: "partial", detail };
  if (firewallIndex >= 0) checks[firewallIndex] = firewallCheck;
  else checks.push(firewallCheck);
  const warning = `防火墙：${detail}`;
  const warnings = [...new Set([...(Array.isArray(result.warnings) ? result.warnings : []), warning])];

  return {
    ...result,
    status: result.status === "failed" ? "failed" : "partial",
    firewall: {
      ...(result.firewall || {}),
      ownedStatus,
      status: "overexposed",
      error: detail,
      broadRules: risky.map((finding) => ({ name: String(finding?.name || "").slice(0, 80) }))
    },
    checks,
    warnings,
    firewallGovernance: governance
  };
}

export function createRouter({
  accountService,
  changeExecutor,
  inventory,
  jobStore,
  maintenanceService,
  nodePipeline,
  deploymentVerifier,
  guestAttributesService,
  deploymentProbeService,
  firewallService,
  firewallGovernanceService,
  networkExposureService,
  warpEgressService,
  secretStore,
  recognitionProbeService,
  doctorService,
  regionCatalog,
  freeRuleService,
  runtimeRevision = "unknown",
  recordStore
} = {}) {
  if (!accountService) throw new Error("accountService is required.");
  if (!changeExecutor) throw new Error("changeExecutor is required.");
  if (!inventory) throw new Error("inventory is required.");
  if (!jobStore) throw new Error("jobStore is required.");
  if (!maintenanceService) throw new Error("maintenanceService is required.");
  if (!nodePipeline) throw new Error("nodePipeline is required.");
  if (!deploymentVerifier?.verify) throw new Error("deploymentVerifier with verify() is required.");
  if (!guestAttributesService?.readConsoleAttributes) throw new Error("guestAttributesService with readConsoleAttributes() is required.");
  if (!deploymentProbeService?.probe) throw new Error("deploymentProbeService with probe() is required.");
  if (!firewallService?.inspectInstanceExposure) throw new Error("firewallService with inspectInstanceExposure() is required.");
  if (!firewallGovernanceService?.preview) throw new Error("firewallGovernanceService with preview() is required.");
  if (!networkExposureService?.preview || !networkExposureService?.apply) throw new Error("networkExposureService with preview() and apply() is required.");
  if (!warpEgressService?.probe || !warpEgressService?.reconnect) throw new Error("warpEgressService with probe() and reconnect() is required.");
  if (!secretStore?.publicStatus || !secretStore?.saveSshPassword) throw new Error("secretStore is required.");
  if (!recognitionProbeService?.probe) throw new Error("recognitionProbeService with probe() is required.");
  if (!doctorService?.run) throw new Error("doctorService with run() is required.");
  if (!regionCatalog?.load) throw new Error("regionCatalog with load() is required.");
  if (!freeRuleService?.calibrate || !freeRuleService?.readCached) throw new Error("freeRuleService with calibrate() and readCached() is required.");
  if (!recordStore) throw new Error("recordStore is required.");

  async function recordOrNotFound(id) {
    const record = await recordStore.get(id);
    if (!record) throw new Error("VM record was not found.");
    return record;
  }

  function sshOptions(record) {
    return {
      sshUser: record.desired?.ssh?.user,
      sshKeyFile: record.desired?.ssh?.keyFile,
      sshPort: record.desired?.ssh?.port
    };
  }

  function deployOptions(record) {
    return {
      ...(record.desired?.deploy || {}),
      network: record.desired?.network?.name || "default",
      targetTags: record.desired?.tags || [record.identity.name],
      sourceRanges: record.desired?.sourceRanges || ["0.0.0.0/0"]
    };
  }

  function contextFromSearch(url) {
    return {
      configuration: url.searchParams.get("configuration") || "",
      account: url.searchParams.get("account") || "",
      projectId: url.searchParams.get("projectId") || ""
    };
  }

  function contextFromBody(body = {}) {
    return {
      configuration: body.configuration || "",
      account: body.account || "",
      projectId: body.projectId || ""
    };
  }

  function expectedServicePortsFromProbe(sshProbe = {}, method = "") {
    const processPattern = method === "three_x_ui"
      ? /x-ui|xray|v2ray/i
      : method === "singbox_plus"
        ? /sing-box|hysteria|tuic/i
        : /sing-box|x-ui|xray|v2ray|hysteria|tuic/i;
    const seen = new Set();
    return (sshProbe.ports || [])
      .filter((port) => (
        port?.listening !== false &&
        port?.exposureScope !== "loopback" &&
        port?.protocol &&
        port?.port &&
        processPattern.test(String(port.process || ""))
      ))
      .map((port) => ({ protocol: String(port.protocol).toLowerCase(), port: String(port.port) }))
      .filter((port) => {
        const number = Number(port.port);
        if (!["tcp", "udp"].includes(port.protocol) || !/^\d{1,5}$/.test(port.port) || !Number.isInteger(number) || number < 1 || number > 65535) return false;
        const key = `${port.protocol}/${port.port}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  }

  function expectedServicePortsFromNodeResult(nodeResult = null, method = "") {
    const candidates = method === "three_x_ui"
      ? [{ protocol: "tcp", port: nodeResult?.panel?.port }]
      : method === "singbox_plus"
        ? (Array.isArray(nodeResult?.links) ? nodeResult.links : []).map((link) => ({
            protocol: String(link?.protocol || link?.transport || "udp").toLowerCase(),
            port: link?.port
          }))
        : [];
    const seen = new Set();
    return candidates
      .map((item) => ({ protocol: String(item?.protocol || "").toLowerCase(), port: String(item?.port || "") }))
      .filter((item) => {
        const number = Number(item.port);
        if (!["tcp", "udp"].includes(item.protocol) || !/^\d{1,5}$/.test(item.port) || !Number.isInteger(number) || number < 1 || number > 65535) return false;
        const key = `${item.protocol}/${item.port}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  }

  function appendHistory(record, entry) {
    return [
      ...(Array.isArray(record.history) ? record.history : []),
      { ...entry, at: new Date().toISOString() }
    ].slice(-50);
  }

  function sensitiveText(value = "") {
    return /(?:vless|vmess|hy2|hysteria2|tuic|ss):\/\/|password|passwd|token|secret|private[_-]?key|credential/i.test(String(value || ""));
  }

  function safeRecognition(input = {}) {
    const evidence = Array.isArray(input.evidence) ? input.evidence : [];
    for (const item of evidence) {
      if (item?.sensitive || sensitiveText(item?.label) || sensitiveText(item?.value)) {
        throw new Error("识别证据包含敏感信息，不能写入本地接管记录。");
      }
    }
    return {
      method: normalizeDeploymentMethod(input.method),
      confidence: input.confidence || "none",
      source: input.source || "none",
      managedState: input.managedState || "unknown",
      evidence: evidence.map((item) => ({
        source: String(item.source || "unknown"),
        label: String(item.label || "").slice(0, 80),
        value: String(item.value || "").slice(0, 240),
        confidence: String(item.confidence || "low"),
        sensitive: false
      })).filter((item) => item.label && item.value),
      warnings: (Array.isArray(input.warnings) ? input.warnings : []).map((item) => String(item).slice(0, 240)),
      suggestedAction: input.suggestedAction || "none"
    };
  }

  function methodNeedsConfirmation(recognition) {
    return recognition.method === "unmanaged_unknown"
      || recognition.method === "external_custom"
      || recognition.confidence === "none"
      || recognition.confidence === "low"
      || (recognition.warnings || []).some((warning) => /冲突|conflict|证据不足/i.test(warning));
  }

  function adoptedDesired(input = {}, method) {
    return {
      ...(input || {}),
      deploy: {
        ...(input?.deploy || {}),
        method
      }
    };
  }

  function verificationFromProbe({ sshProbe = {}, firewallProbe = {}, recognition = {}, fallbackSsh = {} } = {}) {
    return {
      status: sshProbe.ssh?.verified ? "partial" : "failed",
      checkedAt: sshProbe.checkedAt || new Date().toISOString(),
      method: recognition.method || "unmanaged_unknown",
      methodConfidence: recognition.confidence || "none",
      methodSource: recognition.source || "none",
      ssh: sshProbe.ssh || {
        desiredPort: Number(fallbackSsh.sshPort || fallbackSsh.port || 0) || null,
        actualPort: null,
        fallback: false,
        verified: false
      },
      bbr: sshProbe.bbr || null,
      services: Array.isArray(sshProbe.services) ? sshProbe.services : [],
      ports: (Array.isArray(sshProbe.ports) ? sshProbe.ports : []).map((port) => ({
        protocol: String(port.protocol || "").toLowerCase(),
        port: String(port.port || ""),
        process: String(port.process || ""),
        listening: port.listening !== false,
        scope: String(port.exposureScope || port.scope || "")
      })),
      firewall: firewallProbe,
      checks: [],
      warnings: Array.isArray(sshProbe.warnings) ? sshProbe.warnings : []
    };
  }

  async function assertLiveCloudWriteReady(record, { requireRunning = false } = {}) {
    const instances = await inventory.listInstances(record.identity);
    const observed = instances.find((instance) => (
      instance.name === record.identity.name && (!instance.zone || instance.zone === record.identity.zone)
    ));
    if (!observed) throw new Error("无法通过实时 Google API 确认实例，云端写操作已阻止。");
    if (requireRunning && String(observed.status || "").toUpperCase() !== "RUNNING") {
      throw new Error(`实例当前状态为 ${observed.status || "UNKNOWN"}，请先启动实例后再执行维护操作。`);
    }
    return observed;
  }

  async function runRecordJob({ type, recordId, stage, task }) {
    const record = await recordOrNotFound(recordId);
    const job = jobStore.create({ type, recordId, lockKey: cloudIdentityKey(record.identity) });
    try {
      jobStore.setStage(job.id, stage);
      const result = await task(record, job);
      return json(200, { job: jobStore.finish(job.id, { status: result?.status === "partial" ? "partial" : "succeeded", result }) });
    } catch (error) {
      const classified = classifyError(error);
      const safeError = new Error(classified.message);
      safeError.code = classified.code;
      return json(classified.status, {
        job: jobStore.fail(job.id, safeError),
        error: classified.message,
        errorCategory: classified.category,
        code: classified.code
      });
    }
  }

  async function dispatch(request = {}) {
    const method = String(request.method || "GET").toUpperCase();
    const url = parseUrl(request.url);
    const pathname = url.pathname;

    try {
      if (method === "GET" && pathname === "/api/health") {
        return json(200, {
          ok: true,
          mode: "gcloud-only",
          runtimeRevision: String(runtimeRevision || "unknown"),
          capabilities: {
            records: true,
            cloudInventory: true,
            changePreview: true,
            maintenance: true,
            nodePipeline: true,
            regionCatalog: true,
            freeRuleCalibration: true,
            externalInstanceRecognition: true,
            localAdoption: true,
            persistentJobHistory: true,
            runtimeOptimization: true,
            networkResilience: true,
            resilientInventory: true,
            firewallGovernance: true,
            localSecretStore: true,
            sshDualEntry: true,
            portExposureGovernance: true,
            metadataSafeReadOnlySsh: true,
            warpEgressManagement: true
          }
        });
      }

      if (method === "GET" && pathname === "/api/accounts") {
        return json(200, { accounts: await accountService.listConfigurations() });
      }

      if (method === "GET" && pathname === "/api/projects") {
        return json(200, {
          projects: await accountService.listProjects({
            configuration: url.searchParams.get("configuration"),
            account: url.searchParams.get("account")
          })
        });
      }

      if (method === "GET" && pathname === "/api/vm-records") {
        return json(200, {
          records: await recordStore.list({
            account: url.searchParams.get("account") || undefined,
            projectId: url.searchParams.get("projectId") || undefined
          })
        });
      }

      if (method === "GET" && pathname === "/api/cloud-instances") {
        const scope = {
          configuration: url.searchParams.get("configuration"),
          account: url.searchParams.get("account"),
          projectId: url.searchParams.get("projectId")
        };
        const snapshot = inventory.listInstancesSnapshot
          ? await inventory.listInstancesSnapshot(scope)
          : { instances: await inventory.listInstances(scope), meta: { source: "live", stale: false } };
        return json(200, snapshot);
      }

      if (method === "POST" && pathname === "/api/cloud-instances/adoption-preview") {
        const identity = normalizeVmIdentity(request.body?.identity || {});
        const ssh = request.body?.ssh || {};
        const localRecord = await recordStore.get(recordIdForIdentity(identity)).catch(() => null);
        const readCache = new Map();
        const { cloudInstance, guestAttributes, sshProbe, firewallProbe, recognition } = await recognitionProbeService.probe({
          identity,
          ssh,
          localRecord,
          readCache
        });
        const firewallGovernance = await firewallGovernanceService.preview({
          ...(localRecord || {}),
          identity,
          desired: {
            ...(localRecord?.desired || {}),
            ssh: { ...(localRecord?.desired?.ssh || {}), port: ssh.sshPort || ssh.port || localRecord?.desired?.ssh?.port }
          },
          verification: verificationFromProbe({ sshProbe, firewallProbe, recognition, fallbackSsh: ssh })
        }, { readCache });
        return json(200, { identity, recognition, cloudInstance, guestAttributes, sshProbe, firewallProbe, firewallGovernance });
      }

      if (method === "POST" && pathname === "/api/cloud-instances/adopt-local") {
        const identity = normalizeVmIdentity(request.body?.identity || {});
        const recognitionInput = safeRecognition(request.body?.recognition || {});
        const confirmedMethod = normalizeDeploymentMethod(request.body?.userConfirmedMethod || recognitionInput.method);
        if (methodNeedsConfirmation(recognitionInput) && !request.body?.userConfirmedMethod) {
          throw new Error("当前识别结果需要手动确认部署方式后才能接管为本地记录。");
        }
        if (confirmedMethod === "unmanaged_unknown") {
          throw new Error("接管前需要选择明确的部署方式。");
        }
        const adoptedAt = new Date().toISOString();
        const record = await recordStore.save({
          status: "managed",
          identity,
          desired: adoptedDesired(request.body?.desired || {}, confirmedMethod),
          observed: null,
          preview: null,
          migration: {
            ...(request.body?.migration || {}),
            adoption: {
              adoptedAt,
              source: "external_instance_recognition",
              managedState: "external_adopted",
              originalMethod: recognitionInput.method,
              userConfirmedMethod: confirmedMethod,
              recognition: {
                ...recognitionInput,
                method: confirmedMethod,
                source: request.body?.userConfirmedMethod ? "user_confirmed" : recognitionInput.source,
                confidence: request.body?.userConfirmedMethod ? "high" : recognitionInput.confidence,
                managedState: "external_adopted"
              }
            }
          },
          history: [{ type: "external-adoption", status: "succeeded", method: confirmedMethod, at: adoptedAt }]
        });
        return json(200, { record });
      }

      if (method === "GET" && pathname === "/api/regions") {
        return json(200, await regionCatalog.load(contextFromSearch(url)));
      }

      if (method === "GET" && pathname === "/api/free-rules") {
        return json(200, await freeRuleService.readCached(contextFromSearch(url)));
      }

      if (method === "GET" && pathname === "/api/doctor") {
        return json(200, await doctorService.run(contextFromSearch(url)));
      }

      if (method === "POST" && pathname === "/api/free-rules/calibrate") {
        return json(200, await freeRuleService.calibrate(contextFromBody(request.body || {})));
      }

      if (method === "GET" && pathname === "/api/jobs") {
        return json(200, {
          jobs: jobStore.list().sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
          meta: jobStore.storageInfo()
        });
      }

      if (method === "GET" && pathname === "/api/local-security/ssh-auth") {
        return json(200, { sshAuth: await secretStore.publicStatus() });
      }

      if (method === "PUT" && pathname === "/api/local-security/ssh-auth") {
        return json(200, { sshAuth: await secretStore.saveSshPassword(request.body?.password) });
      }

      if (method === "POST" && pathname === "/api/vm-records") {
        return json(200, { record: await recordStore.save(request.body || {}) });
      }

      const warpStatusRecordId = recordIdFrom(pathname, "/warp/status");
      if (method === "POST" && warpStatusRecordId) {
        const record = await recordOrNotFound(warpStatusRecordId);
        const warp = await warpEgressService.probe({ record });
        const saved = await recordStore.save({
          ...record,
          observed: {
            ...(record.observed || {}),
            warp
          }
        });
        return json(200, { warp: saved.observed.warp });
      }

      const exposurePreviewRecordId = recordIdFrom(pathname, "/network-exposure/preview");
      if (method === "POST" && exposurePreviewRecordId) {
        const record = await recordOrNotFound(exposurePreviewRecordId);
        const preview = await networkExposureService.preview(record, {
          selection: {
            publicSsh22: Boolean(request.body?.publicSsh22),
            ports: Array.isArray(request.body?.ports) ? request.body.ports : []
          }
        });
        const saved = await recordStore.save({
          ...record,
          observed: {
            ...(record.observed || {}),
            networkExposurePreview: preview
          }
        });
        return json(200, { preview: saved.observed.networkExposurePreview });
      }

      const previewRecordId = recordIdFrom(pathname, "/preview");
      if (method === "POST" && previewRecordId) {
        const record = await recordStore.get(previewRecordId);
        if (!record) return json(404, { error: "VM record was not found." });
        const observed = await inventory.readObserved(record.identity);
        const preview = createChangePreview({
          identity: record.identity,
          desired: record.desired,
          observed
        });
        await recordStore.save({ ...record, observed, preview });
        return json(200, { preview });
      }

      const executeRecordId = recordIdFrom(pathname, "/execute");
      if (method === "POST" && executeRecordId) {
        const record = await recordStore.get(executeRecordId);
        if (!record) return json(404, { error: "VM record was not found." });
        const job = jobStore.create({
          type: "execute-change",
          recordId: executeRecordId,
          lockKey: cloudIdentityKey(record.identity)
        });
        try {
          jobStore.setStage(job.id, {
            name: "fingerprint_check",
            status: "running",
            detail: "执行前复核已保存的预览指纹"
          });
          const result = await changeExecutor.execute({
            recordId: executeRecordId,
            previewFingerprint: request.body?.previewFingerprint,
            idempotencyKey: request.body?.idempotencyKey
          });
          return json(200, { job: jobStore.finish(job.id, { status: "succeeded", result }) });
        } catch (error) {
          const classified = classifyError(error);
          const safeError = new Error(classified.message);
          safeError.code = classified.code;
          return json(classified.status, {
            job: jobStore.fail(job.id, safeError),
            error: classified.message,
            errorCategory: classified.category,
            code: classified.code
          });
        }
      }

      const statusRecordId = recordIdFrom(pathname, "/maintenance/status");
      if (method === "POST" && statusRecordId) {
        return runRecordJob({
          type: "maintenance-status",
          recordId: statusRecordId,
          stage: {
            name: "status_check",
            status: "running",
            detail: "通过 gcloud describe 读取实例状态"
          },
          task: async (record) => {
            const result = await maintenanceService.checkStatus(record.identity);
            await recordStore.save({
              ...record,
              observed: {
                ...(record.observed || {}),
                exists: result.exists,
                status: result.status,
                network: {
                  ...(record.observed?.network || {}),
                  externalIp: result.externalIp,
                  externalIpMode: result.externalIpMode
                }
              },
              history: appendHistory(record, { type: "maintenance-status", status: "succeeded" })
            });
            return result;
          }
        });
      }

      const restartRecordId = recordIdFrom(pathname, "/maintenance/restart");
      if (method === "POST" && restartRecordId) {
        return runRecordJob({
          type: "maintenance-restart",
          recordId: restartRecordId,
          stage: {
            name: "restart",
            status: "running",
            detail: "停止后重新启动所选实例"
          },
          task: async (record) => {
            await assertLiveCloudWriteReady(record, { requireRunning: true });
            const result = await maintenanceService.restartVm(record.identity);
            await recordStore.save({
              ...record,
              history: appendHistory(record, { type: "maintenance-restart", status: "succeeded" })
            });
            return result;
          }
        });
      }

      const updateRecordId = recordIdFrom(pathname, "/maintenance/system-update");
      if (method === "POST" && updateRecordId) {
        return runRecordJob({
          type: "maintenance-system-update",
          recordId: updateRecordId,
          stage: {
            name: "system_update",
            status: "running",
            detail: "通过 IAP SSH 分阶段执行系统更新"
          },
          task: async (record) => {
            await assertLiveCloudWriteReady(record, { requireRunning: true });
            const result = await maintenanceService.systemUpdate(record.identity, sshOptions(record));
            await recordStore.save({
              ...record,
              observed: {
                ...(record.observed || {}),
                sshConnection: result.ssh || record.observed?.sshConnection || null
              },
              history: appendHistory(record, { type: "maintenance-system-update", status: "succeeded" })
            });
            return result;
          }
        });
      }

      const warpReconnectRecordId = recordIdFrom(pathname, "/warp/reconnect");
      if (method === "POST" && warpReconnectRecordId) {
        return runRecordJob({
          type: "warp-reconnect",
          recordId: warpReconnectRecordId,
          stage: {
            name: "precheck",
            status: "running",
            detail: "复核 WARP 服务、代理监听、Sing-box 路由和 SSH 路径"
          },
          task: async (record, job) => {
            await assertLiveCloudWriteReady(record);
            const result = await warpEgressService.reconnect({
              record,
              onStage: (nextStage) => nextStage.name === "precheck" ? null : jobStore.setStage(job.id, nextStage)
            });
            try {
              await recordStore.save({
                ...record,
                observed: {
                  ...(record.observed || {}),
                  warp: result.warp
                },
                history: appendHistory(record, {
                  type: "warp-reconnect",
                  status: result.status,
                  outcome: result.outcome
                })
              });
              jobStore.setStage(job.id, {
                name: "persist",
                status: "succeeded",
                detail: "WARP 脱敏状态已保存到本地记录"
              });
              return result;
            } catch {
              jobStore.setStage(job.id, {
                name: "persist",
                status: "partial",
                detail: "远端操作已返回，但本地 WARP 状态保存失败"
              });
              return {
                ...result,
                status: "partial",
                localPersistence: {
                  status: "failed",
                  error: "本地 WARP 历史保存失败；未执行补偿性远端操作。"
                }
              };
            }
          }
        });
      }

      const nodesRecordId = recordIdFrom(pathname, "/nodes/deploy");
      if (method === "POST" && nodesRecordId) {
        return runRecordJob({
          type: "node-deploy",
          recordId: nodesRecordId,
          stage: {
            name: "node_pipeline",
            status: "running",
            detail: "执行所选部署管线并同步端口"
          },
          task: async (record) => {
            await assertLiveCloudWriteReady(record, { requireRunning: true });
            const result = await nodePipeline.deploy({
              identity: record.identity,
              deploy: deployOptions(record),
              ssh: sshOptions(record)
            });
            let verification = null;
            let firewallGovernance = null;
            try {
              verification = await deploymentVerifier.verify({
                identity: record.identity,
                desired: record.desired,
                nodeResult: result.nodeResult,
                ssh: sshOptions(record)
              });
              firewallGovernance = await firewallGovernanceService.preview({
                ...record,
                nodeResult: result.nodeResult,
                verification
              }, { readCache: new Map() });
              verification = applyFirewallGovernanceRisk(verification, firewallGovernance);
            } catch (error) {
              verification = {
                status: "failed",
                checkedAt: new Date().toISOString(),
                method: result.method,
                checks: [{ id: "verification", label: "部署后验证", status: "failed", detail: error.message }],
                warnings: [error.message]
              };
            }
            const combinedResult = {
              ...result,
              verification,
              firewallGovernance: verification?.firewallGovernance || firewallGovernance,
              status: result.status === "partial" || verification.status !== "passed" ? "partial" : result.status
            };
            await recordStore.save({
              ...record,
              nodeResult: result.nodeResult,
              verification,
              observed: {
                ...(record.observed || {}),
                sshConnection: verification.ssh || result.ssh || result.nodeResult?.ssh || record.observed?.sshConnection || null,
                ...(verification?.firewallGovernance || firewallGovernance
                  ? { firewallGovernance: verification?.firewallGovernance || firewallGovernance }
                  : {})
              },
              history: appendHistory(record, { type: "node-deploy", status: combinedResult.status === "partial" ? "partial" : "succeeded", method: result.method })
            });
            return combinedResult;
          }
        });
      }

      const verifyRecordId = recordIdFrom(pathname, "/verify");
      if (method === "POST" && verifyRecordId) {
        return runRecordJob({
          type: "verification",
          recordId: verifyRecordId,
          stage: {
            name: "verification",
            status: "running",
            detail: "只读核验 SSH、服务、端口、BBR 和防火墙"
          },
          task: async (record) => {
            const storedMethod = normalizeDeploymentMethod(record.desired?.deploy?.method || record.nodeResult?.type || "vm_only");
            let methodOverride = "";
            let runtimeProbe = null;
            let firewallProbe = null;
            let expectedRuntimePorts = [];
            let methodRecognition = null;
            const readCache = new Map();
            const probeContext = await recognitionProbeService.probe({
              identity: record.identity,
              ssh: sshOptions(record),
              localRecord: null,
              readCache
            });
            runtimeProbe = probeContext.sshProbe;
            firewallProbe = probeContext.firewallProbe;
            if (
              ["high", "medium"].includes(probeContext.recognition.confidence) &&
              ["singbox_plus", "three_x_ui"].includes(probeContext.recognition.method)
            ) {
              methodOverride = probeContext.recognition.method;
              methodRecognition = probeContext.recognition;
            }
            if (!methodOverride) methodOverride = storedMethod;
            const persistedPorts = expectedServicePortsFromNodeResult(record.nodeResult, methodOverride);
            expectedRuntimePorts = persistedPorts.length
              ? persistedPorts
              : expectedServicePortsFromProbe(runtimeProbe, methodOverride);
            if (expectedRuntimePorts.length) {
              firewallProbe = await firewallService.inspectInstanceExposure({
                identity: record.identity,
                cloudInstance: probeContext.cloudInstance || {},
                expectedPorts: expectedRuntimePorts,
                readCache
              });
            }
            try {
              const result = await deploymentVerifier.verify({
                identity: record.identity,
                desired: record.desired,
                nodeResult: record.nodeResult,
                ssh: sshOptions(record),
                methodOverride,
                runtimeProbe,
                firewallProbe,
                expectedRuntimePorts
              });
              const effectiveResult = methodRecognition ? {
                ...result,
                methodConfidence: methodRecognition.confidence,
                methodSource: methodRecognition.source
              } : result;
              const firewallGovernance = await firewallGovernanceService.preview({ ...record, verification: effectiveResult }, { readCache });
              const governedResult = applyFirewallGovernanceRisk(effectiveResult, firewallGovernance);
              const merged = mergeVerificationEvidence(record, governedResult, { method: methodOverride || storedMethod });
              await recordStore.save({
                ...record,
                verification: merged.verification,
                observed: { ...(merged.observed || {}), firewallGovernance },
                history: appendHistory(record, merged.historyEntry)
              });
              return { ...governedResult, nodeResult: record.nodeResult || null };
            } catch (error) {
              const merged = mergeVerificationEvidence(record, error, { method: methodOverride || storedMethod });
              await recordStore.save({
                ...record,
                verification: merged.verification,
                observed: merged.observed,
                history: appendHistory(record, merged.historyEntry)
              });
              throw error;
            }
          }
        });
      }

      const exposureApplyRecordId = recordIdFrom(pathname, "/network-exposure/apply");
      if (method === "POST" && exposureApplyRecordId) {
        return runRecordJob({
          type: "network-exposure-apply",
          recordId: exposureApplyRecordId,
          stage: {
            name: "exposure_recheck",
            status: "running",
            detail: "写入前重新核对监听、密码版本与防火墙预览"
          },
          task: async (record, job) => {
            await assertLiveCloudWriteReady(record);
            const result = await networkExposureService.apply({
              record,
              fingerprint: request.body?.fingerprint,
              storedPreview: record.observed?.networkExposurePreview,
              onStage: (nextStage) => jobStore.setStage(job.id, nextStage)
            });
            await recordStore.save({
              ...record,
              desired: {
                ...(record.desired || {}),
                networkExposure: {
                  public: result.exposure?.public || [],
                  iap: result.exposure?.iap || []
                }
              },
              verification: {
                ...(record.verification || {}),
                checkedAt: result.checkedAt || new Date().toISOString(),
                ssh: result.ssh,
                firewall: {
                  ...(record.verification?.firewall || {}),
                  status: "isolated",
                  effectiveStatus: "isolated",
                  targetTag: result.firewall?.targetTag,
                  externalRuleNames: result.firewall?.externalRuleNames || []
                }
              },
              observed: {
                ...(record.observed || {}),
                sshConnection: result.ssh,
                sshAuthPolicy: result.sshPolicy,
                networkExposure: {
                  public: result.exposure?.public || [],
                  iap: result.exposure?.iap || [],
                  changes: result.exposure?.changes || {},
                  firewall: result.firewall,
                  checkedAt: result.checkedAt || new Date().toISOString()
                },
                firewallGovernance: {
                  ...(record.observed?.firewallGovernance || {}),
                  effectiveIsolation: result.firewall
                },
                networkExposurePreview: null
              },
              history: appendHistory(record, { type: "network-exposure-apply", status: result.status })
            });
            return result;
          }
        });
      }

      const localDeleteRecordId = recordIdFrom(pathname);
      if (method === "DELETE" && localDeleteRecordId) {
        return json(200, { deletedLocalRecord: await recordStore.remove(localDeleteRecordId) });
      }

      return json(404, { error: "Not found" });
    } catch (error) {
      const classified = classifyError(error);
      return json(classified.status, {
        error: classified.message,
        errorCategory: classified.category,
        code: classified.code,
        retryable: Boolean(classified.retryable),
        retryAttempts: Number(error?.retryAttempts || 1)
      });
    }
  }

  return { dispatch };
}
