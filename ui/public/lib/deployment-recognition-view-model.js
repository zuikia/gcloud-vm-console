const METHOD_LABELS = {
  vm_only: "只开实例",
  singbox_plus: "Sing-Box-Plus",
  three_x_ui: "3X-UI",
  custom_startup: "自定义脚本",
  external_custom: "外部自定义",
  unmanaged_unknown: "未识别"
};

const SOURCE_LABELS = {
  local_record: "本地记录",
  cloud_label: "云端标签",
  cloud_metadata: "云端 metadata",
  guest_attributes: "Guest Attributes",
  ssh_probe: "SSH 探测",
  ssh_deep_probe: "SSH 深探测",
  local_verification: "本地验证",
  firewall_probe: "防火墙探测",
  os_inventory: "OS Inventory",
  user_confirmed: "用户确认",
  none: "无证据"
};

const CONFIDENCE_LABELS = {
  high: "高可信",
  medium: "中可信",
  low: "低可信",
  none: "无可信证据"
};

const STATE_LABELS = {
  managed: "本地已管理",
  external_adopted: "外部已接管",
  external_observed: "外部可接管",
  unknown: "未知状态"
};

function compact(value = "", max = 120) {
  const text = String(value || "").trim();
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}

function secretLike(value = "") {
  return /(?:vless|vmess|hy2|hysteria2|tuic|ss):\/\/|password|passwd|secret|token|private[_-]?key|credential/i.test(String(value || ""));
}

export function methodBadgeLabel(method) {
  return METHOD_LABELS[method] || method || "未识别";
}

export function sourceLabel(source) {
  return SOURCE_LABELS[source] || source || "无证据";
}

export function confidenceLabel(confidence) {
  return CONFIDENCE_LABELS[confidence] || confidence || "未知可信度";
}

function stateLabel(state) {
  return STATE_LABELS[state] || state || "未知状态";
}

function toneFor(recognition = {}) {
  if (recognition.method === "unmanaged_unknown" || recognition.confidence === "none") return "muted";
  if (recognition.managedState === "external_observed") return "warning";
  if (recognition.confidence === "high") return "success";
  return "info";
}

function visibleWarnings(recognition = {}) {
  return (Array.isArray(recognition.warnings) ? recognition.warnings : [])
    .filter((warning) => !/证据冲突|evidence conflict/i.test(String(warning || "")));
}

function primaryActionFor(recognition = {}, context = {}) {
  if ((recognition.warnings || []).length) return "smartDiagnoseInstance";
  if (recognition.method === "unmanaged_unknown" || recognition.suggestedAction === "manual_choose") return "smartDiagnoseInstance";
  if (!context.hasLocalRecord && context.hasCloudInstance && recognition.suggestedAction === "adopt") return "adoptLocalInstance";
  if (recognition.suggestedAction === "verify" || context.hasLocalRecord) return "smartDiagnoseInstance";
  return "smartDiagnoseInstance";
}

function evidenceView(items = []) {
  return (Array.isArray(items) ? items : []).slice(0, 8).map((item) => ({
    source: sourceLabel(item.source),
    label: compact(item.label, 36),
    value: item.sensitive || secretLike(item.label) || secretLike(item.value) ? "[已隐藏]" : compact(item.value, 120),
    confidence: confidenceLabel(item.confidence)
  }));
}

function compactRow(value = "", max = 140) {
  return compact(value, max);
}

function sshFact(ssh = null) {
  if (!ssh) return { label: "SSH", value: "未探测", tone: "muted" };
  if (!ssh.verified) return { label: "SSH", value: `未连接 ${ssh.desiredPort || 22}`, tone: "warning" };
  if (ssh.fallback) return { label: "SSH", value: `${ssh.actualPort}（从 ${ssh.desiredPort} 回退）`, tone: "warning" };
  return { label: "SSH", value: `${ssh.actualPort || ssh.desiredPort || 22}`, tone: "success" };
}

function bbrFact(bbr = null) {
  if (bbr === true) return { label: "BBR", value: "已开启", tone: "success" };
  if (bbr === false || !bbr) return { label: "BBR", value: "未确认", tone: "muted" };
  const detail = [bbr.congestionControl || "未知", bbr.qdisc || ""].filter(Boolean).join(" / ");
  return { label: "BBR", value: detail || "未确认", tone: bbr.enabled ? "success" : "muted" };
}

