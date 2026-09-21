import { toInstanceEvidenceView } from "../public/lib/instance-evidence-freshness-view-model.js";

const REQUIRED_APIS = ["compute.googleapis.com", "iam.googleapis.com", "iap.googleapis.com"];

function sanitizeEvidence(value) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, 240);
}

function check(id, group, label, status, reason, evidence = "", nextAction = "", actionRef = "") {
  return {
    id,
    group,
    label,
    status,
    reason,
    evidence: sanitizeEvidence(evidence),
    nextAction,
    actionRef,
    cloudWrite: false
  };
}

function summarize(checks) {
  const summary = { pass: 0, warning: 0, blocked: 0 };
  for (const item of checks) {
    if (item.status === "pass") summary.pass += 1;
    else if (item.status === "blocked") summary.blocked += 1;
    else summary.warning += 1;
  }
  return summary;
}

function overall(summary) {
  if (summary.blocked) return "blocked";
  if (summary.warning) return "warning";
  return "pass";
}

function configName(account = {}) {
  return account.configuration || account.name || "";
}

function normalizeContext(context = {}) {
  return {
    configuration: context.configuration || "",
    account: context.account || "",
    projectId: context.projectId || ""
  };
}

function dataArray(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.data)) return value.data;
  return [];
}

function recordName(record = {}) {
  return record.identity?.name || record.name || "";
}

function recordProject(record = {}) {
  return record.identity?.projectId || record.projectId || "";
}

function recordVerification(record = {}) {
  return record.verification || record.nodeResult?.verification || null;
}

function verificationPassed(value) {
  return ["passed", "pass", "succeeded", "ok", "matched"].includes(String(value || "").toLowerCase());
}

function verificationWarning(value) {
  return ["partial", "warning", "unknown", "unverified"].includes(String(value || "").toLowerCase());
}

function listLocalRecords(recordStore, context) {
  if (!recordStore?.list) return [];
  return recordStore.list({
    account: context.account || undefined,
    projectId: context.projectId || undefined
  });
}

async function loadFreeRules(freeRuleService, context) {
  if (freeRuleService?.readCached) return freeRuleService.readCached(context);
  if (freeRuleService?.load) return freeRuleService.load(context);
  return null;
}

async function addAccountChecks(checks, deps, context) {
  try {
    const accounts = await deps.accountService?.listConfigurations?.();
    const matched = (accounts || []).some((item) => (
      configName(item) === context.configuration && item.account === context.account
    ));
    checks.push(matched
      ? check("gcloud_accounts", "local", "gcloud 账号", "pass", "当前账号配置可读取。", context.account)
      : check("gcloud_accounts", "local", "gcloud 账号", "blocked", "未找到当前账号配置。", context.account || "未选择账号", "选择账号和项目后重新读取。", "reloadAccounts"));
  } catch (error) {
    checks.push(check("gcloud_accounts", "local", "gcloud 账号", "blocked", "读取账号失败。", error.message, "修复本机 gcloud 登录后重新读取。", "reloadAccounts"));
  }
}

async function addProxyCheck(checks, deps) {
  if (!deps.proxyInspector?.inspect) return;
  try {
    const proxy = await deps.proxyInspector.inspect();
    if (!proxy.configured) {
      checks.push(check("proxy_transport", "local", "网络通道", "pass", "当前未配置代理，gcloud 使用直接网络。", "direct"));
    } else if (proxy.status === "listening") {
      checks.push(check("proxy_transport", "local", "代理监听", "pass", "本地代理端口正在监听。", proxy.endpoint));
    } else {
      checks.push(check("proxy_transport", "local", "代理监听", "blocked", "已配置代理，但本地端口不可用。", proxy.endpoint || proxy.source, "启动代理或修正代理环境后重新体检。", "doctorRunBtn"));
    }
  } catch {
    checks.push(check("proxy_transport", "local", "网络通道", "warning", "无法确认本地代理监听状态。", "probe unavailable", "检查代理后重新体检。", "doctorRunBtn"));
  }
}

