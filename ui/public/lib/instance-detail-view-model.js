import { supportsNodeDeployment } from "./action-readiness-view-model.js";
import { methodBadgeLabel } from "./deployment-recognition-view-model.js";
import { toFirewallGovernanceView } from "./firewall-governance-view-model.js";
import { toInstanceEvidenceView } from "./instance-evidence-freshness-view-model.js";

const STATUS_ORDER = Object.freeze([
  Object.freeze({ id: "ssh", label: "SSH" }),
  Object.freeze({ id: "bbr", label: "BBR" }),
  Object.freeze({ id: "firewall", label: "防火墙" }),
  Object.freeze({ id: "services", label: "服务" })
]);

function statusTone(value = "") {
  const normalized = String(value || "").toLowerCase();
  if (normalized.includes("running") || normalized.includes("managed")) return "running";
  if (normalized.includes("failed") || normalized.includes("error")) return "error";
  if (normalized.includes("terminated") || normalized.includes("stopped")) return "terminated";
  return "draft";
}

function checkById(verification = {}, ids = []) {
  const accepted = new Set(ids.map((id) => String(id).toLowerCase()));
  return (Array.isArray(verification.checks) ? verification.checks : [])
    .find((check) => accepted.has(String(check?.id || "").toLowerCase())) || null;
}

function pendingStatus(id, label) {
  return {
    id,
    label,
    value: "待探测",
    tone: "muted",
    detail: "尚无可用探测证据",
    source: "none"
  };
}

function sshStatus(ssh, source, fallbackCheck = null) {
  if (!ssh && !fallbackCheck) return null;
  if (!ssh) {
    const passed = fallbackCheck.status === "passed";
    return {
      id: "ssh",
      label: "SSH",
      value: passed ? "已验证" : "连接失败",
      tone: passed ? "success" : "danger",
      detail: String(fallbackCheck.detail || fallbackCheck.status || "SSH 状态已记录"),
      source
    };
  }
  const desiredPort = ssh.desiredPort == null ? null : Number(ssh.desiredPort);
  const actualPort = ssh.actualPort == null ? null : Number(ssh.actualPort);
  const verified = Boolean(ssh.verified);
  const fallback = Boolean(ssh.fallback);
  if (!verified) {
    return {
      id: "ssh",
      label: "SSH",
      value: desiredPort ? `未连接 ${desiredPort}` : "未连接",
      tone: "warning",
      detail: String(ssh.label || fallbackCheck?.detail || "SSH 尚未成功连接"),
      source
    };
  }
  const value = fallback && desiredPort && actualPort
    ? `${actualPort}（从 ${desiredPort} 回退）`
    : String(actualPort || desiredPort || "已连接");
  return {
    id: "ssh",
    label: "SSH",
    value,
    tone: fallback ? "warning" : "success",
    detail: fallback && desiredPort && actualPort
      ? `期望端口 ${desiredPort}，实际连接 ${actualPort}`
      : String(ssh.label || `实际连接 ${value}`),
    source
  };
}

function bbrStatus(bbr, source, fallbackCheck = null) {
  if (bbr === undefined && !fallbackCheck) return null;
  const enabled = typeof bbr === "boolean"
    ? bbr
    : bbr && typeof bbr === "object"
      ? Boolean(bbr.enabled)
      : fallbackCheck?.status === "passed";
  const detail = bbr && typeof bbr === "object"
    ? [bbr.congestionControl, bbr.qdisc].filter(Boolean).join(" / ")
    : String(fallbackCheck?.detail || "");
  return {
    id: "bbr",
    label: "BBR",
    value: enabled ? "已启用" : "未启用",
    tone: enabled ? "success" : "warning",
    detail: detail || (enabled ? "已确认使用 BBR" : "未检测到已启用的 BBR"),
    source
  };
}

function firewallStatus(firewall, source, fallbackCheck = null) {
  if (!firewall && !fallbackCheck) return null;
  const status = String(firewall?.status || fallbackCheck?.status || "unknown").toLowerCase();
  const matched = Array.isArray(firewall?.matchedPorts) ? firewall.matchedPorts.length : 0;
  const missing = Array.isArray(firewall?.missingPorts) ? firewall.missingPorts.length : 0;
  const ratio = matched || missing ? ` ${matched}/${matched + missing}` : "";
  const labels = {
    matched: "已匹配",
    synced: "已同步",
    passed: "已验证",
    isolated: "已按所选端口隔离",
    partial: `部分开放${ratio}`,
    missing: `未开放${ratio}`,
    overexposed: "过度开放",
    mismatch: "规则不匹配",
    failed: "探测失败",
    not_required: "无需检查",
    unknown: "状态未知"
  };
  const tone = ["matched", "synced", "passed", "isolated"].includes(status)
    ? "success"
    : ["overexposed", "failed"].includes(status)
      ? "danger"
      : ["partial", "missing", "mismatch"].includes(status)
        ? "warning"
        : "muted";
  return {
    id: "firewall",
    label: "防火墙",
    value: labels[status] || String(firewall?.status || fallbackCheck?.status || "状态未知"),
    tone,
    detail: String(firewall?.error || fallbackCheck?.detail || labels[status] || "防火墙状态已记录"),
    source
  };
}

