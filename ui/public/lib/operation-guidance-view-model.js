import { toOperationScenario } from "./operation-scenario-view-model.js";

const RUNTIME_ISSUE_IDS = new Set(["verification_state", "ssh_state", "firewall_state", "bbr_state", "node_service_state"]);

function doctorIssues(doctorView = {}) {
  const issues = Array.isArray(doctorView?.issues) ? doctorView.issues : [];
  const runtime = issues.filter((issue) => RUNTIME_ISSUE_IDS.has(issue.id) && issue.actionRef === "smartDiagnoseInstance");
  const compact = [];
  if (runtime.length > 1) {
    compact.push({
      id: "runtime_diagnosis_group",
      label: `${runtime.length} 项运行检查`,
      status: runtime.some((issue) => issue.status === "blocked") ? "blocked" : "warning",
      reason: "选择实例后统一处理",
      actionRef: "smartDiagnoseInstance",
      actionLabel: "智能诊断"
    });
  } else if (runtime.length === 1) {
    compact.push(runtime[0]);
  }
  const remaining = issues.filter((issue) => !runtime.includes(issue));
  return [...remaining, ...compact].slice(0, 3);
}

export function toOperationGuidance(input = {}) {
  const scenario = toOperationScenario(input);
  const issues = doctorIssues(input.doctorView)
    .filter((issue) => input.selectedVm || (issue.id !== "runtime_diagnosis_group" && !RUNTIME_ISSUE_IDS.has(issue.id)))
    .filter((issue) => issue.actionRef !== scenario.primaryActionId);
  return {
    tone: scenario.tone,
    headline: scenario.headline,
    detail: scenario.detail,
    primaryActionId: scenario.primaryActionId,
    primaryLabel: scenario.primaryLabel,
    secondaryActions: scenario.secondaryActions || [],
    evidence: scenario.evidence || [],
    issues
  };
}
