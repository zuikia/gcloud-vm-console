import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { createLegacyMigrator } from "../server/legacy-migrator.js";
import { createVmRecordStore } from "../server/vm-record-store.js";

async function writeProfile(rootDir, name, values) {
  const dir = path.join(rootDir, "instances", name);
  await mkdir(dir, { recursive: true });
  const body = Object.entries(values).map(([key, value]) => `${key} = "${value}"`).join("\n");
  await writeFile(path.join(dir, "terraform.tfvars"), `${body}\n`);
  await writeFile(path.join(dir, "terraform.tfstate"), JSON.stringify({ resources: [] }, null, 2));
}

async function setup(t) {
  const stableRoot = path.join(tmpdir(), `gcp-legacy-fixture-${Math.random().toString(16).slice(2)}`);
  await mkdir(stableRoot, { recursive: true });
  t.after(() => rm(stableRoot, { recursive: true, force: true }));
  const recordStore = createVmRecordStore({ rootDir: path.join(stableRoot, "records"), now: () => "2026-06-17T12:00:00.000Z" });
  return { rootDir: stableRoot, recordStore };
}

const cloudInstances = [
  {
    configuration: "acct-a",
    account: "user@example.com",
    projectId: "project-a",
    zone: "us-west1-b",
    name: "vm-a",
    exists: true,
    status: "RUNNING"
  }
];

test("legacy migrator previews matched unmatched and conflicting old profiles without cloud writes", async (t) => {
  const { rootDir, recordStore } = await setup(t);
  await writeProfile(rootDir, "profile-a", {
    project_id: "project-a",
    zone: "us-west1-b",
    name_prefix: "vm-a",
    machine_type: "e2-micro",
    image: "debian-cloud/debian-12"
  });
  await writeProfile(rootDir, "profile-a-copy", {
    project_id: "project-a",
    zone: "us-west1-b",
    name_prefix: "vm-a",
    machine_type: "e2-micro"
  });
  await writeProfile(rootDir, "profile-missing", {
    project_id: "project-a",
    zone: "us-west1-b",
    name_prefix: "vm-missing",
    machine_type: "e2-micro"
  });
  const migrator = createLegacyMigrator({ rootDir, recordStore, cloudInstances, now: () => "2026-06-17T12:00:00.000Z" });

  const preview = await migrator.preview();

  assert.deepEqual(preview.summary, { matched: 0, unmatched: 1, conflicts: 2 });
  assert.deepEqual(preview.unmatched.map((item) => item.profile), ["profile-missing"]);
  assert.deepEqual(preview.conflicts.map((item) => item.profile).sort(), ["profile-a", "profile-a-copy"]);
});

test("legacy migrator confirms matches idempotently and archives only the copied fixture", async (t) => {
  const { rootDir, recordStore } = await setup(t);
  await writeProfile(rootDir, "profile-a", {
    project_id: "project-a",
    zone: "us-west1-b",
    name_prefix: "vm-a",
    machine_type: "e2-micro",
    image: "debian-cloud/debian-12",
    disk_size_gb: "30",
    node_deploy_method: "vm_only"
  });
  const migrator = createLegacyMigrator({ rootDir, recordStore, cloudInstances, now: () => "2026-06-17T12:00:00.000Z" });
  const preview = await migrator.preview();

  assert.deepEqual(preview.summary, { matched: 1, unmatched: 0, conflicts: 0 });
  const first = await migrator.confirm(preview);
  const second = await migrator.confirm(preview);

  assert.deepEqual(first.summary, { created: 1, reused: 0, archived: 1 });
  assert.deepEqual(second.summary, { created: 0, reused: 1, archived: 0 });
  const records = await recordStore.list({ account: "user@example.com", projectId: "project-a" });
  assert.equal(records.length, 1);
  assert.equal(records[0].migration.sourceProfile, "profile-a");
  assert.equal(records[0].desired.deploy.method, "vm_only");

  const manifest = JSON.parse(await readFile(first.manifestPath, "utf8"));
  assert.equal(manifest.archivedProfiles[0].profile, "profile-a");
  assert.match(manifest.archivedProfiles[0].from, /instances\/profile-a$/);
  assert.match(manifest.archivedProfiles[0].to, /legacy-archive\/2026-06-17T12-00-00-000Z\/profile-a$/);
});
