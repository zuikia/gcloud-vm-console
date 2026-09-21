import assert from "node:assert/strict";
import test from "node:test";

import { createCloudInventory } from "../server/cloud-inventory.js";

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
        calls.push({ command, options });
        const response = responses.shift();
        if (response?.error) throw response.error;
        return { data: response?.data ?? null, retryAttempts: response?.retryAttempts || 1 };
      }
    }
  };
}

const gcloudInstance = {
  name: "vm-a",
  status: "RUNNING",
  zone: "https://www.googleapis.com/compute/v1/projects/project-a/zones/us-west1-b",
  machineType: "https://www.googleapis.com/compute/v1/projects/project-a/zones/us-west1-b/machineTypes/e2-micro",
  labels: { managed_by: "gcp-vm-console", gvc_managed: "true", gvc_deploy_method: "three_x_ui" },
  tags: { items: ["gcp-vm-console", "ssh"] },
  metadata: {
    items: [
      { key: "gcp-vm-console-startup-script-hash", value: "script-v1" },
      { key: "gcp-vm-console-image", value: "debian-cloud/debian-12" },
      { key: "gvc-record-schema", value: "1" },
      { key: "gvc-deploy-method", value: "three_x_ui" },
      { key: "startup-script", value: "raw script must not leak" }
    ]
  },
  disks: [
    {
      boot: true,
      diskSizeGb: "30",
      type: "https://www.googleapis.com/compute/v1/projects/project-a/zones/us-west1-b/diskTypes/pd-standard"
    }
  ],
  networkInterfaces: [
    {
      network: "https://www.googleapis.com/compute/v1/projects/project-a/global/networks/default",
      subnetwork: "https://www.googleapis.com/compute/v1/projects/project-a/regions/us-west1/subnetworks/default",
      accessConfigs: [{ natIP: "203.0.113.10", networkTier: "PREMIUM" }]
    }
  ],
  serviceAccounts: [{ email: "vm-a@project-a.iam.gserviceaccount.com" }]
};

test("cloud inventory reads one VM snapshot with explicit account project and zone", async () => {
  const fake = createFakeRunner([{ data: gcloudInstance }]);
  const inventory = createCloudInventory({ runner: fake.runner });

  const observed = await inventory.readObserved(identity);

  assert.equal(observed.exists, true);
  assert.equal(observed.name, "vm-a");
  assert.equal(observed.status, "RUNNING");
  assert.equal(observed.machineType, "e2-micro");
  assert.equal(observed.image, "debian-cloud/debian-12");
  assert.equal(observed.labels.gvc_managed, "true");
  assert.equal(observed.labels.gvc_deploy_method, "three_x_ui");
  assert.equal(observed.metadata.gvcRecordSchema, "1");
  assert.equal(observed.metadata.gvcDeployMethod, "three_x_ui");
  assert.equal("startup-script" in observed.metadata, false);
  assert.deepEqual(observed.disk, { sizeGb: 30, type: "pd-standard" });
  assert.deepEqual(observed.network, {
    name: "default",
    subnet: "default",
    externalIpMode: "ephemeral",
    externalIp: "203.0.113.10",
    networkTier: "PREMIUM",
    nicType: "VIRTIO_NET"
  });
  assert.deepEqual(fake.calls[0], {
    command: ["compute", "instances", "describe", "vm-a"],
    options: {
      context: { configuration: "acct-a", account: "user@example.com", projectId: "project-a" },
      location: { zone: "us-west1-b" }
    }
  });
});

test("cloud inventory returns null for a missing VM", async () => {
  const fake = createFakeRunner([{ error: new Error("The resource 'vm-a' was not found") }]);
  const inventory = createCloudInventory({ runner: fake.runner });

  assert.equal(await inventory.readObserved(identity), null);
  assert.equal(fake.calls.length, 1);
});

