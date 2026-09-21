import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const app = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");

function functionBody(name, nextName) {
  return app.match(new RegExp(`(?:async )?function ${name}\\([^)]*\\) \\{([\\s\\S]*?)\\n(?:async )?function ${nextName}\\(`))?.[1] || "";
}

test("global refresh and inventory refresh have distinct operation ownership", () => {
  const allBody = functionBody("refreshAllContext", "refreshResources");
  const inventoryBody = functionBody("refreshResources", "renderResources");

  assert.match(allBody, /fetchContextSnapshot\(/);
  assert.match(inventoryBody, /fetchInventorySnapshot\(/);
  assert.doesNotMatch(inventoryBody, /fetchContextSnapshot\(/);
  assert.match(app, /\$\("#refreshAll"\)[\s\S]*?refreshAllContext\(\)/);
  assert.match(app, /\$\("#refreshResources"\)[\s\S]*?refreshResources\(\)/);
});

test("inventory refresh reads resources and Doctor without recalibrating catalogs", () => {
  const body = functionBody("fetchInventorySnapshot", "commitInventorySnapshot");
  assert.match(body, /fetchResourcesForContext\(/);
  assert.match(body, /fetchDoctor\(/);
  assert.doesNotMatch(body, /fetchRegionCatalog\(|fetchFreeRules\(/);
});

test("inventory degradation preserves same-context memory and invalidates executable previews", () => {
  const fetchBody = functionBody("fetchResourcesForContext", "refreshAllContext");
  const commitBody = functionBody("commitInventorySnapshot", "commitContextSnapshot");
  assert.match(fetchBody, /sameActiveContext/);
  assert.match(fetchBody, /source:\s*canUseMemory \? "memory" : "none"/);
  assert.match(fetchBody, /instances:\s*canUseMemory \? structuredClone\(state\.cloud\) : \[\]/);
  assert.match(commitBody, /state\.inventoryMeta\.source !== "live"/);
  assert.match(commitBody, /state\.previewExecutable = false/);
});

test("project switching accepts its exact server cache but still fails closed without cache or memory", () => {
  const switchBody = functionBody("useSelectedContext", "resourceKey");
  const fetchBody = functionBody("fetchResourcesForContext", "refreshAllContext");
  assert.match(switchBody, /failOnDegraded:\s*true/);
  assert.match(switchBody, /当前显示缓存清单/);
  assert.match(fetchBody, /if \(hardFailure && failOnDegraded\) throw/);
});
