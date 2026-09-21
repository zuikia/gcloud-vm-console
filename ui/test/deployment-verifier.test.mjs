import assert from "node:assert/strict";
import test from "node:test";

import { createDeploymentVerifier } from "../server/deployment-verifier.js";

const identity = {
  configuration: "acct-a",
  account: "user@example.com",
  projectId: "project-a",
  zone: "us-west1-b",
  name: "vm-a"
};

const ssh = { sshUser: "y", sshKeyFile: "/tmp/gcp-key", sshPort: 45400 };

function fakeRunner(stdout, error = null) {
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

function fakeFirewall(result) {
  const calls = [];
  return {
    calls,
    service: {
      async inspectOwnedRule(input) {
        calls.push(input);
        return result;
      }
    }
  };
}

const remoteOk = [
  "__GVC_SERVICES__",
  "sing-box active",
  "x-ui inactive",
  "__GVC_BBR__",
  "bbr",
  "fq",
  "__GVC_PORTS__",
  "udp UNCONN 0 0 0.0.0.0:23293 0.0.0.0:* users:((\"sing-box\",pid=1,fd=1))",
  "udp UNCONN 0 0 0.0.0.0:25737 0.0.0.0:* users:((\"sing-box\",pid=1,fd=2))"
].join("\n");

test("deployment verifier passes Sing-Box when SSH, service, ports, BBR, and firewall match", async () => {
  const fake = fakeRunner(remoteOk);
  const firewall = fakeFirewall({
    status: "matched",
    name: "vm-a-singbox-udp",
    protocol: "udp",
    ports: ["23293", "25737"],
    targetTags: ["vm-a"],
    sourceRanges: ["0.0.0.0/0"]
  });
  const verifier = createDeploymentVerifier({ runner: fake.runner, firewallService: firewall.service, now: () => "2026-07-05T00:00:00.000Z" });

  const result = await verifier.verify({
    identity,
    desired: { deploy: { method: "singbox_plus" }, network: { name: "default" }, tags: ["vm-a"], sourceRanges: ["0.0.0.0/0"] },
    nodeResult: {
      type: "singbox_plus",
      bbr: true,
      links: [
        { name: "tuic-v5-warp", protocol: "udp", port: "23293", url: "tuic://warp" },
        { name: "hy2-obfs-warp", protocol: "udp", port: "25737", url: "hy2://warp" }
      ]
    },
    ssh
  });

  assert.equal(result.status, "passed");
  assert.deepEqual(result.bbr, { enabled: true, congestionControl: "bbr", qdisc: "fq" });
  assert.equal(result.ssh.actualPort, 45400);
  assert.equal(result.checks.every((check) => check.status === "passed"), true);
  assert.deepEqual(firewall.calls[0].ports, ["23293", "25737"]);
});

test("deployment verifier returns partial when firewall does not match but links remain present", async () => {
  const fake = fakeRunner(remoteOk);
  const firewall = fakeFirewall({ status: "missing", name: "vm-a-singbox-udp", protocol: "udp", ports: ["23293"] });
  const verifier = createDeploymentVerifier({
    runner: fake.runner,
    firewallService: firewall.service,
    now: () => "2026-07-05T00:00:00.000Z",
    wait: async () => {},
    sshRetryDelayMs: 1,
    sshMaxAttempts: 1
  });

  const result = await verifier.verify({
    identity,
    desired: { deploy: { method: "singbox_plus" }, network: { name: "default" }, tags: ["vm-a"], sourceRanges: ["0.0.0.0/0"] },
    nodeResult: { type: "singbox_plus", links: [{ name: "tuic-v5-warp", protocol: "udp", port: "23293", url: "tuic://warp" }] },
    ssh
  });

  assert.equal(result.status, "partial");
  assert.equal(result.firewall.status, "missing");
  assert.match(result.warnings.join("\n"), /防火墙/);
});

test("deployment verifier handles vm-only without requiring node links", async () => {
  const fake = fakeRunner(["__GVC_SERVICES__", "__GVC_BBR__", "cubic", "__GVC_PORTS__"].join("\n"));
  const firewall = fakeFirewall({ status: "not_required", rules: [] });
  const verifier = createDeploymentVerifier({ runner: fake.runner, firewallService: firewall.service });

  const result = await verifier.verify({
    identity,
    desired: { deploy: { method: "vm_only" } },
    nodeResult: { type: "vm_only", links: [] },
    ssh
  });

  assert.equal(result.status, "passed");
  assert.equal(result.firewall.status, "not_required");
  assert.equal(firewall.calls.length, 0);
});

test("deployment verifier validates 3X-UI panel service, TCP port, and firewall", async () => {
  const remote = [
    "__GVC_SERVICES__",
    "sing-box inactive",
    "x-ui active",
    "__GVC_BBR__",
    "cubic",
    "__GVC_PORTS__",
    "tcp LISTEN 0 4096 0.0.0.0:443 0.0.0.0:* users:((\"x-ui\",pid=2,fd=7))"
  ].join("\n");
  const fake = fakeRunner(remote);
  const firewall = fakeFirewall({
    status: "matched",
    name: "vm-a-3x-ui-tcp",
    protocol: "tcp",
    ports: ["443"],
    targetTags: ["vm-a"],
    sourceRanges: ["0.0.0.0/0"]
  });
  const verifier = createDeploymentVerifier({ runner: fake.runner, firewallService: firewall.service });

  const result = await verifier.verify({
    identity,
    desired: { deploy: { method: "three_x_ui" }, network: { name: "default" }, tags: ["vm-a"] },
    nodeResult: { type: "three_x_ui", panel: { url: "http://203.0.113.10:443", port: "443", username: "admin", password: "secret" }, links: [] },
    ssh
  });

  assert.equal(result.status, "passed");
  assert.deepEqual(firewall.calls[0].ports, ["443"]);
  assert.deepEqual(result.ports, [{ protocol: "tcp", port: "443", expected: true, listening: true }]);
});

test("deployment verifier returns failed instead of throwing when SSH verification cannot run", async () => {
  const fake = fakeRunner("", new Error("Permission denied (publickey)"));
  const firewall = fakeFirewall({ status: "matched", name: "vm-a-singbox-udp", protocol: "udp", ports: ["23293"] });
  const verifier = createDeploymentVerifier({
    runner: fake.runner,
    firewallService: firewall.service,
    now: () => "2026-07-05T00:00:00.000Z",
    wait: async () => {},
    sshRetryDelayMs: 1,
    sshMaxAttempts: 1
  });

  const result = await verifier.verify({
    identity,
    desired: { deploy: { method: "singbox_plus" }, network: { name: "default" }, tags: ["vm-a"] },
    nodeResult: { type: "singbox_plus", links: [{ name: "tuic-v5-warp", protocol: "udp", port: "23293", url: "tuic://warp" }] },
    ssh
  });

  assert.equal(result.status, "failed");
  assert.equal(result.ssh.verified, false);
  assert.match(result.checks[0].detail, /Permission denied/);
  assert.equal(firewall.calls.length, 0);
});

test("deployment verifier uses a read-only recognition probe for BBR and instance firewall exposure", async () => {
  const fake = fakeRunner("");
  const firewall = fakeFirewall({ status: "missing" });
  const verifier = createDeploymentVerifier({
    runner: fake.runner,
    firewallService: firewall.service,
    now: () => "2026-07-10T00:00:00.000Z"
  });

  const result = await verifier.verify({
    identity,
    desired: { deploy: { method: "vm_only" }, tags: ["vm-a"] },
    methodOverride: "three_x_ui",
    runtimeProbe: {
      ssh: { desiredPort: 45400, actualPort: 45400, fallback: false, verified: true, label: "SSH 实际连接 45400" },
      services: [{ name: "x-ui", status: "active" }],
      ports: [
        { protocol: "tcp", port: "8443", process: "x-ui", listening: true },
        { protocol: "tcp", port: "11111", process: "xray-linux-amd64", listening: true }
      ],
      bbr: { enabled: true, congestionControl: "bbr", qdisc: "fq" }
    },
    expectedRuntimePorts: [
      { protocol: "tcp", port: "8443" },
      { protocol: "tcp", port: "11111" }
    ],
    firewallProbe: {
      status: "matched",
      matchedPorts: [
        { protocol: "tcp", port: "8443", rule: "allow-xui" },
        { protocol: "tcp", port: "11111", rule: "allow-xray" }
      ],
      missingPorts: [],
      exposedPorts: [],
      rules: [{ name: "allow-xui", targetTags: ["vm-a"], sourceRanges: ["0.0.0.0/0"] }]
    },
    nodeResult: {
      type: "three_x_ui",
      panel: { url: "http://203.0.113.10:8443", port: "8443", username: "admin", password: "secret" }
    },
    ssh
  });

  assert.equal(result.method, "three_x_ui");
  assert.deepEqual(result.bbr, { enabled: true, congestionControl: "bbr", qdisc: "fq" });
  assert.equal(result.checks.find((check) => check.id === "bbr").status, "passed");
  assert.equal(result.firewall.status, "matched");
  assert.equal(result.checks.find((check) => check.id === "firewall").status, "passed");
  assert.deepEqual(result.ports.map((port) => [port.protocol, port.port, port.listening]), [
    ["tcp", "8443", true],
    ["tcp", "11111", true]
  ]);
  assert.equal(fake.calls.length, 0);
  assert.equal(firewall.calls.length, 0);
});

test("deployment verifier preserves overexposed firewall evidence as a partial safety result", async () => {
  const firewall = fakeFirewall({ status: "missing" });
  const verifier = createDeploymentVerifier({
    runner: fakeRunner("").runner,
    firewallService: firewall.service
  });

  const result = await verifier.verify({
    identity,
    desired: { deploy: { method: "vm_only" } },
    methodOverride: "three_x_ui",
    nodeResult: { panel: { url: "https://example", username: "admin", password: "secret" } },
    runtimeProbe: {
      ssh: { desiredPort: 45400, actualPort: 45400, fallback: false, verified: true, label: "SSH 实际连接 45400" },
      services: [{ name: "x-ui", status: "active" }],
      ports: [{ protocol: "tcp", port: "8443", listening: true }],
      bbr: { enabled: true, congestionControl: "bbr", qdisc: "fq" }
    },
    expectedRuntimePorts: [{ protocol: "tcp", port: "8443" }],
    firewallProbe: {
      status: "overexposed",
      matchedPorts: [{ protocol: "tcp", port: "8443", rule: "public-allow-all" }],
      missingPorts: [],
      broadRules: [{ name: "public-allow-all" }],
      warning: "存在公网全端口规则：public-allow-all"
    }
  });

  assert.equal(result.status, "partial");
  assert.equal(result.firewall.status, "overexposed");
  assert.deepEqual(result.firewall.broadRules, [{ name: "public-allow-all" }]);
  assert.equal(result.checks.find((check) => check.id === "firewall").status, "partial");
  assert.match(result.checks.find((check) => check.id === "firewall").detail, /公网全端口/);
});
