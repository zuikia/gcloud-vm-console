import assert from "node:assert/strict";
import test from "node:test";

import { createFirewallService } from "../server/firewall-service.js";

const identity = {
  configuration: "acct-a",
  account: "user@example.com",
  projectId: "project-a",
  zone: "us-west1-b",
  name: "vm-a"
};

function createFakeRunner(responses = []) {
  const calls = [];
  return {
    calls,
    runner: {
      async runJson(command, options) {
        calls.push({ kind: "json", command, options });
        const response = responses.shift();
        if (response?.error) throw response.error;
        return { data: response?.data ?? null };
      },
      async run(command, options) {
        calls.push({ kind: "run", command, options });
        const response = responses.shift();
        if (response?.error) throw response.error;
        return { exitCode: 0, stdout: "", stderr: "" };
      }
    }
  };
}

test("firewall service creates an owned UDP rule when it is missing", async () => {
  const fake = createFakeRunner([{ error: new Error("firewall rule was not found") }, {}]);
  const service = createFirewallService({ runner: fake.runner });

  const result = await service.ensureOwnedRule({
    identity,
    name: "vm-a-singbox-udp",
    network: "default",
    protocol: "udp",
    ports: ["23293", "25737"],
    targetTags: ["vm-a"],
    sourceRanges: ["0.0.0.0/0"]
  });

  assert.equal(result.action, "created");
  assert.equal(result.status, "synced");
  assert.equal(result.name, "vm-a-singbox-udp");
  assert.equal(result.protocol, "udp");
  assert.deepEqual(result.ports, ["23293", "25737"]);
  assert.deepEqual(result.targetTags, ["vm-a"]);
  assert.deepEqual(result.sourceRanges, ["0.0.0.0/0"]);
  assert.deepEqual(fake.calls[0], {
    kind: "json",
    command: ["compute", "firewall-rules", "describe", "vm-a-singbox-udp"],
    options: {
      context: { configuration: "acct-a", account: "user@example.com", projectId: "project-a" },
      allowGlobal: true
    }
  });
  assert.equal(fake.calls[1].command[0], "compute");
  assert.deepEqual(fake.calls[1].command.slice(0, 4), ["compute", "firewall-rules", "create", "vm-a-singbox-udp"]);
  assert.ok(fake.calls[1].command.includes("--allow=udp:23293,udp:25737"));
  assert.ok(fake.calls[1].command.includes("--target-tags=vm-a"));
  assert.ok(fake.calls[1].command.some((part) => part.includes("managed-by=gcp-vm-console")));
});

test("firewall service updates only an existing owned rule", async () => {
  const fake = createFakeRunner([{
    data: {
      name: "vm-a-singbox-udp",
      description: "managed-by=gcp-vm-console;vm=vm-a;project=project-a",
      allowed: [{ IPProtocol: "udp", ports: ["23293"] }],
      sourceRanges: ["0.0.0.0/0"],
      targetTags: ["vm-a"]
    }
  }, {}]);
  const service = createFirewallService({ runner: fake.runner });

  const result = await service.ensureOwnedRule({
    identity,
    name: "vm-a-singbox-udp",
    network: "default",
    protocol: "udp",
    ports: ["23293", "25737"],
    targetTags: ["vm-a"],
    sourceRanges: ["0.0.0.0/0"]
  });

  assert.equal(result.action, "updated");
  assert.equal(result.status, "synced");
  assert.equal(result.protocol, "udp");
  assert.deepEqual(result.ports, ["23293", "25737"]);
  assert.deepEqual(fake.calls[1].command.slice(0, 4), ["compute", "firewall-rules", "update", "vm-a-singbox-udp"]);
  assert.ok(fake.calls[1].command.includes("--allow=udp:23293,udp:25737"));
});

