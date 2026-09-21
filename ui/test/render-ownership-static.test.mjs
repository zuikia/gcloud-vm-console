import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const app = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");

function count(body, expression) {
  return [...body.matchAll(expression)].length;
}

test("context snapshot has one explicit owner for each root render", () => {
  const body = app.match(/function commitContextSnapshot\([^)]*\) \{([\s\S]*?)\n\}/)?.[1] || "";
  for (const name of [
    "renderResources",
    "renderTaskWorkspace",
    "renderContextScope",
    "renderOverview",
    "renderDoctorPanel",
    "renderDiagnosticSummary",
    "renderEvidenceTimeline",
    "applyActionReadiness"
  ]) {
    assert.equal(count(body, new RegExp(`${name}\\(`, "g")), 1, `${name} should run once per snapshot`);
  }
  assert.match(body, /renderResources\(\{ renderRelated: false \}\)/);
  assert.match(body, /renderTaskWorkspace\(\{ renderRelated: false \}\)/);
});

test("resource and task root renders can suppress cross-region work", () => {
  assert.match(app, /function renderResources\(\{ renderRelated = true \} = \{\}\)/);
  assert.match(app, /function renderDetail\(\{ renderRelated = true, updateReadiness = true \} = \{\}\)/);
  assert.match(app, /function renderTaskWorkspace\(\{ renderRelated = true \} = \{\}\)/);
});
