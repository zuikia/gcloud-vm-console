import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { cleanupCandidates, runLocalCleanup } from "../server/local-cleanup.js";

async function exists(target) {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "gcp-vm-cleanup-"));
  t.after(async () => {
    const { rm } = await import("node:fs/promises");
    await rm(root, { recursive: true, force: true });
  });
  const files = {
    output: path.join(root, "ui/output/result.json"),
    playwrightNpm: path.join(root, "ui/.playwright-cache/npm/cache.bin"),
    nodeGyp: path.join(root, "ui/.playwright-cache/home/Library/Caches/node-gyp/build.bin"),
    python: path.join(root, "ui/.playwright-cache/home/Library/Caches/com.apple.python/cache.pyc"),
    npm: path.join(root, "ui/.npm-cache/cache.bin"),
    browser: path.join(root, "ui/.playwright-cache/browsers/chromium/browser.bin"),
    record: path.join(root, ".gcp-vm-console/records/vm/record.json"),
    job: path.join(root, ".gcp-vm-console/jobs/job-000001.json"),
    legacy: path.join(root, ".gcp-vm-console/legacy-iac-archive/archive.tfstate"),
    credential: path.join(root, "credentials/private-key")
  };
  for (const [name, target] of Object.entries(files)) {
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, `${name}-payload`);
  }
  return { root, files };
}

test("cleanup candidate list is an explicit cache-only whitelist", () => {
  assert.deepEqual(cleanupCandidates(), [
    "ui/output",
    "ui/.playwright-cache/npm",
    "ui/.playwright-cache/home/Library/Caches/node-gyp",
    "ui/.playwright-cache/home/Library/Caches/com.apple.python",
    "ui/.npm-cache",
    "ui/.DS_Store",
    ".DS_Store"
  ]);
  assert.equal(cleanupCandidates().some((item) => item.includes("browsers") || item.includes(".gcp-vm-console")), false);
});

test("dry-run reports bytes without deleting cache or protected data", async (t) => {
  const { root, files } = await fixture(t);
  const report = await runLocalCleanup({ projectRoot: root });

  assert.equal(report.mode, "dry-run");
  assert.ok(report.potentialBytes > 0);
  assert.equal(report.reclaimedBytes, 0);
  for (const target of Object.values(files)) assert.equal(await exists(target), true, target);
});

test("apply removes only allowlisted artifacts and preserves protected data", async (t) => {
  const { root, files } = await fixture(t);
  const report = await runLocalCleanup({ projectRoot: root, apply: true });

  assert.equal(report.mode, "apply");
  assert.ok(report.reclaimedBytes > 0);
  for (const target of [files.output, files.playwrightNpm, files.nodeGyp, files.python, files.npm]) {
    assert.equal(await exists(target), false, target);
  }
  for (const target of [files.browser, files.record, files.job, files.legacy, files.credential]) {
    assert.equal(await exists(target), true, target);
  }
  assert.equal(await readFile(files.record, "utf8"), "record-payload");
});

test("symlink escape rejects the entire cleanup before any deletion", async (t) => {
  const { root, files } = await fixture(t);
  const outside = await mkdtemp(path.join(os.tmpdir(), "gcp-vm-cleanup-outside-"));
  t.after(async () => {
    const { rm } = await import("node:fs/promises");
    await rm(outside, { recursive: true, force: true });
  });
  await writeFile(path.join(outside, "keep.txt"), "outside");
  await symlink(outside, path.join(root, "ui/output/escape"));

  await assert.rejects(() => runLocalCleanup({ projectRoot: root, apply: true }), /symlink escape/i);
  assert.equal(await exists(files.output), true);
  assert.equal(await exists(files.npm), true);
  assert.equal(await exists(path.join(outside, "keep.txt")), true);
});
