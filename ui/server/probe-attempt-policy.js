function sanitizeMessage(value = "") {
  let message = String(value || "")
    .replace(/\b(?:vmess|vless|trojan|ss|hysteria2?|hy2):\/\/\S+/gi, "[redacted-link]")
    .replace(/\b(?:password|passwd|token|secret|private[_ -]?key|credential)\s*[:=]\s*\S+/gi, "$1=[redacted]")
    .replace(/[\r\n\t]+/g, " ")
    .trim();
  if (message.length > 240) message = `${message.slice(0, 237)}...`;
  return message;
}

function hasUsableEvidence(result = {}) {
  if (result?.ssh?.verified) return true;
  if (Array.isArray(result?.services) && result.services.length) return true;
  if (Array.isArray(result?.ports) && result.ports.length) return true;
  if (result?.bbr !== undefined && result?.bbr !== null) return true;
  if (result?.firewall && String(result.firewall.status || "").toLowerCase() !== "unknown") return true;
  return false;
}

function statusFor(input) {
  if (input instanceof Error) return "failed";
  const status = String(input?.status || "failed").toLowerCase();
  return ["passed", "partial", "failed"].includes(status) ? status : "failed";
}

export function toProbeAttempt(resultOrError, { checkedAt = new Date().toISOString(), method = "" } = {}) {
  const error = resultOrError instanceof Error ? resultOrError : null;
  const result = error ? null : resultOrError || {};
  const status = statusFor(resultOrError);
  const category = sanitizeMessage(
    error ? (error.category || error.code || "probe_error") : (result.errorCategory || result.category || "")
  );
  const message = sanitizeMessage(
    error?.message || result?.error || result?.message || (Array.isArray(result?.warnings) ? result.warnings[0] : "") || ""
  );
  return {
    status,
    checkedAt: String(result?.checkedAt || checkedAt),
    method: String(result?.method || method || ""),
    evidenceAvailable: hasUsableEvidence(result),
    category,
    message
  };
}

export function mergeVerificationEvidence(record = {}, attemptResult, options = {}) {
  const attempt = toProbeAttempt(attemptResult, {
    checkedAt: options.checkedAt || attemptResult?.checkedAt || new Date().toISOString(),
    method: options.method || attemptResult?.method || record?.verification?.method || ""
  });
  const useAttemptEvidence = ["passed", "partial"].includes(attempt.status) || attempt.evidenceAvailable;
  return {
    verification: useAttemptEvidence ? attemptResult : (record.verification || null),
    observed: {
      ...(record.observed || {}),
      ...(useAttemptEvidence && attemptResult?.ssh ? { sshConnection: attemptResult.ssh } : {}),
      lastProbeAttempt: attempt
    },
    historyEntry: {
      type: "verification",
      status: attempt.status,
      checkedAt: attempt.checkedAt,
      method: attempt.method,
      evidenceAvailable: attempt.evidenceAvailable,
      category: attempt.category,
      message: attempt.message
    }
  };
}
