import assert from "node:assert/strict";
import test from "node:test";

import { mergeVerificationEvidence, toProbeAttempt } from "../server/probe-attempt-policy.js";

const checkedAt = "2026-07-10T12:00:00.000Z";

test("probe attempt policy normalizes passed, partial and thrown failures", () => {
  assert.deepEqual(toProbeAttempt({ status: "passed", ssh: { verified: true } }, { checkedAt, method: "singbox_plus" }), {
    status: "passed", checkedAt, method: "singbox_plus", evidenceAvailable: true, category: "", message: ""
  });
  assert.equal(toProbeAttempt({ status: "partial", bbr: { enabled: true } }, { checkedAt }).evidenceAvailable, true);
  const failed = toProbeAttempt(new Error("token=secret remote output\nsecond line"), { checkedAt, method: "three_x_ui" });
  assert.equal(failed.status, "failed");
  assert.equal(failed.category, "probe_error");
  assert.equal(JSON.stringify(failed).includes("secret"), false);
});

test("usable passed or partial evidence replaces verification and records latest attempt", () => {
  const record = { verification: { status: "passed", checkedAt: "2026-07-09T12:00:00.000Z", method: "vm_only" }, observed: {} };
  const result = { status: "partial", checkedAt, method: "singbox_plus", ssh: { verified: true, actualPort: 45400 }, warnings: ["firewall partial"] };
  const merged = mergeVerificationEvidence(record, result);
  assert.equal(merged.verification, result);
  assert.equal(merged.observed.lastProbeAttempt.status, "partial");
  assert.equal(merged.historyEntry.status, "partial");
});

test("failed attempt with parsed usable evidence replaces verification", () => {
  const result = { status: "failed", checkedAt, method: "three_x_ui", services: [{ name: "x-ui", status: "active" }] };
  const merged = mergeVerificationEvidence({ verification: null, observed: {} }, result);
  assert.equal(merged.verification, result);
  assert.equal(merged.observed.lastProbeAttempt.evidenceAvailable, true);
});

test("unusable failure preserves previous verification and stores only sanitized attempt summary", () => {
  const previous = { status: "passed", checkedAt: "2026-07-10T11:00:00.000Z", method: "singbox_plus", ssh: { verified: true } };
  const record = { verification: previous, observed: { sshConnection: previous.ssh } };
  const failure = { status: "failed", checkedAt, method: "singbox_plus", errorCategory: "ssh", error: "password=hunter2\nfull remote output" };
  const merged = mergeVerificationEvidence(record, failure);
  assert.equal(merged.verification, previous);
  assert.equal(merged.observed.sshConnection, previous.ssh);
  assert.deepEqual(Object.keys(merged.observed.lastProbeAttempt).sort(), ["category", "checkedAt", "evidenceAvailable", "message", "method", "status"]);
  assert.equal(JSON.stringify(merged).includes("hunter2"), false);
});
