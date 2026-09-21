import { taskStatusLabel, taskTypeLabel, verificationStatusLabel } from "./task-view-model.js";

function compact(value, limit = 180) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

function redact(value) {
  return compact(value)
    .replace(/password=([^&\s]+)/gi, "[redacted-secret]")
    .replace(/password:\s*\S+/gi, "[redacted-secret]")
    .replace(/\b(token|uuid|key|pass|password)=\S+/gi, "$1=[redacted]")
    .replace(/(hysteria2|vless|vmess|tuic|trojan|ss):\/\/\S+/gi, "$1://[redacted-link]")
    .replace(/([?&](?:token|uuid|key|pass|password)=)[^&\s]+/gi, "$1[redacted]");
}

function row(label, value) {
  const clean = redact(value);
  return clean ? { label, value: clean } : null;
}

function recognitionLabel(recognition = null) {
  if (!recognition?.method) return "";
  const method = {
    vm_only: "只开实例",
    singbox_plus: "Sing-Box-Plus",
    three_x_ui: "3X-UI",
    custom_startup: "自定义脚本",
    external_custom: "外部自定义",
    unmanaged_unknown: "未识别"
  }[recognition.method] || recognition.method;
  const confidence = {
    high: "高可信",
    medium: "中可信",
    low: "低可信",
    none: "无可信证据"
  }[recognition.confidence] || recognition.confidence || "未知可信度";
  return `${method} / ${confidence}`;
}

export function toDiagnosticSummary(input = {}) {
  const linkCount = Array.isArray(input.nodeResult?.links) ? input.nodeResult.links.length : 0;
  const verificationStatus = input.verification?.status || input.selectedVm?.verification?.status;
  const rows = [
    row("账号", input.context?.account),
    row("项目", input.context?.projectId),
    row("配置", input.context?.configuration),
    row("实例", input.selectedVm?.name),
    row("区域", input.selectedVm?.zone || input.selectedVm?.region),
    row("公网 IPv4", input.selectedVm?.externalIp || input.selectedVm?.publicIp),
    row("体检", input.doctorView?.title),
    row("部署识别", recognitionLabel(input.recognition)),
    row("验证", verificationStatus ? verificationStatusLabel(verificationStatus) : ""),
    row("节点链接", linkCount ? `${linkCount} 条` : ""),
    row("面板", input.nodeResult?.panel?.url),
    row("任务", input.selectedJob ? `${taskTypeLabel(input.selectedJob)} / ${taskStatusLabel(input.selectedJob.status)}` : ""),
    row("错误", input.selectedJob?.error)
  ].filter(Boolean);

  const issues = Array.isArray(input.doctorView?.issues) ? input.doctorView.issues.slice(0, 3) : [];
  for (const issue of issues) {
    rows.push(row(`体检项: ${issue.label}`, issue.reason));
  }

  const text = [
    "GCP VM Console 诊断摘要",
    ...rows.map((item) => `${item.label}: ${item.value}`)
  ].join("\n");

  return {
    title: input.selectedVm?.name ? `诊断摘要: ${input.selectedVm.name}` : "诊断摘要",
    rows,
    text
  };
}
