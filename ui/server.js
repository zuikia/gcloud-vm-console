import { createServer } from "node:http";
import { chmod, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createAccountService } from "./server/account-service.js";
import { createServerApp } from "./server/app.js";
import { createChangeExecutor } from "./server/change-executor.js";
import { createCloudInventory } from "./server/cloud-inventory.js";
import { createDeploymentVerifier } from "./server/deployment-verifier.js";
import { createFirewallService } from "./server/firewall-service.js";
import { createFreeRuleService } from "./server/free-rule-service.js";
import { createGcloudRunner } from "./server/gcloud-runner.js";
import { createJobStore } from "./server/job-store.js";
import { createInventorySnapshotStore } from "./server/inventory-snapshot-store.js";
import { createLocalSecretStore } from "./server/local-secret-store.js";
import { assertAllowedLoopbackOrigin, readJsonBody, toPublicHttpError } from "./server/http-runtime.js";
import { createMaintenanceService } from "./server/maintenance-service.js";
import { createNodePipeline } from "./server/node-pipeline.js";
import { createNetworkExposureService } from "./server/network-exposure-service.js";
import { createRegionCatalog } from "./server/region-catalog.js";
import { createShutdownController } from "./server/shutdown-controller.js";
import { createStaticFileService } from "./server/static-file-service.js";
import { createSshDualEntryService } from "./server/ssh-dual-entry-service.js";
import { createTaskLock } from "./server/task-lock.js";
import { createVmRecordStore } from "./server/vm-record-store.js";
import { computeRuntimeRevision } from "./scripts/runtime-revision.mjs";

const __filename = fileURLToPath(import.meta.url);
const uiRoot = path.dirname(__filename);
const projectRoot = path.dirname(uiRoot);
const publicRoot = path.join(uiRoot, "public");
const fontsourceRoot = path.join(uiRoot, "node_modules", "@fontsource-variable");
const dataRoot = path.join(projectRoot, ".gcp-vm-console", "records");
const jobsRoot = path.join(projectRoot, ".gcp-vm-console", "jobs");
const cacheRoot = path.join(projectRoot, ".gcp-vm-console", "cache");
const inventoryCacheRoot = path.join(cacheRoot, "inventory");
const secretsRoot = path.join(projectRoot, ".gcp-vm-console", "secrets");
const port = Number(process.env.PORT || 8787);
const runtimeRevision = computeRuntimeRevision({ uiRoot });

for (const directory of [dataRoot, jobsRoot, cacheRoot]) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
}

const runner = createGcloudRunner();
const inventorySnapshotStore = createInventorySnapshotStore({ rootDir: inventoryCacheRoot });
const inventory = createCloudInventory({ runner, snapshotStore: inventorySnapshotStore });
const recordStore = createVmRecordStore({ rootDir: dataRoot });
const firewallService = createFirewallService({ runner });
const taskLock = createTaskLock();
const secretStore = createLocalSecretStore({ rootDir: secretsRoot });
const sshDualEntryService = createSshDualEntryService({ runner });
const networkExposureService = createNetworkExposureService({
  inventory,
  firewallService,
  sshDualEntryService,
  secretStore,
  taskLock
});
const maintenanceService = createMaintenanceService({ runner, inventory });
const nodePipeline = createNodePipeline({ runner, firewallService });
const deploymentVerifier = createDeploymentVerifier({ runner, firewallService });
const regionCatalog = createRegionCatalog({ runner, cacheDir: cacheRoot });
const freeRuleService = createFreeRuleService({ cacheDir: cacheRoot });

const app = createServerApp({
  accountService: createAccountService({ runner }),
  changeExecutor: createChangeExecutor({
    runner,
    inventory,
    recordStore,
    taskLock
  }),
  inventory,
  runner,
  taskLock,
  firewallService,
  secretStore,
  networkExposureService,
  jobStore: createJobStore({ rootDir: jobsRoot }),
  maintenanceService,
  nodePipeline,
  deploymentVerifier,
  regionCatalog,
  freeRuleService,
  runtimeRevision,
  recordStore
});
const staticFiles = createStaticFileService({ publicRoot, fontsourceRoot });

function sendJson(res, status, body) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer"
  });
  res.end(`${JSON.stringify(body)}\n`);
}

async function sendStatic(req, res) {
  const result = await staticFiles.handle({
    method: req.method,
    url: req.url,
    headers: req.headers
  });
  res.writeHead(result.status, result.headers);
  res.end(result.body || undefined);
}

let shutdownController;
const server = createServer(async (req, res) => {
  try {
    if (shutdownController?.isDraining()) {
      sendJson(res, 503, { error: "本地服务正在关闭，请稍后重新打开。", code: "service_draining" });
      return;
    }
    const url = new URL(req.url || "/", "http://localhost");
    if (url.pathname.startsWith("/api/")) {
      assertAllowedLoopbackOrigin(req.headers.origin, { port });
      const body = req.method === "GET" || req.method === "HEAD" ? undefined : await readJsonBody(req);
      const result = await app.dispatch({ method: req.method, url: req.url, body });
      sendJson(res, result.status, result.body);
      return;
    }
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405);
      res.end("Method not allowed");
      return;
    }
    await sendStatic(req, res);
  } catch (error) {
    const publicError = toPublicHttpError(error);
    sendJson(res, publicError.status, publicError.body);
  }
});

shutdownController = createShutdownController({ server });
process.once("SIGTERM", () => { void shutdownController.shutdown("SIGTERM"); });
process.once("SIGINT", () => { void shutdownController.shutdown("SIGINT"); });

server.listen(port, "127.0.0.1", () => {
  console.log(`GCP VM Console listening on http://127.0.0.1:${port}`);
});
