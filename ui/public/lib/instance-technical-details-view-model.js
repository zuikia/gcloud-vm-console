import { toDeploymentRecognitionView } from "./deployment-recognition-view-model.js";
import { toFirewallGovernanceView } from "./firewall-governance-view-model.js";
import { toInstanceDiagnosticView } from "./node-result-view-model.js";
import { toInstanceEvidenceView } from "./instance-evidence-freshness-view-model.js";

function text(value = "", limit = 180) {
  const normalized = String(value || "").trim();
  return normalized.length > limit ? `${normalized.slice(0, limit - 3)}...` : normalized;
}

function compactRows(rows = []) {
  return rows
    .map((row) => ({ label: text(row.label, 48), value: text(row.value, 220) }))
    .filter((row) => row.value);
}

function attributeGroups(item = null, methodLabel = "未识别") {
  if (!item) return [];
  const desired = item.record?.desired || {};
  const network = {
    ...(item.cloud?.network || {}),
    ...(item.record?.observed?.network || {}),
    ...(desired.network || {})
  };
  const groups = [
    {
      id: "basic",
      label: "基础",
      rows: compactRows([
        { label: "来源", value: item.source || "" },
        { label: "机器", value: item.cloud?.machineType || desired.machineType || "" },
        { label: "系统", value: desired.image || "" },
        { label: "部署", value: methodLabel }
      ])
    },
    {
      id: "network",
      label: "网络",
      rows: compactRows([
        { label: "公网", value: network.externalIp || "" },
        { label: "公网类型", value: {
          static: "静态 IPv4",
          ephemeral: "临时 IPv4",
          none: "无公网 IPv4"
        }[network.externalIpMode] || "" },
        { label: "网络层级", value: network.networkTier || "" },
        { label: "网卡", value: network.nicType === "VIRTIO_NET" ? "VirtIO" : network.nicType || "" },
        { label: "网络", value: network.name || "" },
        { label: "子网", value: network.subnet || "" },
        { label: "位置", value: item.identity?.zone || "" }
      ])
    },
    {
      id: "identity",
      label: "身份",
      rows: compactRows([
        { label: "账号", value: item.identity?.account || "" },
        { label: "项目", value: item.identity?.projectId || "" }
      ])
    }
  ];
  return groups.filter((group) => group.rows.length);
}

function recognitionEvidence(view) {
  const rows = [];
  for (const item of view.evidence || []) {
    rows.push({ group: "识别证据", label: item.label || item.source, value: item.value });
  }
  for (const group of view.evidenceGroups || []) {
    for (const value of group.items || []) {
      rows.push({ group: group.title, label: group.title, value });
    }
  }
  for (const row of view.detailRows || []) {
    rows.push({ group: "探测细节", label: row.label, value: row.value });
  }
  return rows;
}

function diagnosticEvidence(view) {
  return (view.evidence || []).map((row) => ({
    group: "验证证据",
    label: row.label,
    value: row.value
  }));
}

function compactEvidence(rows = []) {
  return rows
    .map((row) => ({
      group: text(row.group || "证据", 48),
      label: text(row.label || "证据", 64),
      value: text(row.value || "", 220)
    }))
    .filter((row) => row.value)
    .slice(0, 24);
}

function issueSummary(diagnostic, hasVerification) {
  if (!hasVerification) {
    return {
      label: "验证问题",
      value: "尚未验证",
      note: "运行只读探测后显示问题摘要",
      tone: "muted",
      count: 0
    };
  }
  if (!diagnostic.issueCount) {
    return {
      label: "验证问题",
      value: "暂无待处理验证问题",
      note: "当前验证未发现需要恢复的项目",
      tone: "success",
      count: 0
    };
  }
  const first = diagnostic.issues[0];
  return {
    label: "验证问题",
    value: `${diagnostic.issueCount} 个问题`,
    note: `${first.label}：${first.detail}`,
    tone: first.tone === "danger" ? "danger" : "warning",
    count: diagnostic.issueCount
  };
}

function recoverySummary(diagnostic, hasVerification) {
  if (!hasVerification) {
    return {
      label: "恢复建议",
      value: "智能诊断",
      note: "先执行只读探测，不修改云端实例",
      tone: "info",
      actionId: "smartDiagnoseInstance"
    };
  }
  if (!diagnostic.recovery) {
    return {
      label: "恢复建议",
      value: "无需恢复操作",
      note: "当前状态无需额外处理",
      tone: "success",
      actionId: ""
    };
  }
  const step = diagnostic.recovery.steps[0] || null;
  return {
    label: "恢复建议",
    value: step?.label || diagnostic.recovery.headline || "智能诊断",
    note: step?.detail || diagnostic.recovery.explanation || "按现有受保护流程处理",
    tone: diagnostic.recovery.severity === "critical" ? "danger" : "warning",
    actionId: step?.id === "diagnose" || step?.id === "diagnose-again"
      ? "smartDiagnoseInstance"
      : step?.kind === "guided_write"
        ? "deployNodes"
        : "smartDiagnoseInstance"
  };
}

