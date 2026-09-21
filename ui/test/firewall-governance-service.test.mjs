import assert from "node:assert/strict";
import test from "node:test";

import {
  buildFirewallGovernancePreview,
  createFirewallGovernanceService
} from "../server/firewall-governance-service.js";

const now = "2026-07-14T12:00:00.000Z";
const identity = {
  configuration: "acct-a",
  account: "user@example.com",
  projectId: "project-a",
  zone: "us-west1-b",
  region: "us-west1",
  name: "vm-a"
};

function cloud(name, tags = [name]) {
  return {
    name,
    zone: "us-west1-b",
    region: "us-west1",
    status: "RUNNING",
    network: { name: "default", externalIp: "203.0.113.1" },
    tags
  };
}

function record(overrides = {}) {
  return {
    id: "vm-a-record",
    identity,
    desired: { ssh: { port: 45400 }, deploy: { method: "singbox_plus" }, tags: ["vm-a"] },
    verification: {
      checkedAt: now,
      method: "singbox_plus",
      ssh: { desiredPort: 45400, actualPort: 45400, verified: true, fallback: false },
      ports: [{ protocol: "udp", port: "22353", listening: true, scope: "network" }]
    },
    ...overrides
  };
}

const broadRule = {
  name: "ruzhan1",
  network: "projects/project-a/global/networks/default",
  direction: "INGRESS",
  priority: 1000,
  disabled: false,
  sourceRanges: ["0.0.0.0/0"],
  targetTags: [],
  allowed: [{ IPProtocol: "all" }],
  description: ""
};

test("firewall governance marks targetless allow-all as external critical and maps every affected instance", () => {
  const instances = [cloud("vm-a"), cloud("vm-b"), cloud("vm-c"), cloud("vm-d"), cloud("vm-e")];
  const preview = buildFirewallGovernancePreview({
    record: record(),
    instances,
    rules: [broadRule],
    now
  });

  const finding = preview.findings.find((item) => item.name === "ruzhan1");
  assert.equal(finding.severity, "critical");
  assert.equal(finding.ownership, "external");
  assert.equal(finding.affectedInstances.length, 5);
  assert.equal(preview.externalActions.some((item) => item.ruleName === "ruzhan1"), true);
  assert.equal(preview.ownedActions.some((item) => item.name === "ruzhan1"), false);
  assert.equal(preview.expiresAt, "2026-07-14T12:15:00.000Z");
});

test("firewall governance does not misclassify public ICMP as a full-port critical rule", () => {
  const preview = buildFirewallGovernancePreview({
    record: record(),
    instances: [cloud("vm-a")],
    rules: [{
      name: "default-allow-icmp",
      network: "global/networks/default",
      direction: "INGRESS",
      sourceRanges: ["0.0.0.0/0"],
      targetTags: [],
      allowed: [{ IPProtocol: "icmp" }]
    }],
    now
  });

  assert.equal(preview.findings[0].severity, "warning");
});

test("firewall governance keeps every project rule with source target ownership and impact metadata", () => {
  const preview = buildFirewallGovernancePreview({
    record: record(),
    instances: [
      { ...cloud("vm-a"), serviceAccount: "vm-a@project-a.iam.gserviceaccount.com" },
      cloud("vm-b")
    ],
    rules: [{
      name: "gvc-vm-b-ssh-iap-tcp",
      network: "global/networks/default",
      direction: "INGRESS",
      disabled: true,
      sourceTags: ["admin-client"],
      targetServiceAccounts: ["vm-a@project-a.iam.gserviceaccount.com"],
      allowed: [{ IPProtocol: "tcp", ports: ["22"] }],
      description: "managed-by=gcp-vm-console;vm=vm-b;project=project-a"
    }],
    now
  });

  assert.equal(preview.findings.length, 1);
  assert.equal(preview.findings[0].severity, "safe");
  assert.equal(preview.findings[0].ownership, "console_owned");
  assert.deepEqual(preview.findings[0].sourceTags, ["admin-client"]);
  assert.equal(preview.findings[0].sourceServiceAccountCount, 0);
  assert.equal(preview.findings[0].targetServiceAccountCount, 1);
  assert.equal(preview.findings[0].targetScope, "service_accounts");
  assert.doesNotMatch(JSON.stringify(preview), /vm-a@project-a\.iam\.gserviceaccount\.com/);
  assert.deepEqual(preview.findings[0].affectedInstances, []);
});

