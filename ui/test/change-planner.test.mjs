import assert from "node:assert/strict";
import test from "node:test";

import {
  createChangePreview,
  previewMatchesCurrentState
} from "../server/change-planner.js";

const identity = {
  configuration: "acct-a",
  account: "user@example.com",
  projectId: "project-a",
  zone: "us-west1-b",
  name: "vm-a"
};

const desired = {
  machineType: "e2-micro",
  image: "debian-cloud/debian-12",
  disk: { sizeGb: 30, type: "pd-standard" },
  network: {
    name: "default",
    subnet: "default",
    externalIpMode: "ephemeral",
    networkTier: "PREMIUM",
    nicType: "VIRTIO_NET"
  },
  labels: { managed_by: "gcp-vm-console" },
  tags: ["gcp-vm-console"],
  metadata: { startupScriptHash: "script-v1" },
  deploy: { method: "vm_only" }
};

const observed = {
  exists: true,
  status: "RUNNING",
  machineType: "e2-micro",
  image: "debian-cloud/debian-12",
  disk: { sizeGb: 30, type: "pd-standard" },
  network: {
    name: "default",
    subnet: "default",
    externalIpMode: "ephemeral",
    networkTier: "PREMIUM",
    nicType: "VIRTIO_NET"
  },
  labels: { managed_by: "gcp-vm-console" },
  tags: ["gcp-vm-console"],
  metadata: { startupScriptHash: "script-v1" }
};

test("change planner creates a new VM without deleting any existing resource", () => {
  const preview = createChangePreview({ identity, desired, observed: null, now: "2026-06-17T12:00:00.000Z" });

  assert.equal(preview.summary.create, 1);
  assert.equal(preview.summary.delete, 0);
  assert.equal(preview.requiresReplacement, false);
  assert.deepEqual(preview.actions.map((action) => action.id), ["create-vm"]);
  assert.match(preview.fingerprint, /^[a-f0-9]{64}$/);
});

test("change planner makes static address reservation explicit and fingerprinted", () => {
  const staticDesired = {
    ...desired,
    network: {
      ...desired.network,
      externalIpMode: "static",
      networkTier: "STANDARD",
      nicType: "GVNIC",
      addressName: "vm-a-static"
    }
  };
  const preview = createChangePreview({ identity, desired: staticDesired, observed: null });

  assert.deepEqual(preview.actions.map((action) => action.id), ["ensure-static-address", "create-vm"]);
  assert.equal(preview.summary.create, 2);
  assert.deepEqual(preview.networkPlan, {
    externalIpMode: "static",
    networkTier: "STANDARD",
    nicType: "GVNIC",
    addressName: "vm-a-static"
  });
});

test("change planner returns a stable no-op preview for equivalent state", () => {
  const first = createChangePreview({ identity, desired, observed, now: "2026-06-17T12:00:00.000Z" });
  const reordered = createChangePreview({
    identity: { ...identity },
    desired: { ...desired, labels: { managed_by: "gcp-vm-console" } },
    observed: { ...observed, labels: { managed_by: "gcp-vm-console" } },
    now: "2026-06-17T13:00:00.000Z"
  });

  assert.deepEqual(first.actions, []);
  assert.equal(first.summary.noop, true);
  assert.equal(first.fingerprint, reordered.fingerprint);
});

test("change planner classifies live stop-required and replacement fields", () => {
  const preview = createChangePreview({
    identity,
    desired: {
      ...desired,
      machineType: "e2-small",
      image: "ubuntu-os-cloud/ubuntu-2404-lts-amd64",
      disk: { sizeGb: 40, type: "pd-balanced" },
      labels: { managed_by: "gcp-vm-console", env: "test" },
      tags: ["gcp-vm-console", "node"],
      metadata: { startupScriptHash: "script-v2" }
    },
    observed,
    now: "2026-06-17T12:00:00.000Z"
  });

  const classifications = Object.fromEntries(preview.actions.map((action) => [action.field, action.classification]));
  assert.equal(classifications.labels, "in_place");
  assert.equal(classifications.tags, "in_place");
  assert.equal(classifications["metadata.startupScriptHash"], "in_place");
  assert.equal(classifications["disk.sizeGb"], "in_place");
  assert.equal(classifications.machineType, "interrupt");
  assert.equal(classifications.image, "replacement");
  assert.equal(classifications["disk.type"], "replacement");
  assert.equal(preview.requiresInterruption, true);
  assert.equal(preview.requiresReplacement, true);
  assert.equal(preview.summary.delete, 0);
  assert.ok(preview.actions.some((action) => action.id === "create-replacement-vm"));
  assert.equal(preview.executable, false);
  assert.ok(preview.unsupportedActions.includes("change-machineType"));
});

