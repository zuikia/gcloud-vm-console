import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { ACTION_BUTTON_IDS, toActionReadiness } from "../public/lib/action-readiness-view-model.js";
import { policyForAction } from "../public/lib/action-policy.js";

const root = new URL("../", import.meta.url);
const index = readFileSync(new URL("public/index.html", root), "utf8");
const app = readFileSync(new URL("public/app.js", root), "utf8");

function buttonIds() {
  return [...index.matchAll(/<button[^>]+id="([^"]+)"/g)].map((match) => match[1]);
}

test("every visible button has readiness and handler coverage", () => {
  const ids = buttonIds();
  const readiness = toActionReadiness({
    serviceReady: true,
    contextReady: true,
    accountSelected: true,
    projectSelected: true,
    selected: true,
    hasLocalRecord: true,
    deployMethod: "singbox_plus",
    previewExecutable: true
  });

  for (const id of ids) {
    assert.equal(ACTION_BUTTON_IDS.includes(id), true, `${id} missing from ACTION_BUTTON_IDS`);
    assert.ok(readiness[id], `${id} missing from readiness view`);
    if (readiness[id].kind !== "route") {
      assert.doesNotThrow(() => policyForAction(id), `${id} missing from action policy`);
    }
    assert.match(app, new RegExp(`#${id}|getElementById\\("${id}"|\\$\\("${id}"|\\$\\("#${id}"`), `${id} missing handler reference`);
  }
});

test("diagnostics button remains read-only after overview guide consolidation", () => {
  const view = toActionReadiness({ serviceReady: true, contextReady: true, accountSelected: true, projectSelected: true });
  assert.equal(policyForAction("copyDiagnosticSummary").kind, "read");
  assert.equal("operationGuidePrimary" in view, false);
  assert.equal(view.copyDiagnosticSummary.enabled, true);
});

test("confirmation dialog clears any stale native return value before every open", () => {
  assert.match(app, /dialog\.returnValue\s*=\s*"";[\s\S]*?dialog\.showModal\(\)/);
});

test("node results and responsive action disclosures stay local to the instance UI", () => {
  assert.match(app, /\$\("#showNodeResults"\)\.addEventListener\("click"/);
  const handler = app.match(/\$\("#showNodeResults"\)\.addEventListener\("click",[\s\S]*?\n  \}\);/)?.[0] || "";
  assert.doesNotMatch(handler, /api\(|runRecordTask\(|gcloud/);
  assert.match(app, /function syncInstanceActionDisclosures\(\)/);
  assert.match(app, /dataset\.disclosureStateKey/);
  assert.match(app, /dataset\.recommendedGroup/);
  assert.match(app, /is-recommended/);
});