test("cloud inventory lists project VMs without activating gcloud configuration", async () => {
  const fake = createFakeRunner([{ data: [gcloudInstance, { ...gcloudInstance, name: "vm-b", status: "TERMINATED" }] }]);
  const inventory = createCloudInventory({ runner: fake.runner });

  const instances = await inventory.listInstances({
    configuration: "acct-a",
    account: "user@example.com",
    projectId: "project-a"
  });

  assert.deepEqual(instances.map((vm) => `${vm.name}:${vm.zone}:${vm.status}`), [
    "vm-a:us-west1-b:RUNNING",
    "vm-b:us-west1-b:TERMINATED"
  ]);
  assert.deepEqual(fake.calls[0], {
    command: ["compute", "instances", "list"],
    options: {
      context: { configuration: "acct-a", account: "user@example.com", projectId: "project-a" },
      allowGlobal: true
    }
  });
});

test("cloud inventory coalesces identical concurrent project lists", async () => {
  let release;
  let calls = 0;
  const pending = new Promise((resolve) => { release = resolve; });
  const inventory = createCloudInventory({
    runner: {
      async runJson() {
        calls += 1;
        await pending;
        return { data: [] };
      }
    }
  });
  const scope = {
    configuration: "acct-a",
    account: "user@example.com",
    projectId: "project-a"
  };

  const first = inventory.listInstances(scope);
  const second = inventory.listInstances(scope);
  assert.equal(calls, 1);
  release();
  assert.deepEqual(await first, await second);
});

test("cloud inventory snapshot persists live safe inventory with response metadata", async () => {
  const fake = createFakeRunner([{ data: [gcloudInstance], retryAttempts: 2 }]);
  const saves = [];
  const inventory = createCloudInventory({
    runner: fake.runner,
    now: () => "2026-07-14T12:00:00.000Z",
    snapshotStore: {
      async save(scope, instances, checkedAt) {
        saves.push({ scope, instances, checkedAt });
      },
      async load() { return null; }
    }
  });

  const result = await inventory.listInstancesSnapshot({
    configuration: "acct-a",
    account: "user@example.com",
    projectId: "project-a"
  });

  assert.equal(result.meta.source, "live");
  assert.equal(result.meta.stale, false);
  assert.equal(result.meta.retryAttempts, 2);
  assert.equal(result.instances[0].name, "vm-a");
  assert.equal(saves.length, 1);
  assert.equal(saves[0].checkedAt, "2026-07-14T12:00:00.000Z");
});

test("cloud inventory snapshot falls back to exact cached context with sanitized blocker", async () => {
  const fake = createFakeRunner([{ error: new Error("Tunnel connection failed: 503 Service Unavailable") }]);
  const inventory = createCloudInventory({
    runner: fake.runner,
    now: () => "2026-07-14T12:05:00.000Z",
    snapshotStore: {
      async save() { assert.fail("must not save failed reads"); },
      async load() {
        return {
          checkedAt: "2026-07-14T12:00:00.000Z",
          instances: [{ name: "cached-vm", zone: "us-west1-b", status: "RUNNING", network: {}, disk: {}, tags: [], labels: {}, metadata: {} }]
        };
      }
    }
  });

  const result = await inventory.listInstancesSnapshot({
    configuration: "acct-a",
    account: "user@example.com",
    projectId: "project-a"
  });

  assert.equal(result.meta.source, "cache");
  assert.equal(result.meta.stale, true);
  assert.equal(result.meta.ageSeconds, 300);
  assert.equal(result.meta.blocker.code, "proxy_upstream");
  assert.deepEqual(result.instances.map((item) => item.name), ["cached-vm"]);
});

test("cloud inventory snapshot rethrows live failure when no cache exists", async () => {
  const error = new Error("PERMISSION_DENIED");
  const fake = createFakeRunner([{ error }]);
  const inventory = createCloudInventory({
    runner: fake.runner,
    snapshotStore: {
      async save() {},
      async load() { return null; }
    }
  });

  await assert.rejects(() => inventory.listInstancesSnapshot({
    configuration: "acct-a",
    account: "user@example.com",
    projectId: "project-a"
  }), error);
});
