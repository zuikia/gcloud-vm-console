import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createInventorySnapshotStore } from "../server/inventory-snapshot-store.js";

const scope = {
  configuration: "acct-a",
  account: "user@example.com",
  projectId: "project-a"
};

function instance(name = "vm-a") {
  return {
    name,
    zone: "us-west1-b",
    region: "us-west1",
    status: "RUNNING",
    machineType: "e2-micro",
    disk: { sizeGb: 10, type: "pd-standard" },
    network: { name: "default", subnet: "default", externalIpMode: "ephemeral", externalIp: "203.0.113.1", networkTier: "PREMIUM", nicType: "GVNIC" },
    tags: [name],
    labels: {
      gvc_deploy_method: "singbox_plus",
      arbitrary_secret_label: "must-not-persist"
    },
    metadata: {
      gvcRecordSchema: "1",
      gvcDeployMethod: "singbox_plus",
      startupScriptHash: "safe-hash",
      startupScript: "secret script"
    },
    serviceAccount: "sensitive@project-a.iam.gserviceaccount.com",
    rawOutput: "must-not-persist"
  };
}

test("inventory snapshots persist atomically with restrictive permissions and safe fields", async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "inventory-cache-"));
  t.after(async () => (await import("node:fs/promises")).rm(rootDir, { recursive: true, force: true }));
  const store = createInventorySnapshotStore({ rootDir });

  await store.save(scope, [instance()], "2026-07-14T12:00:00.000Z");
  const loaded = await store.load(scope, "2026-07-14T12:01:00.000Z");

  assert.equal(loaded.instances.length, 1);
  assert.equal(loaded.instances[0].labels.gvc_deploy_method, "singbox_plus");
  assert.equal(loaded.instances[0].network.networkTier, "PREMIUM");
  assert.equal(loaded.instances[0].network.nicType, "GVNIC");
  assert.equal("serviceAccount" in loaded.instances[0], false);
  assert.equal("rawOutput" in loaded.instances[0], false);
  assert.equal("startupScript" in loaded.instances[0].metadata, false);
  assert.equal(JSON.stringify(loaded).includes("must-not-persist"), false);

  const entries = (await readdir(rootDir)).filter((name) => name.endsWith(".json"));
  assert.equal(entries.length, 1);
  assert.equal((await stat(rootDir)).mode & 0o777, 0o700);
  assert.equal((await stat(path.join(rootDir, entries[0]))).mode & 0o777, 0o600);
  assert.equal((await readdir(rootDir)).some((name) => name.endsWith(".tmp")), false);
});

test("inventory snapshots isolate contexts and prune to twenty records or seven days", async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "inventory-cache-"));
  t.after(async () => (await import("node:fs/promises")).rm(rootDir, { recursive: true, force: true }));
  let current = new Date("2026-07-14T12:00:00.000Z");
  const store = createInventorySnapshotStore({ rootDir, now: () => current.toISOString() });

  for (let index = 0; index < 22; index += 1) {
    current = new Date(Date.UTC(2026, 6, 14, 12, index));
    await store.save({ ...scope, projectId: `project-${index}` }, [instance(`vm-${index}`)]);
  }
  assert.equal((await readdir(rootDir)).filter((name) => name.endsWith(".json")).length, 20);

  current = new Date("2026-07-22T12:00:00.000Z");
  await store.prune();
  assert.equal((await readdir(rootDir)).filter((name) => name.endsWith(".json")).length, 0);
});

test("inventory snapshots quarantine malformed files without exposing their content", async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "inventory-cache-"));
  t.after(async () => (await import("node:fs/promises")).rm(rootDir, { recursive: true, force: true }));
  const store = createInventorySnapshotStore({ rootDir });
  await store.save(scope, [instance()], "2026-07-14T12:00:00.000Z");
  const fileName = (await readdir(rootDir)).find((name) => name.endsWith(".json"));
  await writeFile(path.join(rootDir, fileName), "token=secret broken json", "utf8");

  const loaded = await store.load(scope, "2026-07-14T12:01:00.000Z");
  assert.equal(loaded, null);
  const quarantineEntries = await readdir(path.join(rootDir, "quarantine"));
  assert.equal(quarantineEntries.length, 1);
  assert.equal(JSON.stringify(store.storageInfo()).includes("token=secret"), false);
  assert.equal((await readFile(path.join(rootDir, "quarantine", quarantineEntries[0]), "utf8")).includes("token=secret"), true);
});
