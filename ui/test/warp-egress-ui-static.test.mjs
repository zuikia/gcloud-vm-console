import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const index = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
const app = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
const styles = await readFile(new URL("../public/styles.css", import.meta.url), "utf8");

test("WARP management has one compact owner inside node results", () => {
  const nodeStart = index.indexOf('id="nodeResultsDetails"');
  const dangerStart = index.indexOf('class="danger-zone instance-disclosure"');
  for (const id of ["warpEgressRow", "manageWarpEgress"]) {
    const position = index.indexOf(`id="${id}"`);
    assert.ok(position > nodeStart && position < dangerStart, `${id} must stay inside node results`);
  }
  assert.equal([...index.matchAll(/data-instance-status="warp"/g)].length, 0);
  assert.equal([...index.matchAll(/id="manageWarpEgress"/g)].length, 1);
  assert.equal([...index.matchAll(/id="refreshWarpStatus"/g)].length, 1);
  assert.equal([...index.matchAll(/id="reconnectWarpEgress"/g)].length, 1);
});

test("WARP dialog uses progressive disclosure and only two operation buttons", () => {
  assert.match(index, /<dialog id="warpEgressDialog"[^>]*aria-labelledby="warpEgressTitle"/);
  assert.match(index, /id="warpIpv4"/);
  assert.match(index, /id="warpIpv6"/);
  assert.match(index, /id="warpProtocol"/);
  assert.match(index, /id="warpProxyPort"/);
  assert.match(index, /id="warpAffectedNodes"/);
  assert.match(index, /仅 WARP 节点预计中断 10–60 秒；直连节点、SSH 和节点链接不受影响/);
  assert.doesNotMatch(index, /旋转.*密钥|切换.*MASQUE|切换.*WireGuard|重启 WARP 服务/);
});

test("WARP requests are explicit button actions and never run during boot or routing", () => {
  assert.match(app, /warp-egress-view-model\.js/);
  assert.match(app, /#refreshWarpStatus/);
  assert.match(app, /#reconnectWarpEgress/);
  assert.match(app, /\/warp\/status/);
  assert.match(app, /\/warp\/reconnect/);
  const boot = app.match(/async function boot\(\) \{[\s\S]*?\n\}/)?.[0] || "";
  const route = app.match(/function showRoute\([^)]*\) \{[\s\S]*?\n\}/)?.[0] || "";
  assert.doesNotMatch(boot, /warp\/status|warp\/reconnect|refreshWarpStatus/);
  assert.doesNotMatch(route, /warp\/status|warp\/reconnect|refreshWarpStatus/);
});

test("WARP UI contains long values and keeps 390px controls touchable", () => {
  assert.match(styles, /\.warp-egress-row \{[\s\S]*?min-width: 0;/);
  assert.match(styles, /\.warp-egress-facts[\s\S]*?minmax\(0, 1fr\)/);
  assert.match(styles, /\.warp-egress-value[\s\S]*?overflow-wrap: anywhere/);
  assert.match(styles, /@media \(max-width: 430px\)[\s\S]*?\.warp-egress-dialog[\s\S]*?width: calc\(100vw - 16px\)/);
  assert.match(styles, /\.warp-egress-actions button[\s\S]*?min-height: 44px/);
});
