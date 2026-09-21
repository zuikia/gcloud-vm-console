import assert from "node:assert/strict";
import * as nodeFs from "node:fs";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { createJobStore } from "../server/job-store.js";

function tempRoot(t, prefix = "gcp-job-store-") {
  const rootDir = mkdtempSync(path.join(tmpdir(), prefix));
  t.after(() => rmSync(rootDir, { recursive: true, force: true }));
  return rootDir;
}

function mutableClock(initial = "2026-07-12T12:00:00.000Z") {
  let value = initial;
  return {
    now: () => value,
    set(next) {
      value = next;
    }
  };
}

function failingRenameFileSystem() {
  let shouldFail = false;
  return {
    fileSystem: new Proxy(nodeFs, {
      get(target, property) {
        if (property === "renameSync") {
          return (...args) => {
            if (shouldFail) {
              const error = new Error("disk full");
              error.code = "ENOSPC";
              throw error;
            }
            return target.renameSync(...args);
          };
        }
        const value = target[property];
        return typeof value === "function" ? value.bind(target) : value;
      }
    }),
    fail() {
      shouldFail = true;
    },
    recover() {
      shouldFail = false;
    }
  };
}

test("job store creates and updates structured task records", (t) => {
  const rootDir = tempRoot(t);
  const store = createJobStore({ rootDir, now: () => "2026-06-17T12:00:00.000Z" });

  const job = store.create({ type: "execute-preview", recordId: "vm-a-123", lockKey: "acct::project::zone::vm-a" });
  store.setStage(job.id, { name: "fingerprint_check", status: "running", detail: "Checking saved preview" });
  store.finish(job.id, { status: "succeeded", result: { status: "succeeded" } });

  assert.equal(job.id, "job-000001");
  assert.deepEqual(store.get(job.id), {
    schemaVersion: 1,
    id: "job-000001",
    type: "execute-preview",
    recordId: "vm-a-123",
    lockKey: "acct::project::zone::vm-a",
    status: "succeeded",
    stages: [{ name: "fingerprint_check", status: "succeeded", detail: "Checking saved preview", at: "2026-06-17T12:00:00.000Z" }],
    result: { status: "succeeded" },
    error: null,
    interruption: null,
    createdAt: "2026-06-17T12:00:00.000Z",
    updatedAt: "2026-06-17T12:00:00.000Z"
  });
  assert.equal(JSON.parse(readFileSync(path.join(rootDir, "job-000001.json"), "utf8")).status, "succeeded");
  assert.equal(statSync(rootDir).mode & 0o777, 0o700);
  assert.equal(statSync(path.join(rootDir, "job-000001.json")).mode & 0o777, 0o600);
});

test("job store rejects duplicate active jobs for the same lock key and releases after failure", (t) => {
  const store = createJobStore({ rootDir: tempRoot(t), now: () => "2026-06-17T12:00:00.000Z" });

  const first = store.create({ type: "node-pipeline", recordId: "vm-a-123", lockKey: "same-vm" });

  assert.throws(
    () => store.create({ type: "node-pipeline", recordId: "vm-a-123", lockKey: "same-vm" }),
    /already running/
  );
  store.setStage(first.id, { name: "install", status: "running", detail: "Installing" });
  store.fail(first.id, new Error("boom"));
  const second = store.create({ type: "node-pipeline", recordId: "vm-a-123", lockKey: "same-vm" });

  assert.equal(store.get(first.id).status, "failed");
  assert.equal(store.get(first.id).error, "boom");
  assert.equal(store.get(first.id).stages[0].status, "failed");
  assert.equal(second.id, "job-000002");
});

test("terminal jobs survive restart with stages errors results and node links", (t) => {
  const rootDir = tempRoot(t);
  const clock = mutableClock();
  const firstStore = createJobStore({ rootDir, now: clock.now });
  const succeeded = firstStore.create({ type: "node-deploy", recordId: "record-a", lockKey: "vm-a" });
  firstStore.setStage(succeeded.id, { name: "collect", status: "running", detail: "Collect result" });
  firstStore.finish(succeeded.id, {
    result: {
      nodeResult: {
        type: "singbox_plus",
        links: [{ name: "tuic-v5", url: "tuic://local-sensitive-result" }]
      }
    }
  });
  clock.set("2026-07-12T12:01:00.000Z");
  const failed = firstStore.create({ type: "verification", recordId: "record-a", lockKey: "vm-a" });
  firstStore.fail(failed.id, new Error("Permission denied"));

  const restarted = createJobStore({ rootDir, now: () => "2026-07-12T12:02:00.000Z" });

  assert.equal(restarted.get(succeeded.id).result.nodeResult.links[0].url, "tuic://local-sensitive-result");
  assert.equal(restarted.get(succeeded.id).stages[0].name, "collect");
  assert.equal(restarted.get(failed.id).status, "failed");
  assert.equal(restarted.get(failed.id).error, "Permission denied");
});

test("restart repairs legacy terminal jobs that still contain active stages", (t) => {
  const rootDir = tempRoot(t);
  const firstStore = createJobStore({ rootDir, now: () => "2026-07-12T12:00:00.000Z" });
  const job = firstStore.create({ type: "verification", recordId: "record-a", lockKey: "vm-a" });
  firstStore.setStage(job.id, { name: "verification", status: "running", detail: "Checking runtime" });

  const filePath = path.join(rootDir, `${job.id}.json`);
  const legacy = JSON.parse(readFileSync(filePath, "utf8"));
  legacy.status = "partial";
  legacy.result = { status: "partial" };
  writeFileSync(filePath, `${JSON.stringify(legacy, null, 2)}\n`, { mode: 0o600 });

  const restarted = createJobStore({ rootDir, now: () => "2026-07-12T12:05:00.000Z" });
  const repaired = restarted.get(job.id);
  const persisted = JSON.parse(readFileSync(filePath, "utf8"));

  assert.equal(repaired.status, "partial");
  assert.equal(repaired.stages[0].status, "partial");
  assert.equal(persisted.stages[0].status, "partial");
  assert.equal(restarted.storageInfo().recoveredInterrupted, 0);
});

