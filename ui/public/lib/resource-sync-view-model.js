export function summarizeResourceSyncFailures(messages = []) {
  const clean = [...new Set(messages.map((message) => String(message || "").trim()).filter(Boolean))];
  if (!clean.length) return "请检查项目权限或网络后重试。";

  const proxy = clean.find((message) => /本地代理|ProxyError|Unable to connect to proxy|Tunnel connection failed|503 Service Unavailable/i.test(message));
  if (proxy) return proxy;

  const projectAccess = clean.find((message) => /项目访问失败|PERMISSION_DENIED|Compute Engine API has not been used|it is disabled/i.test(message));
  if (projectAccess) return projectAccess;

  return clean[0];
}
