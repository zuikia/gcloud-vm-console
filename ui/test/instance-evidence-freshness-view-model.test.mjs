import assert from "node:assert/strict";
import test from "node:test";

import { evidenceFreshness, toInstanceEvidenceView } from "../public/lib/instance-evidence-freshness-view-model.js";

const NOW = "2026-07-10T12:00:00.000Z";

test("evidence freshness honors exact boundaries", () => {
  assert.equal(evidenceFreshness("2026-07-10T11:45:00.000Z", { now: NOW }), "fresh");
  assert.equal(evidenceFreshness("2026-07-10T11:44:59.999Z", { now: NOW }), "aging");
  assert.equal(evidenceFreshness("2026-07-10T06:00:00.000Z", { now: NOW }), "aging");
  assert.equal(evidenceFreshness("2026-07-10T05:59:59.999Z", { now: NOW }), "stale");
});

test("invalid timestamps are unknown and future clock skew is fresh", () => {
  assert.equal(evidenceFreshness("", { now: NOW }), "unknown");
  assert.equal(evidenceFreshness("not-a-date", { now: NOW }), "unknown");
  assert.equal(evidenceFreshness("2026-07-10T12:03:00.000Z", { now: NOW }), "fresh");
});

test("newer successful probe independently beats stale verification", () => {
  const view = toInstanceEvidenceView({
    now: NOW,
    verification: {
      status: "passed", checkedAt: "2026-07-10T03:00:00.000Z", method: "three_x_ui",
      ssh: { desiredPort: 45400, actualPort: 22, verified: true, fallback: true },
      bbr: { enabled: false, congestionControl: "cubic" },
      firewall: { status: "matched" }, services: [{ name: "x-ui", status: "active" }]
    },
    recognitionPreview: {
      checkedAt: "2026-07-10T11:58:00.000Z",
      recognition: {
        method: "singbox_plus", confidence: "high",
        probes: {
          ssh: { desiredPort: 45400, actualPort: 45400, verified: true, fallback: false },
          bbr: { enabled: true, congestionControl: "bbr", qdisc: "fq" },
          firewall: { status: "overexposed", broadRuleNames: ["ruzhan1"] },
          services: [{ name: "sing-box", status: "active" }]
        }
      }
    }
  });
  for (const field of ["ssh", "bbr", "firewall", "services", "method"]) {
    assert.equal(view[field].source, "recognition");
    assert.equal(view[field].freshness, "fresh");
    assert.equal(view[field].historical, false);
  }
  assert.equal(view.ssh.value.actualPort, 45400);
  assert.equal(view.bbr.value.enabled, true);
  assert.equal(view.firewall.value.status, "overexposed");
  assert.equal(view.services.value[0].name, "sing-box");
  assert.equal(view.method.value, "singbox_plus");
});

test("stale probe cannot override user-confirmed intent", () => {
  const view = toInstanceEvidenceView({
    now: NOW,
    observed: { methodIntent: { method: "three_x_ui", source: "user_confirmed", checkedAt: "2026-07-09T12:00:00.000Z" } },
    recognitionPreview: {
      checkedAt: "2026-07-10T03:00:00.000Z",
      recognition: { method: "singbox_plus", confidence: "high", probes: {} }
    }
  });
  assert.equal(view.method.value, "three_x_ui");
  assert.equal(view.method.source, "user_confirmed");
});

test("fresh high-confidence verification from SSH deep probe overrides older persisted intent", () => {
  const view = toInstanceEvidenceView({
    now: NOW,
    verification: {
      status: "passed",
      checkedAt: "2026-07-10T11:59:00.000Z",
      method: "three_x_ui",
      methodConfidence: "high",
      methodSource: "ssh_deep_probe",
      services: [{ name: "x-ui", status: "active" }]
    },
    observed: {
      methodIntent: {
        method: "vm_only",
        source: "persisted",
        checkedAt: "2026-07-10T10:00:00.000Z"
      }
    }
  });
  assert.equal(view.method.value, "three_x_ui");
  assert.equal(view.method.source, "verification");
});

test("failed latest attempt preserves usable values but marks them historical", () => {
  const view = toInstanceEvidenceView({
    now: NOW,
    verification: {
      status: "passed", checkedAt: "2026-07-10T11:40:00.000Z", method: "singbox_plus",
      ssh: { desiredPort: 45400, actualPort: 45400, verified: true }, bbr: { enabled: true },
      firewall: { status: "overexposed" }, services: [{ name: "sing-box", status: "active" }]
    },
    lastProbeAttempt: { status: "failed", checkedAt: "2026-07-10T11:59:00.000Z", category: "ssh_unreachable", message: "SSH 连接失败" }
  });
  assert.equal(view.ssh.value.actualPort, 45400);
  assert.equal(view.ssh.historical, true);
  assert.notEqual(view.ssh.tone, "success");
  assert.equal(view.latestAttempt.status, "failed");
  assert.equal(view.diagnosisRecommended, true);
});

test("serialized evidence excludes secrets and raw output", () => {
  const view = toInstanceEvidenceView({
    now: NOW,
    recognitionPreview: {
      checkedAt: "2026-07-10T11:59:00.000Z", rawOutput: "token=secret-token vmess://secret",
      recognition: {
        method: "three_x_ui", confidence: "high", password: "panel-secret",
        probes: {
          ssh: { desiredPort: 45400, actualPort: 45400, verified: true, privateKey: "PRIVATE KEY", rawOutput: "remote-secret" },
          services: [{ name: "x-ui", status: "active", token: "service-secret" }]
        }
      }
    },
    lastProbeAttempt: {
      status: "failed", checkedAt: "2026-07-10T12:00:00.000Z",
      message: "password=hunter2 token=abc vmess://secret", rawOutput: "full remote output"
    }
  });
  const serialized = JSON.stringify(view);
  for (const secret of ["secret-token", "vmess://", "panel-secret", "PRIVATE KEY", "remote-secret", "service-secret", "hunter2", "full remote output"]) {
    assert.equal(serialized.includes(secret), false);
  }
});

test("firewall evidence derives broad rule names from allow-all exposure summaries", () => {
  const view = toInstanceEvidenceView({
    now: NOW,
    verification: {
      status: "partial",
      checkedAt: "2026-07-10T11:59:00.000Z",
      firewall: {
        status: "overexposed",
        exposedPorts: [
          { protocol: "all", port: "all", rule: "ruzhan1" },
          { protocol: "icmp", port: "all", rule: "default-allow-icmp" }
        ]
      }
    }
  });
  assert.deepEqual(view.firewall.value.broadRuleNames, ["ruzhan1"]);
});