async function addProjectChecks(checks, deps, context) {
  if (!context.configuration || !context.account || !context.projectId) {
    checks.push(check("project_access", "project", "项目访问", "blocked", "账号或项目未选择。", context.projectId || "未选择项目", "选择账号和项目。", "useContext"));
    checks.push(check("api_services", "project", "所需 API", "blocked", "缺少项目上下文，无法读取 API 状态。", "compute / iam / iap", "先切换到可用项目。", "useContext"));
    return;
  }

  try {
    const projects = await deps.accountService?.listProjects?.({
      configuration: context.configuration,
      account: context.account
    });
    const hasProject = (projects || []).some((item) => item.projectId === context.projectId);
    checks.push(hasProject
      ? check("project_access", "project", "项目访问", "pass", "当前账号可读取项目。", context.projectId)
      : check("project_access", "project", "项目访问", "blocked", "当前账号未读取到这个项目。", context.projectId, "重新读取项目或切换账号。", "reloadAccounts"));
  } catch (error) {
    checks.push(check("project_access", "project", "项目访问", "blocked", "读取项目失败。", error.message, "重新读取项目。", "reloadAccounts"));
  }

  try {
    if (!deps.runner?.runJson) throw new Error("runner with runJson() is not available");
    const enabled = await deps.runner.runJson(["services", "list", "--enabled", "--format=json(config.name)"], {
      context,
      allowGlobal: true
    });
    const enabledNames = new Set(dataArray(enabled).map((item) => item.config?.name).filter(Boolean));
    const missing = REQUIRED_APIS.filter((name) => !enabledNames.has(name));
    checks.push(missing.length
      ? check("api_services", "project", "所需 API", "warning", "部分 API 未确认启用。", missing.join(" / "), "部署或维护前先确认 API。")
      : check("api_services", "project", "所需 API", "pass", "Compute、IAM、IAP 已确认启用。", REQUIRED_APIS.join(" / ")));
  } catch (error) {
    checks.push(check("api_services", "project", "所需 API", "warning", "API 状态读取失败。", error.message, "部署前检查 gcloud 权限。"));
  }
}

async function addCatalogChecks(checks, deps, context) {
  try {
    const catalog = await deps.regionCatalog?.load?.(context);
    const count = catalog?.regions?.length || 0;
    if (!count) {
      checks.push(check("region_catalog", "catalog", "区域目录", "warning", "未读取到可用区域目录。", catalog?.source?.kind || catalog?.source?.type || "empty", "重新读取数据。", "refreshAll"));
    } else if (catalog.stale) {
      checks.push(check("region_catalog", "catalog", "区域目录", "warning", "区域目录来自备用或过期缓存。", `${count} regions`, "重新读取数据。", "refreshAll"));
    } else {
      checks.push(check("region_catalog", "catalog", "区域目录", "pass", "区域目录可用。", `${count} regions`));
    }
  } catch (error) {
    checks.push(check("region_catalog", "catalog", "区域目录", "warning", "区域目录读取失败。", error.message, "重新读取数据。", "refreshAll"));
  }

  try {
    const rules = await loadFreeRules(deps.freeRuleService, context);
    const regions = rules?.rules?.compute?.alwaysFreeRegions || [];
    if (!regions.length) {
      checks.push(check("free_rules", "catalog", "免费规则", "warning", "未读取到 Always Free 区域规则。", rules?.source?.kind || rules?.source?.type || "empty", "更新规则提示。", "auditFreeRules"));
    } else if (rules.stale) {
      checks.push(check("free_rules", "catalog", "免费规则", "warning", "免费规则缓存已过期或来自备用数据。", regions.join(" / "), "更新规则提示。", "auditFreeRules"));
    } else {
      checks.push(check("free_rules", "catalog", "免费规则", "pass", "免费规则缓存可用。", regions.join(" / ")));
    }
  } catch (error) {
    checks.push(check("free_rules", "catalog", "免费规则", "warning", "免费规则读取失败。", error.message, "更新规则提示。", "auditFreeRules"));
  }
}

