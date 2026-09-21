import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const audit = readFileSync(new URL("browser-layout-audit.mjs", import.meta.url), "utf8");

test("layout audit selects the managed fixture before injecting resource node stress content", () => {
  const selectFirstBody = audit.match(/async function selectFirstResource\(page\) \{([\s\S]*?)\n\}/)?.[1] || "";
  assert.match(selectFirstBody, /selectResourceByName\(page,\s*"vm-a"\)/);
  assert.doesNotMatch(selectFirstBody, /domClick\(page,\s*"\[data-resource-key\]"\)/);

  const stressBody = audit.match(/async function installStressContent\(page, route\) \{([\s\S]*?)\n\}/)?.[1] || "";
  assert.match(stressBody, /resourceSelected/);
  assert.match(stressBody, /vm-a/);
});

test("layout audit covers canonical status and unique instance action ownership", () => {
  assert.match(
    audit,
    /const INSTANCE_STATUS_IDS = .*"ssh".*"bbr".*"firewall".*"services"/
  );
  assert.match(audit, /\[data-instance-status="\$\{id\}"\]/);
  for (const actionId of [
    "detailPrimary",
    "cloneVm",
    "deployNodes",
    "smartDiagnoseInstance",
    "adoptLocalInstance",
    "manageNetworkExposure",
    "restartVm",
    "systemUpdate",
    "showNodeResults"
  ]) {
    assert.match(audit, new RegExp(actionId));
  }
  assert.match(audit, /duplicate canonical status/);
  assert.match(audit, /duplicate instance action/);
});

test("layout audit encodes desktop, tablet, and mobile instance geometry", () => {
  assert.match(audit, /instance-status-desktop-row/);
  assert.match(audit, /instance-action-desktop-top/);
  assert.match(audit, /instance-status-tablet-columns/);
  assert.match(audit, /instance-maintenance-tablet-row/);
  assert.match(audit, /instance-status-mobile-column/);
  assert.match(audit, /instance-mobile-auto-open-group/);
  assert.match(audit, /instance-mobile-control-under-44/);
});

test("layout audit verifies read-only recognition updates in place", () => {
  assert.match(audit, /recognition-status-count-changed/);
  assert.match(audit, /recognition-method-not-updated/);
  assert.match(audit, /recognition-checked-time-missing/);
  assert.match(audit, /recognition-action-label-not-updated/);
  assert.match(audit, /recognition-selection-changed/);
  assert.match(audit, /recognition-horizontal-overflow/);
});

test("layout audit verifies compact instance diagnostics", () => {
  assert.doesNotMatch(audit, /diagnostic-duplicate-issue|diagnostic-recovery-card-regression|diagnostic-evidence-open-by-default/);
  assert.match(audit, /technical-summary-row-count/);
  assert.match(audit, /technical-more-attributes-open-by-default/);
});

test("layout audit opens the network exposure dialog at every responsive width", () => {
  assert.match(audit, /networkExposureDialogIssues/);
  assert.match(audit, /network-exposure-dialog@\$\{width\}: internal-horizontal-overflow/);
  assert.match(audit, /network-exposure-dialog@\$\{width\}: target-under-44/);
  assert.match(audit, /mobile-port-choices-not-stacked/);
  assert.match(audit, /preview-obscured-by-actions/);
  assert.match(audit, /input\[type='password'\]/);
  assert.match(audit, /opening-network-dialog-triggered-write/);
});

test("layout audit verifies final technical detail distillation", () => {
  assert.match(audit, /technical-summary-row-count/);
  assert.match(audit, /technical-primary-control-regression/);
  assert.match(audit, /technical-duplicate-canonical-status/);
  assert.match(audit, /technical-more-attributes-open-by-default/);
  assert.match(audit, /technical-summary-target-under-44/);
  assert.match(audit, /technical-overview-over-264/);
  assert.match(audit, /technical-details-horizontal-overflow/);
  assert.match(audit, /technical-more-attributes-stale-open/);
  assert.match(audit, /technical-evidence-row-missing/);
  assert.match(audit, /最新尝试/);
});

test("layout audit rejects the removed duplicate overview guide", () => {
  assert.match(audit, /duplicate-overview-guidance/);
  assert.doesNotMatch(audit, /missing-operation-guide|#operationGuidePrimary/);
});

test("layout audit covers persistent interrupted task history", () => {
  assert.match(audit, /status:\s*"interrupted"/);
  assert.match(audit, /recoveredInterrupted/);
  assert.match(audit, /task-history-horizontal-overflow/);
  assert.match(audit, /task-storage-notice-overflow/);
});

test("layout audit checks compact task evidence and proportional desktop result layout", () => {
  assert.match(audit, /task-detail-desktop-result-main-column/);
  assert.match(audit, /task-detail-desktop-context-stretch/);
  assert.match(audit, /task-diagnostics-open-by-default/);
  assert.match(audit, /task-artifacts-open-by-default/);
  assert.match(audit, /task-timeline-hint-preview-leak/);
});

test("layout audit rejects duplicated instance recommendation copy", () => {
  assert.match(audit, /instance-duplicate-recommendation-hint/);
});
