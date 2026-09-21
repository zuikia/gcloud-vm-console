import assert from "node:assert/strict";
import test from "node:test";

import { createNetworkExposureService } from "../server/network-exposure-service.js";

const identity = {
  configuration: "acct-a",
  account: "user@example.com",
  projectId: "project-a",
  zone: "us-west1-b",
  name: "vm-a"
};

function record() {
  return {
    id: "vm-a-record",
    identity,
    desired: { ssh: { user: "y", keyFile: "/private/key", port: 45400 } },
    verification: {
      checkedAt: "2026-07-16T12:00:00.000Z",
      ports: [
        { protocol: "tcp", port: "443", process: "x-ui", listening: true, scope: "wildcard" },
        { protocol: "udp", port: "25737", process: "sing-box", listening: true, scope: "network" }
      ]
    },
    observed: { network: { externalIp: "203.0.113.10" } }
  };
}

function setup({ failFinalPublic = false } = {}) {
  const operations = [];
  const instances = [
    { name: "vm-a", zone: "us-west1-b", status: "RUNNING", network: { name: "default", externalIp: "203.0.113.10" }, tags: [] },
    { name: "vm-b", zone: "us-west1-b", status: "RUNNING", network: { name: "default" }, tags: [] }
  ];
  const rules = [{
    name: "ruzhan1",
    network: "global/networks/default",
    direction: "INGRESS",
    priority: 1000,
    disabled: false,
    sourceRanges: ["0.0.0.0/0"],
    targetTags: [],
    allowed: [{ IPProtocol: "all" }]
  }];
  let publicChecks = 0;
  const service = createNetworkExposureService({
    inventory: { async listInstances() { return instances; } },
    firewallService: {
      async listRules() { return rules; },
      async ensureOwnedRule(action) { operations.push(`allow:${action.purpose}`); return { action: "created", name: action.name }; },
      async ensureOwnedDenyRule(action) { operations.push(`deny:${action.disabled ? "disabled" : "enabled"}`); return { action: "created", name: action.name }; },
      async ensureInstanceTag() { operations.push("tag"); return { action: "added" }; },
      async setOwnedRuleDisabled({ disabled }) { operations.push(`deny-toggle:${disabled}`); return { action: "updated", disabled }; }
    },
    sshDualEntryService: {
      async apply() {
        operations.push("ssh");
        return { status: "succeeded", policy: { mode: "dual_entry", passwordVersion: "secret-v1" } };
      },
      async verifyPublic45400() {
        publicChecks += 1;
        operations.push(publicChecks === 1 ? "verify-public-pre" : "verify-public-final");
        if (failFinalPublic && publicChecks === 2) throw new Error("public verification failed");
        return { verified: true };
      },
      async verifyIap22Path() { operations.push("verify-iap"); return { verified: true }; }
    },
    secretStore: {
      async publicStatus() { return { configured: true, versionId: "secret-v1" }; },
      async readSshPassword() { return { password: "ValidPass9", versionId: "secret-v1" }; }
    },
    taskLock: { async run(key, task) { operations.push(`lock:${key.includes("vm-a")}`); return task(); } },
    now: () => "2026-07-16T12:10:00.000Z"
  });
  return { service, operations };
}

test("network exposure applies allow tag deny in a connectivity-safe order", async () => {
  const { service, operations } = setup();
  const source = record();
  const preview = await service.preview(source, {
    selection: { publicSsh22: false, ports: [{ protocol: "tcp", port: "443" }, { protocol: "udp", port: "25737" }] }
  });

  const result = await service.apply({ record: source, fingerprint: preview.fingerprint, storedPreview: preview });

  assert.equal(result.status, "succeeded");
  assert.equal(result.firewall.effectiveStatus, "isolated");
  assert.deepEqual(operations, [
    "lock:true",
    "allow:ssh-iap",
    "allow:public-service",
    "allow:public-service",
    "deny:disabled",
    "tag",
    "ssh",
    "verify-public-pre",
    "deny-toggle:false",
    "verify-public-final",
    "verify-iap"
  ]);
  assert.equal(JSON.stringify(result).includes("ValidPass9"), false);
  assert.equal(JSON.stringify(result).includes("/private/key"), false);
});

test("network exposure disables only its owned deny rule when final connectivity fails", async () => {
  const { service, operations } = setup({ failFinalPublic: true });
  const source = record();
  const preview = await service.preview(source, {
    selection: { publicSsh22: false, ports: [{ protocol: "tcp", port: "443" }] }
  });

  await assert.rejects(
    () => service.apply({ record: source, fingerprint: preview.fingerprint, storedPreview: preview }),
    /回滚|public verification failed/
  );
  assert.deepEqual(operations.slice(-3), ["deny-toggle:false", "verify-public-final", "deny-toggle:true"]);
});
