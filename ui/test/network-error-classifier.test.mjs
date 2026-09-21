import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyNetworkError,
  effectiveProxy
} from "../server/network-error-classifier.js";

test("network classifier distinguishes upstream proxy failure and redacts proxy credentials", () => {
  const result = classifyNetworkError(new Error(
    "ProxyError: Unable to connect to proxy; Tunnel connection failed: 503 Service Unavailable"
  ), {
    baseEnv: { https_proxy: "http://user:secret@127.0.0.1:1082" }
  });

  assert.equal(result.category, "proxy");
  assert.equal(result.code, "proxy_upstream");
  assert.equal(result.retryable, true);
  assert.match(result.message, /127\.0\.0\.1:1082/);
  assert.doesNotMatch(result.message, /user|secret/);
});

test("network classifier distinguishes unavailable proxy listener", () => {
  const result = classifyNetworkError(new Error("connect ECONNREFUSED 127.0.0.1:1082"), {
    baseEnv: { HTTPS_PROXY: "http://127.0.0.1:1082" }
  });

  assert.equal(result.category, "proxy");
  assert.equal(result.code, "proxy_unreachable");
  assert.equal(result.retryable, true);
});

test("network classifier keeps permission authentication and not-found errors non-retryable", () => {
  assert.equal(classifyNetworkError(new Error("PERMISSION_DENIED"), {}).retryable, false);
  assert.equal(classifyNetworkError(new Error("UNAUTHENTICATED login required"), {}).retryable, false);
  assert.equal(classifyNetworkError(new Error("resource was not found 404"), {}).retryable, false);
});

test("effective proxy uses HTTPS proxy precedence and never returns credentials", () => {
  const proxy = effectiveProxy({
    HTTP_PROXY: "http://127.0.0.1:8000",
    HTTPS_PROXY: "http://name:password@proxy.example:8443",
    ALL_PROXY: "socks5://127.0.0.1:1080"
  });

  assert.equal(proxy.source, "HTTPS_PROXY");
  assert.equal(proxy.endpoint, "proxy.example:8443");
  assert.equal(proxy.authConfigured, true);
  assert.equal(JSON.stringify(proxy).includes("password"), false);
});
