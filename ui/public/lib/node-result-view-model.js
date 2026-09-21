import { toVerificationRecoveryView } from "./verification-recovery-view-model.js";

const METHOD_LABELS = {
  singbox_plus: "Sing-Box-Plus",
  three_x_ui: "3X-UI",
  custom_startup: "自定义脚本",
  vm_only: "只开实例"
};

const LINK_LABELS = {
  "hy2-obfs-warp": "HY2 obfs WARP",
  "tuic-v5-warp": "TUIC v5 WARP",
  "hy2-obfs": "HY2 obfs 直连",
  "tuic-v5": "TUIC v5 直连",
  "vless-reality": "VLESS Reality",
  vmess: "VMess"
};

const LINK_ORDER = ["hy2-obfs-warp", "tuic-v5-warp", "hy2-obfs", "tuic-v5", "vless-reality", "vmess"];

const FIREWALL_ACTION_LABELS = {
  created: "已创建",
  updated: "已更新",
  unchanged: "无需变更",
  skipped: "已跳过",
  synced: "已同步"
};

function methodLabel(method) {
  return METHOD_LABELS[method] || String(method || "未确认");
}

function linkLabel(link = {}) {
  return LINK_LABELS[String(link.name || "").toLowerCase()] || String(link.name || "节点链接");
}

function normalizeLinks(links = []) {
  return [...(Array.isArray(links) ? links : [])]
    .map((link) => ({
      name: String(link.name || ""),
      label: linkLabel(link),
      protocol: String(link.protocol || link.transport || ""),
      port: String(link.port || ""),
      url: String(link.url || ""),
      copyValue: String(link.url || ""),
      meta: [link.protocol || link.transport, link.port].filter(Boolean).join(" / ")
    }))
    .filter((link) => link.url)
    .sort((a, b) => {
      const ai = LINK_ORDER.indexOf(a.name);
      const bi = LINK_ORDER.indexOf(b.name);
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    });
}

function normalizePanel(panel) {
  if (!panel) return null;
  const rows = [
    { label: "面板地址", value: panel.url || "", kind: "url" },
    { label: "用户名", value: panel.username || "", kind: "text" },
    { label: "密码", value: panel.password || "", kind: "secret" }
  ].filter((row) => row.value);
  if (!rows.length) return null;
  return {
    title: "3X-UI 面板",
    port: String(panel.port || ""),
    webBasePath: String(panel.webBasePath || ""),
    rows: rows.map((row) => ({
      ...row,
      value: String(row.value),
      copyValue: String(row.value)
    }))
  };
}

function normalizeSsh(ssh = null) {
  if (!ssh) return null;
  const desiredPort = ssh.desiredPort == null ? null : Number(ssh.desiredPort);
  const actualPort = ssh.actualPort == null ? null : Number(ssh.actualPort);
  const verified = Boolean(ssh.verified);
  const fallback = Boolean(ssh.fallback);
  return {
    desiredPort,
    actualPort,
    fallback,
    verified,
    desiredLabel: desiredPort ? `SSH 期望端口 ${desiredPort}` : "SSH 期望端口未设置",
    actualLabel: verified && actualPort ? `SSH 实际连接 ${actualPort}` : "SSH 实际连接未知",
    label: ssh.label || (verified && actualPort
      ? fallback && desiredPort
        ? `SSH 实际连接 ${actualPort}（已从 ${desiredPort} 回退）`
        : `SSH 实际连接 ${actualPort}`
      : "SSH 未验证")
  };
}

function normalizeFirewallRules(rules = []) {
  return (Array.isArray(rules) ? rules : []).map((rule) => ({
    ...rule,
    actionLabel: FIREWALL_ACTION_LABELS[rule?.action] || String(rule?.action || "已同步")
  }));
}

function firewallView(firewall = null) {
  if (!firewall) return { status: "", label: "防火墙状态未知", tone: "draft", rules: [], error: "" };
  if (firewall.status === "not_required") {
    return { status: "not_required", label: "无需同步防火墙", tone: "draft", rules: [], error: "" };
  }
  if (firewall.status === "failed") {
    return {
      status: "failed",
      label: "防火墙同步失败",
      tone: "error",
      rules: normalizeFirewallRules(firewall.rules),
      error: firewall.error || "请在维护操作中重试同步"
    };
  }
  return {
    status: firewall.status || "synced",
    label: "防火墙已同步",
    tone: "running",
    rules: normalizeFirewallRules(firewall.rules),
    error: ""
  };
}

function verificationStateLabel(status) {
  return {
    passed: "验证通过",
    partial: "部分通过",
    failed: "验证失败",
    unknown: "未验证"
  }[status] || "未验证";
}

function verificationTone(status) {
  if (status === "passed") return "running";
  if (status === "partial") return "cloud";
  if (status === "failed") return "error";
  return "draft";
}

