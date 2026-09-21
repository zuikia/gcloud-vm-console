import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createLocalSecretStore } from "../server/local-secret-store.js";

test("local SSH secret persists atomically with 0700/0600 permissions and public metadata only", async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "gvc-secret-"));
  t.after(async () => (await import("node:fs/promises")).rm(rootDir, { recursive: true, force: true }));
  const store = createLocalSecretStore({ rootDir, now: () => "2026-07-16T12:00:00.000Z" });

  assert.deepEqual(await store.publicStatus(), { configured: false, versionId: "", updatedAt: "" });
  const saved = await store.saveSshPassword("ValidPass9");
  const secret = await store.readSshPassword();
  const publicStatus = await store.publicStatus();

  assert.equal(secret.password, "ValidPass9");
  assert.equal(secret.versionId, saved.versionId);
  assert.deepEqual(publicStatus, {
    configured: true,
    versionId: saved.versionId,
    updatedAt: "2026-07-16T12:00:00.000Z"
  });
  assert.equal(JSON.stringify(publicStatus).includes("ValidPass9"), false);
  assert.equal(JSON.stringify(publicStatus).includes(rootDir), false);
  assert.equal((await stat(rootDir)).mode & 0o777, 0o700);
  assert.equal((await stat(path.join(rootDir, "ssh-auth.json"))).mode & 0o777, 0o600);
  assert.equal((await readdir(rootDir)).some((name) => name.endsWith(".tmp")), false);
});

test("local SSH secret rejects unsafe values and quarantines malformed storage without exposing content", async (t) => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "gvc-secret-"));
  t.after(async () => (await import("node:fs/promises")).rm(rootDir, { recursive: true, force: true }));
  const store = createLocalSecretStore({ rootDir });

  for (const value of ["short", "bad:password", "bad\npassword", `bad${String.fromCharCode(0)}password`, "x".repeat(129)]) {
    await assert.rejects(() => store.saveSshPassword(value), /password/i);
  }

  await store.saveSshPassword("ValidPass9");
  await writeFile(path.join(rootDir, "ssh-auth.json"), "password=must-not-leak broken", "utf8");
  await assert.rejects(() => store.readSshPassword(), /unavailable|invalid/i);
  const quarantine = await readdir(path.join(rootDir, "quarantine"));
  assert.equal(quarantine.length, 1);
  assert.equal(JSON.stringify(await store.publicStatus()).includes("must-not-leak"), false);
  assert.equal((await readFile(path.join(rootDir, "quarantine", quarantine[0]), "utf8")).includes("must-not-leak"), true);
});