function servicesStatus(services, source, fallbackCheck = null) {
  if (!Array.isArray(services) && !fallbackCheck) return null;
  if (!Array.isArray(services)) {
    const passed = fallbackCheck.status === "passed";
    return {
      id: "services",
      label: "服务",
      value: passed ? "已验证" : "状态异常",
      tone: passed ? "success" : "warning",
      detail: String(fallbackCheck.detail || fallbackCheck.status || "服务状态已记录"),
      source
    };
  }
  const active = services
    .filter((service) => String(service?.status || "").toLowerCase() === "active")
    .map((service) => String(service?.name || ""))
    .filter(Boolean);
  return {
    id: "services",
    label: "服务",
    value: active.length ? `${active.length} 项运行中` : "未发现运行服务",
    tone: active.length ? "success" : "warning",
    detail: active.length ? active.join("、") : "探测未发现运行中的目标服务",
    source
  };
}

function verificationStatus(record, id) {
  const verification = record?.verification;
  if (!verification) return null;
  if (id === "ssh") return sshStatus(verification.ssh, "verification", checkById(verification, ["ssh"]));
  if (id === "bbr") return bbrStatus(verification.bbr, "verification", checkById(verification, ["bbr"]));
  if (id === "firewall") return firewallStatus(verification.firewall, "verification", checkById(verification, ["firewall"]));
  return servicesStatus(verification.services, "verification", checkById(verification, ["service", "services"]));
}

function recognitionStatus(recognitionPreview, id) {
  const probes = recognitionPreview?.recognition?.probes;
  if (!probes) return null;
  if (id === "ssh") return sshStatus(probes.ssh, "recognition");
  if (id === "bbr") return bbrStatus(probes.bbr, "recognition");
  if (id === "firewall") return firewallStatus(probes.firewall, "recognition");
  return servicesStatus(probes.services, "recognition");
}

function nodeResultStatus(record, id) {
  const nodeResult = record?.nodeResult;
  if (!nodeResult) return null;
  if (id === "ssh") return sshStatus(nodeResult.ssh, "nodeResult");
  if (id === "bbr") return bbrStatus(nodeResult.bbr, "nodeResult");
  if (id === "firewall") return firewallStatus(nodeResult.firewall, "nodeResult");
  return servicesStatus(nodeResult.services, "nodeResult");
}

function observedStatus(record, id) {
  if (id !== "ssh") return null;
  return sshStatus(record?.observed?.sshConnection, "observed");
}

function statusFromEvidence(id, evidence) {
  if (!evidence?.value) return null;
  const status = id === "ssh"
    ? sshStatus(evidence.value, evidence.source)
    : id === "bbr"
      ? bbrStatus(evidence.value, evidence.source)
      : id === "firewall"
        ? firewallStatus(evidence.value, evidence.source)
        : servicesStatus(evidence.value, evidence.source);
  return status ? {
    ...status,
    tone: evidence.tone,
    checkedAt: evidence.checkedAt,
    freshness: evidence.freshness,
    historical: evidence.historical
  } : null;
}

function buildCanonicalStatuses(item, recognitionPreview, evidenceView) {
  return STATUS_ORDER.map(({ id, label }) => (
    statusFromEvidence(id, evidenceView?.[id])
    || verificationStatus(item?.record, id)
    || recognitionStatus(recognitionPreview, id)
    || nodeResultStatus(item?.record, id)
    || observedStatus(item?.record, id)
    || pendingStatus(id, label)
  ));
}

function governanceForItem(item, recognitionPreview) {
  return item?.record?.observed?.firewallGovernance
    || item?.record?.verification?.firewallGovernance
    || recognitionPreview?.firewallGovernance
    || null;
}

