import { taskStatusLabel, taskTypeLabel, verificationStatusLabel } from "./task-view-model.js";

function compact(value, limit = 96) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

function toneForStatus(status = "") {
  if (["failed", "blocked", "error"].includes(status)) return "blocked";
  if (["partial", "warning", "unknown"].includes(status)) return "warning";
  if (["running", "busy"].includes(status)) return "busy";
  if (["passed", "pass", "succeeded", "done"].includes(status)) return "pass";
  return "ready";
}

function recognitionMethodLabel(method = "") {
  return {
    vm_only: "只开实例",
    singbox_plus: "Sing-Box-Plus",
    three_x_ui: "3X-UI",
    custom_startup: "自定义脚本",
    external_custom: "外部自定义",
    unmanaged_unknown: "未识别"
  }[method] || method || "未识别";
}

function confidenceLabel(confidence = "") {
  return {
    high: "高可信",
    medium: "中可信",
    low: "低可信",
    none: "无可信证据"
  }[confidence] || confidence || "未知可信度";
}

export function toEvidenceTimeline(input = {}) {
  const items = [];

  if (input.doctorView?.status) {
    const issueCount = Array.isArray(input.doctorView.issues) ? input.doctorView.issues.length : 0;
    items.push({
      id: "doctor",
      label: "环境体检",
      tone: toneForStatus(input.doctorView.status),
      detail: issueCount ? `${issueCount} 项需要注意` : "未发现阻断项"
    });
  }

  if (input.selectedJob?.id) {
    items.push({
      id: "task",
      label: "任务",
      tone: toneForStatus(input.selectedJob.status),
      detail: compact(`${taskTypeLabel(input.selectedJob)} / ${taskStatusLabel(input.selectedJob.status)}`)
    });
  }

  if (input.recognition?.method) {
    items.push({
      id: "recognition",
      label: "部署识别",
      tone: input.recognition.confidence === "none" ? "warning" : toneForStatus(input.recognition.confidence === "high" ? "passed" : "warning"),
      detail: compact(`${recognitionMethodLabel(input.recognition.method)} / ${confidenceLabel(input.recognition.confidence)}`)
    });
  }

  if (input.verification?.status) {
    const failed = (input.verification.checks || []).filter((check) => check.status === "failed").length;
    items.push({
      id: "verification",
      label: "实例验证",
      tone: toneForStatus(input.verification.status),
      detail: failed ? `${failed} 项失败` : verificationStatusLabel(input.verification.status)
    });
  }

  const linkCount = Array.isArray(input.nodeResult?.links) ? input.nodeResult.links.length : 0;
  if (linkCount) {
    items.push({
      id: "node",
      label: "节点结果",
      tone: "pass",
      detail: `${linkCount} 条节点链接`
    });
  }

  if (!items.length) {
    items.push({
      id: "empty",
      label: "暂无证据",
      tone: "ready",
      detail: "暂无任务、验证或节点结果。"
    });
  }

  return { title: "证据时间线", items };
}