function syncStatus(records, instances) {
  if (!records.length && !instances.length) {
    return check("inventory_sync", "inventory", "清单同步", "warning", "当前项目还没有本地记录或云端实例。", "0 local / 0 cloud", "刷新清单或新建实例。", "refreshResources");
  }
  const cloudNames = new Set(instances.map((item) => item.name).filter(Boolean));
  const unmatched = records.filter((record) => recordName(record) && !cloudNames.has(recordName(record)));
  if (unmatched.length) {
    return check("inventory_sync", "inventory", "清单同步", "warning", "部分本地记录未在云端清单中匹配。", unmatched.map(recordName).join(" / "), "刷新清单或重新验证实例。", "refreshResources");
  }
  return check("inventory_sync", "inventory", "清单同步", "pass", "本地记录和云端清单可对照。", `${records.length} local / ${instances.length} cloud`);
}

function inventoryAgeLabel(seconds = 0) {
  const value = Math.max(0, Number(seconds || 0));
  if (value < 60) return `${value} 秒`;
  if (value < 3600) return `${Math.floor(value / 60)} 分钟`;
  if (value < 86400) return `${Math.floor(value / 3600)} 小时`;
  return `${Math.floor(value / 86400)} 天`;
}

function inventorySourceCheck(meta = {}) {
  const source = String(meta.source || "unknown");
  const attempts = Math.max(1, Number(meta.retryAttempts || 1));
  if (source === "live" && meta.stale !== true) {
    return check(
      "inventory_source",
      "inventory",
      "清单来源",
      "pass",
      "实例清单来自实时 Google API。",
      `live · ${attempts} 次请求`
    );
  }
  const blockerCode = sanitizeEvidence(meta.blocker?.code || meta.blocker?.category || "network");
  return check(
    "inventory_source",
    "inventory",
    "清单来源",
    "warning",
    "实时读取失败，当前实例清单来自本地缓存。",
    `cache · ${inventoryAgeLabel(meta.ageSeconds)}前 · ${attempts} 次尝试${blockerCode ? ` · ${blockerCode}` : ""}`,
    "恢复实时网络后刷新清单。",
    "refreshResources"
  );
}

function evidenceForRecord(record, now) {
  const desiredMethod = record?.desired?.deploy?.method;
  return toInstanceEvidenceView({
    verification: recordVerification(record),
    nodeResult: record?.nodeResult,
    observed: {
      ...(record?.observed || {}),
      methodIntent: desiredMethod ? {
        method: desiredMethod,
        source: "persisted",
        checkedAt: record?.updatedAt || record?.createdAt || ""
      } : record?.observed?.methodIntent
    },
    lastProbeAttempt: record?.observed?.lastProbeAttempt,
    now
  });
}

function runtimeRecords(records, now) {
  return records.map((record) => ({ record, evidence: evidenceForRecord(record, now) }));
}

function verificationState(records) {
  if (!records.length) {
    return check("verification_state", "runtime", "验证状态", "warning", "当前项目没有可展示的实例验证记录。", "no records", "选择实例后运行重新验证。", "verifyInstance");
  }
  const verified = records.filter((record) => (
    verificationPassed(recordVerification(record)?.status)
    && record?.observed?.lastProbeAttempt?.status !== "failed"
  ));
  const partial = records.filter((record) => verificationWarning(recordVerification(record)?.status));
  const failed = records.filter((record) => (
    String(recordVerification(record)?.status || "").toLowerCase() === "failed"
    || record?.observed?.lastProbeAttempt?.status === "failed"
  ));
  if (verified.length === records.length) {
    return check("verification_state", "runtime", "验证状态", "pass", "实例验证均已通过。", `${verified.length}/${records.length}`);
  }
  const reason = failed.length ? "部分实例最新探测失败或尚未通过完整验证。" : "部分实例尚未通过完整验证。";
  return check("verification_state", "runtime", "验证状态", "warning", reason, `${verified.length}/${records.length} 完整通过 · ${partial.length} 台部分通过${failed.length ? ` · ${failed.length} 台失败` : ""}`, "选择实例后运行智能诊断。", "verifyInstance");
}

function countValues(items) {
  const counts = new Map();
  for (const item of items.filter(Boolean)) counts.set(String(item), (counts.get(String(item)) || 0) + 1);
  return [...counts.entries()].map(([value, count]) => `${value}×${count}`).join(" / ");
}