test("firewall service treats same-protocol gcloud allow entries as one desired port set", async () => {
  const fake = createFakeRunner([{
    data: {
      name: "vm-a-singbox-udp",
      description: "managed-by=gcp-vm-console;vm=vm-a;project=project-a",
      allowed: [
        { IPProtocol: "udp", ports: ["25737"] },
        { IPProtocol: "udp", ports: ["23293"] }
      ],
      sourceRanges: ["0.0.0.0/0"],
      targetTags: ["vm-a"]
    }
  }]);
  const service = createFirewallService({ runner: fake.runner });

  const result = await service.ensureOwnedRule({
    identity,
    name: "vm-a-singbox-udp",
    network: "default",
    protocol: "udp",
    ports: ["23293", "25737"],
    targetTags: ["vm-a"],
    sourceRanges: ["0.0.0.0/0"]
  });

  assert.equal(result.action, "unchanged");
  assert.equal(result.status, "synced");
  assert.equal(fake.calls.length, 1);
});

test("firewall service refuses to mutate a shared firewall rule", async () => {
  const fake = createFakeRunner([{
    data: {
      name: "shared-ssh",
      description: "created by hand",
      allowed: [{ IPProtocol: "tcp", ports: ["22"] }],
      sourceRanges: ["0.0.0.0/0"],
      targetTags: ["ssh"]
    }
  }]);
  const service = createFirewallService({ runner: fake.runner });

  await assert.rejects(
    () => service.ensureOwnedRule({
      identity,
      name: "shared-ssh",
      network: "default",
      protocol: "tcp",
      ports: ["22"],
      targetTags: ["ssh"],
      sourceRanges: ["0.0.0.0/0"]
    }),
    /shared firewall rule/
  );
  assert.equal(fake.calls.length, 1);
});

test("firewall service creates a disabled owned deny rule with explicit priority", async () => {
  const fake = createFakeRunner([{ error: new Error("firewall rule was not found") }, {}]);
  const service = createFirewallService({ runner: fake.runner });

  const result = await service.ensureOwnedDenyRule({
    identity,
    name: "gvc-vm-a-isolation-deny",
    network: "default",
    targetTags: ["gvc-isolate-a"],
    sourceRanges: ["0.0.0.0/0"],
    priority: 999,
    disabled: true
  });

  assert.equal(result.action, "created");
  assert.equal(result.disabled, true);
  assert.equal(result.priority, 999);
  assert.deepEqual(fake.calls[1].command.slice(0, 4), ["compute", "firewall-rules", "create", "gvc-vm-a-isolation-deny"]);
  assert.ok(fake.calls[1].command.includes("--action=DENY"));
  assert.ok(fake.calls[1].command.includes("--rules=all"));
  assert.ok(fake.calls[1].command.includes("--priority=999"));
  assert.ok(fake.calls[1].command.includes("--disabled"));
});

test("firewall service enables only an owned deny rule and adds only one validated instance tag", async () => {
  const fake = createFakeRunner([{
    data: {
      name: "gvc-vm-a-isolation-deny",
      description: "managed-by=gcp-vm-console;vm=vm-a;project=project-a",
      denied: [{ IPProtocol: "all" }],
      disabled: true
    }
  }, {}, {}]);
  const service = createFirewallService({ runner: fake.runner });

  const enabled = await service.setOwnedRuleDisabled({
    identity,
    name: "gvc-vm-a-isolation-deny",
    disabled: false
  });
  const tagged = await service.ensureInstanceTag({ identity, tag: "gvc-isolate-a1b2c3" });

  assert.equal(enabled.disabled, false);
  assert.equal(tagged.action, "added");
  assert.deepEqual(fake.calls[1].command.slice(0, 4), ["compute", "firewall-rules", "update", "gvc-vm-a-isolation-deny"]);
  assert.ok(fake.calls[1].command.includes("--no-disabled"));
  assert.deepEqual(fake.calls[2].command.slice(0, 4), ["compute", "instances", "add-tags", "vm-a"]);
  assert.ok(fake.calls[2].command.includes("--tags=gvc-isolate-a1b2c3"));
  assert.equal(fake.calls.some((call) => call.command?.includes("delete")), false);
  assert.equal(fake.calls.some((call) => call.command?.includes("remove-tags")), false);
});

