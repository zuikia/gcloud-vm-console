import assert from "node:assert/strict";
import { chmod, mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { createVmRecordStore } from "../server/vm-record-store.js";

const identityA = {
  configuration: "acct-a",
  account: "a@example.com",
  projectId: "project-a",
  zone: "us-west1-b",
  name: "vm-a"
};

async function withStore(t) {
  const rootDir = await mkdtemp(path.join(tmpdir(), "gcp-vm-records-"));
  t.after(() => rm(rootDir, { recursive: true, force: true }));
  return {
    rootDir,
    store: createVmRecordStore({
      rootDir,
      now: () => "2026-06-17T12:00:00.000Z"
    })
  };
}

test("VM record store persists one structured record atomically", async (t) => {
  const { rootDir, store } = await withStore(t);
  const saved = await store.save({
    status: "draft",
    identity: identityA,
    desired: { machineType: "e2-micro", deployMethod: "vm_only" }
  });

  assert.match(saved.id, /^vm-a-[a-f0-9]{12}$/);
  assert.equal(saved.schemaVersion, 1);
  assert.equal(saved.createdAt, "2026-06-17T12:00:00.000Z");
  assert.equal(saved.updatedAt, "2026-06-17T12:00:00.000Z");
  assert.deepEqual(saved.preview, null);
  assert.deepEqual(saved.history, []);

  const stored = JSON.parse(await readFile(path.join(rootDir, saved.id, "record.json"), "utf8"));
  assert.deepEqual(stored, saved);
  assert.deepEqual((await readdir(path.join(rootDir, saved.id))).sort(), ["record.json"]);
});

test("VM record store hardens existing roots, record directories, and files", async (t) => {
  const { rootDir, store } = await withStore(t);
  await chmod(rootDir, 0o755);
  const saved = await store.save({ status: "draft", identity: identityA, desired: {} });
  const recordDir = path.join(rootDir, saved.id);
  const recordPath = path.join(recordDir, "record.json");
  await chmod(rootDir, 0o755);
  await chmod(recordDir, 0o755);
  await chmod(recordPath, 0o644);

  assert.ok(await store.get(saved.id));
  assert.equal((await stat(rootDir)).mode & 0o777, 0o700);
  assert.equal((await stat(recordDir)).mode & 0o777, 0o700);
  assert.equal((await stat(recordPath)).mode & 0o777, 0o600);

  await store.save({ ...saved, desired: { machineType: "e2-micro" } });
  assert.equal((await stat(rootDir)).mode & 0o777, 0o700);
  assert.equal((await stat(recordDir)).mode & 0o777, 0o700);
  assert.equal((await stat(recordPath)).mode & 0o777, 0o600);
});

test("VM record store preserves createdAt and replaces record state on save", async (t) => {
  const { store } = await withStore(t);
  const first = await store.save({ status: "draft", identity: identityA, desired: { machineType: "e2-micro" } });
  const second = await store.save({
    ...first,
    status: "managed",
    observed: { status: "RUNNING", machineType: "e2-micro" },
    history: [{ type: "migration", at: first.createdAt }]
  });

  assert.equal(second.id, first.id);
  assert.equal(second.createdAt, first.createdAt);
  assert.equal(second.status, "managed");
  assert.equal(second.observed.status, "RUNNING");
  assert.equal(second.history.length, 1);
});

test("VM record store removes legacy 3X-UI credentials before persistence and reads", async (t) => {
  const { rootDir, store } = await withStore(t);
  const saved = await store.save({
    status: "managed",
    identity: identityA,
    desired: {},
    nodeResult: {
      type: "three_x_ui",
      panel: { url: "https://panel.example", username: "admin", password: "legacy-secret", apiToken: "legacy-token" }
    }
  });

  assert.equal(saved.nodeResult.panel.credentialsAvailable, true);
  assert.equal(Object.hasOwn(saved.nodeResult.panel, "password"), false);
  assert.doesNotMatch(await readFile(path.join(rootDir, saved.id, "record.json"), "utf8"), /legacy-secret|legacy-token/);
  assert.equal((await store.get(saved.id)).nodeResult.panel.credentialsAvailable, true);
});

test("VM record store lists records inside an exact account and project scope", async (t) => {
  const { store } = await withStore(t);
  await store.save({ status: "draft", identity: identityA, desired: {} });
  await store.save({
    status: "cloud",
    identity: { ...identityA, configuration: "acct-b", account: "b@example.com", projectId: "project-b", name: "vm-b" },
    desired: {}
  });

  assert.deepEqual((await store.list({ account: "a@example.com" })).map((item) => item.identity.name), ["vm-a"]);
  assert.deepEqual((await store.list({ projectId: "project-b" })).map((item) => item.identity.name), ["vm-b"]);
  assert.equal((await store.list()).length, 2);
});

test("VM record store rejects malformed records and unsafe IDs", async (t) => {
  const { store } = await withStore(t);
  await assert.rejects(() => store.save({ status: "unknown", identity: identityA, desired: {} }), /valid record status/);
  await assert.rejects(() => store.get("../record"), /valid record id/);
  await assert.rejects(() => store.remove("/tmp/record"), /valid record id/);
});

test("VM record store removes only the local record directory", async (t) => {
  const { store } = await withStore(t);
  const saved = await store.save({ status: "draft", identity: identityA, desired: {} });

  assert.equal(await store.remove(saved.id), true);
  assert.equal(await store.get(saved.id), null);
  assert.equal(await store.remove(saved.id), false);
});