const SOURCE_LABELS = {
  verification: "历史验证",
  recognition: "SSH 深探测",
  nodeResult: "节点结果",
  observed: "运行观察",
  persisted: "本地配置",
  user_confirmed: "用户确认",
  none: "无证据"
};

const FRESHNESS_LABELS = {
  fresh: "最新",
  aging: "近期",
  stale: "已过期",
  unknown: "时间未知"
};

function evidenceNote(evidence, fallbackSource = "无证据") {
  const source = SOURCE_LABELS[evidence?.source] || fallbackSource;
  const freshness = FRESHNESS_LABELS[evidence?.freshness] || "时间未知";
  return `${source} · ${freshness}`;
}

function evidenceRows(evidenceView) {
  if (!evidenceView) return [];
  const latest = evidenceView.latestAttempt;
  const fields = [
    ["method", "部署证据"],
    ["ssh", "SSH 证据"],
    ["bbr", "BBR 证据"],
    ["firewall", "防火墙证据"],
    ["services", "服务证据"]
  ];
  const rows = fields.map(([key, label]) => {
    const evidence = evidenceView[key] || {};
    const source = SOURCE_LABELS[evidence.source] || evidence.source || "无证据";
    const freshness = FRESHNESS_LABELS[evidence.freshness] || "时间未知";
    return {
      group: "证据状态",
      label,
      value: `${source} · ${freshness} · ${evidence.checkedAt || "时间未知"}`
    };
  });
  if (latest) {
    rows.push({
      group: "证据状态",
      label: "最新尝试",
      value: latest.status === "failed"
        ? `失败 · ${latest.message || latest.category || "未获得可用结果"}`
        : `${latest.status} · ${FRESHNESS_LABELS[latest.freshness] || "时间未知"}`
    });
  }
  return rows;
}

export function toInstanceTechnicalDetailsView({
  item = null,
  recognition = null,
  recognitionPreview = null,
  verification = null,
  now = new Date().toISOString()
} = {}) {
  const preview = recognitionPreview || (recognition ? {
    checkedAt: recognition.checkedAt || item?.record?.observed?.lastProbeAttempt?.checkedAt || "",
    recognition
  } : null);
  const record = item?.record || {};
  const evidenceView = toInstanceEvidenceView({
    verification,
    recognitionPreview: preview,
    nodeResult: record.nodeResult,
    observed: record.observed || null,
    lastProbeAttempt: record?.observed?.lastProbeAttempt,
    now
  });
  const resolvedRecognition = {
    ...(recognition || {}),
    method: evidenceView.method.value || recognition?.method || "unmanaged_unknown",
    source: evidenceView.method.source || recognition?.source || "none"
  };
  const recognitionView = toDeploymentRecognitionView(resolvedRecognition, {
    hasLocalRecord: Boolean(item?.record?.id),
    hasCloudInstance: Boolean(item?.cloud)
  });
  const diagnostic = toInstanceDiagnosticView(verification);
  const governance = toFirewallGovernanceView(
    record?.observed?.firewallGovernance || verification?.firewallGovernance || null,
    { now }
  );
  const governanceIsPriority = governance.visible
    && !governance.pending
    && !governance.expired
    && ["critical", "high"].includes(governance.severity)
    && (!diagnostic.issueCount || diagnostic.issues[0]?.id === "firewall");
  const failedLatest = evidenceView.latestAttempt?.status === "failed";
  const issue = failedLatest ? {
    label: "验证问题",
    value: "最新探测失败",
    note: evidenceView.latestAttempt.message || "最后可用结果已保留，但当前状态需要重新确认",
    tone: "warning",
    count: Math.max(1, diagnostic.issueCount || 0)
  } : governanceIsPriority ? {
    label: "验证问题",
    value: `${Math.max(1, diagnostic.issueCount)} 个问题`,
    note: `防火墙：${governance.statusLabel}，${governance.rows[1]?.value || "影响范围未知"}`,
    tone: governance.tone,
    count: Math.max(1, diagnostic.issueCount)
  } : issueSummary(diagnostic, Boolean(verification));
  const recovery = failedLatest ? {
    label: "恢复建议",
    value: "智能诊断",
    note: "重新执行只读探测，不修改云端实例",
    tone: "warning",
    actionId: "smartDiagnoseInstance"
  } : governanceIsPriority ? {
    label: "恢复建议",
    value: "人工检查外部规则",
    note: governance.rows[2]?.detail || "外部共享规则不会由控制台自动修改",
    tone: governance.tone,
    actionId: ""
  } : recoverySummary(diagnostic, Boolean(verification));
  return {
    recognition: {
      label: "部署识别",
      value: recognitionView.headline,
      note: evidenceNote(evidenceView.method, recognitionView.source),
      tone: evidenceView.method.historical ? "warning" : recognitionView.tone
    },
    issue,
    recovery,
    attributeGroups: attributeGroups(item, recognitionView.headline),
    manualMethod: "auto",
    evidence: compactEvidence([
      ...evidenceRows(evidenceView),
      ...(governance.visible ? governance.rows.map((row) => ({ group: "防火墙治理", label: row.label, value: `${row.value} · ${row.detail}` })) : []),
      ...recognitionEvidence(recognitionView),
      ...diagnosticEvidence(diagnostic)
    ])
  };
}
