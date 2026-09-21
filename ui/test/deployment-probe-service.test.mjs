import assert from "node:assert/strict";
import test from "node:test";

import { createDeploymentProbeService } from "../server/deployment-probe-service.js";

const identity = {
  configuration: "acct-a",
  account: "user@example.com",
  projectId: "project-a",
  zone: "us-west1-b",
  name: "vm-a"
};

const ssh = { sshUser: "y", sshKeyFile: "/tmp/gcp-key", sshPort: 45400 };

function runnerFor(stdout, { error = null } = {}) {
  const calls = [];
  return {
    calls,
    runner: {
      async run(command, options) {
        calls.push({ command, options });
        if (error) throw error;
        return { stdout, stderr: "", exitCode: 0 };
      }
    }
  };
}

test("deployment probe detects active Sing-Box without cloud writes", async () => {
  const fake = runnerFor(`__GVC_SERVICES__
sing-box active
x-ui inactive
__GVC_PORTS__
udp UNCONN 0 0 0.0.0.0:23293 0.0.0.0:* users:(("sing-box",pid=12,fd=3))
__GVC_FILES__
sing-box-config
__GVC_BBR__
bbr
`);
  const service = createDeploymentProbeService({ runner: fake.runner, wait: async () => {}, sshRetryDelayMs: 1, sshMaxAttempts: 1, now: () => "2026-07-08T10:00:00.000Z" });

  const result = await service.probe(identity, ssh);

  assert.equal(result.services.find((item) => item.name === "sing-box").status, "active");
  assert.deepEqual(result.ports.map((item) => `${item.protocol}/${item.port}`), ["udp/23293"]);
  assert.deepEqual(result.files, ["sing-box-config"]);
  assert.equal(result.bbr.enabled, true);
  assert.equal(fake.calls[0].command.some((part) => /instances (create|delete|start|stop)|firewall-rules/.test(part)), false);
});

test("deployment probe delegates read-only SSH to the metadata-safe probe runner", async () => {
  const calls = [];
  const sshProbeRunner = {
    async run(inputIdentity, inputSsh, command) {
      calls.push({ inputIdentity, inputSsh, command });
      return {
        result: { stdout: "__GVC_SERVICES__\nsing-box active\n__GVC_BBR__\ncongestion_control=bbr\n", stderr: "", exitCode: 0 },
        sshConnection: { desiredPort: 45400, actualPort: 45400, fallback: false, verified: true, label: "SSH 实际连接 45400" }
      };
    }
  };
  const service = createDeploymentProbeService({
    runner: { async run() { assert.fail("legacy gcloud compute ssh path must not run"); } },
    sshProbeRunner,
    now: () => "2026-07-16T11:00:00.000Z"
  });

  const result = await service.probe(identity, ssh);

  assert.equal(result.ssh.actualPort, 45400);
  assert.equal(result.bbr.enabled, true);
  assert.equal(calls.length, 1);
  assert.match(calls[0].command, /__GVC_SERVICES__/);
});

test("deployment probe accepts UI ssh field names for adoption preview", async () => {
  const fake = runnerFor(`__GVC_SERVICES__
x-ui active
__GVC_PORTS__
tcp LISTEN 0 4096 0.0.0.0:8443 0.0.0.0:* users:(("x-ui",pid=20,fd=4))
__GVC_FILES__
x-ui-config-dir
__GVC_BBR__
bbr
`);
  const service = createDeploymentProbeService({ runner: fake.runner, wait: async () => {}, sshRetryDelayMs: 1, sshMaxAttempts: 1 });

  const result = await service.probe(identity, { user: "y", keyFile: "/tmp/gcp-key", port: 45400 });

  assert.equal(result.ssh.actualPort, 45400);
  assert.ok(fake.calls[0].command.some((part) => part === "--ssh-flag=-p 45400"));
  assert.ok(fake.calls[0].command.some((part) => part === "--ssh-key-file=/tmp/gcp-key"));
  assert.ok(fake.calls[0].command.some((part) => part === "y@vm-a"));
});

test("deployment probe detects active 3X-UI", async () => {
  const fake = runnerFor(`__GVC_SERVICES__
sing-box inactive
x-ui active
__GVC_PORTS__
tcp LISTEN 0 4096 0.0.0.0:443 0.0.0.0:* users:(("x-ui",pid=20,fd=4))
__GVC_FILES__
x-ui-config-dir
x-ui-binary
__GVC_BBR__
cubic
`);
  const service = createDeploymentProbeService({ runner: fake.runner, wait: async () => {}, sshRetryDelayMs: 1, sshMaxAttempts: 1 });

  const result = await service.probe(identity, ssh);

  assert.equal(result.services.find((item) => item.name === "x-ui").status, "active");
  assert.deepEqual(result.ports.map((item) => `${item.protocol}/${item.port}`), ["tcp/443"]);
  assert.equal(result.bbr.enabled, false);
});

