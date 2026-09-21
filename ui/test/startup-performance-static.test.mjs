import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const app = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");

test("boot loads jobs and accounts in the same request wave", () => {
  const boot = app.match(/async function boot\(\) \{([\s\S]*?)\n\}\n\nboot\(\);/)?.[1] || "";
  assert.match(boot, /Promise\.all\(\[[\s\S]*loadJobs\([\s\S]*loadAccounts\(/);
});

test("healthy service isolates account loading failures from the service health state", () => {
  const boot = app.match(/async function boot\(\) \{([\s\S]*?)\n\}\n\nboot\(\);/)?.[1] || "";
  assert.match(boot, /health = await api\("\/api\/health"\)/);
  assert.match(boot, /state\.serviceReady = true/);
  assert.match(boot, /loadAccounts\(\{ preferDefault: true \}\)\.catch\(\(error\) => handleAccountLoadFailure\(error\)\)/);
  assert.doesNotMatch(boot, /loadAccounts\(\{ preferDefault: true \}\)\s*\n\s*\]\);\s*\n\s*if \(shouldAutoApplyPreferredContext/);
});

test("account loading failure clears stale selectors and leaves retry guidance", () => {
  const resetBody = app.match(/function resetAccountContextAfterLoadFailure\(\) \{([\s\S]*?)\n\}/)?.[1] || "";
  assert.match(resetBody, /state\.accounts = \[\]/);
  assert.match(resetBody, /state\.projects = \[\]/);
  assert.match(resetBody, /state\.context = null/);
  assert.match(resetBody, /accountSelect\.replaceChildren\(\)/);
  assert.match(resetBody, /projectSelect\.disabled = true/);
  assert.match(app, /setSyncState\("账号读取失败，请重新读取", "warn"\)/);
  assert.match(app, /handleAccountLoadFailure\(error\);\s*\n\s*throw error/);
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