test("firewall governance generates only IAP SSH and fresh public listener owned actions", () => {
  const preview = buildFirewallGovernancePreview({
    record: record(),
    instances: [cloud("vm-a", ["vm-a"]), cloud("vm-b", ["vm-b"])],
    rules: [broadRule],
    now
  });

  const ssh = preview.ownedActions.find((item) => item.purpose === "ssh-iap");
  const service = preview.ownedActions.find((item) => item.purpose === "public-service");
  assert.deepEqual(ssh.sourceRanges, ["35.235.240.0/20"]);
  assert.deepEqual(ssh.ports, ["22", "45400"]);
  assert.equal(ssh.targetTags[0], "vm-a");
  assert.deepEqual(service.sourceRanges, ["0.0.0.0/0"]);
  assert.deepEqual(service.ports, ["22353"]);
  assert.equal(preview.ownedActions.every((item) => item.action === "create"), true);
});

test("firewall governance fails closed without a unique existing tag or fresh network listener", () => {
  const staleRecord = record({
    desired: { ssh: { port: 45400 }, deploy: { method: "external_custom" }, tags: ["shared"] },
    verification: {
      checkedAt: "2026-07-13T00:00:00.000Z",
      ssh: { desiredPort: 45400, actualPort: 45400, verified: true },
      ports: [
        { protocol: "tcp", port: "9999", listening: true, scope: "loopback" },
        { protocol: "udp", port: "22353", listening: true, scope: "network" }
      ]
    }
  });
  const preview = buildFirewallGovernancePreview({
    record: staleRecord,
    instances: [cloud("vm-a", ["shared"]), cloud("vm-b", ["shared"])],
    rules: [broadRule],
    now
  });

  assert.equal(preview.ownedActions.length, 0);
  assert.match(preview.coverage.blockedReason, /唯一标签|证据已过期/);
});

test("firewall governance ignores invalid or unknown ports instead of generating cloud actions", () => {
  const preview = buildFirewallGovernancePreview({
    record: record({
      verification: {
        checkedAt: now,
        ssh: { desiredPort: 70000, actualPort: 0, verified: true },
        ports: [
          { protocol: "udp", port: "99999", listening: true, scope: "network" },
          { protocol: "tcp", port: "custom", listening: true, scope: "network" },
          { protocol: "tcp", port: "8443", listening: true, scope: "loopback" }
        ]
      }
    }),
    instances: [cloud("vm-a")],
    rules: [],
    now
  });

  assert.equal(preview.ownedActions.length, 0);
});

test("firewall governance never schedules an update for an external hash-collision rule", () => {
  const first = buildFirewallGovernancePreview({
    record: record(),
    instances: [cloud("vm-a")],
    rules: [],
    now
  });
  const sshName = first.ownedActions.find((item) => item.purpose === "ssh-iap").name;
  const collision = { ...broadRule, name: sshName, targetTags: ["vm-a"], allowed: [{ IPProtocol: "tcp", ports: ["1-65535"] }] };
  const second = buildFirewallGovernancePreview({
    record: record(),
    instances: [cloud("vm-a")],
    rules: [collision],
    now
  });

  assert.equal(second.ownedActions.some((item) => item.name === sshName), false);
  assert.equal(second.ownedActions.every((item) => item.action !== "update" || item.name.startsWith("gvc-")), true);
  assert.equal(second.ownedActions.some((item) => item.name === "ruzhan1"), false);
});

test("firewall governance fingerprint changes when relevant cloud rules change", () => {
  const input = { record: record(), instances: [cloud("vm-a")], rules: [broadRule], now };
  const first = buildFirewallGovernancePreview(input);
  const second = buildFirewallGovernancePreview({
    ...input,
    rules: [{ ...broadRule, disabled: true }]
  });

  assert.notEqual(first.fingerprint, second.fingerprint);
});

test("firewall governance service is read-only and exposes no legacy owned-rule apply method", async () => {
  const instances = [cloud("vm-a", ["vm-a"]), cloud("vm-b", ["vm-b"])];
  const rules = [broadRule];
  const service = createFirewallGovernanceService({
    inventory: { async listInstances() { return instances; } },
    firewallService: {
      async listRules() { return rules; }
    },
    now: () => now
  });
  const preview = await service.preview(record());
  assert.equal(preview.externalActions.some((item) => item.ruleName === "ruzhan1"), true);
  assert.equal(preview.ownedActions.length > 0, true);
  assert.equal("applyOwned" in service, false);
});
