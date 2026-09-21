import assert from "node:assert/strict";
import test from "node:test";

import { buildNetworkExposurePreview } from "../server/network-exposure-policy.js";

const identity = {
  configuration: "acct-a",
  account: "user@example.com",
  projectId: "project-a",
  zone: "us-west1-b",
  name: "vm-a"
};

function fixture(overrides = {}) {
  const now = "2026-07-16T12:10:00.000Z";
  return {
    record: {
      identity,
      desired: { ssh: { user: "y", keyFile: "/private/key", port: 45400 } },
      verification: {
        checkedAt: "2026-07-16T12:00:00.000Z",
        ports: [
          { protocol: "tcp", port: "443", process: "x-ui", listening: true, scope: "wildcard" },
          { protocol: "udp", port: "25737", process: "sing-box", listening: true, scope: "network" },
          { protocol: "tcp", port: "9999", process: "custom-daemon", listening: true, scope: "wildcard" },
          { protocol: "tcp", port: "8080", process: "loopback-only", listening: true, scope: "loopback" }
        ]
      }
    },
    instances: [
      { name: "vm-a", zone: "us-west1-b", status: "RUNNING", network: { name: "default" }, tags: ["shared"] },
      { name: "vm-b", zone: "us-west1-b", status: "RUNNING", network: { name: "default" }, tags: ["shared"] }
    ],
    rules: [{
      name: "ruzhan1",
      network: "global/networks/default",
      direction: "INGRESS",
      priority: 1000,
      disabled: false,
      sourceRanges: ["0.0.0.0/0"],
      targetTags: [],
      allowed: [{ IPProtocol: "all" }]
    }],
    selection: { publicSsh22: false, ports: [{ protocol: "tcp", port: "443" }, { protocol: "udp", port: "25737" }] },
    secretStatus: { configured: true, versionId: "secret-v1" },
    now,
    ...overrides
  };
}

test("network exposure preview selects fresh listeners and reserves SSH policy ports", () => {
  const preview = buildNetworkExposurePreview(fixture());

  assert.equal(preview.expiresAt, "2026-07-16T12:25:00.000Z");
  assert.equal(preview.coverage.ready, true);
  assert.equal(preview.isolation.allowPriority, 998);
  assert.equal(preview.isolation.denyPriority, 999);
  assert.equal(preview.isolation.targetTag.startsWith("gvc-isolate-"), true);
  assert.deepEqual(preview.desiredExposure.iap, [
    { protocol: "tcp", port: "22" },
    { protocol: "tcp", port: "45400" }
  ]);
  assert.deepEqual(preview.desiredExposure.public, [
    { protocol: "tcp", port: "443" },
    { protocol: "tcp", port: "45400" },
    { protocol: "udp", port: "25737" }
  ]);
  const candidates = Object.fromEntries(preview.portCandidates.map((item) => [`${item.protocol}/${item.port}`, item]));
  assert.equal(candidates["tcp/443"].selectedByDefault, true);
  assert.equal(candidates["tcp/9999"].selectedByDefault, false);
  assert.equal("tcp/8080" in candidates, false);
  assert.match(preview.fingerprint, /^[a-f0-9]{64}$/);
  assert.equal(JSON.stringify(preview).includes("/private/key"), false);
});

test("network exposure preview fails closed for stale evidence invalid selections and exhausted priorities", () => {
  const stale = buildNetworkExposurePreview(fixture({ now: "2026-07-16T12:16:01.000Z" }));
  assert.equal(stale.coverage.ready, false);
  assert.match(stale.coverage.blockedReason, /过期/);

  const invalidSelection = buildNetworkExposurePreview(fixture({
    selection: { publicSsh22: false, ports: [{ protocol: "tcp", port: "65000" }] }
  }));
  assert.equal(invalidSelection.coverage.ready, false);
  assert.match(invalidSelection.coverage.blockedReason, /监听/);

  const exhausted = buildNetworkExposurePreview(fixture({
    rules: [{
      name: "priority-one",
      direction: "INGRESS",
      priority: 1,
      disabled: false,
      sourceRanges: ["0.0.0.0/0"],
      targetTags: [],
      allowed: [{ IPProtocol: "all" }]
    }]
  }));
  assert.equal(exhausted.coverage.ready, false);
  assert.match(exhausted.coverage.blockedReason, /优先级/);
});

test("network exposure preview fails closed for uncertain live state and external rule-name collisions", () => {
  for (const selected of [
    { name: "vm-a", zone: "us-west1-b", status: "UNKNOWN", network: { name: "default" }, tags: [] },
    { name: "vm-a", zone: "us-west1-b", status: "RUNNING", network: { name: "default" } },
    { name: "vm-a", zone: "us-west1-b", status: "RUNNING", tags: [] }
  ]) {
    const preview = buildNetworkExposurePreview(fixture({ instances: [selected] }));
    assert.equal(preview.coverage.ready, false);
    assert.match(preview.coverage.blockedReason, /实时状态|标签|网络/);
  }

  const invalidPriority = buildNetworkExposurePreview(fixture({
    rules: [{ ...fixture().rules[0], priority: "unknown" }]
  }));
  assert.equal(invalidPriority.coverage.ready, false);
  assert.match(invalidPriority.coverage.blockedReason, /优先级.*不完整/);

  const initial = buildNetworkExposurePreview(fixture());
  const collisionName = initial.isolation.ruleActions.find((action) => action.purpose === "ssh-iap").name;
  const collision = buildNetworkExposurePreview(fixture({
    rules: [
      fixture().rules[0],
      {
        name: collisionName,
        description: "created outside this console",
        network: "global/networks/default",
        direction: "INGRESS",
        priority: 900,
        disabled: false,
        sourceRanges: ["0.0.0.0/0"],
        targetTags: [],
        allowed: [{ IPProtocol: "tcp", ports: ["22"] }]
      }
    ]
  }));
  assert.equal(collision.coverage.ready, false);
  assert.match(collision.coverage.blockedReason, /规则名称.*外部规则冲突/);
  assert.deepEqual(collision.isolation.ruleActions, []);
});

test("network exposure preview reuses its owned rule priority slots without ratcheting", () => {
  const initial = buildNetworkExposurePreview(fixture());
  const targetTag = initial.isolation.targetTag;
  const ownedRules = initial.isolation.ruleActions.map((action) => ({
    name: action.name,
    description: `managed-by=gcp-vm-console;vm=${identity.name};project=${identity.projectId}`,
    network: "global/networks/default",
    direction: "INGRESS",
    priority: action.priority,
    disabled: Boolean(action.disabled),
    sourceRanges: action.sourceRanges,
    targetTags: [targetTag],
    ...(action.action === "ensure-deny"
      ? { denied: [{ IPProtocol: "all" }] }
      : { allowed: [{ IPProtocol: action.protocol, ports: action.ports }] })
  }));
  const repeated = buildNetworkExposurePreview(fixture({
    instances: [
      { name: "vm-a", zone: "us-west1-b", status: "RUNNING", network: { name: "default" }, tags: ["shared", targetTag] },
      { name: "vm-b", zone: "us-west1-b", status: "RUNNING", network: { name: "default" }, tags: ["shared"] }
    ],
    rules: [fixture().rules[0], ...ownedRules]
  }));

  assert.equal(repeated.coverage.ready, true);
  assert.equal(repeated.isolation.allowPriority, 998);
  assert.equal(repeated.isolation.denyPriority, 999);
  assert.equal(repeated.isolation.tagAction, "reuse");
});