test("firewall service inspects an owned rule without mutating it", async () => {
  const fake = createFakeRunner([{
    data: {
      name: "vm-a-singbox-udp",
      description: "managed-by=gcp-vm-console;vm=vm-a;project=project-a",
      allowed: [{ IPProtocol: "udp", ports: ["23293", "25737"] }],
      sourceRanges: ["0.0.0.0/0"],
      targetTags: ["vm-a"]
    }
  }]);
  const service = createFirewallService({ runner: fake.runner });

  const result = await service.inspectOwnedRule({
    identity,
    name: "vm-a-singbox-udp",
    protocol: "udp",
    ports: ["23293", "25737"],
    targetTags: ["vm-a"],
    sourceRanges: ["0.0.0.0/0"]
  });

  assert.equal(result.status, "matched");
  assert.equal(result.name, "vm-a-singbox-udp");
  assert.deepEqual(result.ports, ["23293", "25737"]);
  assert.equal(fake.calls.length, 1);
  assert.equal(fake.calls[0].kind, "json");
});

test("firewall service inspects external instance exposure through list only", async () => {
  const fake = createFakeRunner([{
    data: [
      {
        name: "allow-xui-panel",
        network: "https://www.googleapis.com/compute/v1/projects/project-a/global/networks/default",
        direction: "INGRESS",
        disabled: false,
        allowed: [{ IPProtocol: "tcp", ports: ["45400", "443"] }],
        sourceRanges: ["0.0.0.0/0"],
        targetTags: ["xui-us-test"]
      },
      {
        name: "allow-singbox",
        network: "global/networks/default",
        direction: "INGRESS",
        disabled: false,
        allowed: [{ IPProtocol: "udp", ports: ["23293"] }],
        sourceRanges: ["0.0.0.0/0"],
        targetTags: ["vm-a"]
      }
    ]
  }]);
  const service = createFirewallService({ runner: fake.runner });

  const result = await service.inspectInstanceExposure({
    identity,
    cloudInstance: { network: { name: "default" }, tags: ["xui-us-test"] },
    expectedPorts: [
      { protocol: "tcp", port: "45400" },
      { protocol: "udp", port: "23293" }
    ]
  });

  assert.equal(result.status, "partial");
  assert.deepEqual(result.matchedPorts.map((item) => `${item.protocol}/${item.port}`).toSorted(), ["tcp/45400"]);
  assert.deepEqual(result.missingPorts.map((item) => `${item.protocol}/${item.port}`), ["udp/23293"]);
  assert.equal(result.exposedPorts.some((item) => item.rule === "allow-xui-panel" && item.port === "443"), true);
  assert.equal(fake.calls.length, 1);
  assert.deepEqual(fake.calls[0].command.slice(0, 3), ["compute", "firewall-rules", "list"]);
  assert.equal(fake.calls.some((call) => /(create|update|delete)/.test(call.command?.join(" ") || "")), false);
});

test("firewall service does not treat internal-only source ranges as public exposure", async () => {
  const fake = createFakeRunner([{
    data: [{
      name: "allow-internal-xui",
      network: "global/networks/default",
      direction: "INGRESS",
      disabled: false,
      allowed: [{ IPProtocol: "tcp", ports: ["8443"] }],
      sourceRanges: ["10.0.0.0/8"],
      targetTags: ["xui-us-test"]
    }]
  }]);
  const service = createFirewallService({ runner: fake.runner });

  const result = await service.inspectInstanceExposure({
    identity,
    cloudInstance: { network: { name: "default" }, tags: ["xui-us-test"] },
    expectedPorts: [{ protocol: "tcp", port: "8443" }]
  });

  assert.equal(result.status, "missing");
  assert.deepEqual(result.matchedPorts, []);
  assert.deepEqual(result.missingPorts, [{ protocol: "tcp", port: "8443" }]);
  assert.deepEqual(result.internalPorts.map((item) => `${item.protocol}/${item.port}`), ["tcp/8443"]);
});

