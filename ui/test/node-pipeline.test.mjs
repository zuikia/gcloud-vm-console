import assert from "node:assert/strict";
import test from "node:test";

import { createNodePipeline } from "../server/node-pipeline.js";

const identity = {
  configuration: "acct-a",
  account: "user@example.com",
  projectId: "project-a",
  zone: "us-west1-b",
  name: "vm-a"
};

const ssh = { sshUser: "y", sshKeyFile: "/tmp/gcp-key", sshPort: 45400 };

function createFakeRunner(responses = []) {
  const calls = [];
  return {
    calls,
    runner: {
      async run(command, options) {
        calls.push({ command, options });
        const response = responses.shift() || {};
        if (response.error) throw response.error;
        return { exitCode: 0, stdout: response.stdout || "", stderr: response.stderr || "" };
      }
    }
  };
}

function createFakeFirewall() {
  const calls = [];
  return {
    calls,
    service: {
      async ensureOwnedRule(input) {
        calls.push(input);
        return {
          status: "synced",
          action: "created",
          name: input.name,
          protocol: input.protocol,
          ports: input.ports,
          targetTags: input.targetTags || [input.identity.name],
          sourceRanges: input.sourceRanges || ["0.0.0.0/0"]
        };
      }
    }
  };
}

test("node pipeline exits after VM creation for vm-only mode", async () => {
  const fake = createFakeRunner();
  const firewall = createFakeFirewall();
  const pipeline = createNodePipeline({ runner: fake.runner, firewallService: firewall.service });

  const result = await pipeline.deploy({ identity, deploy: { method: "vm_only" }, ssh });

  assert.deepEqual(result, {
    method: "vm_only",
    status: "succeeded",
    stages: ["vm_ready"],
    firewall: { status: "not_required", rules: [] },
    ssh: { desiredPort: 45400, actualPort: null, fallback: false, verified: false, label: "SSH 未连接" },
    nodeResult: {
      type: "vm_only",
      links: [],
      firewall: { status: "not_required", rules: [] },
      ssh: { desiredPort: 45400, actualPort: null, fallback: false, verified: false, label: "SSH 未连接" }
    }
  });
  assert.equal(fake.calls.length, 0);
  assert.equal(firewall.calls.length, 0);
});

test("node pipeline installs Sing-Box-Plus, checks BBR, syncs UDP ports, and returns the four target links", async () => {
  const installLog = [
    "hy2-obfs-warp 25737 UDP hy2://warp-link",
    "tuic-v5-warp 23293 UDP tuic://warp-link",
    "hy2-obfs 36111 UDP hy2://direct-link",
    "tuic-v5 36222 UDP tuic://direct-link"
  ].join("\n");
  const fake = createFakeRunner([{ stdout: installLog }, { stdout: "net.ipv4.tcp_congestion_control = bbr\n" }]);
  const firewall = createFakeFirewall();
  const pipeline = createNodePipeline({ runner: fake.runner, firewallService: firewall.service });

  const result = await pipeline.deploy({ identity, deploy: { method: "singbox_plus" }, ssh });

  assert.equal(result.method, "singbox_plus");
  assert.deepEqual(result.stages, ["install", "bbr_check", "firewall_sync", "collect"]);
  assert.deepEqual(result.nodeResult.links.map((link) => link.name), [
    "hy2-obfs-warp",
    "tuic-v5-warp",
    "hy2-obfs",
    "tuic-v5"
  ]);
  assert.deepEqual(result.firewall, {
    status: "synced",
    rules: [{
      status: "synced",
      action: "created",
      name: "vm-a-singbox-udp",
      protocol: "udp",
      ports: ["23293", "25737", "36111", "36222"],
      targetTags: ["vm-a"],
      sourceRanges: ["0.0.0.0/0"]
    }]
  });
  assert.deepEqual(result.nodeResult.firewall.rules[0].ports, ["23293", "25737", "36111", "36222"]);
  assert.deepEqual(firewall.calls[0].ports, ["23293", "25737", "36111", "36222"]);
  assert.equal(firewall.calls[0].protocol, "udp");
  assert.ok(fake.calls[0].command.some((part) => part.includes("Sing-Box-Plus")));
  assert.match(fake.calls[0].command.join(" "), /sed -i .*stty erase/);
  assert.match(fake.calls[0].command.join(" "), /patched for noninteractive/);
  assert.equal(result.nodeResult.bbr, true);
});

