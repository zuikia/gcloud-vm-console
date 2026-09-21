const DEFAULT_BODY_LIMIT = 1024 * 1024;

export function isAllowedLoopbackOrigin(origin, { port = 8787 } = {}) {
  const value = String(origin || "").trim();
  if (!value) return true;
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    const loopback = hostname === "127.0.0.1" || hostname === "localhost" || hostname === "[::1]";
    return url.protocol === "http:" && loopback && Number(url.port || port) === Number(port);
  } catch {
    return false;
  }
}

export function assertAllowedLoopbackOrigin(origin, options = {}) {
  if (isAllowedLoopbackOrigin(origin, options)) return;
  throw new HttpRequestError({
    status: 403,
    code: "cross_origin_blocked",
    message: "已阻止来自非本地页面的请求。请从本地控制台页面发起操作。"
  });
}

export class HttpRequestError extends Error {
  constructor({ status, code, message }) {
    super(message);
    this.name = "HttpRequestError";
    this.status = status;
    this.code = code;
  }
}

export async function readJsonBody(req, { limitBytes = DEFAULT_BODY_LIMIT } = {}) {
  const chunks = [];
  let totalBytes = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.byteLength;
    if (totalBytes > limitBytes) {
      throw new HttpRequestError({
        status: 413,
        code: "payload_too_large",
        message: "请求内容超过 1 MiB 限制。"
      });
    }
    chunks.push(buffer);
  }
  if (!chunks.length) return undefined;
  const text = Buffer.concat(chunks, totalBytes).toString("utf8");
  if (!text.trim()) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpRequestError({
      status: 400,
      code: "invalid_json",
      message: "请求内容不是有效 JSON。"
    });
  }
}

export function toPublicHttpError(error) {
  if (error instanceof HttpRequestError) {
    return {
      status: error.status,
      body: { error: error.message, code: error.code }
    };
  }
  return {
    status: 500,
    body: { error: "服务器内部错误", code: "internal_error" }
  };
}
