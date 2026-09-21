function safeText(value, fallback = "") {
  return String(value || fallback)
    .replace(/\b(?:vmess|vless|trojan|ss|hysteria2?|hy2|tuic):\/\/\S+/gi, "[已隐藏链接]")
    .replace(/\b(?:password|passwd|token|secret|private[_ -]?key|credential)\s*[:=]\s*\S+/gi, "$1=[已隐藏]")
    .replace(/[\r\n\t]+/g, " ")
    .trim()
    .slice(0, 160);
}

function toneFor(severity) {
  if (severity === "critical" || severity === "high") return "danger";
  if (severity === "warning") return "warning";
  return "success";
}

function severityLabel(severity) {
  return {
    critical: "严重风险",
    high: "高风险",
    warning: "需要注意",
    safe: "未发现高风险"
  }[severity] || "状态未知";
}

function pendingView(fallbackStatus) {
  if (!fallbackStatus || typeof fallbackStatus !== "object") return null;
  const value = safeText(fallbackStatus.value);
  const rawDetail = safeText(fallbackStatus.detail, "实例级防火墙状态已读取");
  const detail = rawDetail === value ? "实例级防火墙状态已读取" : rawDetail;
  if (
    !value
    || fallbackStatus.source === "none"
    || ["待探测", "状态未知", "无需检查"].includes(value)
  ) return null;
  const tone = fallbackStatus.tone === "danger"
    ? "danger"
    : fallbackStatus.tone === "warning"
      ? "warning"
      : "muted";
  return {
    visible: true,
    pending: true,
    tone,
    severity: "unknown",
    expired: false,
    canApply: false,
    fingerprint: "",
    ruleNames: [],
    overflowCount: 0,
    statusLabel: "待分析",
    rows: [
      { label: "当前信号", value, detail },
      { label: "项目影响", value: "待分析", detail: "运行只读探测后统计项目规则和受影响实例" },
      { label: "处理边界", value: "尚无执行预览", detail: "外部共享规则始终只提供人工建议，不会自动修改" }
    ]
  };
}

export function toFirewallGovernanceView(governance, {
  now = new Date().toISOString(),
  fallbackStatus = null
} = {}) {
  if (!governance || typeof governance !== "object") {
    return pendingView(fallbackStatus)
      || { visible: false, canApply: false, rows: [], ruleNames: [], overflowCount: 0 };
  }
  const findings = Array.isArray(governance.findings) ? governance.findings : [];
  const severityRank = { critical: 0, high: 1, warning: 2 };
  const risky = findings
    .filter((finding) => Object.hasOwn(severityRank, finding?.severity))
    .sort((a, b) => severityRank[a.severity] - severityRank[b.severity]
      || (Array.isArray(b?.affectedInstances) ? b.affectedInstances.length : 0)
        - (Array.isArray(a?.affectedInstances) ? a.affectedInstances.length : 0));
  const names = risky.map((finding) => safeText(finding?.name)).filter(Boolean);
  const ruleNames = names.slice(0, 3);
  const overflowCount = Math.max(0, names.length - ruleNames.length);
  const affected = Array.isArray(governance.affectedInstances) ? governance.affectedInstances.length : 0;
  const ownedCount = Array.isArray(governance.ownedActions) ? governance.ownedActions.length : 0;
  const externalCount = Array.isArray(governance.externalActions) ? governance.externalActions.length : 0;
  const expiresAt = Date.parse(String(governance.expiresAt || ""));
  const current = Date.parse(String(now || ""));
  const expired = !Number.isFinite(expiresAt) || !Number.isFinite(current) || expiresAt <= current;
  const coverageReady = Boolean(governance.coverage?.ready);
  const hasOwnedGaps = !expired && coverageReady && ownedCount > 0;
  const blockedReason = safeText(governance.coverage?.blockedReason);

  return {
    visible: findings.length > 0 || ownedCount > 0 || Boolean(blockedReason),
    pending: false,
    tone: toneFor(governance.severity),
    severity: safeText(governance.severity || "unknown"),
    expired,
    canApply: false,
    hasOwnedGaps,
    fingerprint: safeText(governance.fingerprint),
    ruleNames,
    overflowCount,
    statusLabel: severityLabel(governance.severity),
    rows: [
      { label: "风险", value: severityLabel(governance.severity), detail: ruleNames.length ? `${ruleNames.join("、")}${overflowCount ? ` +${overflowCount}` : ""}` : "未发现公开高风险规则" },
      { label: "影响范围", value: affected ? `${affected} 台实例` : "未确认影响实例", detail: governance.coverage?.uniqueTag ? `目标标签 ${safeText(governance.coverage.uniqueTag)}` : "尚无可用唯一标签" },
      {
        label: "处理边界",
        value: ownedCount ? `${ownedCount} 项自有规则待治理` : "当前无自有规则变更",
        detail: externalCount
          ? `${externalCount} 条外部规则仅提供人工建议`
          : (blockedReason || "端口变更统一通过“管理端口与 SSH”预览")
      }
    ]
  };
}