test("node pipeline retries IAP SSH on port 22 when a custom SSH port is not ready", async () => {
  const installLog = "tuic-v5-warp 23293 UDP tuic://warp-link";
  const fake = createFakeRunner([
    { error: new Error("ssh: connect to host port 45400: Connection refused") },
    { stdout: installLog },
    { stdout: "net.ipv4.tcp_congestion_control = bbr\n" }
  ]);
  const firewall = createFakeFirewall();
  const pipeline = createNodePipeline({ runner: fake.runner, firewallService: firewall.service });

  const result = await pipeline.deploy({ identity, deploy: { method: "singbox_plus" }, ssh });

  assert.equal(result.status, "succeeded");
  assert.deepEqual(result.ssh, {
    desiredPort: 45400,
    actualPort: 22,
    fallback: true,
    verified: true,
    label: "SSH 实际连接 22（已从 45400 回退）"
  });
  assert.deepEqual(result.nodeResult.ssh, result.ssh);
  assert.equal(fake.calls.length, 3);
  assert.ok(fake.calls[0].command.includes("--ssh-flag=-p 45400"));
  assert.equal(fake.calls[1].command.some((part) => part.includes("--ssh-flag=-p 45400")), false);
  assert.deepEqual(result.firewall.rules[0].ports, ["23293"]);
});

test("node pipeline records a custom SSH port as actual only after a command succeeds through that port", async () => {
  const installLog = "tuic-v5-warp 23293 UDP tuic://warp-link";
  const fake = createFakeRunner([
    { stdout: installLog },
    { stdout: "net.ipv4.tcp_congestion_control = bbr\n" }
  ]);
  const firewall = createFakeFirewall();
  const pipeline = createNodePipeline({ runner: fake.runner, firewallService: firewall.service });

  const result = await pipeline.deploy({ identity, deploy: { method: "singbox_plus" }, ssh });

  assert.equal(result.ssh.desiredPort, 45400);
  assert.equal(result.ssh.actualPort, 45400);
  assert.equal(result.ssh.fallback, false);
  assert.equal(result.ssh.verified, true);
  assert.ok(fake.calls[0].command.includes("--ssh-flag=-p 45400"));
  assert.deepEqual(result.nodeResult.ssh, result.ssh);
});

test("node pipeline configures an opted-in custom SSH port through IAP before installing Sing-Box-Plus", async () => {
  const installLog = "tuic-v5-warp 23293 UDP tuic://warp-link";
  const fake = createFakeRunner([
    { error: new Error("ssh: connect to host port 45400: Connection refused") },
    { stdout: "bootstrap ready" },
    { stdout: "sshd restarted" },
    { stdout: "custom port ready" },
    { stdout: installLog },
    { stdout: "net.ipv4.tcp_congestion_control = bbr\n" }
  ]);
  const firewall = createFakeFirewall();
  const pipeline = createNodePipeline({ runner: fake.runner, firewallService: firewall.service });

  const result = await pipeline.deploy({
    identity,
    deploy: { method: "singbox_plus", configureSshPort: true },
    ssh
  });

  assert.equal(result.status, "succeeded");
  assert.deepEqual(result.stages, ["ssh_port", "install", "bbr_check", "firewall_sync", "collect"]);
  assert.equal(result.ssh.actualPort, 45400);
  assert.equal(result.ssh.fallback, false);
  assert.equal(result.nodeResult.sshPort.status, "configured");
  assert.equal(result.nodeResult.sshPort.port, 45400);
  assert.match(fake.calls[2].command.join(" "), /99-gcp-vm-console-port\.conf/);
  assert.match(fake.calls[2].command.join(" "), /Port 22/);
  assert.match(fake.calls[2].command.join(" "), /Port 45400/);
  assert.ok(fake.calls[3].command.includes("--ssh-flag=-p 45400"));
  assert.ok(fake.calls[4].command.includes("--ssh-flag=-p 45400"));
  assert.deepEqual(firewall.calls[0], {
    identity: { ...identity, region: "us-west1" },
    name: "gvc-vm-a-ssh-iap-tcp",
    network: "default",
    protocol: "tcp",
    ports: ["22", "45400"],
    targetTags: ["vm-a"],
    sourceRanges: ["35.235.240.0/20"]
  });
  assert.equal(firewall.calls[1].protocol, "udp");
});

