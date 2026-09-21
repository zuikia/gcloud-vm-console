import { isIP } from "node:net";

import { cloudIdentityKey, normalizeVmIdentity } from "./vm-identity.js";

const STATUS_KEYS = new Set([
  "service", "cli_version", "mode", "proxy_port", "protocol", "tier", "connection", "network",
  "listener", "route_server", "route_port", "affected_count", "ipv4", "ipv4_colo", "ipv4_warp",
  "ipv6", "ipv6_colo", "ipv6_warp"
]);

function safeText(value, max = 160) {
  return String(value || "").replace(/[\r\n\t]+/g, " ").trim().slice(0, max);
}

function sanitizeError(error) {
  return safeText(error?.message || error, 320)
    .replace(/(?:vless|vmess|hy2|hysteria2|tuic|ss|trojan):\/\/\S+/gi, "[已脱敏链接]")
    .replace(/\b(?:password|passwd|token|secret|credential|license|device[_-]?id)=\S+/gi, "[已脱敏]")
    .replace(/\/(?:Users|home|private|root)\/\S+/g, "[已脱敏路径]");
}

function parseBlock(output, start, end) {
  const lines = String(output || "").split(/\r?\n/).map((line) => line.trim());
  const first = lines.indexOf(start);
  const last = lines.indexOf(end, first + 1);
  if (first < 0 || last <= first) throw new Error("WARP 远端输出格式无效。");
  return lines.slice(first + 1, last);
}

function parseStatus(output = "") {
  const values = {};
  for (const line of parseBlock(output, "__GVC_WARP_STATUS__", "__GVC_WARP_END__")) {
    const index = line.indexOf("=");
    if (index <= 0) continue;
    const key = line.slice(0, index);
    if (!STATUS_KEYS.has(key)) continue;
    values[key] = safeText(line.slice(index + 1), 120);
  }
  return values;
}

function parseReconnect(output = "") {
  const allowed = new Set(["initial", "disconnect", "hold", "connect", "final"]);
  const values = {};
  for (const line of parseBlock(output, "__GVC_WARP_RECONNECT__", "__GVC_WARP_END__")) {
    const index = line.indexOf("=");
    if (index <= 0) continue;
    const key = line.slice(0, index);
    if (allowed.has(key)) values[key] = safeText(line.slice(index + 1), 40);
  }
  return values;
}

function validPort(value) {
  const port = Number(value);
  return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : 0;
}

function validColo(value) {
  const colo = String(value || "").toUpperCase();
  return /^[A-Z0-9]{3,5}$/.test(colo) ? colo : "";
}

function validIp(value, family) {
  return isIP(String(value || "")) === family ? String(value) : "";
}

function affectedNodeNames(record = {}) {
  const names = [];
  for (const link of Array.isArray(record.nodeResult?.links) ? record.nodeResult.links : []) {
    const name = safeText(link?.name, 80);
    if (!name || !/(?:^|[-_\s])warp(?:$|[-_\s])/i.test(name)) continue;
    if (!names.includes(name)) names.push(name);
    if (names.length >= 20) break;
  }
  return names;
}

function connectionStatus(values, supported, ipv4, ipv6) {
  if (!supported) return "unsupported";
  if (values.connection === "disconnected") return "disconnected";
  if (values.connection !== "connected") return "unknown";
  const egressHealthy = (ipv4 && values.ipv4_warp === "on") || (ipv6 && values.ipv6_warp === "on");
  return values.network === "healthy" && egressHealthy ? "connected" : "degraded";
}

