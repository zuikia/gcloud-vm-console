import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("instance UI owns network exposure through one compact entry and no legacy repair button", async () => {
  const [html, app, styles, policy, readiness] = await Promise.all([
    readFile(path.join(root, "public/index.html"), "utf8"),
    readFile(path.join(root, "public/app.js"), "utf8"),
    readFile(path.join(root, "public/styles.css"), "utf8"),
    readFile(path.join(root, "public/lib/action-policy.js"), "utf8"),
    readFile(path.join(root, "public/lib/action-readiness-view-model.js"), "utf8")
  ]);

  assert.match(html, /id="manageNetworkExposure"[^>]*>管理端口与 SSH</);
  assert.match(html, /id="networkExposureDialog"/);
  assert.match(html, /id="networkExposurePortList"/);
  assert.match(app, /network-exposure-preview-rows/);
  assert.match(html, /id="sshUnifiedPassword"[^>]*type="password"/);
  assert.doesNotMatch(html, /id="applyOwnedFirewall"/);
  assert.equal((html.match(/id="manageNetworkExposure"/g) || []).length, 1);
  assert.match(app, /network-exposure\/preview/);
  assert.match(app, /network-exposure\/apply/);
  assert.match(policy, /applyNetworkExposure[\s\S]*confirmation:\s*"typed"/);
  assert.match(readiness, /manageNetworkExposure/);
  assert.match(styles, /\.network-exposure-dialog/);
  assert.match(styles, /\.network-exposure-preview-rows/);
  assert.match(styles, /@media \(max-width: 680px\)[\s\S]*\.network-exposure/);
});
