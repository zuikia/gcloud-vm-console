const DEFAULT_FRESH_MS = 15 * 60 * 1000;
const DEFAULT_AGING_MS = 6 * 60 * 60 * 1000;
const SUCCESS_TONES = new Set(["success", "running"]);

function timestamp(value) {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : null;
}

export function evidenceFreshness(checkedAt, {
  now = new Date().toISOString(),
  freshMs = DEFAULT_FRESH_MS,
  agingMs = DEFAULT_AGING_MS
} = {}) {
  const checked = timestamp(checkedAt);
  const current = timestamp(now);
  if (checked === null || current === null) return "unknown";
  const age = Math.max(0, current - checked);
  if (age <= freshMs) return "fresh";
  if (age <= agingMs) return "aging";
  return "stale";
}

function cleanText(value, fallback = "") {
  let text = String(value || fallback)
    .replace(/\b(?:vmess|vless|trojan|ss|hysteria2?|hy2):\/\/\S+/gi, "[redacted-link]")
    .replace(/\b(?:password|passwd|token|secret|private[_ -]?key|credential)\s*[:=]\s*\S+/gi, "$1=[redacted]")
    .replace(/-----BEGIN[\s\S]*?-----END[^-]*-----/g, "[redacted-key]")
    .replace(/[\r\n\t]+/g, " ")
    .trim();
  if (text.length > 240) text = `${text.slice(0, 237)}...`;
  return text;
}

function safeSsh(value) {
  if (!value || typeof value !== "object") return null;
  return {
    desiredPort: Number.isFinite(Number(value.desiredPort)) ? Number(value.desiredPort) : null,
    actualPort: Number.isFinite(Number(value.actualPort)) ? Number(value.actualPort) : null,
    verified: Boolean(value.verified),
    fallback: Boolean(value.fallback),
    label: cleanText(value.label)
  };
}

function safeBbr(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === "boolean") return { enabled: value, congestionControl: "", qdisc: "" };
  if (typeof value !== "object") return null;
  return {
    enabled: Boolean(value.enabled),
    congestionControl: cleanText(value.congestionControl),
    qdisc: cleanText(value.qdisc)
  };
}

function safeFirewall(value) {
  if (!value || typeof value !== "object") return null;
  const ports = (items) => (Array.isArray(items) ? items : []).slice(0, 32).map((item) => ({
    protocol: cleanText(item?.protocol),
    port: cleanText(item?.port)
  }));
  const broadRuleNames = [
    ...(Array.isArray(value.broadRuleNames) ? value.broadRuleNames : []),
    ...(Array.isArray(value.broadRules) ? value.broadRules.map((rule) => rule?.name) : []),
    ...(Array.isArray(value.exposedPorts) ? value.exposedPorts
      .filter((port) => (
        String(port?.protocol || "").toLowerCase() === "all"
        && String(port?.port || "").toLowerCase() === "all"
      ))
      .map((port) => port?.rule) : [])
  ];
  return {
    status: cleanText(value.status || "unknown"),
    matchedPorts: ports(value.matchedPorts),
    missingPorts: ports(value.missingPorts),
    broadRuleNames: [...new Set(broadRuleNames.map((name) => cleanText(name)).filter(Boolean))].slice(0, 16),
    error: cleanText(value.error)
  };
}

function safeServices(value) {
  if (!Array.isArray(value)) return null;
  return value.slice(0, 32).map((service) => ({
    name: cleanText(service?.name),
    status: cleanText(service?.status)
  }));
}

function fieldTone(field, value) {
  if (!value) return "muted";
  if (field === "ssh") return value.verified ? (value.fallback ? "warning" : "success") : "warning";
  if (field === "bbr") return value.enabled ? "success" : "warning";
  if (field === "firewall") {
    if (["matched", "synced", "passed", "isolated"].includes(value.status)) return "success";
    if (["failed", "overexposed"].includes(value.status)) return "danger";
    return "warning";
  }
  if (field === "services") return value.some((service) => service.status === "active") ? "success" : "warning";
  return value && value !== "unmanaged_unknown" ? "success" : "muted";
}

function detailFor(field, value) {
  if (!value) return "尚无可用证据";
  if (field === "ssh") return value.verified
    ? `实际连接 ${value.actualPort || value.desiredPort || "已验证"}`
    : "SSH 尚未验证";
  if (field === "bbr") return value.enabled ? "已检测到 BBR" : "未检测到 BBR";
  if (field === "firewall") return value.status || "状态未知";
  if (field === "services") {
    const active = value.filter((service) => service.status === "active").map((service) => service.name);
    return active.length ? active.join("、") : "未发现运行中的目标服务";
  }
  return cleanText(value || "未识别");
}

function candidate(field, value, source, checkedAt, now, extra = {}) {
  if (value === null || value === undefined || value === "") return null;
  const freshness = evidenceFreshness(checkedAt, { now });
  return {
    field,
    value,
    detail: detailFor(field, value),
    tone: fieldTone(field, value),
    source,
    checkedAt: timestamp(checkedAt) === null ? "" : String(checkedAt),
    freshness,
    historical: freshness === "stale" || freshness === "unknown",
    confidence: cleanText(extra.confidence).toLowerCase(),
    persistedIntent: Boolean(extra.persistedIntent),
    liveObserved: Boolean(extra.liveObserved)
  };
}

