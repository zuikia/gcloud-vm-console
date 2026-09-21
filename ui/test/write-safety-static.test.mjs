import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const app = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
const router = readFileSync(new URL("../server/router.js", import.meta.url), "utf8");
const governance = readFileSync(new URL("../server/firewall-governance-service.js", import.meta.url), "utf8");
const gitignore = readFileSync(new URL("../../.gitignore", import.meta.url), "utf8");

test("runtime keeps cloud delete disabled and absent", () => {
  assert.doesNotMatch(router, /delete-cloud|instances",\s*"delete"|instances delete/);
  assert.match(app, /云端删除流程当前未开放/);
});

test("runtime has no window confirm shortcut", () => {
  assert.doesNotMatch(app, /window\.confirm|confirm\(/);
});

test("local console records jobs and node results stay outside version control", () => {
  assert.match(gitignore, /^\.gcp-vm-console\/$/m);
});

test("firewall governance is read-only and never exposes a legacy mutation method", () => {
  assert.doesNotMatch(governance, /applyOwned|firewallService\.ensureOwnedRule/);
  assert.doesNotMatch(governance, /firewallService\.(?:delete|disable|remove|updateExternal)/);
  assert.doesNotMatch(governance, /firewall-rules["',\s]+(?:delete|disable)/);
  assert.match(governance, /externalActions/);
});