function sshState(runtime) {
  if (!runtime.length) return check("ssh_state", "runtime", "SSH", "warning", "还没有确认 SSH 实际连接端口。", "no records", "选择实例后运行智能诊断。", "verifyInstance");
  const verified = runtime.filter(({ evidence }) => evidence.ssh.value?.verified);
  const historical = verified.filter(({ evidence }) => evidence.ssh.historical);
  const fallback = verified.filter(({ evidence }) => evidence.ssh.value?.fallback).length;
  const ports = countValues(verified.map(({ evidence }) => evidence.ssh.value?.actualPort));
  const allCurrent = verified.length === runtime.length && historical.length === 0;
  const reason = allCurrent
    ? "所有实例的 SSH 实际连接已同步。"
    : historical.length
      ? "部分 SSH 结果来自历史验证或最新探测失败。"
      : "部分实例还没有确认 SSH 实际连接端口。";
  const suffix = [ports, fallback ? `${fallback} 台回退` : "", historical.length ? `${historical.length} 条历史证据` : ""].filter(Boolean).join(" · ");
  return check("ssh_state", "runtime", "SSH", allCurrent ? "pass" : "warning", reason, `${verified.length}/${runtime.length} 已验证${suffix ? ` · ${suffix}` : ""}`, allCurrent ? "" : "选择实例后运行智能诊断。", allCurrent ? "" : "verifyInstance");
}

function firewallState(runtime) {
  if (!runtime.length) return check("firewall_state", "runtime", "防火墙", "warning", "还没有确认防火墙状态。", "no records", "选择实例后运行智能诊断。", "verifyInstance");
  const known = runtime.filter(({ evidence }) => evidence.firewall.value);
  const matched = known.filter(({ evidence }) => ["matched", "synced", "passed"].includes(evidence.firewall.value.status) && !evidence.firewall.historical);
  const overexposed = known.filter(({ evidence }) => evidence.firewall.value.status === "overexposed");
  const historical = known.filter(({ evidence }) => evidence.firewall.historical);
  const broadRules = [...new Set(overexposed.flatMap(({ evidence }) => evidence.firewall.value.broadRuleNames || []))];
  const allSafe = matched.length === runtime.length;
  const reason = overexposed.length
    ? "检测到防火墙规则过度开放。"
    : allSafe
      ? "所有实例的防火墙状态已同步并匹配。"
      : historical.length
        ? "部分防火墙结果来自历史验证。"
        : "部分实例的防火墙规则尚未完全匹配。";
  const evidence = [
    `${matched.length}/${runtime.length} 已匹配`,
    overexposed.length ? `${overexposed.length} 台过度开放` : "",
    broadRules.length ? `规则 ${broadRules.join(" / ")}` : "",
    historical.length ? `${historical.length} 条历史证据` : ""
  ].filter(Boolean).join(" · ");
  return check("firewall_state", "runtime", "防火墙", allSafe ? "pass" : "warning", reason, evidence, allSafe ? "" : "选择实例后运行智能诊断。", allSafe ? "" : "verifyInstance");
}

function bbrState(runtime) {
  if (!runtime.length) return check("bbr_state", "runtime", "BBR", "warning", "还没有读取到 BBR 启用证据。", "no records", "选择实例后运行智能诊断。", "verifyInstance");
  const enabled = runtime.filter(({ evidence }) => evidence.bbr.value?.enabled);
  const historical = enabled.filter(({ evidence }) => evidence.bbr.historical);
  const allCurrent = enabled.length === runtime.length && historical.length === 0;
  const reason = allCurrent
    ? "所有实例的 BBR 启用状态已同步。"
    : historical.length
      ? "部分 BBR 结果来自历史验证或最新探测失败。"
      : "部分实例还没有读取到 BBR 启用证据。";
  return check("bbr_state", "runtime", "BBR", allCurrent ? "pass" : "warning", reason, `${enabled.length}/${runtime.length} 已启用${historical.length ? ` · ${historical.length} 条历史证据` : ""}`, allCurrent ? "" : "选择实例后运行智能诊断。", allCurrent ? "" : "verifyInstance");
}

