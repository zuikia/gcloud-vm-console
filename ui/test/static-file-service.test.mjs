import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { brotliDecompressSync, gunzipSync } from "node:zlib";

import { createStaticFileService } from "../server/static-file-service.js";

async function setup(t) {
  const root = await mkdtemp(path.join(tmpdir(), "gvc-static-"));
  const publicRoot = path.join(root, "public");
  const fontRoot = path.join(root, "fonts");
  await mkdir(publicRoot);
  await mkdir(path.join(fontRoot, "family", "files"), { recursive: true });
  await writeFile(path.join(publicRoot, "index.html"), "<main>console</main>\n");
  await writeFile(path.join(publicRoot, "app.js"), `export const payload = "${"a".repeat(4096)}";\n`);
  await writeFile(path.join(publicRoot, "styles.css"), `.root{content:"${"b".repeat(4096)}"}\n`);
  await writeFile(path.join(fontRoot, "family", "files", "font.woff2"), Buffer.alloc(2048, 7));
  t.after(() => rm(root, { recursive: true, force: true }));
  return {
    root,
    publicRoot,
    fontRoot,
    service: createStaticFileService({ publicRoot, fontsourceRoot: fontRoot })
  };
}

test("static service revalidates unchanged assets with ETag and Last-Modified", async (t) => {
  const { service } = await setup(t);
  const first = await service.handle({ method: "GET", url: "/app.js", headers: {} });
  assert.equal(first.status, 200);
  assert.match(first.headers.etag, /^W\//);
  assert.ok(first.headers["last-modified"]);
  assert.equal(first.headers["cache-control"], "no-cache");
  assert.equal(first.headers["x-content-type-options"], "nosniff");

  const etag = await service.handle({
    method: "GET",
    url: "/app.js",
    headers: { "if-none-match": first.headers.etag }
  });
  assert.equal(etag.status, 304);
  assert.equal(etag.body, null);

  const modified = await service.handle({
    method: "GET",
    url: "/app.js",
    headers: { "if-modified-since": first.headers["last-modified"] }
  });
  assert.equal(modified.status, 304);
});

test("static service prefers Brotli, falls back to gzip, and skips WOFF2 recompression", async (t) => {
  const { service } = await setup(t);
  const brotli = await service.handle({
    method: "GET",
    url: "/app.js",
    headers: { "accept-encoding": "gzip, br" }
  });
  assert.equal(brotli.headers["content-encoding"], "br");
  assert.equal(brotli.headers.vary, "Accept-Encoding");
  assert.match(brotliDecompressSync(brotli.body).toString("utf8"), /payload/);

  const gzip = await service.handle({
    method: "GET",
    url: "/styles.css",
    headers: { "accept-encoding": "gzip" }
  });
  assert.equal(gzip.headers["content-encoding"], "gzip");
  assert.match(gunzipSync(gzip.body).toString("utf8"), /\.root/);

  const font = await service.handle({
    method: "GET",
    url: "/vendor/fontsource/family/files/font.woff2",
    headers: { "accept-encoding": "br, gzip" }
  });
  assert.equal(font.headers["content-encoding"], undefined);
  assert.equal(font.headers["cache-control"], "public, max-age=604800");
});

test("static service invalidates cached variants after a file changes", async (t) => {
  const { service, publicRoot } = await setup(t);
  const first = await service.handle({ method: "GET", url: "/app.js", headers: { "accept-encoding": "br" } });
  await new Promise((resolve) => setTimeout(resolve, 5));
  await writeFile(path.join(publicRoot, "app.js"), `export const changed = "${"c".repeat(5000)}";\n`);
  const second = await service.handle({ method: "GET", url: "/app.js", headers: { "accept-encoding": "br" } });
  assert.notEqual(second.headers.etag, first.headers.etag);
  assert.match(brotliDecompressSync(second.body).toString("utf8"), /changed/);
});

test("static service handles HEAD, missing files, unsupported methods, and traversal", async (t) => {
  const { service } = await setup(t);
  const head = await service.handle({ method: "HEAD", url: "/app.js", headers: { "accept-encoding": "gzip" } });
  assert.equal(head.status, 200);
  assert.equal(head.body, null);
  assert.ok(Number(head.headers["content-length"]) > 0);

  assert.equal((await service.handle({ method: "GET", url: "/missing.js", headers: {} })).status, 404);
  assert.equal((await service.handle({ method: "POST", url: "/app.js", headers: {} })).status, 405);
  assert.equal((await service.handle({ method: "GET", url: "/%2e%2e/package.json", headers: {} })).status, 403);
});
