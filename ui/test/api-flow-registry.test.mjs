import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  API_FLOW_REGISTRY,
  classifyApiFlow,
  cloudWriteFlows,
  readOnlyFlows
} from "../server/api-flow-registry.js";

const routerSource = readFileSync(new URL("../server/router.js", import.meta.url), "utf8");

test("api flow registry classifies all active endpoints", () => {
  assert.equal(classifyApiFlow("GET", "/api/health").writeScope, "read");
  assert.equal(classifyApiFlow("POST", "/api/cloud-instances/adoption-preview").writeScope, "read");
  assert.equal(classifyApiFlow("POST", "/api/cloud-instances/adopt-local").writeScope, "local-write");
  assert.equal(classifyApiFlow("POST", "/api/vm-records/abc/execute").writeScope, "cloud-write");
  assert.equal(classifyApiFlow("PUT", "/api/local-security/ssh-auth").writeScope, "local-sensitive-write");
  assert.equal(classifyApiFlow("POST", "/api/vm-records/abc/network-exposure/apply").confirmation, "typed");
  assert.equal(classifyApiFlow("POST", "/api/vm-records/abc/maintenance/restart").confirmation, "confirm");
  assert.equal(classifyApiFlow("POST", "/api/vm-records/abc/warp/status").writeScope, "read-local-write");
  assert.equal(classifyApiFlow("POST", "/api/vm-records/abc/warp/reconnect").confirmation, "confirm");
  assert.equal(classifyApiFlow("DELETE", "/api/vm-records/abc").writeScope, "local-danger");
});

test("api flow registry keeps reads and writes separated", () => {
  assert.equal(readOnlyFlows().some((flow) => flow.writeScope !== "read"), false);
  assert.deepEqual(cloudWriteFlows().map((flow) => flow.path).toSorted(), [
    "/api/vm-records/:id/execute",
    "/api/vm-records/:id/maintenance/restart",
    "/api/vm-records/:id/maintenance/system-update",
    "/api/vm-records/:id/network-exposure/apply",
    "/api/vm-records/:id/nodes/deploy",
    "/api/vm-records/:id/warp/reconnect"
  ]);
});

test("api flow registry does not define cloud delete", () => {
  assert.equal(API_FLOW_REGISTRY.some((flow) => /delete cloud|cloud delete/i.test(flow.purpose)), false);
  assert.equal(API_FLOW_REGISTRY.some((flow) => flow.path.includes("delete-cloud")), false);
});

test("api flow registry covers every direct and record-scoped router endpoint", () => {
  const registered = new Set(API_FLOW_REGISTRY.map((flow) => `${flow.method} ${flow.path}`));
  const direct = [...routerSource.matchAll(/method === "(GET|POST|PUT|DELETE)" && pathname === "([^"]+)"/g)]
    .map((match) => `${match[1]} ${match[2]}`);
  const dynamic = [
    "POST /api/vm-records/:id/preview",
    "POST /api/vm-records/:id/execute",
    "POST /api/vm-records/:id/network-exposure/preview",
    "POST /api/vm-records/:id/network-exposure/apply",
    "POST /api/vm-records/:id/warp/status",
    "POST /api/vm-records/:id/warp/reconnect",
    "POST /api/vm-records/:id/maintenance/status",
    "POST /api/vm-records/:id/maintenance/restart",
    "POST /api/vm-records/:id/maintenance/system-update",
    "POST /api/vm-records/:id/nodes/deploy",
    "POST /api/vm-records/:id/verify",
    "DELETE /api/vm-records/:id"
  ];

  for (const route of [...direct, ...dynamic]) assert.equal(registered.has(route), true, `${route} is missing from API_FLOW_REGISTRY`);
  assert.equal(registered.size, new Set([...direct, ...dynamic]).size);
});