test("deployment probe classifies listener scope and prefers network bindings over loopback duplicates", async () => {
  const fake = runnerFor(`__GVC_SERVICES__
x-ui active
__GVC_PORTS__
tcp LISTEN 0 4096 127.0.0.1:8443 0.0.0.0:* users:(("x-ui",pid=20,fd=4))
tcp LISTEN 0 4096 0.0.0.0:8443 0.0.0.0:* users:(("x-ui",pid=20,fd=5))
tcp LISTEN 0 4096 [::1]:62789 [::]:* users:(("x-ui",pid=20,fd=6))
tcp LISTEN 0 4096 10.138.0.2:443 0.0.0.0:* users:(("xray",pid=21,fd=4))
__GVC_BBR__
congestion_control=bbr
default_qdisc=fq
`);
  const service = createDeploymentProbeService({ runner: fake.runner, wait: async () => {}, sshRetryDelayMs: 1, sshMaxAttempts: 1 });

  const result = await service.probe(identity, ssh);

  assert.deepEqual(
    result.ports.map(({ protocol, port, bindAddress, exposureScope }) => ({ protocol, port, bindAddress, exposureScope })),
    [
      { protocol: "tcp", port: "443", bindAddress: "10.138.0.2", exposureScope: "network" },
      { protocol: "tcp", port: "8443", bindAddress: "0.0.0.0", exposureScope: "wildcard" },
      { protocol: "tcp", port: "62789", bindAddress: "::1", exposureScope: "loopback" }
    ]
  );
});

test("deployment probe preserves both services as conflict evidence", async () => {
  const fake = runnerFor(`__GVC_SERVICES__
sing-box active
x-ui active
__GVC_PORTS__
udp UNCONN 0 0 0.0.0.0:23293 0.0.0.0:*
tcp LISTEN 0 4096 0.0.0.0:443 0.0.0.0:*
__GVC_FILES__
sing-box-config
x-ui-config-dir
__GVC_BBR__
bbr
`);
  const service = createDeploymentProbeService({ runner: fake.runner, wait: async () => {}, sshRetryDelayMs: 1, sshMaxAttempts: 1 });

  const result = await service.probe(identity, ssh);

  assert.equal(result.services.filter((item) => item.status === "active").length, 2);
  assert.match(result.warnings.join("\n"), /多个服务/);
});

test("deployment probe returns unverified state when SSH fails", async () => {
  const fake = runnerFor("", { error: new Error("Permission denied (publickey)") });
  const service = createDeploymentProbeService({ runner: fake.runner, wait: async () => {}, sshRetryDelayMs: 1, sshMaxAttempts: 1 });

  const result = await service.probe(identity, ssh);

  assert.equal(result.ssh.verified, false);
  assert.deepEqual(result.services, []);
  assert.match(result.warnings.join("\n"), /Permission denied/);
});

test("deployment probe summarizes deep 3X-UI evidence and preserves SSH fallback plus BBR details", async () => {
  const calls = [];
  const runner = {
    async run(command) {
      calls.push(command);
      if (calls.length === 1) throw new Error("connect to host vm-a port 45400: Connection refused");
      return {
        stdout: `__GVC_SERVICES__
x-ui active
sing-box inactive
xray active
__GVC_UNITS__
x-ui.service loaded active running
xray.service loaded active running
__GVC_PROCESSES__
x-ui /usr/local/x-ui/x-ui
xray /usr/local/bin/xray run -config /usr/local/x-ui/bin/config.json
__GVC_PORTS__
tcp LISTEN 0 4096 0.0.0.0:45400 0.0.0.0:* users:(("x-ui",pid=20,fd=4))
tcp LISTEN 0 4096 0.0.0.0:443 0.0.0.0:* users:(("xray",pid=21,fd=4))
__GVC_FILES__
x-ui-config-dir
x-ui-binary
x-ui-env
x-ui-systemd
__GVC_CONTAINERS__
{"Names":"3x-ui","Image":"ghcr.io/mhsanaei/3x-ui:latest","Ports":"0.0.0.0:45400->2053/tcp"}
__GVC_VERSIONS__
xray 25.1.1
__GVC_CONFIG_SUMMARY__
xray-inbound: vless,trojan
__GVC_BBR__
congestion_control=bbr
default_qdisc=fq
`,
        stderr: "",
        exitCode: 0
      };
    }
  };
  const service = createDeploymentProbeService({ runner, wait: async () => {}, sshRetryDelayMs: 1, sshMaxAttempts: 2 });

  const result = await service.probe(identity, ssh);

  assert.equal(result.ssh.desiredPort, 45400);
  assert.equal(result.ssh.actualPort, 22);
  assert.equal(result.ssh.fallback, true);
  assert.equal(result.bbr.enabled, true);
  assert.equal(result.bbr.congestionControl, "bbr");
  assert.equal(result.bbr.qdisc, "fq");
  assert.ok(result.units.some((item) => item.name === "x-ui.service"));
  assert.ok(result.processes.some((item) => item.command === "x-ui"));
  assert.ok(result.containers.some((item) => /3x-ui/.test(item.name)));
  assert.ok(result.configSummary.some((item) => item.kind === "xray-inbound"));
  assert.ok(calls[0].some((part) => part === "--ssh-flag=-p 45400"));
  assert.equal(calls[1].some((part) => part === "--ssh-flag=-p 45400"), false);
});

