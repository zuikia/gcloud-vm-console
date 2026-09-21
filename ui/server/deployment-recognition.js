export const CANONICAL_DEPLOYMENT_METHODS = [
  "vm_only",
  "singbox_plus",
  "three_x_ui",
  "custom_startup",
  "external_custom",
  "unmanaged_unknown"
];

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
  firewall_probe: "防火墙探测",
  os_inventory: "OS Inventory",
  user_confirmed: "用户确认",
  none: "无证据"
};

const METHOD_ALIASES = {
  "vm-only": "vm_only",
  vm_only: "vm_only",
  vmonly: "vm_only",
  none: "vm_only",
  "sing-box": "singbox_plus",
  singbox: "singbox_plus",
  singbox_plus: "singbox_plus",
  "singbox-plus": "singbox_plus",
  "sing-box-plus": "singbox_plus",
  "3x-ui": "three_x_ui",
  "3xui": "three_x_ui",
  xui: "three_x_ui",
  "x-ui": "three_x_ui",
  three_x_ui: "three_x_ui",
  "three-x-ui": "three_x_ui",
  custom: "custom_startup",
  custom_startup: "custom_startup",
  "custom-startup": "custom_startup",
  external_custom: "external_custom",
  "external-custom": "external_custom",
  unmanaged_unknown: "unmanaged_unknown",
  unknown: "unmanaged_unknown"
};

function text(value) {
  return String(value ?? "").trim();
}

export function normalizeDeploymentMethod(value) {
  const key = text(value).toLowerCase().replace(/\s+/g, "-");
  return METHOD_ALIASES[key] || "unmanaged_unknown";
}

function isSensitiveKey(key = "") {
  return /password|passwd|secret|token|private|key|credential|link|url/i.test(String(key || ""));
}

function isSensitiveValue(value = "") {
  return /(?:vless|vmess|hy2|hysteria2|tuic|ss):\/\/|password=|passwd=|token=|private[_-]?key/i.test(String(value || ""));
}

function addEvidence(evidence, { source, label, value, confidence = "low" }) {
  const cleanLabel = text(label);
  const cleanValue = text(value);
  if (!cleanLabel || !cleanValue) return;
  if (isSensitiveKey(cleanLabel) || isSensitiveValue(cleanValue)) return;
  evidence.push({
    source,
    label: cleanLabel,
    value: cleanValue.length > 240 ? `${cleanValue.slice(0, 237)}...` : cleanValue,
    confidence,
    sensitive: false
  });
}

function methodFromLocalRecord(localRecord = null) {
  const method = normalizeDeploymentMethod(
    localRecord?.migration?.adoption?.recognition?.method ||
    localRecord?.desired?.deploy?.method ||
    localRecord?.nodeResult?.type ||
    localRecord?.verification?.method
  );
  return method === "unmanaged_unknown" ? "" : method;
}

function methodFromGuestAttributes(guestAttributes = null) {
  if (!guestAttributes?.available) return "";
  const values = guestAttributes.values || {};
  return normalizeDeploymentMethod(values["deploy-method"] || values.deployMethod || values.method);
}

function methodFromCloudLabel(cloudInstance = null) {
  return normalizeDeploymentMethod(cloudInstance?.labels?.gvc_deploy_method || cloudInstance?.labels?.gvcDeployMethod || cloudInstance?.labels?.deploy_method);
}

function methodFromCloudMetadata(cloudInstance = null) {
  return normalizeDeploymentMethod(cloudInstance?.metadata?.gvcDeployMethod || cloudInstance?.metadata?.["gvc-deploy-method"]);
}

function activeService(sshProbe = {}, name) {
  return (sshProbe.services || []).some((service) => service?.name === name && String(service?.status || "").toLowerCase() === "active");
}

function listeningPort(sshProbe = {}, protocol) {
  return (sshProbe.ports || []).some((port) => String(port?.protocol || "").toLowerCase() === protocol && port?.listening !== false);
}

function hasDeepProbe(sshProbe = {}) {
  return ["units", "processes", "containers", "configSummary"].some((key) => Array.isArray(sshProbe[key]) && sshProbe[key].length > 0);
}

function activeNames(sshProbe = {}) {
  return (sshProbe.services || [])
    .filter((service) => String(service?.status || "").toLowerCase() === "active")
    .map((service) => service.name);
}