test("firewall service matches expected ports covered by a public port range", async () => {
  const fake = createFakeRunner([{
    data: [{
      name: "allow-xui-range",
      network: "global/networks/default",
      direction: "INGRESS",
      disabled: false,
      allowed: [{ IPProtocol: "tcp", ports: ["8000-9000"] }],
      sourceRanges: ["0.0.0.0/0"],
      targetTags: ["xui-us-test"]
    }]
  }]);
  const service = createFirewallService({ runner: fake.runner });

  const result = await service.inspectInstanceExposure({
    identity,
    cloudInstance: { network: { name: "default" }, tags: ["xui-us-test"] },
    expectedPorts: [{ protocol: "tcp", port: "8443" }]
  });

  assert.equal(result.status, "matched");
  assert.deepEqual(result.matchedPorts.map((item) => `${item.protocol}/${item.port}`), ["tcp/8443"]);
  assert.equal(result.matchedPorts[0].rule, "allow-xui-range");
});

test("firewall service flags an untargeted public allow-all rule as overexposed", async () => {
  const fake = createFakeRunner([{
    data: [{
      name: "public-allow-all",
      network: "global/networks/default",
      direction: "INGRESS",
      disabled: false,
      allowed: [{ IPProtocol: "all" }],
      sourceRanges: ["0.0.0.0/0"],
      targetTags: []
    }]
  }]);
  const service = createFirewallService({ runner: fake.runner });

  const result = await service.inspectInstanceExposure({
    identity,
    cloudInstance: { network: { name: "default" }, tags: ["xui-us-test"] },
    expectedPorts: [{ protocol: "tcp", port: "8443" }]
  });

  assert.equal(result.status, "overexposed");
  assert.deepEqual(result.matchedPorts.map((item) => `${item.protocol}/${item.port}`), ["tcp/8443"]);
  assert.deepEqual(result.broadRules.map((item) => item.name), ["public-allow-all"]);
  assert.match(result.warning, /public-allow-all.*全端口/);
});

test("firewall service reuses one project rule list inside a request-scoped read cache", async () => {
  const fake = createFakeRunner([{ data: [] }]);
  const service = createFirewallService({ runner: fake.runner });
  const readCache = new Map();

  await service.inspectInstanceExposure({
    identity,
    cloudInstance: { network: { name: "default" }, tags: ["vm-a"] },
    expectedPorts: [{ protocol: "tcp", port: "45400" }],
    readCache
  });
  await service.listRules(identity, { readCache });

  assert.equal(fake.calls.length, 1);
  assert.deepEqual(fake.calls[0].command.slice(0, 3), ["compute", "firewall-rules", "list"]);
});

test("firewall service treats source tags as restricted and honors target service accounts", async () => {
  const fake = createFakeRunner([{
    data: [{
      name: "tag-sourced-admin",
      network: "global/networks/default",
      direction: "INGRESS",
      disabled: false,
      allowed: [{ IPProtocol: "tcp", ports: ["8443"] }],
      sourceTags: ["admin-client"],
      targetServiceAccounts: ["vm-a@project-a.iam.gserviceaccount.com"]
    }]
  }]);
  const service = createFirewallService({ runner: fake.runner });
  const readCache = new Map();

  const result = await service.inspectInstanceExposure({
    identity,
    cloudInstance: {
      network: { name: "default" },
      tags: [],
      serviceAccount: "vm-a@project-a.iam.gserviceaccount.com"
    },
    expectedPorts: [{ protocol: "tcp", port: "8443" }],
    readCache
  });

  assert.equal(result.status, "matched");
  assert.equal(result.matchedPorts[0].sourceScope, "restricted");

  const mismatch = await service.inspectInstanceExposure({
    identity,
    cloudInstance: {
      network: { name: "default" },
      tags: [],
      serviceAccount: "other@project-a.iam.gserviceaccount.com"
    },
    expectedPorts: [{ protocol: "tcp", port: "8443" }],
    readCache
  });
  assert.equal(mismatch.status, "missing");
});