function isSuccessfulVerification(verification) {
  return !["failed", "error"].includes(String(verification?.status || "").toLowerCase());
}

function candidateTime(item) {
  return timestamp(item?.checkedAt) ?? Number.NEGATIVE_INFINITY;
}

function chooseField(field, candidates, failedAttempt) {
  const available = candidates.filter(Boolean);
  if (!available.length) {
    return { value: null, detail: "尚无可用证据", tone: "muted", source: "none", checkedAt: "", freshness: "unknown", historical: false };
  }
  let chosen;
  if (field === "method") {
    const intent = available.find((item) => item.persistedIntent);
    const liveProbe = available.find((item) => item.source === "recognition" || item.liveObserved);
    const liveMayOverride = liveProbe
      && ["fresh", "aging"].includes(liveProbe.freshness)
      && ["high", "medium"].includes(liveProbe.confidence);
    chosen = liveMayOverride ? liveProbe : intent;
  }
  if (!chosen) {
    const current = available.filter((item) => ["fresh", "aging"].includes(item.freshness));
    chosen = (current.length ? current : available)
      .slice().sort((a, b) => candidateTime(b) - candidateTime(a))[0];
  }
  const failedAfterEvidence = failedAttempt?.status === "failed"
    && candidateTime(failedAttempt) > candidateTime(chosen);
  const historical = chosen.historical || failedAfterEvidence;
  const tone = historical && SUCCESS_TONES.has(chosen.tone) ? "warning" : chosen.tone;
  return {
    value: chosen.value,
    detail: chosen.detail,
    tone,
    source: chosen.source,
    checkedAt: chosen.checkedAt,
    freshness: chosen.freshness,
    historical
  };
}

function safeAttempt(attempt, now) {
  if (!attempt || typeof attempt !== "object") return null;
  return {
    status: cleanText(attempt.status || "unknown"),
    checkedAt: timestamp(attempt.checkedAt) === null ? "" : String(attempt.checkedAt),
    freshness: evidenceFreshness(attempt.checkedAt, { now }),
    evidenceAvailable: Boolean(attempt.evidenceAvailable),
    category: cleanText(attempt.category),
    message: cleanText(attempt.message)
  };
}

export function toInstanceEvidenceView({
  verification = null,
  recognitionPreview = null,
  nodeResult = null,
  observed = null,
  lastProbeAttempt = null,
  now = new Date().toISOString()
} = {}) {
  const latestAttempt = safeAttempt(lastProbeAttempt || observed?.lastProbeAttempt, now);
  const verificationOk = isSuccessfulVerification(verification);
  const verificationAt = verification?.checkedAt;
  const recognition = recognitionPreview?.recognition;
  const recognitionAt = recognitionPreview?.checkedAt;
  const probes = recognition?.probes || {};
  const nodeAt = nodeResult?.checkedAt || nodeResult?.deployedAt || nodeResult?.updatedAt;
  const observedAt = observed?.checkedAt || observed?.sshConnection?.checkedAt;
  const intent = observed?.methodIntent || observed?.manualClassification || null;

  const sources = {
    ssh: [
      verificationOk && candidate("ssh", safeSsh(verification?.ssh), "verification", verificationAt, now),
      candidate("ssh", safeSsh(probes.ssh), "recognition", recognitionAt, now),
      candidate("ssh", safeSsh(nodeResult?.ssh), "nodeResult", nodeAt, now),
      candidate("ssh", safeSsh(observed?.sshConnection), "observed", observedAt, now)
    ],
    bbr: [
      verificationOk && candidate("bbr", safeBbr(verification?.bbr), "verification", verificationAt, now),
      candidate("bbr", safeBbr(probes.bbr), "recognition", recognitionAt, now),
      candidate("bbr", safeBbr(nodeResult?.bbr), "nodeResult", nodeAt, now)
    ],
    firewall: [
      verificationOk && candidate("firewall", safeFirewall(verification?.firewall), "verification", verificationAt, now),
      candidate("firewall", safeFirewall(probes.firewall), "recognition", recognitionAt, now),
      candidate("firewall", safeFirewall(nodeResult?.firewall), "nodeResult", nodeAt, now)
    ],
    services: [
      verificationOk && candidate("services", safeServices(verification?.services), "verification", verificationAt, now),
      candidate("services", safeServices(probes.services), "recognition", recognitionAt, now),
      candidate("services", safeServices(nodeResult?.services), "nodeResult", nodeAt, now)
    ],
    method: [
      verificationOk && candidate("method", cleanText(verification?.method), "verification", verificationAt, now, {
        confidence: verification?.methodConfidence,
        liveObserved: ["ssh_deep_probe", "ssh_probe"].includes(String(verification?.methodSource || ""))
      }),
      candidate("method", cleanText(recognition?.method), "recognition", recognitionAt, now, { confidence: recognition?.confidence }),
      candidate("method", cleanText(nodeResult?.type), "nodeResult", nodeAt, now, { persistedIntent: true }),
      candidate("method", cleanText(intent?.method), cleanText(intent?.source || "persisted"), intent?.checkedAt, now, { persistedIntent: true })
    ]
  };

  const view = {};
  for (const field of Object.keys(sources)) view[field] = chooseField(field, sources[field], latestAttempt);
  view.latestAttempt = latestAttempt;
  view.diagnosisRecommended = latestAttempt?.status === "failed";
  return view;
}
