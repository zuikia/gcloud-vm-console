import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { ACTION_BUTTON_IDS } from "../public/lib/action-readiness-view-model.js";
import { ACTION_POLICY } from "../public/lib/action-policy.js";
import {
  FUNCTION_INTENTS,
  coverageRows,
  findDuplicateIntents
} from "../public/lib/function-integrity-registry.js";
import { API_FLOW_REGISTRY } from "../server/api-flow-registry.js";

const root = new URL("../", import.meta.url);
const index = readFileSync(new URL("public/index.html", root), "utf8");
const app = readFileSync(new URL("public/app.js", root), "utf8");

function buttonIds() {
  return [...index.matchAll(/<button[^>]+id="([^"]+)"[^>]*>/g)]
    .filter((match) => !/data-i18n-control/.test(match[0]))
    .map((match) => match[1]);
}

function apiPaths() {
  return [...new Set([...app.matchAll(/api\("([^"]+)"/g)].map((match) => match[1]))];
}

test("function registry covers every static button exactly once", () => {
  const ids = buttonIds();
  assert.deepEqual(FUNCTION_INTENTS.map((item) => item.id).toSorted(), ids.toSorted());
  assert.deepEqual(FUNCTION_INTENTS.map((item) => item.id).toSorted(), ACTION_BUTTON_IDS.toSorted());
});

test("function registry maps every function to policy readiness handler and page", () => {
  const rows = coverageRows({
    buttonIds: buttonIds(),
    apiPaths: apiPaths(),
    readinessIds: ACTION_BUTTON_IDS,
    policyIds: Object.keys(ACTION_POLICY),
    handlerRefs: app
  });
  assert.equal(rows.filter((row) => row.coverage !== "ok").length, 0);
  assert.equal(rows.every((row) => ["overview", "resources", "config", "tasks", "global"].includes(row.page)), true);
});

test("instance action registry reflects canonical ownership and local node-result view", () => {
  const byId = Object.fromEntries(FUNCTION_INTENTS.map((item) => [item.id, item]));
  assert.equal(byId.detailPrimary.group, "configuration");
  assert.equal(byId.deployNodes.group, "configuration");
  assert.equal(byId.smartDiagnoseInstance.group, "diagnostics");
  assert.equal(byId.manageNetworkExposure.group, "network-governance");
  assert.deepEqual(byId.manageNetworkExposure.apiRefs, []);
  assert.deepEqual(byId.saveNetworkExposurePreview.apiRefs, [
    "PUT /api/local-security/ssh-auth",
    "POST /api/vm-records/:id/network-exposure/preview"
  ]);
  assert.deepEqual(byId.applyNetworkExposure.apiRefs, ["POST /api/vm-records/:id/network-exposure/apply"]);
  assert.equal(byId.restartVm.group, "maintenance");
  assert.equal(byId.showNodeResults.group, "node-results");
  assert.equal(byId.showNodeResults.writeScope, "route");
  assert.deepEqual(byId.showNodeResults.apiRefs, []);
  assert.equal(byId.manageWarpEgress.group, "warp-egress");
  assert.deepEqual(byId.manageWarpEgress.apiRefs, []);
  assert.deepEqual(byId.refreshWarpStatus.apiRefs, ["POST /api/vm-records/:id/warp/status"]);
  assert.deepEqual(byId.reconnectWarpEgress.apiRefs, ["POST /api/vm-records/:id/warp/reconnect"]);
});

test("function registry flags only approved duplicate intent groups", () => {
  const duplicates = findDuplicateIntents();
  assert.deepEqual(duplicates.map((item) => item.intent).toSorted(), [
    "diagnose",
    "navigate",
    "refresh",
    "reuse-instance"
  ]);
});

test("function registry write scopes cover every referenced API flow", () => {
  const flowByPath = new Map(API_FLOW_REGISTRY.map((flow) => [`${flow.method} ${flow.path}`, flow]));
  const allowed = {
    read: new Set(["read"]),
    "local-write": new Set(["read", "local-write"]),
    "read-local-write": new Set(["read", "local-write", "read-local-write"]),
    "local-sensitive-write": new Set(["read", "local-write", "read-local-write", "local-sensitive-write"]),
    "cloud-write": new Set(["cloud-write"]),
    "local-danger": new Set(["local-danger"]),
    route: new Set(),
    disabled: new Set()
  };

  for (const item of FUNCTION_INTENTS) {
    for (const apiRef of item.apiRefs) {
      const flow = flowByPath.get(apiRef);
      assert.ok(flow, `${item.id} references unregistered API ${apiRef}`);
      assert.equal(allowed[item.writeScope]?.has(flow.writeScope), true, `${item.id} cannot own ${flow.writeScope} API ${apiRef}`);
    }
  }
});

test("refresh and local calibration rows describe their complete operation scope", () => {
  const byId = Object.fromEntries(FUNCTION_INTENTS.map((item) => [item.id, item]));
  const fullContextReads = ["GET /api/vm-records", "GET /api/cloud-instances", "GET /api/regions", "GET /api/free-rules", "GET /api/doctor"];
  assert.deepEqual(byId.refreshAll.apiRefs, fullContextReads);
  assert.deepEqual(byId.useContext.apiRefs, fullContextReads);
  assert.deepEqual(byId.refreshResources.apiRefs, ["GET /api/vm-records", "GET /api/cloud-instances", "GET /api/doctor"]);
  assert.equal(byId.auditFreeRules.writeScope, "local-write");
});