function toWarpState(values, record, checkedAt) {
  const proxyPort = validPort(values.proxy_port);
  const routePort = validPort(values.route_port);
  const affectedCount = Number(values.affected_count) || 0;
  const serviceActive = values.service === "active";
  const cliAvailable = Boolean(values.cli_version);
  const proxyReady = values.mode === "proxy" && proxyPort > 0 && values.listener === "loopback";
  const routeReady = values.route_server === "127.0.0.1" && routePort === proxyPort && affectedCount > 0;
  const supported = serviceActive && cliAvailable && proxyReady && routeReady;
  const reason = !serviceActive
    ? "warp-svc 未运行"
    : !cliAvailable
      ? "warp-cli 不可用"
      : !proxyReady
        ? "WarpProxy 模式或监听端口未确认"
        : !routeReady
          ? "Sing-box WARP 路由未指向当前代理端口"
          : "";
  const ipv4 = validIp(values.ipv4, 4);
  const ipv6 = validIp(values.ipv6, 6);
  const names = affectedNodeNames(record);
  const status = connectionStatus(values, supported, ipv4, ipv6);
  return {
    schemaVersion: 1,
    supported,
    status,
    mode: values.mode === "proxy" ? "proxy" : "unknown",
    protocol: ["masque", "wireguard"].includes(values.protocol) ? values.protocol : "unknown",
    proxyPort,
    tier: ["free", "plus", "team", "teams", "zero-trust"].includes(values.tier) ? values.tier : "unknown",
    ipv4,
    ipv6,
    colo: { ipv4: validColo(values.ipv4_colo), ipv6: validColo(values.ipv6_colo) },
    capability: {
      serviceActive,
      cliAvailable,
      cliVersion: safeText(values.cli_version, 40),
      listenerVerified: values.listener === "loopback",
      routeVerified: routeReady,
      affectedInboundCount: affectedCount,
      reason
    },
    affectedNodes: { count: names.length || affectedCount, names },
    checkedAt,
    lastProbeAttempt: { status: supported ? "succeeded" : "partial", checkedAt, error: reason },
    lastReconnect: record.observed?.warp?.lastReconnect || null
  };
}

function sshInput(record = {}) {
  const desired = record.desired?.ssh || {};
  const actualPort = Number(record.observed?.sshConnection?.actualPort || desired.port);
  if (!record.observed?.sshConnection?.verified || !Number.isInteger(actualPort)) {
    throw new Error("缺少已验证的密钥 SSH 连接，WARP 管理已阻止。");
  }
  return {
    user: desired.user,
    keyFile: desired.keyFile,
    port: actualPort
  };
}

function safeSnapshot(warp = {}) {
  return {
    status: String(warp.status || "unknown"),
    ipv4: validIp(warp.ipv4, 4),
    ipv6: validIp(warp.ipv6, 6),
    colo: {
      ipv4: validColo(warp.colo?.ipv4),
      ipv6: validColo(warp.colo?.ipv6)
    }
  };
}

