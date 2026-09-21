import { buildNetworkExposurePreview } from "./network-exposure-policy.js";
import { cloudIdentityKey, normalizeVmIdentity } from "./vm-identity.js";
import { sanitizePublicError } from "./network-error-classifier.js";

export function createNetworkExposureService({
  inventory,
  firewallService,
  sshDualEntryService,
  secretStore,
  taskLock,
  now = () => new Date().toISOString()
} = {}) {
  if (!inventory?.listInstances) throw new Error("inventory with listInstances() is required.");
  if (!firewallService?.listRules || !firewallService?.ensureOwnedRule || !firewallService?.ensureOwnedDenyRule ||
      !firewallService?.ensureInstanceTag || !firewallService?.setOwnedRuleDisabled) {
    throw new Error("firewallService with network exposure methods is required.");
  }
  if (!sshDualEntryService?.apply || !sshDualEntryService?.verifyPublic45400 || !sshDualEntryService?.verifyIap22Path) {
    throw new Error("sshDualEntryService with apply and connectivity verification is required.");
  }
  if (!secretStore?.publicStatus || !secretStore?.readSshPassword) throw new Error("secretStore is required.");
  if (!taskLock?.run) throw new Error("taskLock with run() is required.");

  async function preview(record, { selection = {}, instances = null, rules = null, secretStatus = null } = {}) {
    const identity = normalizeVmIdentity(record?.identity || {});
    const [liveInstances, liveRules, localSecretStatus] = await Promise.all([
      Array.isArray(instances) ? instances : inventory.listInstances(identity),
      Array.isArray(rules) ? rules : firewallService.listRules(identity),
      secretStatus || secretStore.publicStatus()
    ]);
    return buildNetworkExposurePreview({
      record,
      instances: liveInstances,
      rules: liveRules,
      selection,
      secretStatus: localSecretStatus,
      now: now()
    });
  }

  async function apply({ record, fingerprint, storedPreview, onStage = null } = {}) {
    const identity = normalizeVmIdentity(record?.identity || {});
    const requestedFingerprint = String(fingerprint || "");
    if (!requestedFingerprint || requestedFingerprint !== String(storedPreview?.fingerprint || "")) {
      throw new Error("端口策略预览指纹不匹配，请重新生成预览。");
    }
    if (new Date(storedPreview?.expiresAt || 0).getTime() <= new Date(now()).getTime()) {
      throw new Error("端口策略预览已过期，请重新运行只读探测并生成预览。");
    }

    return taskLock.run(cloudIdentityKey(identity), async () => {
      const secret = await secretStore.readSshPassword();
      const current = await preview(record, { selection: storedPreview.selection });
      if (current.fingerprint !== requestedFingerprint) throw new Error("端口策略预览指纹已变化，请重新生成预览。");
      if (!current.coverage.ready) throw new Error(current.coverage.blockedReason || "当前端口策略不可执行。");

      await onStage?.({ name: "exposure_recheck", status: "succeeded", detail: "实时实例、监听、密码版本和防火墙指纹一致" });
      const allowActions = current.isolation.ruleActions.filter((action) => action.action === "ensure-allow");
      const denyAction = current.isolation.ruleActions.find((action) => action.action === "ensure-deny");
      const changes = [];
      for (const action of allowActions) {
        const result = await firewallService.ensureOwnedRule({ identity, ...action });
        changes.push({
          name: action.name,
          purpose: action.purpose,
          action: result.action,
          protocol: action.protocol,
          ports: action.ports,
          priority: action.priority,
          sourceRanges: action.sourceRanges,
          targetTags: action.targetTags
        });
      }
      await onStage?.({ name: "exposure_allow", status: "succeeded", detail: `${allowActions.length} 条 allow 规则已核对` });

      const denyResult = await firewallService.ensureOwnedDenyRule({ identity, ...denyAction, disabled: true });
      changes.push({
        name: denyAction.name,
        purpose: denyAction.purpose,
        action: denyResult.action,
        priority: denyAction.priority,
        disabled: true,
        sourceRanges: denyAction.sourceRanges,
        targetTags: denyAction.targetTags
      });
      if (current.isolation.tagAction === "add") {
        await firewallService.ensureInstanceTag({ identity, tag: current.isolation.targetTag });
      }
      await onStage?.({ name: "exposure_isolation_prepare", status: "succeeded", detail: "隔离标签和禁用状态 deny 已准备" });

      const sshResult = await sshDualEntryService.apply({
        identity,
        ssh: record.desired?.ssh || {},
        password: secret.password,
        passwordVersion: secret.versionId,
        onStage
      });

      const externalIp = record.observed?.network?.externalIp || "";
      await sshDualEntryService.verifyPublic45400({ identity, ssh: record.desired?.ssh || {}, externalIp });
      await onStage?.({ name: "exposure_pre_enable", status: "succeeded", detail: "启用 deny 前已验证公网 45400" });

      let denyEnabled = false;
      try {
        await firewallService.setOwnedRuleDisabled({ identity, name: denyAction.name, disabled: false });
        denyEnabled = true;
        await onStage?.({ name: "exposure_enable", status: "succeeded", detail: "实例级 deny 已启用" });
        await sshDualEntryService.verifyPublic45400({ identity, ssh: record.desired?.ssh || {}, externalIp });
        await sshDualEntryService.verifyIap22Path({ identity });
        await onStage?.({ name: "exposure_post_verify", status: "succeeded", detail: "公网 45400 与 IAP 22 网络路径已复核" });
      } catch (error) {
        const detail = sanitizePublicError(error?.message || error);
        if (denyEnabled) {
          await firewallService.setOwnedRuleDisabled({ identity, name: denyAction.name, disabled: true });
          await onStage?.({ name: "exposure_rollback", status: "succeeded", detail: "最终连通性失败，自有 deny 已禁用回滚" });
          throw new Error(`最终连通性验证失败，自有 deny 已回滚：${detail}`);
        }
        throw error;
      }

      return {
        status: "succeeded",
        ssh: sshResult.ssh,
        sshPolicy: sshResult.policy,
        exposure: {
          public: current.desiredExposure.public,
          iap: current.desiredExposure.iap,
          changes: current.changes
        },
        firewall: {
          effectiveStatus: "isolated",
          targetTag: current.isolation.targetTag,
          allowPriority: current.isolation.allowPriority,
          denyPriority: current.isolation.denyPriority,
          externalRuleNames: current.isolation.externalRuleNames,
          changes
        },
        previewFingerprint: current.fingerprint,
        checkedAt: now()
      };
    });
  }

  return { apply, preview };
}