function lineMatches(items = [], pattern) {
  return items.some((item) => pattern.test(typeof item === "string" ? item : JSON.stringify(item)));
}

function portOwnedBy(sshProbe = {}, pattern, protocol = "") {
  return (sshProbe.ports || []).some((port) => {
    const protocolMatches = !protocol || String(port.protocol || "").toLowerCase() === protocol;
    return protocolMatches && port.listening !== false && pattern.test(String(port.process || ""));
  });
}

function addReason(candidate, points, reason) {
  candidate.score += points;
  candidate.reasons.push(reason);
}

function confidenceForScore(score) {
  if (score >= 80) return "high";
  if (score >= 50) return "medium";
  if (score > 0) return "low";
  return "none";
}

function scoredSshCandidates(sshProbe = null) {
  if (!sshProbe) return { candidates: [], warnings: [] };
  const candidates = [
    { source: hasDeepProbe(sshProbe) ? "ssh_deep_probe" : "ssh_probe", method: "three_x_ui", score: 0, confidence: "none", managedState: "external_observed", suggestedAction: "adopt", reasons: [] },
    { source: hasDeepProbe(sshProbe) ? "ssh_deep_probe" : "ssh_probe", method: "singbox_plus", score: 0, confidence: "none", managedState: "external_observed", suggestedAction: "adopt", reasons: [] }
  ];
  const xui = candidates[0];
  const singbox = candidates[1];
  const active = activeNames(sshProbe);

  if (active.includes("x-ui")) addReason(xui, 35, "x-ui service active");
  if (active.includes("xray") && (active.includes("x-ui") || lineMatches(sshProbe.files, /x-ui/i))) addReason(xui, 10, "xray active with x-ui evidence");
  if (lineMatches(sshProbe.files, /x-ui|xray/i)) addReason(xui, 20, "x-ui/xray file marker");
  if (lineMatches(sshProbe.processes, /x-ui|xray/i)) addReason(xui, 15, "x-ui/xray process");
  if (lineMatches(sshProbe.containers, /3x-ui|x-ui/i)) addReason(xui, 25, "3X-UI container");
  if (portOwnedBy(sshProbe, /x-ui|xray/i, "tcp") || (xui.score > 0 && listeningPort(sshProbe, "tcp"))) addReason(xui, 10, "TCP listener with x-ui/xray evidence");
  if (lineMatches(sshProbe.configSummary, /xray-inbound|vless|trojan/i)) addReason(xui, 15, "Xray inbound config summary");

  if (active.includes("sing-box")) addReason(singbox, 35, "sing-box service active");
  if (lineMatches(sshProbe.files, /sing-box/i)) addReason(singbox, 20, "sing-box file marker");
  if (lineMatches(sshProbe.processes, /sing-box/i)) addReason(singbox, 15, "sing-box process");
  if (lineMatches(sshProbe.containers, /sing-box/i)) addReason(singbox, 25, "sing-box container");
  if (lineMatches(sshProbe.configSummary, /sing-box-inbounds|hysteria2|tuic|shadowsocks/i)) addReason(singbox, 20, "sing-box inbound config summary");
  if (portOwnedBy(sshProbe, /sing-box/i, "udp") || (singbox.score > 0 && listeningPort(sshProbe, "udp"))) addReason(singbox, 10, "UDP listener with sing-box evidence");

  const scored = candidates
    .filter((candidate) => candidate.score > 0)
    .map((candidate) => ({ ...candidate, confidence: confidenceForScore(candidate.score) }))
    .sort((a, b) => b.score - a.score);

  const warnings = [];
  const primaryActive = active.filter((name) => ["x-ui", "sing-box"].includes(name));
  if (primaryActive.length > 1) warnings.push(`检测到多个代理服务同时 active：${primaryActive.join(", ")}`);

  if (!scored.length && (sshProbe.ports || []).some((port) => port?.listening !== false)) {
    return {
      candidates: [{
        source: hasDeepProbe(sshProbe) ? "ssh_deep_probe" : "ssh_probe",
        method: "external_custom",
        score: 20,
        confidence: "low",
        managedState: "external_observed",
        suggestedAction: "manual_choose",
        reasons: ["端口监听证据不足，无法确认部署方式"]
      }],
      warnings: ["仅发现端口监听，证据不足，不能自动判定部署方式。"]
    };
  }

  return { candidates: scored, warnings };
}

