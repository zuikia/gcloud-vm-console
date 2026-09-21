import net from "node:net";

import { effectiveProxy } from "./network-error-classifier.js";

function tcpConnect(host, port, timeoutMs) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port });
    let settled = false;
    const finish = (error = null) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (error) reject(error);
      else resolve();
    };
    socket.setTimeout(timeoutMs, () => finish(new Error("proxy listener timeout")));
    socket.once("connect", () => finish());
    socket.once("error", (error) => finish(error));
  });
}

export function createProxyInspector({
  baseEnv = process.env,
  connect = tcpConnect,
  timeoutMs = 1000
} = {}) {
  async function inspect() {
    const proxy = effectiveProxy(baseEnv);
    if (!proxy) return { configured: false, status: "direct", endpoint: "", source: "" };
    if (!proxy.hostname || !proxy.port) {
      return { configured: true, status: "invalid", endpoint: proxy.endpoint, source: proxy.source };
    }
    try {
      await connect(proxy.hostname, proxy.port, timeoutMs);
      return { configured: true, status: "listening", endpoint: proxy.endpoint, source: proxy.source };
    } catch {
      return { configured: true, status: "unreachable", endpoint: proxy.endpoint, source: proxy.source };
    }
  }

  return { inspect };
}
