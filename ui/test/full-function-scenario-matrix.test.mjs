import assert from "node:assert/strict";
import test from "node:test";

import { buildFullFunctionScenarioMatrix } from "./full-function-scenario-fixtures.mjs";

test("full function scenario matrix covers beginner-critical console states", () => {
  const scenarios = buildFullFunctionScenarioMatrix();
  assert.deepEqual(scenarios.map((scenario) => scenario.id), [
    "no-account-project",
    "account-no-project",
    "inventory-sync-failed",
    "no-selected-instance",
    "cloud-only-unknown",
    "cloud-only-recognized-before-adoption",
    "adopted-external-instance",
    "local-vm-only-instance",
    "local-singbox-plus-node-links",
    "local-three-x-ui-panel",
    "preview-invalidated",
    "preview-executable",
    "verification-partial",
    "verification-failed",
    "clipboard-denied",
    "long-values-contained",
    "fresh-evidence",
    "aging-evidence",
    "stale-retained-evidence",
    "latest-attempt-failed",
    "live-method-drift",
    "unknown-evidence-time",
    "probe-recovered"
  ]);

  for (const scenario of scenarios) {
    assert.equal(typeof scenario.name, "string", scenario.id);
    assert.equal(scenario.actions.every((action) => action.id && typeof action.enabled === "boolean"), true, scenario.id);
    assert.equal(scenario.cloudWritesWithoutConfirmation.length, 0, scenario.id);
    assert.equal(scenario.preventableThrows.length, 0, scenario.id);
    assert.equal(scenario.rawSecretsLeaked.length, 0, scenario.id);
    assert.equal(typeof scenario.expectedRecommendationAction, "string", scenario.id);
    assert.equal(typeof scenario.expectedAutoOpenGroup, "string", scenario.id);
    assert.equal(
      scenario.instanceDetail.recommendation.actionId,
      scenario.expectedRecommendationAction,
      `${scenario.id}: recommendation`
    );
    assert.equal(
      scenario.instanceDetail.autoOpenGroupId,
      scenario.expectedAutoOpenGroup,
      `${scenario.id}: auto-open group`
    );
    assert.deepEqual(
      scenario.instanceDetail.statuses.map((status) => status.id),
      ["ssh", "bbr", "firewall", "services"],
      `${scenario.id}: canonical status order`
    );
  }

  const byId = new Map(scenarios.map((scenario) => [scenario.id, scenario]));
  assert.equal(byId.get("fresh-evidence").instanceDetail.statuses.every((status) => status.freshness === "fresh"), true);
  assert.equal(byId.get("aging-evidence").instanceDetail.statuses.every((status) => status.freshness === "aging"), true);
  assert.equal(byId.get("stale-retained-evidence").instanceDetail.statuses.every((status) => status.historical), true);
  assert.equal(byId.get("latest-attempt-failed").instanceDetail.statuses.every((status) => status.historical), true);
  assert.equal(byId.get("live-method-drift").instanceDetail.header.methodLabel, "3X-UI");
  assert.equal(byId.get("unknown-evidence-time").instanceDetail.statuses.every((status) => status.freshness === "unknown"), true);
  assert.equal(byId.get("probe-recovered").instanceDetail.statuses.some((status) => status.historical), false);
});
