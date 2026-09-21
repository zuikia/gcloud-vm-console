export class ApiError extends Error {
  constructor({ path, status, body }) {
    super(body?.error || `请求失败: ${status}`);
    this.name = "ApiError";
    this.path = path;
    this.status = status;
    this.body = body || {};
    this.code = this.body.code || "http_error";
    this.category = this.body.errorCategory || "http";
    this.retryable = Boolean(this.body.retryable);
  }
}

export function createApiClient({ fetchImpl = globalThis.fetch } = {}) {
  if (typeof fetchImpl !== "function") throw new Error("fetch is required.");

  return async function api(path, options = {}) {
    const response = await fetchImpl(path, {
      method: options.method || "GET",
      headers: options.body ? { "content-type": "application/json" } : {},
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: options.signal
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new ApiError({ path, status: response.status, body });
    return body;
  };
}
