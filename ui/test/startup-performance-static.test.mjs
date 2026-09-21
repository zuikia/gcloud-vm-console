import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const app = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");

test("boot loads jobs and accounts in the same request wave", () => {
  const boot = app.match(/async function boot\(\) \{([\s\S]*?)\n\}\n\nboot\(\);/)?.[1] || "";
  assert.match(boot, /Promise\.all\(\[[\s\S]*loadJobs\([\s\S]*loadAccounts\(/);
});

test("context refresh fetches all context reads concurrently and commits once", () => {
  assert.match(app, /request-coordinator\.js/);
  const snapshot = app.match(/async function fetchContextSnapshot\([^)]*\) \{([\s\S]*?)\n\}/)?.[1] || "";
  assert.match(snapshot, /Promise\.all\(\[/);
  for (const read of ["fetchResourcesForContext", "fetchRegionCatalog", "fetchFreeRules", "fetchDoctor"]) {
    assert.match(snapshot, new RegExp(`${read}\\(`));
  }
  assert.match(app, /function commitContextSnapshot\(/);
});

test("resource-changing actions do not reload Doctor after refreshResources", () => {
  assert.doesNotMatch(app, /await syncDoctorAfterEvidenceChange\(\)/);
});