function addSshDualEntryContext(statuses, item) {
  const policy = item?.record?.observed?.sshAuthPolicy;
  const entries = Array.isArray(policy?.entries) ? policy.entries : [];
  const port22 = entries.find((entry) => Number(entry?.port) === 22);
  const port45400 = entries.find((entry) => Number(entry?.port) === 45400);
  const sshEvidence = item?.record?.verification?.ssh || item?.record?.observed?.sshConnection || null;
  const verifiedOn45400 = Boolean(sshEvidence?.verified) && Number(sshEvidence?.actualPort) === 45400 && !sshEvidence?.fallback;
  const policyReady = policy?.mode === "dual_entry"
    && port22?.authentication === "publickey,password"
    && port22?.exposure === "iap"
    && port45400?.authentication === "publickey"
    && String(port45400?.exposure || "").includes("public");
  if (!verifiedOn45400 || !policyReady) return statuses;
  return statuses.map((status) => status.id === "ssh" ? {
    ...status,
    value: "45400 · 双入口",
    detail: "公网 45400 已验证；22 保留为 IAP 救援入口",
    context: "22 IAP · 密钥 + 密码 · 45400 公网 · 密钥"
  } : status);
}

function addFirewallGovernanceContext(statuses, item, recognitionPreview, now) {
  const firewall = statuses.find((status) => status.id === "firewall");
  if (!firewall) return statuses;
  const governanceSource = governanceForItem(item, recognitionPreview);
  const effectiveIsolation = governanceSource?.effectiveIsolation;
  if (String(effectiveIsolation?.effectiveStatus || "").toLowerCase() === "isolated") {
    const externalRisk = Array.isArray(governanceSource?.externalActions) && governanceSource.externalActions.length > 0;
    return statuses.map((status) => status.id === "firewall" ? {
      ...status,
      value: "已按所选端口隔离",
      tone: "success",
      detail: effectiveIsolation.targetTag
        ? `唯一标签 ${effectiveIsolation.targetTag} 已启用实例级隔离`
        : "实例级端口隔离已验证",
      context: externalRisk
        ? "外部共享规则仍有项目级风险"
        : "仅保留所选公网端口与 IAP SSH"
    } : status);
  }
  const governance = toFirewallGovernanceView(
    governanceSource,
    { now, fallbackStatus: firewall }
  );
  if (!governance.visible) return statuses;
  const severe = !governance.pending && !governance.expired && ["critical", "high"].includes(governance.severity);
  const ownedFirewallStatus = String(item?.record?.verification?.firewall?.ownedStatus || "").toLowerCase();
  const instanceRuleContext = ownedFirewallStatus === "matched"
    ? "自有规则已匹配"
    : `实例规则${firewall.value}`;
  const context = governance.pending
    ? "项目影响待分析"
    : governance.expired
      ? "治理预览已过期"
      : severe
        ? `${instanceRuleContext} · ${governance.rows[1]?.value || "影响范围未知"}`
        : `${governance.rows[0]?.value || "项目治理"} · ${governance.rows[1]?.value || "影响范围未知"}`;
  return statuses.map((status) => status.id === "firewall" ? {
    ...status,
    ...(severe ? {
      value: governance.statusLabel,
      tone: governance.tone,
      detail: governance.rows[0]?.detail || status.detail,
      source: "firewallGovernance"
    } : {}),
    context
  } : status);
}

function effectiveMethod(item, recognitionPreview, evidenceView) {
  if (evidenceView?.method?.value) return evidenceView.method.value;
  const verificationMethod = item?.record?.verification?.method;
  const recognitionMethod = recognitionPreview?.recognition?.method;
  const nodeMethod = item?.record?.nodeResult?.type;
  const desiredMethod = item?.record?.desired?.deploy?.method;
  if (verificationMethod) return verificationMethod;
  if (recognitionMethod) return recognitionMethod;
  if (nodeMethod) return nodeMethod;
  if (desiredMethod) return desiredMethod;
  return item?.cloud ? "unmanaged_unknown" : "vm_only";
}

function buildHeader(item, recognitionPreview, evidenceView) {
  if (!item) {
    return {
      name: "未选择实例",
      status: "未选择",
      statusTone: "draft",
      externalIp: "",
      method: "unmanaged_unknown",
      methodLabel: "未识别",
      checkedAt: ""
    };
  }
  const status = item.cloud?.status || item.record?.status || "draft";
  const method = effectiveMethod(item, recognitionPreview, evidenceView);
  return {
    name: String(item.identity?.name || "未命名实例"),
    status: String(status),
    statusTone: statusTone(status),
    externalIp: String(item.cloud?.network?.externalIp || item.record?.observed?.network?.externalIp || ""),
    method,
    methodLabel: methodBadgeLabel(method),
    checkedAt: String(
      evidenceView?.latestAttempt?.checkedAt
      || item.record?.verification?.checkedAt
      || recognitionPreview?.checkedAt
      || item.record?.updatedAt
      || ""
    )
  };
}