test("restart converts active jobs to interrupted releases locks and continues ids", (t) => {
  const rootDir = tempRoot(t);
  const firstStore = createJobStore({ rootDir, now: () => "2026-07-12T12:00:00.000Z" });
  const running = firstStore.create({ type: "maintenance-system-update", recordId: "record-a", lockKey: "vm-a" });
  firstStore.setStage(running.id, { name: "system_update", status: "running", detail: "Updating packages" });

  const restarted = createJobStore({ rootDir, now: () => "2026-07-12T12:05:00.000Z" });
  const recovered = restarted.get(running.id);
  const next = restarted.create({ type: "maintenance-status", recordId: "record-a", lockKey: "vm-a" });

  assert.equal(recovered.status, "interrupted");
  assert.deepEqual(recovered.interruption, {
    reason: "server_restart",
    previousStatus: "running",
    detectedAt: "2026-07-12T12:05:00.000Z"
  });
  assert.equal(recovered.stages.at(-1).name, "restart_recovery");
  assert.equal(recovered.stages.at(-1).status, "interrupted");
  assert.match(recovered.stages.at(-1).detail, /未自动续跑/);
  assert.equal(next.id, "job-000002");
  assert.equal(restarted.storageInfo().recoveredInterrupted, 1);
});

test("job retention keeps active jobs and prunes terminal jobs by count and age", (t) => {
  const countRoot = tempRoot(t, "gcp-job-count-");
  const clock = mutableClock("2026-07-12T10:00:00.000Z");
  const store = createJobStore({ rootDir: countRoot, now: clock.now, maxJobs: 2, maxAgeDays: 30 });
  for (let index = 0; index < 3; index += 1) {
    clock.set(`2026-07-12T10:0${index}:00.000Z`);
    const job = store.create({ type: "maintenance-status", recordId: `record-${index}`, lockKey: `vm-${index}` });
    store.finish(job.id, { result: { index } });
  }
  const active = store.create({ type: "maintenance-status", recordId: "active", lockKey: "active-vm" });

  assert.deepEqual(store.list().filter((job) => job.status !== "running").map((job) => job.id), ["job-000002", "job-000003"]);
  assert.equal(store.get(active.id).status, "running");
  assert.equal(store.storageInfo().pruned, 1);

  const ageRoot = tempRoot(t, "gcp-job-age-");
  const oldStore = createJobStore({ rootDir: ageRoot, now: () => "2026-05-01T00:00:00.000Z" });
  const oldJob = oldStore.create({ type: "maintenance-status", recordId: "old", lockKey: "old-vm" });
  oldStore.finish(oldJob.id, { result: { old: true } });
  const agePruned = createJobStore({ rootDir: ageRoot, now: () => "2026-07-12T00:00:00.000Z", maxAgeDays: 30 });

  assert.equal(agePruned.get(oldJob.id), null);
  assert.equal(agePruned.storageInfo().pruned, 1);
});

test("job store quarantines malformed records without reusing numeric ids", (t) => {
  const rootDir = tempRoot(t);
  mkdirSync(rootDir, { recursive: true, mode: 0o700 });
  writeFileSync(path.join(rootDir, "job-000009.json"), "{not-json", { mode: 0o600 });
  writeFileSync(path.join(rootDir, "job-invalid.json"), JSON.stringify({ schemaVersion: 1 }), { mode: 0o600 });

  const store = createJobStore({ rootDir, now: () => "2026-07-12T12:00:00.000Z" });
  const next = store.create({ type: "maintenance-status", recordId: "record-a", lockKey: "vm-a" });
  const quarantine = readdirSync(path.join(rootDir, "quarantine"));

  assert.equal(next.id, "job-000010");
  assert.equal(store.storageInfo().quarantined, 2);
  assert.equal(quarantine.length, 2);
  assert.equal(quarantine.every((name) => !name.includes("not-json")), true);
});

test("pre-operation persistence failure stops job creation", (t) => {
  const failing = failingRenameFileSystem();
  const store = createJobStore({ rootDir: tempRoot(t), fileSystem: failing.fileSystem });
  failing.fail();

  assert.throws(
    () => store.create({ type: "maintenance-restart", recordId: "record-a", lockKey: "vm-a" }),
    /local task history/i
  );
  assert.deepEqual(store.list(), []);
});

test("terminal persistence failure keeps the actual outcome and reports local history degradation", (t) => {
  const rootDir = tempRoot(t);
  const failing = failingRenameFileSystem();
  const store = createJobStore({ rootDir, fileSystem: failing.fileSystem, now: () => "2026-07-12T12:00:00.000Z" });
  const job = store.create({ type: "maintenance-status", recordId: "record-a", lockKey: "vm-a" });
  failing.fail();

  const finished = store.finish(job.id, { status: "succeeded", result: { status: "RUNNING" } });

  assert.equal(finished.status, "succeeded");
  assert.equal(finished.result.status, "RUNNING");
  assert.equal(finished.storageStatus, "degraded");
  assert.match(finished.storageWarning, /本地任务历史保存失败/);
  assert.equal(store.storageInfo().degradedWrites, 1);

  failing.recover();
  const restarted = createJobStore({ rootDir, now: () => "2026-07-12T12:05:00.000Z" });
  assert.equal(restarted.get(job.id).status, "interrupted");
  assert.notEqual(restarted.get(job.id).status, "failed");
});