test("node pipeline waits through transient SSH readiness failures on new VMs", async () => {
  const waits = [];
  const installLog = "tuic-v5-warp 23293 UDP tuic://warp-link";
  const fake = createFakeRunner([
    { error: new Error("ssh: connect to host port 45400: Connection refused") },
    { error: new Error("Permission denied (publickey)") },
    { stdout: installLog },
    { stdout: "net.ipv4.tcp_congestion_control = bbr\n" }
  ]);
  const firewall = createFakeFirewall();
  const pipeline = createNodePipeline({
    runner: fake.runner,
    firewallService: firewall.service,
    wait: async (ms) => waits.push(ms),
    sshRetryDelayMs: 5,
    sshMaxAttempts: 3
  });

  const result = await pipeline.deploy({ identity, deploy: { method: "singbox_plus" }, ssh });

  assert.equal(result.status, "succeeded");
  assert.deepEqual(waits, [5]);
  assert.equal(fake.calls.length, 4);
  assert.ok(fake.calls[0].command.includes("--ssh-flag=-p 45400"));
  assert.equal(fake.calls[1].command.some((part) => part.includes("--ssh-flag=-p 45400")), false);
  assert.equal(fake.calls[2].command.some((part) => part.includes("--ssh-flag=-p 45400")), false);
});

test("node pipeline retries IAP backend port readiness failures before 3X-UI install", async () => {
  const waits = [];
  const xuiLog = [
    "XUI_USERNAME=admin",
    "XUI_PASSWORD=secret",
    "XUI_PANEL_PORT=443",
    "XUI_ACCESS_URL=http://203.0.113.10:443/base"
  ].join("\n");
  const fake = createFakeRunner([
    { error: new Error("Error while connecting [4003: 'failed to connect to backend']. (Failed to connect to port 22)") },
    { stdout: xuiLog }
  ]);
  const firewall = createFakeFirewall();
  const pipeline = createNodePipeline({
    runner: fake.runner,
    firewallService: firewall.service,
    wait: async (ms) => waits.push(ms),
    sshRetryDelayMs: 5,
    sshMaxAttempts: 2
  });

  const result = await pipeline.deploy({
    identity,
    deploy: { method: "three_x_ui", panelPort: 443 },
    ssh: { ...ssh, sshPort: "" }
  });

  assert.equal(result.status, "succeeded");
  assert.deepEqual(waits, [5]);
  assert.equal(fake.calls.length, 2);
  assert.equal(result.nodeResult.panel.url, "http://203.0.113.10:443/base");
  assert.deepEqual(result.firewall.rules[0].ports, ["443"]);
});

