import assert from "node:assert/strict";
import test from "node:test";

import { createTaskLock } from "../server/task-lock.js";
import { createWarpEgressService } from "../server/warp-egress-service.js";

const identity = {
  configuration: "acct-a",
  account: "user@example.com",
  projectId: "project-a",
  zone: "asia-northeast2-b",
  name: "jp-osaka-singbox-01"
};

const record = {
  id: "jp-osaka-singbox-01-test",
  identity,
  desired: { ssh: { user: "y", keyFile: "/private/gcp-key", port: 45400 } },
  observed: {
    network: { externalIp: "203.0.113.12" },
    sshConnection: { desiredPort: 45400, actualPort: 45400, verified: true, fallback: false }
  },
  nodeResult: {
    type: "singbox_plus",
    links: [
      { name: "hy2-obfs-warp", url: "hysteria2://secret" },
      { name: "tuic-v5-warp", url: "tuic://secret" },
      { name: "hy2-obfs", url: "hysteria2://direct" }
    ]
  }
};

function statusOutput({
  connection = "connected",
  network = "healthy",
  ipv4 = "203.0.113.13",
  ipv6 = "",
  routePort = 40000,
  affectedCount = 10
} = {}) {
  return [
    "__GVC_WARP_STATUS__",
    "service=active",
    "cli_version=2026.6.880.0",
    "mode=proxy",
    "proxy_port=40000",
    "protocol=masque",
    "tier=free",
    `connection=${connection}`,
    `network=${network}`,
    "listener=loopback",
    "route_server=127.0.0.1",
    `route_port=${routePort}`,
    `affected_count=${affectedCount}`,
    `ipv4=${ipv4}`,
    "ipv4_colo=KIX",
    "ipv4_warp=on",
    `ipv6=${ipv6}`,
    "ipv6_colo=",
    "ipv6_warp=",
    "__GVC_WARP_END__"
  ].join("\n");
}

function runnerFrom(sequence) {
  const calls = [];
  return {
    calls,
    async run(input) {
      calls.push(input);
      const next = sequence.shift();
      if (next instanceof Error) throw next;
      return { stdout: next, transport: "public", sshPort: 45400 };
    }
  };
}

test("WARP probe requires service listener route and affected nodes and returns only safe facts", async () => {
  const runner = runnerFrom([statusOutput()]);
  const service = createWarpEgressService({
    sshRunner: runner,
    taskLock: createTaskLock(),
    now: () => "2026-07-30T12:00:00.000Z"
  });

  const warp = await service.probe({ record });

  assert.equal(warp.supported, true);
  assert.equal(warp.status, "connected");
  assert.equal(warp.mode, "proxy");
  assert.equal(warp.protocol, "masque");
  assert.equal(warp.proxyPort, 40000);
  assert.equal(warp.ipv4, "203.0.113.13");
  assert.equal(warp.ipv6, "");
  assert.equal(warp.colo.ipv4, "KIX");
  assert.equal(warp.affectedNodes.count, 2);
  assert.deepEqual(warp.affectedNodes.names, ["hy2-obfs-warp", "tuic-v5-warp"]);
  assert.doesNotMatch(JSON.stringify(warp), /hysteria2:\/\/|tuic:\/\/|private\/gcp-key|device_id|license/);
  assert.equal(runner.calls[0].operation, "status");
});

test("WARP probe fails closed when the live Sing-box route does not match the proxy", async () => {
  const runner = runnerFrom([statusOutput({ routePort: 41000 })]);
  const service = createWarpEgressService({ sshRunner: runner, taskLock: createTaskLock() });

  const warp = await service.probe({ record });

  assert.equal(warp.supported, false);
  assert.equal(warp.status, "unsupported");
  assert.match(warp.capability.reason, /路由/);
});