test("change planner marks unsupported in-place edits as preview-only", () => {
  const preview = createChangePreview({ identity, desired: { ...desired, machineType: "e2-small" }, observed });
  assert.equal(preview.executable, false);
  assert.deepEqual(preview.unsupportedActions, ["change-machineType"]);
});

test("change planner requires a bounded custom startup script", () => {
  assert.throws(
    () => createChangePreview({
      identity,
      desired: { ...desired, deploy: { method: "custom_startup" } },
      observed: null
    }),
    /自定义脚本不能为空/
  );

  assert.throws(
    () => createChangePreview({
      identity,
      desired: {
        ...desired,
        deploy: { method: "custom_startup", startupScript: "x".repeat(64 * 1024 + 1) }
      },
      observed: null
    }),
    /64 KiB/
  );
});

test("change planner marks a valid custom startup script as executable", () => {
  const preview = createChangePreview({
    identity,
    desired: {
      ...desired,
      metadata: { startupScriptHash: "script-custom" },
      deploy: { method: "custom_startup", startupScript: "#!/bin/bash\necho ready\n" }
    },
    observed: null
  });

  assert.equal(preview.executable, true);
  assert.deepEqual(preview.actions.map((action) => action.id), ["create-vm"]);
});

test("change planner treats public IP tier NIC and static address changes as replacement-safe", () => {
  const preview = createChangePreview({
    identity,
    desired: {
      ...desired,
      network: {
        ...desired.network,
        externalIpMode: "static",
        networkTier: "STANDARD",
        nicType: "GVNIC",
        addressName: "vm-a-static"
      }
    },
    observed,
    now: "2026-06-17T12:00:00.000Z"
  });

  const classifications = Object.fromEntries(preview.actions.map((action) => [action.field, action.classification]));
  assert.equal(classifications["network.externalIpMode"], "replacement");
  assert.equal(classifications["network.networkTier"], "replacement");
  assert.equal(classifications["network.nicType"], "replacement");
  assert.equal(classifications["network.addressName"], "replacement");
  assert.ok(preview.actions.some((action) => action.id === "ensure-replacement-static-address"));
  assert.ok(preview.actions.some((action) => action.id === "create-replacement-vm"));
});

test("change planner never infers cloud deletion from an absent desired VM", () => {
  assert.throws(
    () => createChangePreview({ identity, desired: null, observed }),
    /explicit delete request/
  );

  const preview = createChangePreview({
    identity,
    desired: null,
    observed,
    operation: "delete",
    deleteResources: ["vm", "address"]
  });
  assert.equal(preview.summary.delete, 2);
  assert.deepEqual(preview.actions.map((action) => action.resource), ["vm", "address"]);
});

test("preview fingerprint invalidates on identity desired or observed changes", () => {
  const preview = createChangePreview({ identity, desired, observed });

  assert.equal(previewMatchesCurrentState(preview, { identity, desired, observed }).ok, true);
  assert.deepEqual(
    previewMatchesCurrentState(preview, { identity: { ...identity, account: "other@example.com" }, desired, observed }),
    { ok: false, reason: "identity_changed" }
  );
  assert.deepEqual(
    previewMatchesCurrentState(preview, { identity, desired: { ...desired, machineType: "e2-small" }, observed }),
    { ok: false, reason: "desired_changed" }
  );
  assert.deepEqual(
    previewMatchesCurrentState(preview, { identity, desired, observed: { ...observed, status: "TERMINATED" } }),
    { ok: false, reason: "observed_changed" }
  );
});
