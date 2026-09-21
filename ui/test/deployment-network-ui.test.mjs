import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const index = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
const app = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
const styles = await readFile(new URL("../public/styles.css", import.meta.url), "utf8");

test("create form exposes one compact network profile owner outside advanced settings", () => {
  const publicIp = index.match(/<select id="externalIpMode"[\s\S]*?<\/select>/)?.[0] || "";
  const tier = index.match(/<select id="networkTier"[\s\S]*?<\/select>/)?.[0] || "";
  const nic = index.match(/<select id="nicType"[\s\S]*?<\/select>/)?.[0] || "";
  const profilePosition = index.indexOf('id="networkProfileSection"');
  const advancedPosition = index.indexOf('class="form-section config-advanced"');

  assert.ok(profilePosition > 0 && profilePosition < advancedPosition);
  assert.match(publicIp, /value="static"[^>]*selected/);
  assert.match(publicIp, /value="ephemeral"/);
  assert.match(publicIp, /value="none"/);
  assert.match(tier, /value="PREMIUM"[^>]*selected/);
  assert.match(tier, /value="STANDARD"/);
  assert.match(nic, /value="GVNIC"[^>]*selected/);
  assert.match(nic, /value="VIRTIO_NET"/);
  assert.match(index, /id="staticAddressName"/);
  assert.match(index, /id="networkProfileHint"/);
});

test("create form reads network choices into desired state and invalidates previews on change", () => {
  assert.match(app, /externalIpMode:\s*\$\("#externalIpMode"\)\.value/);
  assert.match(app, /networkTier:\s*\$\("#networkTier"\)\.value/);
  assert.match(app, /nicType:\s*\$\("#nicType"\)\.value/);
  assert.match(app, /updateNetworkProfileFields/);
  assert.match(app, /configValid/);
  assert.doesNotMatch(app, /externalIpMode:\s*"ephemeral",\s*\n\s*networkTier:\s*"PREMIUM"/);
});

test("network profile stays compact and responsive", () => {
  assert.match(styles, /\.network-profile-grid/);
  assert.match(styles, /\.network-profile-hint/);
  assert.match(styles, /@media \(max-width: 767px\)[\s\S]*\.network-profile-grid/);
});
