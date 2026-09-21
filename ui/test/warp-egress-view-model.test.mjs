import assert from "node:assert/strict";
import test from "node:test";

import { toWarpEgressView } from "../public/lib/warp-egress-view-model.js";

const baseRecord = {
  nodeResult: {
    links: [
      { name: "hy2-obfs-warp", url: "hysteria2://secret" },
      { name: "tuic-v5-warp", url: "tuic://secret" },
      { name: "hy2-obfs", url: "hysteria2://direct" }
    ]
  }
};

test("WARP view exposes one compact candidate row before the first explicit check", () => {
  const view = toWarpEgressView(baseRecord, { now: "2026-07-30T12:00:00.000Z" });

  assert.equal(view.visible, true);
  assert.equal(view.statusLabel, "待检测");
  assert.equal(view.manageLabel, "管理");
  assert.equal(view.reconnectEnabled, false);
  assert.equal(view.affectedCount, 2);
  assert.doesNotMatch(JSON.stringify(view), /hysteria2:\/\/|tuic:\/\//);
});

test("WARP view keeps IPv4 primary and reports IPv6 independently", () => {
  const view = toWarpEgressView({
    ...baseRecord,
    observed: {
      warp: {
        supported: true,
        status: "connected",
        mode: "proxy",
        protocol: "masque",
        proxyPort: 40000,
        tier: "free",
        ipv4: "203.0.113.13",
        ipv6: "",
        colo: { ipv4: "KIX", ipv6: "" },
        affectedNodes: { count: 2, names: ["hy2-obfs-warp", "tuic-v5-warp"] },
        checkedAt: "2026-07-30T11:58:00.000Z",
        lastProbeAttempt: { status: "succeeded", checkedAt: "2026-07-30T11:58:00.000Z" }
      }
    }
  }, { now: "2026-07-30T12:00:00.000Z" });

  assert.equal(view.statusLabel, "已连接");
  assert.equal(view.ipv4, "203.0.113.13");
  assert.equal(view.ipv6, "未获取");
  assert.equal(view.protocolLabel, "MASQUE");
  assert.equal(view.coloLabel, "KIX");
  assert.equal(view.reconnectLabel, "重连并尝试换 IP");
  assert.equal(view.reconnectEnabled, true);
});

test("WARP view offers one manual retry after an unchanged reconnect", () => {
  const view = toWarpEgressView({
    ...baseRecord,
    observed: {
      warp: {
        supported: true,
        status: "connected",
        ipv4: "203.0.113.13",
        checkedAt: "2026-07-30T12:00:00.000Z",
        lastReconnect: { outcome: "unchanged", completedAt: "2026-07-30T12:00:00.000Z" }
      }
    }
  }, { now: "2026-07-30T12:01:00.000Z" });

  assert.equal(view.reconnectLabel, "再试一次");
  assert.match(view.resultMessage, /未变化/);
});

test("WARP view remains absent without node service or observed WARP evidence", () => {
  const view = toWarpEgressView({ nodeResult: { links: [{ name: "tuic-v5", url: "tuic://direct" }] } });
  assert.equal(view.visible, false);
});

test("WARP view retains historical state when the latest probe failed", () => {
  const view = toWarpEgressView({
    ...baseRecord,
    observed: {
      warp: {
        supported: true,
        status: "connected",
        ipv4: "2001:db8::invalid",
        checkedAt: "2026-07-30T05:00:00.000Z",
        lastProbeAttempt: {
          status: "failed",
          checkedAt: "2026-07-30T12:00:00.000Z",
          error: "SSH 连接失败"
        }
      }
    }
  }, { now: "2026-07-30T12:01:00.000Z" });

  assert.equal(view.historical, true);
  assert.match(view.latestAttemptMessage, /检测失败/);
  assert.equal(view.ipv4, "未获取");
});