function enabled(actionReadiness, id) {
  return Boolean(actionReadiness?.[id]?.enabled);
}

function hasRecognition(recognitionPreview) {
  const recognition = recognitionPreview?.recognition;
  return Boolean(recognition && recognition.method && recognition.method !== "unmanaged_unknown");
}

function hasProbeEvidence(item, recognitionPreview) {
  return Boolean(
    item?.record?.verification
    || recognitionPreview?.recognition?.probes
    || item?.record?.nodeResult
    || item?.record?.observed?.sshConnection
  );
}

function externalFirewallRecommendation(item, recognitionPreview, now) {
  const verification = item?.record?.verification;
  if (String(verification?.status || "").toLowerCase() !== "partial") return null;
  if (String(verification?.firewall?.status || "").toLowerCase() !== "overexposed") return null;
  const problemChecks = (Array.isArray(verification.checks) ? verification.checks : [])
    .filter((check) => !["passed", "succeeded", "ok"].includes(String(check?.status || "").toLowerCase()));
  if (problemChecks.some((check) => String(check?.id || "").toLowerCase() !== "firewall")) return null;
  const governance = toFirewallGovernanceView(governanceForItem(item, recognitionPreview), { now });
  const externalCount = Array.isArray(governanceForItem(item, recognitionPreview)?.externalActions)
    ? governanceForItem(item, recognitionPreview).externalActions.length
    : 0;
  if (
    governance.pending
    || governance.expired
    || !["critical", "high"].includes(governance.severity)
    || externalCount === 0
  ) return null;
  return {
    title: "人工检查外部规则",
    detail: `${governance.statusLabel}，${governance.rows[1]?.value || "影响范围待确认"}；外部共享规则仅提供人工建议，控制台不会自动修改。`,
    actionId: ""
  };
}

function buildRecommendation(item, recognitionPreview, actionReadiness, evidenceView, now) {
  if (!item) {
    return {
      title: "建议操作",
      detail: "从实例清单选择一台实例后显示下一步。",
      actionId: ""
    };
  }
  const record = item.record;
  if (evidenceView?.latestAttempt?.status === "failed" && enabled(actionReadiness, "smartDiagnoseInstance")) {
    return {
      title: "最新探测失败",
      detail: "已保留最后可用结果；重新运行智能诊断以确认当前状态。",
      actionId: "smartDiagnoseInstance"
    };
  }
  const verificationStatusValue = String(record?.verification?.status || "").toLowerCase();
  const nodeResult = record?.nodeResult;
  const hasNodeOutput = Boolean(
    (Array.isArray(nodeResult?.links) && nodeResult.links.length)
    || nodeResult?.panel
  );
  const firewallRecommendation = externalFirewallRecommendation(item, recognitionPreview, now);
  if (firewallRecommendation) return firewallRecommendation;
  if (!record?.id && item.cloud) {
    if (hasRecognition(recognitionPreview) && enabled(actionReadiness, "adoptLocalInstance")) {
      return {
        title: "建议接管",
        detail: "部署方式已经识别，确认后仅写入本地管理记录。",
        actionId: "adoptLocalInstance"
      };
    }
    return {
      title: "建议探测",
      detail: "先运行只读探测，确认部署方式、SSH、BBR、防火墙和服务状态。",
      actionId: "smartDiagnoseInstance"
    };
  }
  if (["partial", "failed"].includes(verificationStatusValue) && enabled(actionReadiness, "smartDiagnoseInstance")) {
    return {
      title: verificationStatusValue === "failed" ? "验证失败" : "验证未完全通过",
      detail: "保留现有结果并重新执行只读探测，确认当前实例状态。",
      actionId: "smartDiagnoseInstance"
    };
  }
  if (hasNodeOutput && enabled(actionReadiness, "showNodeResults")) {
    return {
      title: "节点结果可用",
      detail: "节点链接或面板信息已经生成，可直接查看和复制。",
      actionId: "showNodeResults"
    };
  }
  const method = effectiveMethod(item, recognitionPreview, evidenceView);
  if (supportsNodeDeployment(method) && enabled(actionReadiness, "deployNodes")) {
    return {
      title: "等待节点部署",
      detail: `当前部署方式为 ${methodBadgeLabel(method)}，可运行现有受确认保护的部署流程。`,
      actionId: "deployNodes"
    };
  }
  if (!hasProbeEvidence(item, recognitionPreview) && enabled(actionReadiness, "smartDiagnoseInstance")) {
    return {
      title: "建议探测",
      detail: "当前没有可靠运行状态，先执行只读探测。",
      actionId: "smartDiagnoseInstance"
    };
  }
  return {
    title: "实例状态已读取",
    detail: "可以修改当前部署，或基于此配置新建实例。",
    actionId: enabled(actionReadiness, "detailPrimary") ? "detailPrimary" : ""
  };
}

