import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPerformanceReport,
  countRequestWaves,
  compressionSavings,
  protectedPathViolations
} from "../server/performance-audit.js";

test("performance audit counts overlapping request waves and duplicate reads", () => {
  const report = buildPerformanceReport({
    requestEvents: [
      { name: "health", startedAt: 0, finishedAt: 20 },
      { name: "jobs", startedAt: 21, finishedAt: 30 },
      { name: "accounts", startedAt: 21, finishedAt: 40 },
      { name: "cloud-instances", startedAt: 41, finishedAt: 80 },
      { name: "doctor", startedAt: 41, finishedAt: 90 },
      { name: "doctor", startedAt: 91, finishedAt: 100 }
    ],
    gcloudCalls: ["instances.list", "instances.list", "doctor"],
    renderEvents: ["resources", "task", "resources"]
  });

  assert.equal(report.requestWaves, 4);
  assert.deepEqual(report.duplicateRequests, [{ name: "doctor", count: 2 }]);
  assert.deepEqual(report.duplicateGcloudCalls, [{ name: "instances.list", count: 2 }]);
  assert.deepEqual(report.renderCounts, { resources: 2, task: 1 });
});

test("performance audit reports compression savings without dividing by zero", () => {
  assert.equal(compressionSavings(1000, 400), 60);
  assert.equal(compressionSavings(0, 0), 0);
  assert.equal(compressionSavings(100, 120), -20);
});

test("performance audit rejects protected paths but permits generated artifacts", () => {
  const violations = protectedPathViolations([
    "/tmp/project/ui/output/playwright/a.png",
    "/tmp/project/.gcp-vm-console/records/record.json",
    "/tmp/project/.gcp-vm-console/jobs/job-1.json",
    "/tmp/project/.gcp-vm-console/legacy-iac-archive/old.tar",
    "/tmp/project/ui/.playwright-cache/browsers/chromium-1223"
  ], "/tmp/project");

  assert.deepEqual(violations, [
    "/tmp/project/.gcp-vm-console/records/record.json",
    "/tmp/project/.gcp-vm-console/jobs/job-1.json",
    "/tmp/project/.gcp-vm-console/legacy-iac-archive/old.tar",
    "/tmp/project/ui/.playwright-cache/browsers/chromium-1223"
  ]);
});

test("request wave helper handles empty and invalid events conservatively", () => {
  assert.equal(countRequestWaves([]), 0);
  assert.equal(countRequestWaves([{ name: "missing" }, { startedAt: 1 }]), 0);
  assert.equal(countRequestWaves([
    { startedAt: 0, finishedAt: 10 },
    { startedAt: 10, finishedAt: 20 },
    { startedAt: 21, finishedAt: 30 }
  ]), 2);
});
