import assert from "node:assert/strict";
import test from "node:test";

import { ApiError, createApiClient } from "../public/lib/api-client.js";

function response({ ok = true, status = 200, body = {} } = {}) {
  return {
    ok,
    status,
    async json() { return body; }
  };
}

test("API client sends JSON and forwards AbortSignal", async () => {
  const calls = [];
  const api = createApiClient({
    fetchImpl: async (path, options) => {
      calls.push({ path, options });
      return response({ body: { ok: true } });
    }
  });
  const controller = new AbortController();
  assert.deepEqual(await api("/api/test", { method: "POST", body: { name: "vm-a" }, signal: controller.signal }), { ok: true });
  assert.equal(calls[0].options.body, '{"name":"vm-a"}');
  assert.equal(calls[0].options.signal, controller.signal);
  assert.equal(calls[0].options.headers["content-type"], "application/json");
});

test("API client returns structured errors without losing the response body", async () => {
  const api = createApiClient({
    fetchImpl: async () => response({ ok: false, status: 413, body: { error: "too large", code: "payload_too_large" } })
  });
  await assert.rejects(() => api("/api/test"), (error) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.status, 413);
    assert.equal(error.code, "payload_too_large");
    assert.deepEqual(error.body, { error: "too large", code: "payload_too_large" });
    return true;
  });
});