test("deployment probe summarizes deep Sing-Box evidence without full config leakage", async () => {
  const fake = runnerFor(`__GVC_SERVICES__
sing-box active
x-ui inactive
__GVC_UNITS__
sing-box.service loaded active running
__GVC_PROCESSES__
sing-box /usr/bin/sing-box run -c /etc/sing-box/config.json
__GVC_PORTS__
udp UNCONN 0 0 0.0.0.0:23293 0.0.0.0:* users:(("sing-box",pid=12,fd=3))
__GVC_FILES__
sing-box-config
sing-box-binary
sing-box-systemd
__GVC_CONTAINERS__
{"Names":"sing-box","Image":"ghcr.io/sagernet/sing-box:latest"}
__GVC_VERSIONS__
sing-box version 1.12.0
__GVC_CONFIG_SUMMARY__
sing-box-inbounds: hysteria2,tuic,shadowsocks
secret_line=vless://secret@example password=hidden token=abc
__GVC_BBR__
congestion_control=cubic
default_qdisc=fq_codel
`);
  const service = createDeploymentProbeService({ runner: fake.runner, wait: async () => {}, sshRetryDelayMs: 1, sshMaxAttempts: 1 });

  const result = await service.probe(identity, ssh);
  const serialized = JSON.stringify(result);

  assert.equal(result.bbr.enabled, false);
  assert.equal(result.bbr.congestionControl, "cubic");
  assert.equal(result.bbr.qdisc, "fq_codel");
  assert.ok(result.units.some((item) => item.name === "sing-box.service"));
  assert.ok(result.processes.some((item) => item.command === "sing-box"));
  assert.ok(result.containers.some((item) => /sing-box/.test(item.image)));
  assert.ok(result.configSummary.some((item) => item.protocols.includes("hysteria2")));
  assert.doesNotMatch(serialized, /vless:\/\/|password=hidden|token=abc/);
});

test("deployment probe contains long raw output by summarizing parsed evidence", async () => {
  const fake = runnerFor(`__GVC_SERVICES__
sing-box active ${"x".repeat(2000)}
__GVC_PORTS__
udp UNCONN 0 0 0.0.0.0:23293 0.0.0.0:*
__GVC_FILES__
${"sing-box-config ".repeat(200)}
__GVC_BBR__
bbr
`);
  const service = createDeploymentProbeService({ runner: fake.runner, wait: async () => {}, sshRetryDelayMs: 1, sshMaxAttempts: 1 });

  const result = await service.probe(identity, ssh);

  assert.ok(JSON.stringify(result).length < 2000);
  assert.equal(result.ports[0].port, "23293");
});

test("deployment probe exposes only safe WARP candidate evidence", async () => {
  const fake = runnerFor(`
__GVC_SERVICES__
sing-box active
warp-svc active
__GVC_PORTS__
tcp LISTEN 0 4096 127.0.0.1:40000 0.0.0.0:* users:(("warp-svc",pid=100,fd=9))
__GVC_CONFIG_SUMMARY__
warp-proxy: 127.0.0.1:40000,routes=10
__GVC_BBR__
congestion_control=bbr
default_qdisc=fq
`);
  const service = createDeploymentProbeService({ runner: fake.runner, sshMaxAttempts: 1 });

  const result = await service.probe(identity, ssh);

  assert.deepEqual(result.services.find((item) => item.name === "warp-svc"), { name: "warp-svc", status: "active" });
  assert.equal(result.ports.find((item) => item.port === "40000").exposureScope, "loopback");
  assert.match(result.configSummary.find((item) => item.kind === "warp-proxy").value, /routes=10/);
  assert.doesNotMatch(JSON.stringify(result), /license|device_id|private_key|warp:\/\//i);
});