function verificationCheckTone(status) {
  if (status === "passed") return "running";
  if (status === "failed") return "error";
  if (status === "partial") return "cloud";
  return "draft";
}

function verificationFirewallView(firewall = null) {
  const status = firewall?.status || "unknown";
  const matched = Array.isArray(firewall?.matchedPorts) ? firewall.matchedPorts.length : 0;
  const missing = Array.isArray(firewall?.missingPorts) ? firewall.missingPorts.length : 0;
  const ratio = matched || missing ? ` ${matched}/${matched + missing}` : "";
  return {
    status,
    label: {
      matched: `防火墙已开放${ratio}`,
      partial: `防火墙部分开放${ratio}`,
      missing: `防火墙未开放${ratio}`,
      overexposed: "防火墙过度开放",
      mismatch: "防火墙不匹配",
      not_required: "无需防火墙",
      unknown: "防火墙未知"
    }[status] || "防火墙未知",
    tone: status === "matched" || status === "not_required"
      ? "running"
      : status === "unknown"
        ? "draft"
        : status === "overexposed"
          ? "error"
          : "cloud",
    rules: Array.isArray(firewall?.rules) ? firewall.rules : [],
    error: firewall?.error || ""
  };
}

function verificationBbrView(bbr = null) {
  if (typeof bbr === "boolean") {
    return {
      enabled: bbr,
      label: bbr ? "BBR 已开启" : "BBR 未开启",
      detail: bbr ? "bbr" : "未确认拥塞控制算法",
      tone: bbr ? "running" : "cloud"
    };
  }
  if (!bbr || typeof bbr !== "object") {
    return { enabled: false, label: "BBR 未确认", detail: "尚未探测", tone: "draft" };
  }
  const detail = [bbr.congestionControl || "", bbr.qdisc || ""].filter(Boolean).join(" / ");
  return {
    enabled: Boolean(bbr.enabled),
    label: bbr.enabled ? "BBR 已开启" : "BBR 未开启",
    detail: detail || "尚未探测",
    tone: bbr.enabled ? "running" : "cloud"
  };
}

export function toNodeResultView(nodeResult, {
  deployMethod = "",
  hasLocalRecord = true,
  sshConnection = null
} = {}) {
  if (!nodeResult) {
    const emptyMessage = !hasLocalRecord
      ? "未接管，部署后会生成节点结果"
      : deployMethod === "vm_only"
      ? "只开实例，不会生成节点链接"
      : "尚未部署节点";
    return {
      empty: true,
      emptyMessage,
      statusLabel: "未部署",
      statusTone: "draft",
      methodLabel: methodLabel(deployMethod),
      links: [],
      panel: null,
      bbr: { label: "BBR 未确认", tone: "draft" },
      firewall: firewallView(null),
      ssh: normalizeSsh(sshConnection),
      warnings: []
    };
  }

  const method = nodeResult.type || deployMethod;
  const firewall = firewallView(nodeResult.firewall);
  const ssh = normalizeSsh(nodeResult.ssh || sshConnection);
  const warnings = [];
  if (firewall.status === "failed") warnings.push(`防火墙同步失败：${firewall.error}`);
  if (ssh?.fallback) warnings.push(`SSH 自定义端口未验证，当前通过 ${ssh.actualPort} 连接`);

  return {
    empty: false,
    emptyMessage: "",
    statusLabel: nodeResult.status || "已收集",
    statusTone: firewall.status === "failed" ? "cloud" : "running",
    methodLabel: methodLabel(method),
    links: normalizeLinks(nodeResult.links),
    panel: normalizePanel(nodeResult.panel),
    bbr: nodeResult.bbr === undefined
      ? { label: "BBR 未确认", tone: "draft" }
      : { label: nodeResult.bbr ? "BBR 已开启" : "BBR 未确认", tone: nodeResult.bbr ? "running" : "draft" },
    firewall,
    ssh,
    warnings
  };
}

export function toVerificationView(verification) {
  if (!verification) {
    return {
      empty: true,
      stateLabel: "未验证",
      stateTone: "draft",
      sshLabel: "SSH 未验证",
      bbr: verificationBbrView(null),
      rows: [],
      firewall: verificationFirewallView(null),
      warnings: [],
      checkedAt: "",
      recovery: toVerificationRecoveryView(null)
    };
  }
  const rows = (Array.isArray(verification.checks) ? verification.checks : []).map((check) => ({
    id: String(check.id || ""),
    label: String(check.label || check.id || "检查项"),
    status: String(check.status || "unknown"),
    tone: verificationCheckTone(check.status),
    detail: String(check.detail || check.status || "-")
  }));
  return {
    empty: false,
    stateLabel: verificationStateLabel(verification.status),
    stateTone: verificationTone(verification.status),
    sshLabel: verification.ssh?.label || (verification.ssh?.verified ? `SSH 实际连接 ${verification.ssh.actualPort}` : "SSH 未验证"),
    bbr: verificationBbrView(verification.bbr),
    rows,
    firewall: verificationFirewallView(verification.firewall),
    warnings: Array.isArray(verification.warnings) ? verification.warnings.map(String) : [],
    checkedAt: String(verification.checkedAt || ""),
    recovery: toVerificationRecoveryView(verification)
  };
}

