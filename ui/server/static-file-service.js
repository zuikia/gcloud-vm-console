import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { brotliCompress, gzip } from "node:zlib";

const brotli = promisify(brotliCompress);
const gzipBuffer = promisify(gzip);

const MIME_TYPES = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".woff2", "font/woff2"]
]);
const COMPRESSIBLE_EXTENSIONS = new Set([".html", ".js", ".css", ".json", ".svg"]);

function normalizedHeaders(headers = {}) {
  return Object.fromEntries(Object.entries(headers).map(([name, value]) => [name.toLowerCase(), String(value || "")]));
}

function cacheControl(extension) {
  return extension === ".woff2" ? "public, max-age=604800" : "no-cache";
}

function securityHeaders() {
  return {
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer"
  };
}

function notModified(headers, metadata) {
  const ifNoneMatch = headers["if-none-match"];
  if (ifNoneMatch) return ifNoneMatch.split(",").map((value) => value.trim()).includes(metadata.etag);
  const ifModifiedSince = Date.parse(headers["if-modified-since"] || "");
  if (!Number.isFinite(ifModifiedSince)) return false;
  return Math.floor(metadata.mtimeMs / 1000) * 1000 <= ifModifiedSince;
}

function preferredEncoding(acceptEncoding, compressible) {
  if (!compressible) return "identity";
  const accepted = String(acceptEncoding || "").toLowerCase();
  if (/(?:^|,)\s*br(?:\s*;[^,]*)?(?:,|$)/.test(accepted)) return "br";
  if (/(?:^|,)\s*gzip(?:\s*;[^,]*)?(?:,|$)/.test(accepted)) return "gzip";
  return "identity";
}

function rawPathname(rawUrl) {
  return String(rawUrl || "/").split(/[?#]/, 1)[0] || "/";
}

function decodePathname(rawUrl) {
  const raw = rawPathname(rawUrl);
  const decoded = decodeURIComponent(raw);
  if (decoded.includes("\0") || decoded.split(/[\\/]+/).includes("..")) {
    const error = new Error("Forbidden path.");
    error.code = "FORBIDDEN_PATH";
    throw error;
  }
  return decoded === "/" ? "/index.html" : decoded;
}

export function createStaticFileService({
  publicRoot,
  fontsourceRoot,
  compressionThreshold = 1024
} = {}) {
  if (!publicRoot || !fontsourceRoot) throw new Error("publicRoot and fontsourceRoot are required.");
  const publicBase = path.resolve(publicRoot);
  const fontBase = path.resolve(fontsourceRoot);
  const variants = new Map();

  async function compressedBody(resolved, metadata, body, encoding) {
    if (encoding === "identity") return body;
    const key = `${resolved}\0${metadata.size}\0${metadata.mtimeMs}\0${encoding}`;
    if (variants.has(key)) return variants.get(key);
    for (const existingKey of variants.keys()) {
      if (existingKey.startsWith(`${resolved}\0`) && existingKey !== key) variants.delete(existingKey);
    }
    const compressed = encoding === "br" ? await brotli(body) : await gzipBuffer(body);
    variants.set(key, compressed);
    return compressed;
  }

  async function handle({ method = "GET", url = "/", headers: rawHeaders = {} } = {}) {
    if (!['GET', 'HEAD'].includes(method)) {
      return { status: 405, headers: { ...securityHeaders(), allow: "GET, HEAD" }, body: Buffer.from("Method not allowed") };
    }

    let pathname;
    try {
      pathname = decodePathname(url);
    } catch (error) {
      if (error?.code === "FORBIDDEN_PATH") {
        return { status: 403, headers: securityHeaders(), body: method === "HEAD" ? null : Buffer.from("Forbidden") };
      }
      return { status: 400, headers: securityHeaders(), body: method === "HEAD" ? null : Buffer.from("Bad request") };
    }

    const vendorPrefix = "/vendor/fontsource/";
    const rootDir = pathname.startsWith(vendorPrefix) ? fontBase : publicBase;
    const relativePath = pathname.startsWith(vendorPrefix)
      ? pathname.slice(vendorPrefix.length)
      : pathname.replace(/^\/+/, "");
    const resolved = path.normalize(path.join(rootDir, relativePath));
    const relativeToRoot = path.relative(rootDir, resolved);
    if (relativeToRoot.startsWith("..") || path.isAbsolute(relativeToRoot)) {
      return { status: 403, headers: securityHeaders(), body: method === "HEAD" ? null : Buffer.from("Forbidden") };
    }

    let metadata;
    let body;
    try {
      metadata = await stat(resolved);
      if (!metadata.isFile()) throw Object.assign(new Error("Not found"), { code: "ENOENT" });
      body = await readFile(resolved);
    } catch (error) {
      if (["ENOENT", "EISDIR"].includes(error?.code)) {
        return { status: 404, headers: securityHeaders(), body: method === "HEAD" ? null : Buffer.from("Not found") };
      }
      throw error;
    }

    const extension = path.extname(resolved).toLowerCase();
    const etag = `W/\"${metadata.size.toString(16)}-${Math.trunc(metadata.mtimeMs).toString(16)}\"`;
    const responseHeaders = {
      ...securityHeaders(),
      "content-type": MIME_TYPES.get(extension) || "application/octet-stream",
      "cache-control": cacheControl(extension),
      etag,
      "last-modified": metadata.mtime.toUTCString()
    };
    const headers = normalizedHeaders(rawHeaders);
    const compressible = COMPRESSIBLE_EXTENSIONS.has(extension) && body.byteLength >= compressionThreshold;
    if (compressible) responseHeaders.vary = "Accept-Encoding";
    if (notModified(headers, { etag, mtimeMs: metadata.mtimeMs })) {
      return { status: 304, headers: responseHeaders, body: null };
    }

    const encoding = preferredEncoding(headers["accept-encoding"], compressible);
    const responseBody = await compressedBody(resolved, metadata, body, encoding);
    if (encoding !== "identity") responseHeaders["content-encoding"] = encoding;
    responseHeaders["content-length"] = String(responseBody.byteLength);
    return { status: 200, headers: responseHeaders, body: method === "HEAD" ? null : responseBody };
  }

  return { handle };
}
