const GROUPS = [
  ["local", "本机"],
  ["project", "项目"],
  ["catalog", "规则"],
  ["inventory", "实例"],
  ["runtime", "运行"]
];

const RANK = { pass: 1, unknown: 2, warning: 2, blocked: 3 };
const ACTION_LABELS = {
  auditFreeRules: "更新规则提示",
  refreshAll: "刷新数据",
  refreshResources: "刷新清单",
  reloadAccounts: "重新读取",
  useContext: "切换到此项目",
  smartDiagnoseInstance: "智能诊断",
  doctorRunBtn: "运行体检"
};

function normalizedActionRef(actionRef = "") {
  return ["checkStatus", "verifyInstance", "recognizeInstance"].includes(actionRef)
    ? "smartDiagnoseInstance"
    : actionRef;
}

function compact(value, limit = 180) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

function redact(value, limit = 180) {
  return compact(value, limit)
    .replace(/(hysteria2|hy2|vless|vmess|tuic|trojan|ss):\/\/\S+/gi, "$1://[redacted-link]")
    .replace(/password=([^&\s]+)/gi, "password=[redacted]")
    .replace(/password:\s*\S+/gi, "password: [redacted]")
    .replace(/\b(token|uuid|key|pass|password)=\S+/gi, "$1=[redacted]")
    .replace(/([?&](?:token|uuid|key|pass|password)=)[^&\s]+/gi, "$1[redacted]");
}

function summaryTitle(payload) {
  const summary = payload?.summary || {};
  if ((summary.blocked || 0) > 0) return `环境体检有 ${summary.blocked} 项阻断`;
  if ((summary.warning || 0) > 0) return `环境体检有 ${summary.warning} 项需要注意`;
  return "环境体检通过";
}

function issueRank(status) {
  if (status === "blocked") return 0;
  if (status === "warning") return 1;
  if (status === "unknown") return 2;
  return 9;
}

function sectionStatus(items = []) {
  if (items.some((item) => item.status === "blocked")) return "blocked";
  if (items.some((item) => item.status === "warning" || item.status === "unknown")) return "warning";
  return "pass";
}

function sectionSummary(items = []) {
  const attention = items.filter((item) => item.status !== "pass").length;
  return `${items.length} 项检查 · ${attention ? `${attention} 项需处理` : "全部正常"}`;
}

export function toDoctorView(payload) {
  const checks = Array.isArray(payload?.checks) ? payload.checks : [];
  const sections = GROUPS
    .map(([id, label]) => {
      const items = checks
        .filter((item) => item.group === id)
        .map((item) => {
          const actionRef = normalizedActionRef(item.actionRef);
          return {
          id: item.id,
          label: compact(item.label, 48),
          status: item.status || "unknown",
          reason: redact(item.reason),
          evidence: redact(item.evidence),
          nextAction: redact(item.nextAction),
          actionRef,
          showNextAction: Boolean(item.nextAction && actionRef !== "smartDiagnoseInstance")
          };
        });
      return {
        id,
        label,
        items,
        collapsible: id === "runtime" && items.length > 2,
        status: sectionStatus(items),
        summary: sectionSummary(items)
      };
    })
    .filter((section) => section.items.length);

  return {
    status: payload?.status || "unknown",
    severityRank: Math.max(1, ...checks.map((item) => RANK[item.status] || 2)),
    title: summaryTitle(payload),
    generatedAt: payload?.generatedAt || "",
    sections,
    issues: checks
      .filter((item) => item.status && item.status !== "pass")
      .sort((a, b) => issueRank(a.status) - issueRank(b.status))
      .map((item) => ({
        id: item.id,
        label: compact(item.label, 48),
        status: item.status || "unknown",
        reason: redact(item.reason),
        evidence: redact(item.evidence),
        actionRef: normalizedActionRef(item.actionRef),
        actionLabel: ACTION_LABELS[normalizedActionRef(item.actionRef)] || redact(item.nextAction || "查看详情", 32)
      }))
  };
}