function normalizeIssueText(value = "") {
  return String(value || "")
    .toLowerCase()
    .replace(/[：:，,。；;、\s]+/g, "");
}

function safeDiagnosticValue(value = "", limit = 220) {
  return String(value || "")
    .replace(/\b(?:vless|vmess|hy2|hysteria2|tuic|trojan|ss):\/\/\S+/gi, "[redacted-link]")
    .replace(/\b(password|passwd|token|secret|private[_-]?key)\s*[=:]\s*\S+/gi, "$1=[redacted]")
    .slice(0, limit);
}

function warningDuplicatesRow(warning, rows) {
  const normalized = normalizeIssueText(warning);
  return rows.some((row) => {
    const label = normalizeIssueText(row.label);
    const detail = normalizeIssueText(row.detail);
    return label.length >= 2 && normalized.includes(label)
      && (!detail || normalized.includes(detail) || normalized.startsWith(label));
  });
}

function diagnosticWarningEligible(warning = "") {
  return !/(?:vless|vmess|hy2|hysteria2|tuic|trojan|ss):\/\/|password\s*[=:]|passwd\s*[=:]|token\s*[=:]|private[_-]?key\s*[=:]/i
    .test(String(warning || ""));
}

function diagnosticIssueTone(row, verification) {
  const id = String(row.id || "").toLowerCase();
  const firewallStatus = String(verification?.firewall?.status || "").toLowerCase();
  if (id === "firewall" && firewallStatus === "overexposed") return "danger";
  if (["ssh", "service", "services"].includes(id) && row.status === "failed") return "danger";
  return "warning";
}

function issueSortValue(issue) {
  return issue.tone === "danger" ? 0 : 1;
}

export function toInstanceDiagnosticView(verification) {
  const verificationView = toVerificationView(verification);
  if (verificationView.empty) {
    return { empty: true, issues: [], issueCount: 0, recovery: null, evidence: [] };
  }

  const issueRows = verificationView.rows
    .filter((row) => row.status !== "passed")
    .map((row, index) => ({
      id: row.id || `check-${index}`,
      label: safeDiagnosticValue(row.label || "检查项", 80),
      detail: safeDiagnosticValue(row.detail || row.status || "需要复核"),
      tone: diagnosticIssueTone(row, verification),
      order: index
    }));
  const warningIssues = verificationView.warnings
    .filter(diagnosticWarningEligible)
    .filter((warning) => !warningDuplicatesRow(warning, issueRows))
    .map((warning, index) => ({
      id: `warning-${index}`,
      label: "提示",
      detail: safeDiagnosticValue(warning),
      tone: "warning",
      order: issueRows.length + index
    }));
  const issues = [...issueRows, ...warningIssues]
    .sort((a, b) => issueSortValue(a) - issueSortValue(b) || a.order - b.order)
    .map(({ order, ...issue }) => issue);
  const recoverySource = verificationView.recovery;
  const recovery = recoverySource && recoverySource.severity !== "ok" && issues.length
    ? {
        severity: recoverySource.severity,
        headline: safeDiagnosticValue(recoverySource.headline || "恢复建议", 100),
        explanation: safeDiagnosticValue(recoverySource.explanation || "暂无恢复建议。"),
        steps: (Array.isArray(recoverySource.actions) ? recoverySource.actions : [])
          .map((item, index) => ({
            id: String(item.id || `step-${index}`),
            label: safeDiagnosticValue(item.label || "下一步", 100),
            detail: safeDiagnosticValue(item.detail || ""),
            kind: item.kind === "guided_write" ? "guided_write" : "read",
            order: index
          }))
          .sort((a, b) => (a.kind === "read" ? 0 : 1) - (b.kind === "read" ? 0 : 1) || a.order - b.order)
          .map(({ order, ...step }) => step),
        nodeLinksStillUsable: Boolean(recoverySource.nodeLinksStillUsable)
      }
    : null;
  const evidence = (Array.isArray(recoverySource?.evidence) ? recoverySource.evidence : [])
    .map((item) => ({
      label: safeDiagnosticValue(item.label || "证据", 80),
      value: safeDiagnosticValue(item.value || "")
    }))
    .filter((item) => item.value);

  return {
    empty: false,
    issues,
    issueCount: issues.length,
    recovery,
    evidence
  };
}