function firewallFact(firewall = null) {
  const labels = {
    matched: "已匹配",
    partial: "部分开放",
    missing: "未开放",
    overexposed: "过度开放",
    not_required: "无需检查",
    unknown: "未知"
  };
  const tones = {
    matched: "success",
    partial: "warning",
    missing: "danger",
    overexposed: "danger",
    not_required: "muted",
    unknown: "muted"
  };
  const status = firewall?.status || "unknown";
  const matched = Array.isArray(firewall?.matchedPorts) ? firewall.matchedPorts.length : 0;
  const missing = Array.isArray(firewall?.missingPorts) ? firewall.missingPorts.length : 0;
  const suffix = status !== "overexposed" && (matched || missing) ? ` ${matched}/${matched + missing}` : "";
  return { label: "防火墙", value: `${labels[status] || status}${suffix}`, tone: tones[status] || "muted" };
}

function servicesFact(services = []) {
  const active = services.filter((service) => String(service.status || "").toLowerCase() === "active").map((service) => service.name).slice(0, 3);
  return { label: "服务", value: active.length ? active.join(", ") : "未发现", tone: active.length ? "info" : "muted" };
}

function probeFacts(probes = {}) {
  return [
    sshFact(probes.ssh),
    bbrFact(probes.bbr),
    firewallFact(probes.firewall),
    servicesFact(probes.services || [])
  ];
}

function evidenceGroups(probes = {}, evidence = []) {
  const services = [
    ...(probes.services || []).map((item) => `${item.name} ${item.status}`),
    ...(probes.configSummary || []).map((item) => item.value || `${item.kind}: ${(item.protocols || []).join(", ")}`)
  ].filter(Boolean).slice(0, 6);
  const network = [
    ...((probes.firewall?.matchedPorts || []).map((item) => `${item.protocol}/${item.port} 已开放`)),
    ...((probes.firewall?.missingPorts || []).map((item) => `${item.protocol}/${item.port} 未开放`)),
    ...evidence.filter((item) => item.source === "firewall_probe").map((item) => `${item.label}: ${item.value}`)
  ].filter(Boolean).slice(0, 6);
  const groups = [];
  if (services.length) groups.push({ title: "服务与配置", items: services.map((value) => compactRow(value, 96)) });
  if (network.length) groups.push({ title: "网络与防火墙", items: network.map((value) => compactRow(value, 96)) });
  return groups;
}

function detailRows(probes = {}) {
  return [
    ...(probes.processes || []).map((item) => ({ label: `进程 ${item.command}`, value: compactRow(item.args || item.command) })),
    ...(probes.containers || []).map((item) => ({ label: `容器 ${item.name || "-"}`, value: compactRow([item.image, item.ports].filter(Boolean).join(" · ")) })),
    ...(probes.configSummary || []).map((item) => ({ label: item.kind || "配置摘要", value: compactRow(item.value || (item.protocols || []).join(", ")) }))
  ].slice(0, 12);
}

export function toDeploymentRecognitionView(recognition = {}, context = {}) {
  const method = recognition.method || "unmanaged_unknown";
  const primaryActionId = primaryActionFor(recognition, context);
  const scoreText = Number.isFinite(recognition.score) && recognition.score > 0 ? ` · ${recognition.score}分` : "";
  const probes = recognition.probes || {};
  const evidence = evidenceView(recognition.evidence);
  return {
    headline: methodBadgeLabel(method),
    method,
    tone: toneFor(recognition),
    summary: `${sourceLabel(recognition.source)} · ${confidenceLabel(recognition.confidence)} · ${stateLabel(recognition.managedState)}${scoreText}`,
    source: sourceLabel(recognition.source),
    confidence: confidenceLabel(recognition.confidence),
    managedState: stateLabel(recognition.managedState),
    score: recognition.score || 0,
    probeFacts: probeFacts(probes),
    evidence,
    evidenceGroups: evidenceGroups(probes, recognition.evidence || []),
    detailRows: detailRows(probes),
    warnings: visibleWarnings(recognition).map((warning) => compact(warning, 140)),
    primaryActionId,
    primaryLabel: primaryActionId === "adoptLocalInstance"
      ? "接管本地"
      : "智能诊断",
    secondaryActionId: primaryActionId === "adoptLocalInstance" ? "smartDiagnoseInstance" : "",
    secondaryLabel: primaryActionId === "adoptLocalInstance" ? "重新识别" : ""
  };
}
