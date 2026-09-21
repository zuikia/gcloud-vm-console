const PROXY_ENV_KEYS = [
  "HTTPS_PROXY",
  "https_proxy",
  "ALL_PROXY",
  "all_proxy",
  "HTTP_PROXY",
  "http_proxy"
];

function textFor(error) {
  return [error?.message, error?.stderr, error?.stdout]
    .map((value) => String(value || ""))
    .filter(Boolean)
    .join(" ");
}

function safeSlice(value, limit = 1000) {
  return String(value || "")
    .replace(/(?:vless|vmess|hy2|hysteria2|tuic|trojan|ss):\/\/\S+/gi, "[REDACTED-LINK]")
    .replace(/(?:password|passwd|token|secret|private[_-]?key)\s*[=:]\s*\S+/gi, "$1=[REDACTED]")
    .replace(/(?:\/Users\/|\/home\/)[^\s'\"]+/g, "[REDACTED-PATH]")
    .slice(0, limit);
}

function proxyPort(url) {
  if (url.port) return url.port;
  if (url.protocol === "https:") return "443";
  if (url.protocol.startsWith("socks")) return "1080";
  return "80";
}

export function effectiveProxy(baseEnv = process.env) {
  for (const source of PROXY_ENV_KEYS) {
    const raw = String(baseEnv?.[source] || "").trim();
    if (!raw) continue;
    try {
      const url = new URL(raw.includes("://") ? raw : `http://${raw}`);
      const hostname = url.hostname || "";
      const port = proxyPort(url);
      return {
        source,
        scheme: url.protocol.replace(/:$/, ""),
        endpoint: hostname ? `${hostname}:${port}` : "",
        hostname,
        port: Number(port),
        loopback: ["127.0.0.1", "::1", "localhost"].includes(hostname.toLowerCase()),
        authConfigured: Boolean(url.username || url.password)
      };
    } catch {
      return {
        source,
        scheme: "unknown",
        endpoint: "代理地址格式无效",
        hostname: "",
        port: 0,
        loopback: false,
        authConfigured: false
      };
    }
  }
  return null;
}

function result(status, category, code, message, retryable = false) {
  return { status, category, code, message, retryable, recognized: true };
}

export function classifyNetworkError(error, { baseEnv = process.env } = {}) {
  const raw = textFor(error);
  const message = safeSlice(raw);
  const proxy = effectiveProxy(baseEnv);
  const endpoint = proxy?.endpoint ? `（${proxy.endpoint}）` : "";

  if (/PERMISSION_DENIED|Compute Engine API has not been used|it is disabled/i.test(raw)) {
    return result(403, "project_access", "project_access", "项目访问失败：当前账号可能没有权限，或 Compute Engine API 未启用。请确认账号、项目和 API 状态后重试。");
  }
  if (/UNAUTHENTICATED|invalid_grant|reauth|login required/i.test(raw)) {
    return result(401, "auth", "auth", "gcloud 登录状态不可用：请重新登录对应账号后重试。");
  }
  if (/not found|\b404\b|was not found/i.test(raw)) {
    return result(404, "not_found", "not_found", safeSlice(error?.message) || "请求的云端资源不存在。");
  }
  if (error?.code === "timeout") {
    return result(504, "network", "network_timeout", "gcloud 操作超时，云端最终状态未确认。请运行只读体检后再决定下一步。");
  }
  if (error?.code === "output_limit") {
    return result(502, "gcloud", "output_limit", "gcloud 返回内容超过安全上限，原始输出未保存。");
  }
  if (error?.code === "spawn_failure") {
    return result(503, "gcloud", "gcloud_unavailable", "本机无法启动 gcloud，请检查 gcloud 安装和 PATH。");
  }
  if (/ECONNREFUSED|connection refused|failed to connect to proxy|proxy connection failed/i.test(raw) && proxy) {
    return result(503, "proxy", "proxy_unreachable", `本地代理监听不可用${endpoint}。请启动代理或修正代理环境后重试。`, true);
  }
  if (/ProxyError|Unable to connect to proxy|Tunnel connection failed|proxy.*\b(?:502|503|504)\b|\b(?:502|503|504) Service Unavailable/i.test(raw)) {
    const statusMatch = raw.match(/\b(502|503|504)\b/);
    const statusText = statusMatch ? `，上游返回 ${statusMatch[1]}` : "";
    return result(503, "proxy", "proxy_upstream", `本地代理${endpoint}已接收请求，但无法建立 Google API 隧道${statusText}。请检查代理上游后重试。`, true);
  }
  if (/429|RESOURCE_EXHAUSTED|rate limit|too many requests/i.test(raw)) {
    return result(429, "network", "rate_limit", "Google API 暂时限流，请稍后重试。", true);
  }
  if (/ENOTFOUND|EAI_AGAIN|Temporary failure in name resolution|Name or service not known/i.test(raw)) {
    return result(503, "network", "dns", "DNS 无法解析 Google API 地址，请检查当前网络或代理 DNS 设置。", true);
  }
  if (/CERTIFICATE_VERIFY_FAILED|certificate verify failed|SSL|TLS|handshake/i.test(raw)) {
    return result(503, "network", "tls", "连接 Google API 时 TLS 握手失败，请检查代理证书或网络链路。", true);
  }
  if (/ECONNRESET|connection reset|remote end closed|connection aborted/i.test(raw)) {
    return result(503, "network", "connection_reset", "连接 Google API 时网络被重置，请重试当前只读操作。", true);
  }

  return {
    status: 500,
    category: "generic",
    code: "generic",
    message,
    retryable: false,
    recognized: false
  };
}

export function sanitizePublicError(value) {
  return safeSlice(value);
}