test("node pipeline parses current Sing-Box-Plus grouped URL output and enables BBR non-interactively", async () => {
  const installLog = [
    "分享链接（20 个）",
    "【直连节点（10）】",
    "  hy2://password@[2600:1900::1]:36111?insecure=1&obfs=salamander&obfs-password=abc#hysteria2-obfs",
    "  tuic://uuid:pwd@203.0.113.10:36222?congestion_control=bbr&alpn=h3#tuic-v5",
    "【WARP 节点（10）】",
    "  hy2://password@203.0.113.10:25737?insecure=1&obfs=salamander&obfs-password=abc#hysteria2-obfs-warp",
    "  tuic://uuid:pwd@[2600:1900::1]:23293?congestion_control=bbr&alpn=h3#tuic-v5-warp",
    "  hy2://password@203.0.113.10:40000?sni=example.com&pcs=abc#hysteria2-warp-pinnedPeerCertSha256"
  ].join("\n");
  const fake = createFakeRunner([
    { stdout: installLog },
    { stdout: "[信息] BBR 已启用\n" },
    { stdout: "net.ipv4.tcp_congestion_control = bbr\n" }
  ]);
  const firewall = createFakeFirewall();
  const pipeline = createNodePipeline({ runner: fake.runner, firewallService: firewall.service });

  const result = await pipeline.deploy({ identity, deploy: { method: "singbox_plus" }, ssh });

  assert.deepEqual(result.nodeResult.links.map((link) => `${link.name}:${link.port}:${link.protocol}`), [
    "hy2-obfs:36111:udp",
    "tuic-v5:36222:udp",
    "hy2-obfs-warp:25737:udp",
    "tuic-v5-warp:23293:udp"
  ]);
  assert.deepEqual(result.firewall.rules[0].ports, ["23293", "25737", "36111", "36222"]);
  assert.equal(result.nodeResult.bbr, true);
  assert.match(fake.calls[0].command.join(" "), /printf '1\\n'/);
  assert.doesNotMatch(fake.calls[1].command.join(" "), /printf '5\\n' \| bash sing-box-plus\.sh/);
  assert.match(fake.calls[1].command.join(" "), /net\.ipv4\.tcp_congestion_control=bbr/);
  assert.match(fake.calls[1].command.join(" "), /sysctl --system/);
});

test("node pipeline installs pinned 3X-UI and syncs the panel port", async () => {
  const xuiLog = [
    "PANEL_URL=http://203.0.113.10:443",
    "USERNAME=admin",
    "PASSWORD=secret",
    "VLESS_REALITY=vless://reality-link"
  ].join("\n");
  const fake = createFakeRunner([{ stdout: xuiLog }]);
  const firewall = createFakeFirewall();
  const pipeline = createNodePipeline({ runner: fake.runner, firewallService: firewall.service });

  const result = await pipeline.deploy({ identity, deploy: { method: "three_x_ui", xuiVersion: "v2.9.4", panelPort: 443 }, ssh });

  assert.equal(result.method, "three_x_ui");
  assert.equal(result.nodeResult.panel.url, "http://203.0.113.10:443");
  assert.equal(result.nodeResult.panel.username, "admin");
  assert.equal(result.nodeResult.panel.credentialsAvailable, true);
  assert.equal(Object.hasOwn(result.nodeResult.panel, "password"), false);
  assert.deepEqual(result.nodeResult.links, [{ name: "vless-reality", url: "vless://reality-link" }]);
  assert.deepEqual(result.firewall.rules[0], {
    status: "synced",
    action: "created",
    name: "vm-a-3x-ui-tcp",
    protocol: "tcp",
    ports: ["443"],
    targetTags: ["vm-a"],
    sourceRanges: ["0.0.0.0/0"]
  });
  assert.equal(result.nodeResult.firewall.status, "synced");
  assert.equal(firewall.calls[0].protocol, "tcp");
  assert.deepEqual(firewall.calls[0].ports, ["443"]);
  assert.ok(fake.calls[0].command.some((part) => part.includes("v2.9.4")));
});

test("node pipeline reads 3X-UI install-result env output after pinned non-interactive install", async () => {
  const xuiLog = [
    "x-ui v2.9.4 installation finished, it is running now...",
    "XUI_USERNAME=adminuser",
    "XUI_PASSWORD='quoted secret'",
    "XUI_PANEL_PORT=443",
    "XUI_WEB_BASE_PATH=abcdef1234567890",
    "XUI_ACCESS_URL=http://203.0.113.10:443/abcdef1234567890",
    "XUI_API_TOKEN=token"
  ].join("\n");
  const fake = createFakeRunner([{ stdout: xuiLog }]);
  const firewall = createFakeFirewall();
  const pipeline = createNodePipeline({ runner: fake.runner, firewallService: firewall.service });

  const result = await pipeline.deploy({ identity, deploy: { method: "three_x_ui", panelPort: 443 }, ssh });

  assert.equal(result.nodeResult.panel.url, "http://203.0.113.10:443/abcdef1234567890");
  assert.equal(result.nodeResult.panel.username, "adminuser");
  assert.equal(result.nodeResult.panel.credentialsAvailable, true);
  assert.equal(Object.hasOwn(result.nodeResult.panel, "password"), false);
  assert.equal(result.nodeResult.panel.port, "443");
  assert.equal(result.nodeResult.panel.webBasePath, "abcdef1234567890");
  assert.match(fake.calls[0].command.join(" "), /XUI_NONINTERACTIVE=1/);
  assert.match(fake.calls[0].command.join(" "), /XUI_PANEL_PORT=443/);
  assert.match(fake.calls[0].command.join(" "), /v2\.9\.4/);
  assert.match(fake.calls[0].command.join(" "), /cat \/etc\/x-ui\/install-result\.env/);
});