test("failed WARP probe retains the last usable state and records a sanitized latest attempt", async () => {
  const runner = runnerFrom([new Error("token=secret /private/gcp-key vless://raw-node")]);
  const service = createWarpEgressService({
    sshRunner: runner,
    taskLock: createTaskLock(),
    now: () => "2026-07-30T12:30:00.000Z"
  });
  const previous = {
    supported: true,
    status: "connected",
    ipv4: "203.0.113.13",
    checkedAt: "2026-07-30T12:00:00.000Z"
  };

  const warp = await service.probe({ record: { ...record, observed: { ...record.observed, warp: previous } } });

  assert.equal(warp.status, "connected");
  assert.equal(warp.ipv4, "203.0.113.13");
  assert.equal(warp.lastProbeAttempt.status, "failed");
  assert.doesNotMatch(warp.lastProbeAttempt.error, /secret|private\/gcp-key|vless:\/\//);
});

test("WARP reconnect reports changed and emits the fixed six stages once", async () => {
  const runner = runnerFrom([
    statusOutput({ ipv4: "203.0.113.13" }),
    "__GVC_WARP_RECONNECT__\ninitial=connected\ndisconnect=done\nhold=5\nconnect=done\nfinal=connected\n__GVC_WARP_END__",
    statusOutput({ ipv4: "203.0.113.14" })
  ]);
  const stages = [];
  const service = createWarpEgressService({
    sshRunner: runner,
    taskLock: createTaskLock(),
    now: () => "2026-07-30T12:00:00.000Z"
  });

  const result = await service.reconnect({ record, onStage: (stage) => stages.push(stage) });

  assert.equal(result.status, "succeeded");
  assert.equal(result.outcome, "changed");
  assert.equal(result.before.ipv4, "203.0.113.13");
  assert.equal(result.after.ipv4, "203.0.113.14");
  assert.deepEqual(stages.map((stage) => stage.name), ["precheck", "disconnect", "hold", "connect", "verify"]);
  assert.deepEqual(runner.calls.map((call) => call.operation), ["status", "reconnect", "status"]);
});

test("WARP reconnect treats an unchanged IPv4 as success and never loops", async () => {
  const runner = runnerFrom([
    statusOutput(),
    "__GVC_WARP_RECONNECT__\ninitial=connected\ndisconnect=done\nhold=5\nconnect=done\nfinal=connected\n__GVC_WARP_END__",
    statusOutput()
  ]);
  const service = createWarpEgressService({ sshRunner: runner, taskLock: createTaskLock() });

  const result = await service.reconnect({ record });

  assert.equal(result.status, "succeeded");
  assert.equal(result.outcome, "unchanged");
  assert.equal(runner.calls.filter((call) => call.operation === "reconnect").length, 1);
});

test("WARP reconnect restores an initially disconnected client without claiming an IP change", async () => {
  const runner = runnerFrom([
    statusOutput({ connection: "disconnected", network: "disconnected", ipv4: "" }),
    "__GVC_WARP_RECONNECT__\ninitial=disconnected\ndisconnect=skipped\nhold=0\nconnect=done\nfinal=connected\n__GVC_WARP_END__",
    statusOutput({ ipv4: "203.0.113.13" })
  ]);
  const service = createWarpEgressService({ sshRunner: runner, taskLock: createTaskLock() });

  const result = await service.reconnect({ record });

  assert.equal(result.status, "succeeded");
  assert.equal(result.outcome, "restored");
});

test("WARP reconnect treats an ambiguous transport as partial after a read-only recovery check", async () => {
  const runner = runnerFrom([
    statusOutput(),
    new Error("connection reset after remote action"),
    statusOutput()
  ]);
  const stages = [];
  const service = createWarpEgressService({ sshRunner: runner, taskLock: createTaskLock() });

  const result = await service.reconnect({ record, onStage: (stage) => stages.push(stage) });

  assert.equal(result.status, "partial");
  assert.equal(result.outcome, "restored");
  assert.match(stages.find((stage) => stage.name === "disconnect").detail, /需只读复核/);
  assert.match(stages.find((stage) => stage.name === "connect").detail, /恢复连接保护/);
  assert.deepEqual(runner.calls.map((call) => call.operation), ["status", "reconnect", "status"]);
});

test("WARP reconnect reports a safe explicit uncertainty when the recovery check also fails", async () => {
  const runner = runnerFrom([
    statusOutput(),
    new Error("connection reset token=secret"),
    new Error("status unavailable /private/gcp-key")
  ]);
  const stages = [];
  const service = createWarpEgressService({ sshRunner: runner, taskLock: createTaskLock() });

  await assert.rejects(
    service.reconnect({ record, onStage: (stage) => stages.push(stage) }),
    (error) => {
      assert.equal(error.code, "WARP_STATUS_UNCONFIRMED");
      assert.match(error.message, /重连结果未确认/);
      assert.doesNotMatch(error.message, /secret|private\/gcp-key/);
      return true;
    }
  );
  assert.equal(stages.find((stage) => stage.name === "verify").status, "failed");
});

test("WARP reconnect refuses unsupported evidence before any remote write", async () => {
  const runner = runnerFrom([statusOutput({ affectedCount: 0 })]);
  const service = createWarpEgressService({ sshRunner: runner, taskLock: createTaskLock() });

  await assert.rejects(service.reconnect({ record }), /不满足 WARP 管理条件/);
  assert.deepEqual(runner.calls.map((call) => call.operation), ["status"]);
});
