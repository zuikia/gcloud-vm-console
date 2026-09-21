const flows = [
  ["GET", "/api/health", "local service health and capabilities", "read", "none", "router"],
  ["GET", "/api/accounts", "list local gcloud configurations", "read", "none", "accountService"],
  ["GET", "/api/projects", "list projects for selected gcloud configuration", "read", "none", "accountService"],
  ["GET", "/api/vm-records", "list local VM records", "read", "none", "recordStore"],
  ["GET", "/api/cloud-instances", "read cloud instance inventory", "read", "none", "inventory"],
  ["POST", "/api/cloud-instances/adoption-preview", "read external instance recognition evidence", "read", "none", "inventory"],
  ["POST", "/api/cloud-instances/adopt-local", "save external instance adoption to local record", "local-write", "confirm", "recordStore"],
  ["GET", "/api/regions", "load region and zone catalog", "read", "none", "regionCatalog"],
  ["GET", "/api/free-rules", "read cached free rule guidance", "read", "none", "freeRuleService"],
  ["GET", "/api/doctor", "run read-only operational doctor", "read", "none", "doctorService"],
  ["GET", "/api/jobs", "list local job history", "read", "none", "jobStore"],
  ["GET", "/api/local-security/ssh-auth", "read local SSH secret configuration status", "read", "none", "secretStore"],
  ["PUT", "/api/local-security/ssh-auth", "store local SSH password without readback", "local-sensitive-write", "none", "secretStore"],
  ["POST", "/api/free-rules/calibrate", "refresh local free-rule guidance cache", "local-write", "none", "freeRuleService"],
  ["POST", "/api/vm-records", "save local VM record draft", "local-write", "none", "recordStore"],
  ["POST", "/api/vm-records/:id/preview", "save local record and generate live-state preview", "read-local-write", "none", "recordStore"],
  ["POST", "/api/vm-records/:id/execute", "execute fingerprinted VM and static-address change preview", "cloud-write", "confirm", "changeExecutor"],
  ["POST", "/api/vm-records/:id/network-exposure/preview", "build and persist fingerprinted network exposure preview", "read-local-write", "none", "networkExposureService"],
  ["POST", "/api/vm-records/:id/network-exposure/apply", "apply fingerprinted SSH and network exposure policy", "cloud-write", "typed", "networkExposureService"],
  ["POST", "/api/vm-records/:id/warp/status", "read WARP egress state and persist sanitized local evidence", "read-local-write", "none", "warpEgressService"],
  ["POST", "/api/vm-records/:id/warp/reconnect", "reconnect WARP egress once and verify the resulting exit", "cloud-write", "confirm", "warpEgressService"],
  ["POST", "/api/vm-records/:id/maintenance/status", "read selected instance status and persist local result", "read-local-write", "none", "maintenanceService"],
  ["POST", "/api/vm-records/:id/maintenance/restart", "restart selected instance", "cloud-write", "confirm", "maintenanceService"],
  ["POST", "/api/vm-records/:id/maintenance/system-update", "run staged package update over SSH", "cloud-write", "confirm", "maintenanceService"],
  ["POST", "/api/vm-records/:id/nodes/deploy", "run selected node deployment pipeline", "cloud-write", "confirm", "nodePipeline"],
  ["POST", "/api/vm-records/:id/verify", "verify runtime evidence and persist local result", "read-local-write", "none", "deploymentVerifier"],
  ["DELETE", "/api/vm-records/:id", "delete local VM record only", "local-danger", "typed", "recordStore"]
];

function freezeFlow([method, path, purpose, writeScope, confirmation, expectedService]) {
  return Object.freeze({
    method,
    path,
    purpose,
    writeScope,
    confirmation,
    expectedService
  });
}

function normalizePath(pathname = "") {
  const value = String(pathname || "");
  return value
    .replace(/^\/api\/vm-records\/[^/]+\/maintenance\/status$/, "/api/vm-records/:id/maintenance/status")
    .replace(/^\/api\/vm-records\/[^/]+\/maintenance\/restart$/, "/api/vm-records/:id/maintenance/restart")
    .replace(/^\/api\/vm-records\/[^/]+\/maintenance\/system-update$/, "/api/vm-records/:id/maintenance/system-update")
    .replace(/^\/api\/vm-records\/[^/]+\/nodes\/deploy$/, "/api/vm-records/:id/nodes/deploy")
    .replace(/^\/api\/vm-records\/[^/]+\/preview$/, "/api/vm-records/:id/preview")
    .replace(/^\/api\/vm-records\/[^/]+\/execute$/, "/api/vm-records/:id/execute")
    .replace(/^\/api\/vm-records\/[^/]+\/network-exposure\/preview$/, "/api/vm-records/:id/network-exposure/preview")
    .replace(/^\/api\/vm-records\/[^/]+\/network-exposure\/apply$/, "/api/vm-records/:id/network-exposure/apply")
    .replace(/^\/api\/vm-records\/[^/]+\/warp\/status$/, "/api/vm-records/:id/warp/status")
    .replace(/^\/api\/vm-records\/[^/]+\/warp\/reconnect$/, "/api/vm-records/:id/warp/reconnect")
    .replace(/^\/api\/vm-records\/[^/]+\/verify$/, "/api/vm-records/:id/verify")
    .replace(/^\/api\/vm-records\/[^/]+$/, "/api/vm-records/:id");
}

export const API_FLOW_REGISTRY = Object.freeze(flows.map(freezeFlow));

export function classifyApiFlow(method, path) {
  const normalizedMethod = String(method || "GET").toUpperCase();
  const normalizedPath = normalizePath(path);
  const match = API_FLOW_REGISTRY.find((flow) => flow.method === normalizedMethod && flow.path === normalizedPath);
  if (!match) throw new Error(`Unknown API flow: ${normalizedMethod} ${path}`);
  return match;
}

export function cloudWriteFlows() {
  return API_FLOW_REGISTRY.filter((flow) => flow.writeScope === "cloud-write");
}

export function readOnlyFlows() {
  return API_FLOW_REGISTRY.filter((flow) => flow.writeScope === "read");
}