function selectedSshCandidate(sshProbe = null) {
  const { candidates, warnings } = scoredSshCandidates(sshProbe);
  if (!candidates.length) return { candidate: null, candidates, warnings };
  if (warnings.length || candidates.filter((item) => item.score >= 40).length > 1) {
    return {
      candidate: {
        source: candidates[0].source,
        method: "external_custom",
        score: Math.max(...candidates.map((item) => item.score)),
        confidence: "low",
        managedState: "external_observed",
        suggestedAction: "manual_choose",
        reasons: ["多种部署证据并存，需要人工确认"],
        relatedCandidates: candidates
      },
      candidates,
      warnings
    };
  }
  return { candidate: candidates[0], candidates, warnings };
}

function baseRecognition(candidate, candidates, evidence) {
  const warnings = [...(candidate.warnings || [])];
  const relatedCandidates = candidate.relatedCandidates || [];
  return {
    method: candidate.method,
    confidence: candidate.confidence,
    score: candidate.score || (candidate.confidence === "high" ? 90 : candidate.confidence === "medium" ? 60 : candidate.confidence === "low" ? 25 : 0),
    source: candidate.source,
    managedState: candidate.managedState,
    candidates: [...candidates, ...relatedCandidates]
      .filter((item) => item.method && item.method !== "unmanaged_unknown")
      .map((item) => ({
        method: item.method,
        source: item.source,
        score: item.score || (item.confidence === "high" ? 90 : item.confidence === "medium" ? 60 : item.confidence === "low" ? 25 : 0),
        confidence: item.confidence,
        reasons: item.reasons || []
      })),
    probes: candidate.probes || {},
    evidence,
    warnings,
    suggestedAction: warnings.length ? "manual_choose" : candidate.suggestedAction
  };
}

function observedProbeOverride(candidates = []) {
  const local = candidates.find((candidate) => ["local_record", "user_confirmed"].includes(candidate.source));
  if (!local) return null;
  const observed = candidates.find((candidate) => (
    ["ssh_deep_probe", "ssh_probe"].includes(candidate.source) &&
    ["high", "medium"].includes(candidate.confidence) &&
    ["three_x_ui", "singbox_plus", "custom_startup"].includes(candidate.method)
  ));
  if (!observed || observed.method === local.method) return null;
  return {
    ...observed,
    managedState: local.managedState,
    suggestedAction: "verify"
  };
}