export function createWarpEgressService({ sshRunner, taskLock, now = () => new Date().toISOString() } = {}) {
  if (!sshRunner?.run) throw new Error("sshRunner with run() is required.");
  if (!taskLock?.run) throw new Error("taskLock with run() is required.");

  async function liveProbe(record, options = {}) {
    const identity = normalizeVmIdentity(record?.identity || {});
    const ssh = sshInput(record);
    const externalIp = record.observed?.network?.externalIp || "";
    const run = await sshRunner.run({
      operation: "status",
      identity,
      ssh,
      externalIp,
      ...(options.transport ? { transport: options.transport } : {})
    });
    const checkedAt = now();
    return {
      warp: toWarpState(parseStatus(run.stdout), record, checkedAt),
      transport: run.transport || "",
      sshPort: run.sshPort || ssh.port
    };
  }

  async function probe({ record } = {}) {
    try {
      return (await liveProbe(record)).warp;
    } catch (error) {
      const checkedAt = now();
      const previous = record?.observed?.warp && typeof record.observed.warp === "object"
        ? JSON.parse(JSON.stringify(record.observed.warp))
        : {
            schemaVersion: 1,
            supported: false,
            status: "unknown",
            mode: "unknown",
            protocol: "unknown",
            proxyPort: 0,
            tier: "unknown",
            ipv4: "",
            ipv6: "",
            colo: { ipv4: "", ipv6: "" },
            affectedNodes: { count: affectedNodeNames(record).length, names: affectedNodeNames(record) },
            checkedAt: "",
            lastReconnect: null
          };
      return {
        ...previous,
        lastProbeAttempt: {
          status: "failed",
          checkedAt,
          error: sanitizeError(error) || "WARP 检测失败"
        }
      };
    }
  }

  async function reconnect({ record, onStage = null } = {}) {
    const identity = normalizeVmIdentity(record?.identity || {});
    return taskLock.run(cloudIdentityKey(identity), async () => {
      const preflight = await liveProbe(record);
      if (!preflight.warp.supported || !["connected", "degraded", "disconnected"].includes(preflight.warp.status)) {
        throw new Error(`当前实例不满足 WARP 管理条件：${preflight.warp.capability.reason || "连接状态未确认"}`);
      }
      await onStage?.({ name: "precheck", status: "succeeded", detail: "WARP 服务、代理监听、Sing-box 路由和 SSH 路径已确认" });

      const before = safeSnapshot(preflight.warp);
      const startedAt = now();
      let reconnectRun;
      let reconnectError = null;
      try {
        reconnectRun = await sshRunner.run({
          operation: "reconnect",
          identity,
          ssh: sshInput(record),
          externalIp: record.observed?.network?.externalIp || "",
          transport: preflight.transport
        });
      } catch (error) {
        reconnectError = error;
      }

      let markers = {};
      if (reconnectRun) markers = parseReconnect(reconnectRun.stdout);
      await onStage?.({
        name: "disconnect",
        status: reconnectError ? "partial" : "succeeded",
        detail: reconnectError
          ? "远端传输中断，断开结果需只读复核"
          : before.status === "disconnected" || markers.disconnect === "skipped"
            ? "初始已断开，无需重复断开"
            : "WARP 已执行断开"
      });
      await onStage?.({
        name: "hold",
        status: reconnectError ? "partial" : "succeeded",
        detail: reconnectError
          ? "保持阶段结果需只读复核"
          : before.status === "disconnected" || markers.hold === "0"
            ? "恢复连接无需等待换出口"
            : "断开保持 5 秒"
      });
      await onStage?.({
        name: "connect",
        status: reconnectError ? "partial" : "succeeded",
        detail: reconnectError ? "远端脚本已触发恢复连接保护，连接结果需只读复核" : "WARP 已执行连接"
      });

      let verified;
      try {
        verified = await liveProbe(record, { transport: preflight.transport });
      } catch {
        await onStage?.({ name: "verify", status: "failed", detail: "WARP 重连后的状态读取失败，云端结果未确认" });
        const uncertainty = new Error("WARP 重连结果未确认；请重新检测 WARP 状态。");
        uncertainty.code = "WARP_STATUS_UNCONFIRMED";
        throw uncertainty;
      }
      const after = safeSnapshot(verified.warp);
      const connected = verified.warp.status === "connected";
      const degraded = verified.warp.status === "degraded";
      if (!connected && !degraded) {
        await onStage?.({ name: "verify", status: "failed", detail: "WARP 未恢复可用连接" });
        throw new Error(`WARP 重连后未恢复：${sanitizeError(reconnectError) || verified.warp.status}`);
      }

      let outcome;
      let status = "succeeded";
      if (reconnectError || degraded || !after.ipv4) {
        outcome = reconnectError && connected ? "restored" : "partial";
        status = "partial";
      } else if (before.status === "disconnected" || !before.ipv4) {
        outcome = "restored";
      } else {
        outcome = before.ipv4 === after.ipv4 ? "unchanged" : "changed";
      }
      await onStage?.({
        name: "verify",
        status: status === "partial" ? "partial" : "succeeded",
        detail: outcome === "changed"
          ? "WARP IPv4 已变化"
          : outcome === "unchanged"
            ? "WARP 已连接，IPv4 未变化"
            : outcome === "restored"
              ? "WARP 连接已恢复"
              : "WARP 已连接，IPv4 仍需确认"
      });

      const completedAt = now();
      const lastReconnect = {
        outcome,
        status,
        before,
        after,
        startedAt,
        completedAt,
        recoveryAttempted: Boolean(reconnectError)
      };
      return {
        status,
        outcome,
        before,
        after,
        warp: { ...verified.warp, lastReconnect },
        lastReconnect
      };
    });
  }

  return { probe, reconnect };
}
