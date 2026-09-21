const DEFAULT_BODY_LIMIT = 1024 * 1024;

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