export function recognizeDeployment({
  localRecord = null,
  cloudInstance = null,
  guestAttributes = null,
  sshProbe = null,
  firewallProbe = null,
  osInventory = null
} = {}) {
  const evidence = [];
  const candidates = [];

  const localMethod = methodFromLocalRecord(localRecord);
  if (localMethod) {
    const source = localRecord?.migration?.adoption?.recognition?.source === "user_confirmed" ? "user_confirmed" : "local_record";
    candidates.push({ source, method: localMethod, confidence: "high", score: source === "user_confirmed" ? 95 : 90, managedState: source === "user_confirmed" ? "external_adopted" : "managed", suggestedAction: "verify" });
    addEvidence(evidence, { source: "local_record", label: "部署方式", value: METHOD_LABELS[localMethod], confidence: "high" });
    if (localRecord?.verification?.checkedAt) addEvidence(evidence, { source: "local_record", label: "最近验证", value: localRecord.verification.checkedAt, confidence: "high" });
  }

  const guestMethod = methodFromGuestAttributes(guestAttributes);
  if (guestMethod && guestMethod !== "unmanaged_unknown") {
    candidates.push({ source: "guest_attributes", method: guestMethod, confidence: "high", score: 85, managedState: "external_observed", suggestedAction: "adopt" });
    addEvidence(evidence, { source: "guest_attributes", label: "部署方式", value: METHOD_LABELS[guestMethod], confidence: "high" });
    for (const [key, value] of Object.entries(guestAttributes.values || {})) {
      addEvidence(evidence, { source: "guest_attributes", label: key, value, confidence: "medium" });
    }
  }

  const labelMethod = methodFromCloudLabel(cloudInstance);
  if (labelMethod && labelMethod !== "unmanaged_unknown") {
    candidates.push({ source: "cloud_label", method: labelMethod, confidence: "medium", score: 60, managedState: "external_observed", suggestedAction: "adopt" });
    addEvidence(evidence, { source: "cloud_label", label: "部署方式", value: METHOD_LABELS[labelMethod], confidence: "medium" });
  }

  const metadataMethod = methodFromCloudMetadata(cloudInstance);
  if (metadataMethod && metadataMethod !== "unmanaged_unknown") {
    candidates.push({ source: "cloud_metadata", method: metadataMethod, confidence: "medium", score: 60, managedState: "external_observed", suggestedAction: "adopt" });
    addEvidence(evidence, { source: "cloud_metadata", label: "部署方式", value: METHOD_LABELS[metadataMethod], confidence: "medium" });
  }

  const sshRecognition = selectedSshCandidate(sshProbe);
  if (sshRecognition.candidate) {
    candidates.push({ ...sshRecognition.candidate, warnings: sshRecognition.warnings, probes: { ssh: sshProbe?.ssh, bbr: sshProbe?.bbr, firewall: firewallProbe || null, services: sshProbe?.services || [], processes: sshProbe?.processes || [], containers: sshProbe?.containers || [], configSummary: sshProbe?.configSummary || [] } });
    addEvidence(evidence, { source: sshRecognition.candidate.source, label: "部署方式", value: METHOD_LABELS[sshRecognition.candidate.method], confidence: sshRecognition.candidate.confidence });
    for (const service of sshProbe?.services || []) addEvidence(evidence, { source: "ssh_probe", label: `服务 ${service.name}`, value: service.status, confidence: "medium" });
    const portSummary = (sshProbe?.ports || []).map((port) => `${port.protocol}/${port.port}`).join(", ");
    addEvidence(evidence, { source: "ssh_probe", label: "监听端口", value: portSummary, confidence: "medium" });
    for (const reason of sshRecognition.candidate.reasons || []) addEvidence(evidence, { source: sshRecognition.candidate.source, label: "识别原因", value: reason, confidence: sshRecognition.candidate.confidence });
  }

  if (firewallProbe?.status && firewallProbe.status !== "unknown") {
    addEvidence(evidence, { source: "firewall_probe", label: "防火墙", value: firewallProbe.status, confidence: firewallProbe.status === "matched" ? "medium" : "low" });
  }

  const osMethod = normalizeDeploymentMethod(osInventory?.method || "");
  if (osMethod && osMethod !== "unmanaged_unknown") {
    candidates.push({ source: "os_inventory", method: osMethod, confidence: "low", score: 35, managedState: "external_observed", suggestedAction: "adopt" });
    addEvidence(evidence, { source: "os_inventory", label: "部署方式", value: METHOD_LABELS[osMethod], confidence: "low" });
  }

  const priority = ["user_confirmed", "local_record", "guest_attributes", "ssh_deep_probe", "ssh_probe", "cloud_label", "cloud_metadata", "firewall_probe", "os_inventory"];
  const persisted = candidates.find((candidate) => ["user_confirmed", "local_record"].includes(candidate.source));
  const strongest = [...candidates].sort((a, b) => (
    Number(b.score || 0) - Number(a.score || 0)
    || priority.indexOf(a.source) - priority.indexOf(b.source)
  ))[0];
  const selected = observedProbeOverride(candidates) || persisted || strongest;
  if (selected) return baseRecognition(selected, candidates, evidence);

  return {
    method: "unmanaged_unknown",
    confidence: "none",
    score: 0,
    source: "none",
    managedState: "unknown",
    candidates: [],
    probes: firewallProbe ? { firewall: firewallProbe } : {},
    evidence,
    warnings: ["未找到可确认部署方式的本地记录、云端标记或只读探测证据。"],
    suggestedAction: "manual_choose"
  };
}

export function toRecognitionSummary(recognition = {}) {
  const method = METHOD_LABELS[recognition.method] || recognition.method || "未识别";
  const source = SOURCE_LABELS[recognition.source] || recognition.source || "无证据";
  const confidence = {
    high: "高可信",
    medium: "中可信",
    low: "低可信",
    none: "无可信证据"
  }[recognition.confidence] || recognition.confidence || "未知可信度";
  return `${method} · ${source} · ${confidence}`;
}
