import assert from "node:assert/strict";
import test from "node:test";

import {
  assertAllowedLoopbackOrigin,
  HttpRequestError,
  isAllowedLoopbackOrigin,
  readJsonBody,
  toPublicHttpError
} from "../server/http-runtime.js";

test("HTTP runtime allows only the local console origin and non-browser callers", () => {
  assert.equal(isAllowedLoopbackOrigin(undefined, { port: 8787 }), true);
  assert.equal(isAllowedLoopbackOrigin("http://127.0.0.1:8787", { port: 8787 }), true);
  assert.equal(isAllowedLoopbackOrigin("http://localhost:8787", { port: 8787 }), true);
  assert.equal(isAllowedLoopbackOrigin("https://evil.example", { port: 8787 }), false);
  assert.equal(isAllowedLoopbackOrigin("http://localhost:3000", { port: 8787 }), false);
  assert.throws(
    () => assertAllowedLoopbackOrigin("https://evil.example", { port: 8787 }),
    (error) => error instanceof HttpRequestError && error.status === 403 && error.code === "cross_origin_blocked"
  );
});

function requestFrom(chunks) {
  return {
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) yield Buffer.from(chunk);
    }
  };
}

test("HTTP runtime parses JSON within the one MiB boundary", async () => {
  const body = await readJsonBody(requestFrom(["{\"name\":", "\"vm-a\"}"]), { limitBytes: 1024 * 1024 });
  assert.deepEqual(body, { name: "vm-a" });
  assert.equal(await readJsonBody(requestFrom([])), undefined);
});

test("HTTP runtime classifies invalid and oversized JSON", async () => {
  await assert.rejects(
    () => readJsonBody(requestFrom(["{broken"])),
    (error) => error instanceof HttpRequestError && error.status === 400 && error.code === "invalid_json"
  );
  await assert.rejects(
    () => readJsonBody(requestFrom(["x".repeat(11)]), { limitBytes: 10 }),
    (error) => error instanceof HttpRequestError && error.status === 413 && error.code === "payload_too_large"
  );
});

test("HTTP runtime keeps expected errors actionable and hides unexpected secrets", () => {
  assert.deepEqual(toPublicHttpError(new HttpRequestError({
    status: 413,
    code: "payload_too_large",
    message: "请求内容超过 1 MiB 限制。"
  })), {
    status: 413,
    body: { error: "请求内容超过 1 MiB 限制。", code: "payload_too_large" }
  });

  const publicError = toPublicHttpError(new Error("token=secret /Users/example/.ssh/private-key"));
  assert.equal(publicError.status, 500);
  assert.deepEqual(publicError.body, { error: "服务器内部错误", code: "internal_error" });
  assert.doesNotMatch(JSON.stringify(publicError), /secret|private-key/);
});