function includeAction(actionReadiness, id, { enabledOnly = false } = {}) {
  const action = actionReadiness?.[id];
  if (!action) return false;
  return enabledOnly ? Boolean(action.enabled) : true;
}

function buildActionGroups(item, recognitionPreview, actionReadiness, evidenceView) {
  const method = effectiveMethod(item, recognitionPreview, evidenceView);
  const configure = ["detailPrimary", "cloneVm"];
  if (
    item?.record?.id
    && supportsNodeDeployment(method)
    && includeAction(actionReadiness, "deployNodes")
  ) configure.push("deployNodes");
  const diagnose = ["smartDiagnoseInstance"].filter((id) => includeAction(actionReadiness, id));
  if (includeAction(actionReadiness, "adoptLocalInstance", { enabledOnly: true })) diagnose.push("adoptLocalInstance");
  const maintain = ["restartVm", "systemUpdate"].filter((id) => includeAction(actionReadiness, id));
  return [
    {
      id: "configure",
      title: "配置操作",
      description: "调整当前部署，或复用配置创建实例",
      actionIds: configure.filter((id) => includeAction(actionReadiness, id))
    },
    {
      id: "diagnose",
      title: "智能诊断",
      description: "只读探测，不修改云端实例",
      actionIds: diagnose
    },
    {
      id: "maintain",
      title: "维护操作",
      description: "执行前说明影响并要求确认",
      actionIds: maintain
    }
  ];
}

function buildDisclosureSummaries(item) {
  const nodeResult = item?.record?.nodeResult;
  const links = Array.isArray(nodeResult?.links) ? nodeResult.links.length : 0;
  const nodeParts = [];
  if (links) nodeParts.push(`${links} 条节点链接`);
  if (nodeResult?.panel) nodeParts.push("3X-UI 面板可用");
  return {
    technicalSummary: item
      ? "机器、系统、网络、识别证据和验证问题"
      : "选择实例后显示技术详情",
    nodeSummary: nodeParts.join(" · ") || "暂无节点结果",
    dangerSummary: item?.record?.id
      ? "移除本地记录等高风险操作，需要二次确认"
      : "当前没有可用的本地危险操作"
  };
}

function groupForRecommendation(recommendation) {
  if (["detailPrimary", "cloneVm", "deployNodes"].includes(recommendation.actionId)) return "configure";
  if (["smartDiagnoseInstance", "adoptLocalInstance"].includes(recommendation.actionId)) return "diagnose";
  if (["restartVm", "systemUpdate"].includes(recommendation.actionId)) return "maintain";
  return "";
}

export function toInstanceDetailView({
  item = null,
  recognitionPreview = null,
  actionReadiness = {},
  now = new Date().toISOString()
} = {}) {
  const record = item?.record || {};
  const desiredMethod = record?.desired?.deploy?.method;
  const evidenceView = toInstanceEvidenceView({
    verification: record.verification,
    recognitionPreview,
    nodeResult: record.nodeResult,
    observed: {
      ...(record.observed || {}),
      methodIntent: desiredMethod ? {
        method: desiredMethod,
        source: record?.migration?.adoption?.recognition?.source === "user_confirmed" ? "user_confirmed" : "persisted",
        checkedAt: record.updatedAt || record.createdAt || ""
      } : record?.observed?.methodIntent
    },
    lastProbeAttempt: record?.observed?.lastProbeAttempt,
    now
  });
  const recommendation = buildRecommendation(item, recognitionPreview, actionReadiness, evidenceView, now);
  const statuses = addFirewallGovernanceContext(
    addSshDualEntryContext(buildCanonicalStatuses(item, recognitionPreview, evidenceView), item),
    item,
    recognitionPreview,
    now
  );
  return {
    empty: !item,
    header: buildHeader(item, recognitionPreview, evidenceView),
    statuses,
    recommendation,
    groups: buildActionGroups(item, recognitionPreview, actionReadiness, evidenceView),
    disclosures: buildDisclosureSummaries(item),
    autoOpenGroupId: groupForRecommendation(recommendation),
    evidence: evidenceView
  };
}