function nodeServiceState(runtime) {
  const applicable = runtime.filter(({ evidence }) => (
    ["singbox_plus", "three_x_ui", "custom_startup", "external_custom"].includes(evidence.method.value)
    || (Array.isArray(evidence.services.value) && evidence.services.value.length > 0)
  ));
  if (!applicable.length) return check("node_service_state", "runtime", "节点服务", "pass", "当前实例不要求节点服务验证。", "0 applicable");
  const active = applicable.filter(({ evidence }) => (
    Array.isArray(evidence.services.value)
    && evidence.services.value.some((service) => service.status === "active")
    && !evidence.services.historical
  ));
  const historical = applicable.filter(({ evidence }) => evidence.services.historical && evidence.services.value);
  const names = countValues(active.flatMap(({ evidence }) => evidence.services.value.filter((service) => service.status === "active").map((service) => service.name)));
  const links = applicable.reduce((total, { record }) => total + (record.nodeResult?.links?.length || 0), 0);
  const allCurrent = active.length === applicable.length;
  const reason = allCurrent
    ? "所有适用实例的节点服务状态已同步。"
    : historical.length
      ? "部分节点服务结果来自历史验证或最新探测失败。"
      : "部分适用实例还没有节点服务验证证据。";
  const evidence = [
    `${active.length}/${applicable.length} 运行中`,
    names,
    links ? `${links} 条链接` : "",
    historical.length ? `${historical.length} 条历史证据` : ""
  ].filter(Boolean).join(" · ");
  return check("node_service_state", "runtime", "节点服务", allCurrent ? "pass" : "warning", reason, evidence, allCurrent ? "" : "选择实例后运行智能诊断。", allCurrent ? "" : "verifyInstance");
}

async function addInventoryChecks(checks, deps, context, now) {
  let records = [];
  let instances = [];
  let inventoryMeta = null;
  try {
    records = await listLocalRecords(deps.recordStore, context);
    if (context.projectId) {
      records = records.filter((record) => !recordProject(record) || recordProject(record) === context.projectId);
    }
  } catch (error) {
    checks.push(check("inventory_sync", "inventory", "清单同步", "warning", "本地实例记录读取失败。", error.message, "刷新清单。", "refreshResources"));
    records = [];
  }

  try {
    const inventory = deps.cloudInventory || deps.inventory;
    if (context.configuration && context.account && context.projectId && inventory?.listInstancesSnapshot) {
      const snapshot = await inventory.listInstancesSnapshot(context);
      instances = Array.isArray(snapshot?.instances) ? snapshot.instances : [];
      inventoryMeta = snapshot?.meta || { source: "live", stale: false, retryAttempts: 1 };
    } else if (context.configuration && context.account && context.projectId && inventory?.listInstances) {
      instances = await inventory.listInstances(context);
      inventoryMeta = { source: "live", stale: false, retryAttempts: 1 };
    }
  } catch (error) {
    checks.push(check("inventory_sync", "inventory", "清单同步", "warning", "云端实例清单读取失败。", error.message, "刷新清单。", "refreshResources"));
    checks.push(check("inventory_source", "inventory", "清单来源", "warning", "实时清单和本地缓存均不可用。", error.message, "恢复网络后刷新清单。", "refreshResources"));
  }

  if (inventoryMeta) checks.push(inventorySourceCheck(inventoryMeta));
  if (!checks.some((item) => item.id === "inventory_sync")) {
    checks.push(syncStatus(records, instances));
  }
  const runtime = runtimeRecords(records, now);
  checks.push(verificationState(records));
  checks.push(sshState(runtime));
  checks.push(firewallState(runtime));
  checks.push(bbrState(runtime));
  checks.push(nodeServiceState(runtime));
}

export function createDoctorService(deps = {}) {
  const now = deps.now || (() => new Date());

  return {
    async run(context = {}) {
      const generatedAt = now().toISOString();
      const safeContext = normalizeContext(context);
      const checks = [];
      await addProxyCheck(checks, deps);
      await addAccountChecks(checks, deps, safeContext);
      await addProjectChecks(checks, deps, safeContext);
      await addCatalogChecks(checks, deps, safeContext);
      await addInventoryChecks(checks, deps, safeContext, generatedAt);
      const summary = summarize(checks);
      return {
        status: overall(summary),
        generatedAt,
        context: safeContext,
        summary,
        checks
      };
    }
  };
}
