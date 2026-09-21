import assert from "node:assert/strict";
import test from "node:test";

import { toFirewallGovernanceView } from "../public/lib/firewall-governance-view-model.js";

test("firewall governance view stays absent without an assessment", () => {
  assert.deepEqual(toFirewallGovernanceView(null), { visible: false, canApply: false, rows: [], ruleNames: [], overflowCount: 0 });
});

test("firewall governance view exposes a compact pending state when instance evidence already shows risk", () => {
  const view = toFirewallGovernanceView(null, {
    fallbackStatus: {
      id: "firewall",
      value: "过度开放",
      tone: "danger",
      detail: "过度开放",
      source: "verification"
    }
  });

  assert.equal(view.visible, true);
  assert.equal(view.pending, true);
  assert.equal(view.canApply, false);
  assert.equal(view.tone, "danger");
  assert.equal(view.rows.length, 3);
  assert.equal(view.rows[0].value, "过度开放");
  assert.equal(view.rows[0].detail, "实例级防火墙状态已读取");
  assert.equal(view.rows[1].value, "待分析");
  assert.match(view.rows[1].detail, /只读探测/);
  assert.match(view.rows[2].detail, /外部共享规则/);
});

test("firewall governance view compacts critical external findings and owned actions", () => {
  const view = toFirewallGovernanceView({
    checkedAt: "2026-07-14T12:00:00.000Z",
    expiresAt: "2026-07-14T12:15:00.000Z",
    fingerprint: "abc",
    severity: "critical",
    findings: [
      { name: "default-allow-ssh", severity: "high", ownership: "external" },
      { name: "ruzhan1", severity: "critical", ownership: "external" },
      { name: "default-allow-rdp", severity: "high", ownership: "external" },
      { name: "fourth-rule", severity: "warning", ownership: "external" }
    ],
    affectedInstances: ["vm-a", "vm-b", "vm-c", "vm-d", "vm-e"],
    coverage: { ready: true, uniqueTag: "vm-a", freshness: "fresh", blockedReason: "" },
    ownedActions: [{ name: "gvc-vm-a-ssh-iap-tcp", ports: ["22", "45400"] }],
    externalActions: [{ ruleName: "ruzhan1" }]
  }, { now: "2026-07-14T12:05:00.000Z" });

  assert.equal(view.visible, true);
  assert.equal(view.tone, "danger");
  assert.equal(view.canApply, false);
  assert.equal(view.hasOwnedGaps, true);
  assert.deepEqual(view.ruleNames, ["ruzhan1", "default-allow-ssh", "default-allow-rdp"]);
  assert.equal(view.overflowCount, 1);
  assert.match(view.rows[0].value, /严重/);
  assert.match(view.rows[1].value, /5 台/);
  assert.match(view.rows[2].value, /1 项自有规则待治理/);
});

test("firewall governance view fails closed for expired previews and redacts unsafe names", () => {
  const view = toFirewallGovernanceView({
    expiresAt: "2026-07-14T11:00:00.000Z",
    severity: "high",
    findings: [{ name: "token=secret vless://raw", severity: "high", ownership: "external" }],
    affectedInstances: ["vm-a"],
    coverage: { ready: true, freshness: "fresh", blockedReason: "" },
    ownedActions: [{ name: "unsafe" }],
    externalActions: []
  }, { now: "2026-07-14T12:05:00.000Z" });

  assert.equal(view.canApply, false);
  assert.equal(view.expired, true);
  assert.doesNotMatch(JSON.stringify(view), /secret|vless:\/\//);
});