test("node pipeline validates and canonicalizes 3X-UI port and version before building the root command", async () => {
  for (const [panelPort, xuiVersion, expectedPort] of [
    [undefined, undefined, "443"],
    [1, "2.9.4", "1"],
    ["65535", "v2.10.0-rc.1", "65535"],
    ["00443", "v2.9.4", "443"]
  ]) {
    const fake = createFakeRunner();
    const firewall = createFakeFirewall();
    const pipeline = createNodePipeline({ runner: fake.runner, firewallService: firewall.service });

    await pipeline.deploy({ identity, deploy: { method: "three_x_ui", panelPort, xuiVersion }, ssh });

    const command = fake.calls[0].command.find((part) => part.startsWith("--command="));
    assert.ok(command.includes(`XUI_PANEL_PORT=${expectedPort} bash `));
    assert.ok(command.includes(`install.sh) ${xuiVersion ?? "v2.9.4"};`));
    assert.deepEqual(firewall.calls[0].ports, [expectedPort]);
  }
});

test("node pipeline rejects invalid or injected 3X-UI panel ports before any remote operation", async () => {
  const invalidPorts = [
    0, -1, 65536, 443.5, NaN, Infinity, null, false, [], {}, "", " ", " 443", "443 ",
    "443.0", "4.43e2", "0x1bb", "443;id", "443$(id)", "443`id`", "443\nwhoami", "443\";id"
  ];
  for (const panelPort of invalidPorts) {
    const fake = createFakeRunner();
    const firewall = createFakeFirewall();
    const pipeline = createNodePipeline({ runner: fake.runner, firewallService: firewall.service });

    await assert.rejects(pipeline.deploy({
      identity,
      deploy: { method: "three_x_ui", panelPort, configureSshPort: true },
      ssh
    }), /panelPort must be an integer between 1 and 65535/);
    assert.equal(fake.calls.length, 0, `SSH must not run for port ${String(panelPort)}`);
    assert.equal(firewall.calls.length, 0, `Firewall must not change for port ${String(panelPort)}`);
  }
});

test("node pipeline rejects invalid or injected 3X-UI versions before any remote operation", async () => {
  const invalidVersions = [
    null, false, 294, [], {}, "", "latest", "master", "--help", "v2.9", "v2.9.4 ", " v2.9.4",
    "v2.9.4;id", "v2.9.4$(id)", "v2.9.4`id`", "v2.9.4\nwhoami", "v2.9.4\";id",
    "v2.9.4 && id", "v2.9.4|id", "v2.9.4/../../install.sh", `v2.9.4-${"a".repeat(64)}`
  ];
  for (const xuiVersion of invalidVersions) {
    const fake = createFakeRunner();
    const firewall = createFakeFirewall();
    const pipeline = createNodePipeline({ runner: fake.runner, firewallService: firewall.service });

    await assert.rejects(pipeline.deploy({
      identity,
      deploy: { method: "three_x_ui", xuiVersion, configureSshPort: true },
      ssh
    }), /xuiVersion must be an explicit version/);
    assert.equal(fake.calls.length, 0, `SSH must not run for version ${String(xuiVersion)}`);
    assert.equal(firewall.calls.length, 0, `Firewall must not change for version ${String(xuiVersion)}`);
  }
});
