import assert from "node:assert/strict";
import test from "node:test";

import { createProxyInspector } from "../server/proxy-inspector.js";

test("proxy inspector reports direct mode without opening a socket", async () => {
  let calls = 0;
  const inspector = createProxyInspector({ baseEnv: {}, connect: async () => { calls += 1; } });
  assert.deepEqual(await inspector.inspect(), { configured: false, status: "direct", endpoint: "", source: "" });
  assert.equal(calls, 0);
});

test("proxy inspector reports a sanitized listening endpoint", async () => {
  const calls = [];
  const inspector = createProxyInspector({
    baseEnv: { https_proxy: "http://user:secret@127.0.0.1:1082" },
    connect: async (host, port, timeoutMs) => calls.push({ host, port, timeoutMs })
  });

  const result = await inspector.inspect();
  assert.equal(result.configured, true);
  assert.equal(result.status, "listening");
  assert.equal(result.endpoint, "127.0.0.1:1082");
  assert.deepEqual(calls, [{ host: "127.0.0.1", port: 1082, timeoutMs: 1000 }]);
  assert.doesNotMatch(JSON.stringify(result), /user|secret/);
});

test("proxy inspector reports unavailable listener without raw socket errors", async () => {
  const inspector = createProxyInspector({
    baseEnv: { HTTPS_PROXY: "http://127.0.0.1:1082" },
    connect: async () => { throw new Error("token=secret ECONNREFUSED"); }
  });

  const result = await inspector.inspect();
  assert.equal(result.status, "unreachable");
  assert.equal(result.endpoint, "127.0.0.1:1082");
  assert.equal(JSON.stringify(result).includes("secret"), false);
});
