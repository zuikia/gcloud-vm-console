import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { createServerApp } from "../server/app.js";
import { createChangeExecutor } from "../server/change-executor.js";
import { createFirewallService } from "../server/firewall-service.js";
import { createJobStore } from "../server/job-store.js";
import { createTaskLock } from "../server/task-lock.js";
import { createVmRecordStore } from "../server/vm-record-store.js";

const identity = {
  configuration: "acct-a",
  account: "user@example.com",
  projectId: "project-a",
  zone: "us-west1-b",
  name: "vm-a"
};

const desired = {
  machineType: "e2-micro",
  image: "debian-cloud/debian-12",
  disk: { sizeGb: 30, type: "pd-standard" },
  network: { name: "default", subnet: "default", externalIpMode: "ephemeral" },
  labels: { managed_by: "gcp-vm-console" },
  tags: ["vm-a"],
  metadata: {},
  deploy: { method: "vm_only" }
};

function criticalFirewallGovernance() {
  return {
    checkedAt: "2026-07-16T09:20:00.000Z",
    expiresAt: "2026-07-16T09:35:00.000Z",
    fingerprint: "critical-firewall-preview",
    severity: "critical",
    findings: [
      { name: "default-allow-rdp", ownership: "external", severity: "high", affectedInstances: ["vm-a", "vm-b"] },
      { name: "default-allow-ssh", ownership: "external", severity: "high", affectedInstances: ["vm-a", "vm-b"] },
      { name: "codex-shared-rule", ownership: "external", severity: "high", affectedInstances: ["vm-a"] },
      { name: "ruzhan1", ownership: "external", severity: "critical", affectedInstances: ["vm-a", "vm-b"] }
    ],
    affectedInstances: ["vm-a", "vm-b"],
    coverage: { ready: true, uniqueTag: "vm-a", freshness: "fresh", blockedReason: "" },
    ownedActions: [],
    externalActions: [{ type: "manual-review", ruleName: "ruzhan1" }]
  };
}

async function setup(t, overrides = {}) {
  const rootDir = await mkdtemp(path.join(tmpdir(), "gcp-server-app-"));
  t.after(() => rm(rootDir, { recursive: true, force: true }));
  const recordStore = createVmRecordStore({ rootDir, now: () => "2026-06-17T12:00:00.000Z" });
  const runnerCalls = [];
  const runner = {
    async run(command, options) {
      runnerCalls.push({ command, options });
      return { exitCode: 0, stdout: "", stderr: "" };
    },
    async runJson(command, options) {
      runnerCalls.push({ jsonCommand: command, options });
      return { data: {} };
    }
  };
  const observedSequence = [null, null, { exists: true, status: "RUNNING" }];
  let observedIndex = 0;
  const inventory = {
    async readObserved() {
      const value = observedSequence[Math.min(observedIndex, observedSequence.length - 1)];
      observedIndex += 1;
      return value;
    },
    async listInstances() {
      return [{ ...identity, exists: true, status: "RUNNING" }];
    }
  };
  let tick = 0;
  const jobRoot = path.join(rootDir, "jobs");
  const jobStore = overrides.jobStore || createJobStore({
    rootDir: jobRoot,
    now: () => new Date(Date.UTC(2026, 5, 17, 12, 0, tick++)).toISOString()
  });
  const app = createServerApp({
    accountService: {
      async listConfigurations() {
        return [{ name: "acct-a", account: "user@example.com", projectId: "project-a" }];
      },
      async listProjects() {
        return [{ projectId: "project-a", name: "Project A", lifecycleState: "ACTIVE" }];
      }
    },
    runner,
    changeExecutor: createChangeExecutor({ runner, inventory, recordStore, taskLock: createTaskLock(), now: () => "2026-06-17T12:00:00.000Z" }),
    inventory: overrides.inventory || inventory,
    jobStore,
    maintenanceService: overrides.maintenanceService || {
      async checkStatus(input) {
        runnerCalls.push({ maintenance: "status", input });
        return { exists: true, status: "RUNNING", externalIp: "203.0.113.10", externalIpMode: "ephemeral" };
      },
      async restartVm(input) {
        runnerCalls.push({ maintenance: "restart", input });
        return { status: "succeeded", interruption: "stop_start" };
      },
      async systemUpdate(input, ssh) {
        runnerCalls.push({ maintenance: "system-update", input, ssh });
        return {
          status: "succeeded",
          stages: ["precheck", "update", "postcheck"],
          ssh: { desiredPort: 45400, actualPort: 22, fallback: true, verified: true, label: "SSH 实际连接 22（已从 45400 回退）" }
        };
      }
    },
    deploymentVerifier: overrides.deploymentVerifier || {
      async verify(input) {
        runnerCalls.push({ verification: input });
        return {
          status: "passed",
          checkedAt: "2026-07-05T00:00:00.000Z",
          method: input.desired?.deploy?.method || input.nodeResult?.type || "vm_only",
          ssh: { desiredPort: 45400, actualPort: 22, fallback: true, verified: true, label: "SSH 实际连接 22（已从 45400 回退）" },
          checks: [{ id: "ssh", label: "SSH 连接", status: "passed", detail: "connected" }],
          firewall: { status: "matched", rules: [] },
          warnings: []
        };
      }
    },
    nodePipeline: overrides.nodePipeline || {
      async deploy(input) {
        runnerCalls.push({ nodeDeploy: input });
        return {
          method: input.deploy.method,
          status: "succeeded",
          stages: ["install", "firewall_sync", "collect"],
          nodeResult: {
            type: input.deploy.method,
            bbr: true,
            ssh: { desiredPort: 45400, actualPort: 22, fallback: true, verified: true, label: "SSH 实际连接 22（已从 45400 回退）" },
            links: [{ name: "tuic-v5", protocol: "udp", port: "23293", url: "tuic://result" }]
          },
          ssh: { desiredPort: 45400, actualPort: 22, fallback: true, verified: true, label: "SSH 实际连接 22（已从 45400 回退）" }
        };
      }
    },
    guestAttributesService: overrides.guestAttributesService || {
      async readConsoleAttributes(input) {
        runnerCalls.push({ guestAttributes: input });
        return { available: false, namespace: "gcp-vm-console", values: {}, warnings: [] };
      }
    },
    deploymentProbeService: overrides.deploymentProbeService || {
      async probe(input, ssh) {
        runnerCalls.push({ deploymentProbe: input, ssh });
        return {
          ssh: { desiredPort: ssh?.port || 22, actualPort: ssh?.port || 22, fallback: false, verified: true },
          services: [],
          ports: [],
          files: [],
          bbr: false,
          warnings: [],
          checkedAt: "2026-07-08T10:00:00.000Z"
        };
      }
    },
    firewallService: {
      async listRules() {
        return [];
      },
      async ensureOwnedRule(input) {
        runnerCalls.push({ ensureOwnedRule: input });
        return { status: "synced", action: "created", name: input.name };
      },
      async inspectInstanceExposure(input) {
        runnerCalls.push({ firewallExposure: input });
        return { status: "unknown", matchedPorts: [], missingPorts: [], exposedPorts: [], rules: [] };
      },
      ...(overrides.firewallService || {})
    },
    firewallGovernanceService: overrides.firewallGovernanceService,
    networkExposureService: overrides.networkExposureService,
    warpEgressService: overrides.warpEgressService,
    secretStore: overrides.secretStore,
    now: overrides.now,
    runtimeRevision: overrides.runtimeRevision || "test-runtime-revision",
    taskLock: createTaskLock(),
    regionCatalog: {
      async load(context) {
        runnerCalls.push({ regionCatalog: context });
        return {
          generatedAt: "2026-06-18T00:00:00.000Z",
          stale: false,
          source: { kind: "gcloud-derived", account: context.account, projectId: context.projectId },
          freeRegionIds: ["us-west1", "us-central1", "us-east1"],
          regions: [{
            id: "us-west1",
            label: "Oregon",
            group: "North America",
            zones: ["us-west1-a", "us-west1-b"],
            defaultZone: "us-west1-a",
            freeTier: "always_free"
          }]
        };
      }
    },
    freeRuleService: {
      async calibrate(context) {
        runnerCalls.push({ freeRules: "calibrate", context });
        return {
          generatedAt: "2026-06-18T00:00:00.000Z",
          stale: false,
          source: { kind: "official", account: context.account, projectId: context.projectId },
          rules: { compute: { machineType: "e2-micro", alwaysFreeRegions: ["us-west1", "us-central1", "us-east1"] } }
        };
      },
      async readCached(context) {
        runnerCalls.push({ freeRules: "readCached", context });
        return {
          generatedAt: "2026-06-18T00:00:00.000Z",
          stale: false,
          source: { kind: "official", account: context.account, projectId: context.projectId },
          rules: { compute: { machineType: "e2-micro", alwaysFreeRegions: ["us-west1", "us-central1", "us-east1"] } }
        };
      }
    },
    doctorService: overrides.doctorService,
    recordStore
  });
  return { app, jobRoot, jobStore, recordStore, runnerCalls };
}

test("server app exposes gcloud-only health and active capabilities", async (t) => {
  const { app } = await setup(t);

  const response = await app.dispatch({ method: "GET", url: "/api/health" });

  assert.equal(response.status, 200);
  assert.equal(response.body.mode, "gcloud-only");
  assert.equal(response.body.runtimeRevision, "test-runtime-revision");
  assert.equal(response.body.capabilities.records, true);
  assert.equal(response.body.capabilities.cloudInventory, true);
  assert.equal(response.body.capabilities.maintenance, true);
  assert.equal(response.body.capabilities.nodePipeline, true);
  assert.equal(response.body.capabilities.externalInstanceRecognition, true);
  assert.equal(response.body.capabilities.localAdoption, true);
  assert.equal(response.body.capabilities.persistentJobHistory, true);
  assert.equal(response.body.capabilities.runtimeOptimization, true);
  assert.equal(response.body.capabilities.networkResilience, true);
  assert.equal(response.body.capabilities.resilientInventory, true);
  assert.equal(response.body.capabilities.firewallGovernance, true);
  assert.equal(response.body.capabilities.metadataSafeReadOnlySsh, true);
  assert.equal(response.body.capabilities.warpEgressManagement, true);
});

test("server app probes WARP explicitly and persists safe state without creating a job", async (t) => {
  const calls = [];
  const warp = {
    supported: true,
    status: "connected",
    mode: "proxy",
    protocol: "masque",
    proxyPort: 40000,
    tier: "free",
    ipv4: "203.0.113.13",
    ipv6: "",
    colo: { ipv4: "KIX", ipv6: "" },
    affectedNodes: { count: 2, names: ["hy2-obfs-warp", "tuic-v5-warp"] },
    checkedAt: "2026-07-30T12:00:00.000Z",
    lastProbeAttempt: { status: "succeeded", checkedAt: "2026-07-30T12:00:00.000Z" }
  };
  const fixture = await setup(t, {
    warpEgressService: {
      async probe({ record }) {
        calls.push({ probe: record.id });
        return warp;
      },
      async reconnect() { throw new Error("not used"); }
    }
  });
  const saved = await fixture.recordStore.save({
    status: "managed",
    identity,
    desired: { ...desired, ssh: { user: "y", keyFile: "/private/key", port: 45400 } },
    observed: { sshConnection: { actualPort: 45400, verified: true }, network: { externalIp: "203.0.113.10" } },
    nodeResult: { links: [{ name: "hy2-obfs-warp", url: "hysteria2://secret" }] }
  });

  const response = await fixture.app.dispatch({ method: "POST", url: `/api/vm-records/${saved.id}/warp/status` });
  const updated = await fixture.recordStore.get(saved.id);

  assert.equal(response.status, 200);
  assert.equal(response.body.warp.ipv4, "203.0.113.13");
  assert.equal(updated.observed.warp.protocol, "masque");
  assert.equal(fixture.jobStore.list().length, 0);
  assert.deepEqual(calls, [{ probe: saved.id }]);
  assert.doesNotMatch(JSON.stringify(response.body), /hysteria2:\/\/|private\/key/);
});

test("server app reconnects WARP through one persistent six-stage job", async (t) => {
  const calls = [];
  const warpEgressService = {
    async probe() { throw new Error("not used"); },
    async reconnect({ record, onStage }) {
      calls.push(record.id);
      await onStage({ name: "precheck", status: "succeeded", detail: "ready" });
      await onStage({ name: "disconnect", status: "succeeded", detail: "done" });
      await onStage({ name: "hold", status: "succeeded", detail: "5 seconds" });
      await onStage({ name: "connect", status: "succeeded", detail: "done" });
      await onStage({ name: "verify", status: "succeeded", detail: "unchanged" });
      return {
        status: "succeeded",
        outcome: "unchanged",
        before: { ipv4: "203.0.113.13", ipv6: "" },
        after: { ipv4: "203.0.113.13", ipv6: "" },
        warp: {
          supported: true,
          status: "connected",
          ipv4: "203.0.113.13",
          ipv6: "",
          lastReconnect: { outcome: "unchanged", completedAt: "2026-07-30T12:01:00.000Z" }
        }
      };
    }
  };
  const fixture = await setup(t, { warpEgressService });
  const saved = await fixture.recordStore.save({
    status: "managed",
    identity,
    desired: { ...desired, ssh: { user: "y", keyFile: "/private/key", port: 45400 } },
    observed: { sshConnection: { actualPort: 45400, verified: true }, network: { externalIp: "203.0.113.10" } },
    nodeResult: { links: [{ name: "hy2-obfs-warp", url: "hysteria2://secret" }] }
  });
  const nodeResultBefore = JSON.stringify(saved.nodeResult);

  const response = await fixture.app.dispatch({ method: "POST", url: `/api/vm-records/${saved.id}/warp/reconnect` });
  const updated = await fixture.recordStore.get(saved.id);

  assert.equal(response.status, 200);
  assert.equal(response.body.job.type, "warp-reconnect");
  assert.equal(response.body.job.status, "succeeded");
  assert.equal(response.body.job.result.outcome, "unchanged");
  assert.deepEqual(response.body.job.stages.map((stage) => stage.name), ["precheck", "disconnect", "hold", "connect", "verify", "persist"]);
  assert.equal(updated.observed.warp.lastReconnect.outcome, "unchanged");
  assert.equal(JSON.stringify(updated.nodeResult), nodeResultBefore);
  assert.equal(calls.length, 1);
  assert.doesNotMatch(JSON.stringify(response.body.job.result), /hysteria2:\/\/|private\/key/);
});

test("server app marks post-reconnect local save failure partial without another remote operation", async (t) => {
  let reconnects = 0;
  const fixture = await setup(t, {
    warpEgressService: {
      async probe() { throw new Error("not used"); },
      async reconnect({ onStage }) {
        reconnects += 1;
        for (const name of ["precheck", "disconnect", "hold", "connect", "verify"]) {
          await onStage({ name, status: "succeeded", detail: name });
        }
        return {
          status: "succeeded",
          outcome: "changed",
          warp: { supported: true, status: "connected", ipv4: "203.0.113.14" }
        };
      }
    }
  });
  const saved = await fixture.recordStore.save({
    status: "managed",
    identity,
    desired: { ...desired, ssh: { user: "y", keyFile: "/private/key", port: 45400 } },
    observed: { sshConnection: { actualPort: 45400, verified: true }, network: { externalIp: "203.0.113.10" } }
  });
  const originalSave = fixture.recordStore.save.bind(fixture.recordStore);
  fixture.recordStore.save = async (next) => {
    if (next.observed?.warp) throw new Error("local record disk unavailable");
    return originalSave(next);
  };

  const response = await fixture.app.dispatch({ method: "POST", url: `/api/vm-records/${saved.id}/warp/reconnect` });

  assert.equal(response.status, 200);
  assert.equal(response.body.job.status, "partial");
  assert.equal(response.body.job.result.outcome, "changed");
  assert.equal(response.body.job.result.localPersistence.status, "failed");
  assert.equal(reconnects, 1);
});

test("server app exposes a safe WARP uncertainty instead of a generic internal error", async (t) => {
  const uncertainty = new Error("WARP 重连结果未确认；请重新检测 WARP 状态。");
  uncertainty.code = "WARP_STATUS_UNCONFIRMED";
  const fixture = await setup(t, {
    warpEgressService: {
      async probe() { throw new Error("not used"); },
      async reconnect() { throw uncertainty; }
    }
  });
  const saved = await fixture.recordStore.save({
    status: "managed",
    identity,
    desired: { ...desired, ssh: { user: "y", keyFile: "/private/key", port: 45400 } },
    observed: { sshConnection: { actualPort: 45400, verified: true }, network: { externalIp: "203.0.113.10" } }
  });

  const response = await fixture.app.dispatch({ method: "POST", url: `/api/vm-records/${saved.id}/warp/reconnect` });

  assert.equal(response.status, 502);
  assert.equal(response.body.errorCategory, "warp");
  assert.equal(response.body.code, "warp_status_unconfirmed");
  assert.match(response.body.error, /重连结果未确认/);
  assert.equal(response.body.job.status, "failed");
});

test("server app stores SSH secret metadata and applies only a fingerprinted network exposure preview", async (t) => {
  const calls = [];
  const preview = {
    schemaVersion: 2,
    fingerprint: "a".repeat(64),
    checkedAt: "2026-07-16T12:00:00.000Z",
    expiresAt: "2026-07-16T12:15:00.000Z",
    coverage: { ready: true, freshness: "fresh", blockedReason: "" },
    selection: { publicSsh22: false, ports: [{ protocol: "tcp", port: "443" }] },
    desiredExposure: {
      public: [{ protocol: "tcp", port: "443" }, { protocol: "tcp", port: "45400" }],
      iap: [{ protocol: "tcp", port: "22" }, { protocol: "tcp", port: "45400" }]
    },
    isolation: { targetTag: "gvc-isolate-test", externalRuleNames: ["ruzhan1"] }
  };
  const secretStore = {
    async publicStatus() { return { configured: true, versionId: "secret-v1", updatedAt: "2026-07-16T11:00:00.000Z" }; },
    async saveSshPassword(password) {
      calls.push({ secretSave: password });
      return { configured: true, versionId: "secret-v1", updatedAt: "2026-07-16T11:00:00.000Z" };
    }
  };
  const networkExposureService = {
    async preview(input, options) {
      calls.push({ preview: input.id, selection: options.selection });
      return preview;
    },
    async apply(input) {
      calls.push({ apply: input.fingerprint });
      return {
        status: "succeeded",
        ssh: { desiredPort: 45400, actualPort: 45400, verified: true, fallback: false },
        sshPolicy: { mode: "dual_entry", passwordVersion: "secret-v1" },
        exposure: { public: preview.desiredExposure.public, iap: preview.desiredExposure.iap },
        firewall: { effectiveStatus: "isolated", targetTag: "gvc-isolate-test", externalRuleNames: ["ruzhan1"] }
      };
    }
  };
  const fixture = await setup(t, { secretStore, networkExposureService });
  const saved = await fixture.recordStore.save({
    status: "managed",
    identity,
    desired: { ...desired, ssh: { user: "y", keyFile: "/private/key", port: 45400 } },
    verification: { checkedAt: "2026-07-16T12:00:00.000Z", ports: [] }
  });

  const status = await fixture.app.dispatch({ method: "GET", url: "/api/local-security/ssh-auth" });
  assert.equal(status.status, 200);
  assert.equal(JSON.stringify(status.body).includes("password"), false);

  const secret = await fixture.app.dispatch({
    method: "PUT",
    url: "/api/local-security/ssh-auth",
    body: { password: "ValidPass9" }
  });
  assert.equal(secret.status, 200);
  assert.equal(JSON.stringify(secret.body).includes("ValidPass9"), false);

  const previewResponse = await fixture.app.dispatch({
    method: "POST",
    url: `/api/vm-records/${saved.id}/network-exposure/preview`,
    body: { publicSsh22: false, ports: [{ protocol: "tcp", port: "443" }] }
  });
  assert.equal(previewResponse.status, 200);
  assert.equal(previewResponse.body.preview.fingerprint, preview.fingerprint);

  const applyResponse = await fixture.app.dispatch({
    method: "POST",
    url: `/api/vm-records/${saved.id}/network-exposure/apply`,
    body: { fingerprint: preview.fingerprint }
  });
  assert.equal(applyResponse.status, 200);
  assert.equal(applyResponse.body.job.type, "network-exposure-apply");
  const updated = await fixture.recordStore.get(saved.id);
  assert.equal(updated.observed.sshAuthPolicy.mode, "dual_entry");
  assert.equal(updated.observed.networkExposure.firewall.effectiveStatus, "isolated");
  assert.equal(JSON.stringify(updated).includes("ValidPass9"), false);
  assert.deepEqual(calls.map((call) => Object.keys(call)[0]), ["secretSave", "preview", "apply"]);

  const retired = await fixture.app.dispatch({
    method: "POST",
    url: `/api/vm-records/${saved.id}/firewall/apply-owned`,
    body: { fingerprint: "old" }
  });
  assert.equal(retired.status, 404);
});

test("server app reads accounts and projects through account service", async (t) => {
  const { app } = await setup(t);

  assert.deepEqual((await app.dispatch({ method: "GET", url: "/api/accounts" })).body.accounts, [
    { name: "acct-a", account: "user@example.com", projectId: "project-a" }
  ]);
  assert.deepEqual((await app.dispatch({ method: "GET", url: "/api/projects?configuration=acct-a&account=user@example.com" })).body.projects, [
    { projectId: "project-a", name: "Project A", lifecycleState: "ACTIVE" }
  ]);
});

test("server app classifies gcloud proxy tunnel failures for cloud inventory", async (t) => {
  const { app } = await setup(t, {
    inventory: {
      async readObserved() {
        return null;
      },
      async listInstances() {
        throw new Error("ERROR: gcloud crashed (ProxyError): HTTPSConnectionPool(host='compute.googleapis.com', port=443): Max retries exceeded. Caused by ProxyError('Unable to connect to proxy', OSError('Tunnel connection failed: 503 Service Unavailable'))");
      }
    }
  });

  const response = await app.dispatch({
    method: "GET",
    url: "/api/cloud-instances?configuration=acct-a&account=user%40example.com&projectId=project-a"
  });

  assert.equal(response.status, 503);
  assert.equal(response.body.errorCategory, "proxy");
  assert.match(response.body.error, /本地代理/);
  assert.match(response.body.error, /503/);
});

test("server app redacts unknown backend errors before returning them", async (t) => {
  const { app } = await setup(t, {
    inventory: {
      async readObserved() {
        return null;
      },
      async listInstances() {
        throw new Error("token=super-secret /Users/example/.ssh/private-key vless://raw-node-link");
      }
    }
  });

  const response = await app.dispatch({
    method: "GET",
    url: "/api/cloud-instances?configuration=acct-a&account=user%40example.com&projectId=project-a"
  });

  assert.equal(response.status, 500);
  assert.equal(response.body.errorCategory, "generic");
  assert.equal(response.body.code, "generic");
  assert.equal(response.body.error, "服务器内部错误");
  assert.doesNotMatch(JSON.stringify(response.body), /super-secret|private-key|vless:\/\//);
});

test("server app exposes region catalog and free rule calibration APIs", async (t) => {
  const { app, runnerCalls } = await setup(t);

  const regions = await app.dispatch({
    method: "GET",
    url: "/api/regions?configuration=acct-a&account=user@example.com&projectId=project-a"
  });
  const cachedRules = await app.dispatch({
    method: "GET",
    url: "/api/free-rules?configuration=acct-a&account=user@example.com&projectId=project-a"
  });
  const calibrated = await app.dispatch({
    method: "POST",
    url: "/api/free-rules/calibrate",
    body: { configuration: "acct-a", account: "user@example.com", projectId: "project-a" }
  });

  assert.equal(regions.status, 200);
  assert.equal(regions.body.regions[0].id, "us-west1");
  assert.deepEqual(regions.body.freeRegionIds, ["us-west1", "us-central1", "us-east1"]);
  assert.equal(cachedRules.status, 200);
  assert.equal(cachedRules.body.rules.compute.machineType, "e2-micro");
  assert.equal(calibrated.status, 200);
  assert.equal(calibrated.body.source.kind, "official");
  assert.deepEqual(runnerCalls.filter((call) => call.regionCatalog || call.freeRules).map((call) => call.regionCatalog ? "regions" : call.freeRules), [
    "regions",
    "readCached",
    "calibrate"
  ]);
});

test("server app exposes read-only operational doctor", async (t) => {
  const { app } = await setup(t, {
    doctorService: {
      run: async (context) => ({
        status: "warning",
        generatedAt: "2026-07-07T00:00:00.000Z",
        context,
        summary: { pass: 1, warning: 1, blocked: 0 },
        checks: [{
          id: "free_rules",
          group: "catalog",
          label: "免费规则",
          status: "warning",
          reason: "规则缓存已过期。",
          evidence: "cache",
          nextAction: "更新规则提示。",
          actionRef: "auditFreeRules",
          cloudWrite: false
        }]
      })
    }
  });

  const response = await app.dispatch({
    method: "GET",
    url: "/api/doctor?configuration=acct-a&account=user%40example.com&projectId=project-a"
  });
  const post = await app.dispatch({
    method: "POST",
    url: "/api/doctor",
    body: { configuration: "acct-a", account: "user@example.com", projectId: "project-a" }
  });

  assert.equal(response.status, 200);
  assert.equal(response.body.status, "warning");
  assert.equal(response.body.context.configuration, "acct-a");
  assert.equal(response.body.checks[0].cloudWrite, false);
  assert.equal(post.status, 404);
});

test("server app previews external adoption from cloud, guest attributes, and SSH probe without cloud writes", async (t) => {
  const calls = [];
  const { app, runnerCalls } = await setup(t, {
    inventory: {
      async readObserved(input) {
        calls.push("cloud");
        return {
          ...input,
          exists: true,
          status: "RUNNING",
          labels: { gvc_deploy_method: "three_x_ui" },
          metadata: { gvcDeployMethod: "three_x_ui" },
          network: { externalIp: "203.0.113.10", externalIpMode: "ephemeral" }
        };
      },
      async listInstances() {
        return [];
      }
    },
    guestAttributesService: {
      async readConsoleAttributes(input) {
        calls.push("guest");
        return {
          available: true,
          namespace: "gcp-vm-console",
          values: { "deploy-method": "three_x_ui", "schema-version": "1" },
          warnings: []
        };
      }
    },
    deploymentProbeService: {
      async probe(input, ssh) {
        calls.push("probe");
        return {
          ssh: { desiredPort: ssh.port, actualPort: ssh.port, fallback: false, verified: true },
          services: [{ name: "x-ui", status: "active" }],
          ports: [{ protocol: "tcp", port: "45400", listening: true }],
          files: ["x-ui-binary"],
          bbr: true,
          warnings: [],
          checkedAt: "2026-07-08T10:00:00.000Z"
        };
      }
    },
    firewallGovernanceService: {
      async preview(input) {
        calls.push("governance");
        assert.equal(input.verification.ssh.actualPort, 45400);
        return {
          checkedAt: "2026-07-14T12:00:00.000Z",
          expiresAt: "2026-07-14T12:15:00.000Z",
          fingerprint: "adoption-governance",
          severity: "critical",
          findings: [{ name: "ruzhan1", ownership: "external", severity: "critical", affectedInstances: ["vm-a"] }],
          affectedInstances: ["vm-a"],
          coverage: { ready: true, uniqueTag: "vm-a", freshness: "fresh" },
          ownedActions: [],
          externalActions: [{ ruleName: "ruzhan1", type: "manual-review" }]
        };
      },
      async applyOwned() {
        throw new Error("not used");
      }
    }
  });

  const response = await app.dispatch({
    method: "POST",
    url: "/api/cloud-instances/adoption-preview",
    body: { identity, ssh: { user: "y", keyFile: "/tmp/gcp-key", port: 45400 } }
  });

  assert.equal(response.status, 200);
  assert.deepEqual(calls, ["cloud", "guest", "probe", "governance"]);
  assert.equal(response.body.recognition.method, "three_x_ui");
  assert.equal(response.body.recognition.source, "guest_attributes");
  assert.equal(response.body.sshProbe.services[0].name, "x-ui");
  assert.equal(response.body.firewallGovernance.externalActions[0].ruleName, "ruzhan1");
  assert.equal(runnerCalls.some((call) => call.command), false);
});

test("server app includes read-only firewall exposure in external adoption preview", async (t) => {
  const calls = [];
  const { app, runnerCalls } = await setup(t, {
    inventory: {
      async readObserved(input) {
        return {
          ...input,
          exists: true,
          status: "RUNNING",
          labels: {},
          metadata: {},
          network: { name: "default", externalIp: "203.0.113.10", externalIpMode: "ephemeral" },
          tags: ["xui-us-test"]
        };
      },
      async listInstances() {
        return [];
      }
    },
    deploymentProbeService: {
      async probe(input, ssh) {
        return {
          ssh: { desiredPort: ssh.port, actualPort: 22, fallback: true, verified: true },
          services: [{ name: "x-ui", status: "active" }],
          ports: [{ protocol: "tcp", port: "45400", process: "x-ui", listening: true }],
          files: ["x-ui-config-dir"],
          bbr: { enabled: true, congestionControl: "bbr", qdisc: "fq" },
          warnings: [],
          checkedAt: "2026-07-08T10:00:00.000Z"
        };
      }
    },
    firewallService: {
      async inspectInstanceExposure(input) {
        calls.push(input);
        return {
          status: "matched",
          matchedPorts: [{ protocol: "tcp", port: "45400", rule: "allow-xui-panel" }],
          missingPorts: [],
          exposedPorts: [{ protocol: "tcp", port: "45400", rule: "allow-xui-panel" }]
        };
      }
    }
  });

  const response = await app.dispatch({
    method: "POST",
    url: "/api/cloud-instances/adoption-preview",
    body: { identity, ssh: { user: "y", keyFile: "/tmp/gcp-key", port: 45400 } }
  });

  assert.equal(response.status, 200);
  assert.equal(response.body.firewallProbe.status, "matched");
  assert.equal(calls[0].identity.name, "vm-a");
  assert.equal(calls[0].cloudInstance.tags[0], "xui-us-test");
  assert.deepEqual(calls[0].expectedPorts, [{ protocol: "tcp", port: "45400" }]);
  assert.equal(runnerCalls.some((call) => call.command || call.jsonCommand), false);
});

test("external adoption diagnosis shares one project firewall list with governance analysis", async (t) => {
  let firewallLists = 0;
  const firewallService = createFirewallService({
    runner: {
      async run() {
        throw new Error("write command must not run");
      },
      async runJson(command) {
        assert.deepEqual(command.slice(0, 3), ["compute", "firewall-rules", "list"]);
        firewallLists += 1;
        return {
          data: [{
            name: "ruzhan1",
            network: "global/networks/default",
            direction: "INGRESS",
            sourceRanges: ["0.0.0.0/0"],
            targetTags: [],
            allowed: [{ IPProtocol: "all" }]
          }]
        };
      }
    }
  });
  const cloudInstance = {
    ...identity,
    exists: true,
    status: "RUNNING",
    network: { name: "default", externalIp: "203.0.113.10" },
    tags: ["vm-a"]
  };
  const { app } = await setup(t, {
    now: () => "2026-07-14T12:00:00.000Z",
    inventory: {
      async readObserved() { return cloudInstance; },
      async listInstances() { return [cloudInstance]; }
    },
    firewallService,
    deploymentProbeService: {
      async probe() {
        return {
          ssh: { desiredPort: 45400, actualPort: 45400, verified: true, fallback: false },
          services: [{ name: "x-ui", status: "active" }],
          ports: [{ protocol: "tcp", port: "8443", process: "x-ui", listening: true, exposureScope: "network" }],
          bbr: { enabled: true },
          checkedAt: "2026-07-14T11:59:00.000Z"
        };
      }
    }
  });

  const response = await app.dispatch({
    method: "POST",
    url: "/api/cloud-instances/adoption-preview",
    body: { identity, ssh: { user: "y", keyFile: "/tmp/gcp-key", port: 45400 } }
  });

  assert.equal(response.status, 200);
  assert.equal(firewallLists, 1);
  assert.equal(response.body.firewallGovernance.findings[0].name, "ruzhan1");
  assert.equal(response.body.firewallGovernance.externalActions[0].ruleName, "ruzhan1");
});

test("server app limits firewall exposure matching to deployment-relevant listeners", async (t) => {
  const calls = [];
  const { app } = await setup(t, {
    inventory: {
      async readObserved(input) {
        return {
          ...input,
          exists: true,
          status: "RUNNING",
          labels: {},
          metadata: {},
          network: { name: "default", externalIp: "203.0.113.10", externalIpMode: "ephemeral" },
          tags: ["xui-us-test"]
        };
      },
      async listInstances() {
        return [];
      }
    },
    deploymentProbeService: {
      async probe(input, ssh) {
        return {
          ssh: { desiredPort: ssh.port, actualPort: ssh.port, fallback: false, verified: true },
          services: [{ name: "x-ui", status: "active" }],
          ports: [
            { protocol: "tcp", port: "25", process: "exim4", listening: true },
            { protocol: "udp", port: "53", process: "systemd-resolve", listening: true },
            { protocol: "tcp", port: "45400", process: "sshd", listening: true, exposureScope: "wildcard" },
            { protocol: "tcp", port: "8443", process: "x-ui", listening: true, exposureScope: "wildcard" },
            { protocol: "tcp", port: "11111", process: "xray-linux-amd64", listening: true, exposureScope: "network" },
            { protocol: "tcp", port: "62789", process: "x-ui", listening: true, exposureScope: "loopback" }
          ],
          files: ["x-ui-config-dir"],
          bbr: { enabled: true, congestionControl: "bbr", qdisc: "fq" },
          warnings: [],
          checkedAt: "2026-07-08T10:00:00.000Z"
        };
      }
    },
    firewallService: {
      async inspectInstanceExposure(input) {
        calls.push(input);
        return {
          status: "partial",
          matchedPorts: [{ protocol: "tcp", port: "45400", rule: "allow-ssh" }],
          missingPorts: [{ protocol: "tcp", port: "8443" }, { protocol: "tcp", port: "11111" }],
          exposedPorts: [{ protocol: "tcp", port: "45400", rule: "allow-ssh" }]
        };
      }
    }
  });

  const response = await app.dispatch({
    method: "POST",
    url: "/api/cloud-instances/adoption-preview",
    body: { identity, ssh: { user: "y", keyFile: "/tmp/gcp-key", port: 45400 } }
  });

  assert.equal(response.status, 200);
  assert.deepEqual(calls[0].expectedPorts, [
    { protocol: "tcp", port: "45400" },
    { protocol: "tcp", port: "8443" },
    { protocol: "tcp", port: "11111" }
  ]);
});

test("server app adopts an external VM into a local record after user confirmation only", async (t) => {
  const { app, recordStore, runnerCalls } = await setup(t);
  const recognition = {
    method: "unmanaged_unknown",
    confidence: "none",
    source: "none",
    managedState: "unknown",
    evidence: [{ source: "ssh_probe", label: "服务", value: "x-ui active", confidence: "medium", sensitive: false }],
    warnings: ["证据不足"],
    suggestedAction: "manual_choose"
  };

  const blocked = await app.dispatch({
    method: "POST",
    url: "/api/cloud-instances/adopt-local",
    body: { identity, desired, recognition }
  });
  const adopted = await app.dispatch({
    method: "POST",
    url: "/api/cloud-instances/adopt-local",
    body: { identity, desired, recognition, userConfirmedMethod: "three_x_ui" }
  });
  const saved = await recordStore.get(adopted.body.record.id);

  assert.equal(blocked.status, 400);
  assert.match(blocked.body.error, /手动确认/);
  assert.equal(adopted.status, 200);
  assert.equal(adopted.body.record.status, "managed");
  assert.equal(adopted.body.record.desired.deploy.method, "three_x_ui");
  assert.equal(adopted.body.record.migration.adoption.managedState, "external_adopted");
  assert.equal(saved.migration.adoption.recognition.source, "user_confirmed");
  assert.equal(runnerCalls.some((call) => call.command || call.jsonCommand), false);
});

test("server app rejects adoption recognition evidence that contains raw links or credentials", async (t) => {
  const { app, recordStore } = await setup(t);

  const response = await app.dispatch({
    method: "POST",
    url: "/api/cloud-instances/adopt-local",
    body: {
      identity,
      desired,
      recognition: {
        method: "three_x_ui",
        confidence: "medium",
        source: "ssh_probe",
        managedState: "external_observed",
        evidence: [
          { source: "ssh_probe", label: "raw-link", value: "vless://secret@example", confidence: "medium" },
          { source: "ssh_probe", label: "panel password", value: "secret", confidence: "medium" }
        ],
        warnings: [],
        suggestedAction: "adopt"
      }
    }
  });

  assert.equal(response.status, 400);
  assert.match(response.body.error, /敏感/);
  assert.deepEqual(await recordStore.list(), []);
});

test("server app saves a draft, generates a fingerprinted preview, and executes it through a job", async (t) => {
  const { app, runnerCalls } = await setup(t);

  const saved = await app.dispatch({
    method: "POST",
    url: "/api/vm-records",
    body: { status: "draft", identity, desired }
  });
  const recordId = saved.body.record.id;
  const preview = await app.dispatch({ method: "POST", url: `/api/vm-records/${recordId}/preview` });
  const executed = await app.dispatch({
    method: "POST",
    url: `/api/vm-records/${recordId}/execute`,
    body: { previewFingerprint: preview.body.preview.fingerprint, idempotencyKey: "api-create-1" }
  });

  assert.equal(preview.body.preview.actions[0].id, "create-vm");
  assert.equal(executed.body.job.status, "succeeded");
  assert.equal(executed.body.job.result.status, "succeeded");
  assert.equal(runnerCalls.length, 1);
  assert.deepEqual(runnerCalls[0].command.slice(0, 4), ["compute", "instances", "create", "vm-a"]);
});

test("server app deletes only the local VM record through the local delete endpoint", async (t) => {
  const { app, recordStore, runnerCalls } = await setup(t);
  const saved = await recordStore.save({ status: "draft", identity, desired });

  const response = await app.dispatch({ method: "DELETE", url: `/api/vm-records/${saved.id}` });

  assert.equal(response.status, 200);
  assert.equal(response.body.deletedLocalRecord, true);
  assert.equal(await recordStore.get(saved.id), null);
  assert.equal(runnerCalls.length, 0);
});

test("server app runs maintenance endpoints as jobs against the selected VM record", async (t) => {
  const { app, recordStore, runnerCalls } = await setup(t);
  const saved = await recordStore.save({
    status: "managed",
    identity,
    desired: { ...desired, ssh: { user: "y", keyFile: "/tmp/gcp-key", port: 45400 } }
  });

  const status = await app.dispatch({ method: "POST", url: `/api/vm-records/${saved.id}/maintenance/status` });
  const restart = await app.dispatch({ method: "POST", url: `/api/vm-records/${saved.id}/maintenance/restart` });
  const update = await app.dispatch({ method: "POST", url: `/api/vm-records/${saved.id}/maintenance/system-update` });
  const updatedRecord = await recordStore.get(saved.id);

  assert.equal(status.status, 200);
  assert.equal(status.body.job.type, "maintenance-status");
  assert.equal(status.body.job.result.status, "RUNNING");
  assert.equal(restart.body.job.type, "maintenance-restart");
  assert.equal(restart.body.job.result.interruption, "stop_start");
  assert.equal(update.body.job.type, "maintenance-system-update");
  assert.deepEqual(update.body.job.result.stages, ["precheck", "update", "postcheck"]);
  assert.equal(update.body.job.result.ssh.actualPort, 22);
  assert.equal(updatedRecord.observed.sshConnection.actualPort, 22);
  assert.equal(updatedRecord.observed.sshConnection.fallback, true);
  assert.deepEqual(runnerCalls.filter((call) => call.maintenance).map((call) => call.maintenance), [
    "status",
    "restart",
    "system-update"
  ]);
  assert.deepEqual(runnerCalls.find((call) => call.maintenance === "system-update").ssh, {
    sshUser: "y",
    sshKeyFile: "/tmp/gcp-key",
    sshPort: 45400
  });
});

test("server app exposes persistent read-only job history newest first", async (t) => {
  const { app, jobRoot, recordStore, runnerCalls } = await setup(t);
  const saved = await recordStore.save({
    status: "managed",
    identity,
    desired: { ...desired, ssh: { user: "y", keyFile: "/tmp/gcp-key", port: 45400 } }
  });

  await app.dispatch({ method: "POST", url: `/api/vm-records/${saved.id}/maintenance/status` });
  await app.dispatch({ method: "POST", url: `/api/vm-records/${saved.id}/nodes/deploy` });

  const history = await app.dispatch({ method: "GET", url: "/api/jobs" });
  const post = await app.dispatch({ method: "POST", url: "/api/jobs", body: {} });
  const del = await app.dispatch({ method: "DELETE", url: "/api/jobs" });

  assert.equal(history.status, 200);
  assert.deepEqual(history.body.jobs.map((job) => job.type), ["node-deploy", "maintenance-status"]);
  assert.ok(history.body.jobs[0].createdAt > history.body.jobs[1].createdAt);
  assert.deepEqual(history.body.meta, {
    storage: "persistent",
    recoveredInterrupted: 0,
    quarantined: 0,
    quarantineFailures: 0,
    pruned: 0,
    pruneFailures: 0,
    degradedWrites: 0,
    maxJobs: 200,
    maxAgeDays: 30
  });
  assert.equal(post.status, 404);
  assert.equal(del.status, 404);

  const callsBeforeRestart = runnerCalls.length;
  const restarted = createJobStore({ rootDir: jobRoot, now: () => "2026-06-17T12:10:00.000Z" });
  assert.deepEqual(restarted.list().map((job) => job.type), ["maintenance-status", "node-deploy"]);
  assert.equal(runnerCalls.length, callsBeforeRestart);
});

test("server app deploys nodes and persists node result on the VM record", async (t) => {
  const { app, recordStore, runnerCalls } = await setup(t);
  const saved = await recordStore.save({
    status: "managed",
    identity,
    desired: {
      ...desired,
      deploy: { method: "singbox_plus", network: "default", targetTags: ["vm-a"] },
      ssh: { user: "y", keyFile: "/tmp/gcp-key", port: 45400 }
    }
  });

  const response = await app.dispatch({ method: "POST", url: `/api/vm-records/${saved.id}/nodes/deploy` });
  const updated = await recordStore.get(saved.id);

  assert.equal(response.status, 200);
  assert.equal(response.body.job.type, "node-deploy");
  assert.equal(response.body.job.result.nodeResult.links[0].url, "tuic://result");
  assert.equal(response.body.job.result.ssh.actualPort, 22);
  assert.equal(updated.nodeResult.links[0].name, "tuic-v5");
  assert.equal(updated.nodeResult.ssh.actualPort, 22);
  assert.equal(updated.verification.status, "passed");
  assert.equal(updated.observed.sshConnection.actualPort, 22);
  assert.equal(runnerCalls.find((call) => call.nodeDeploy).nodeDeploy.deploy.method, "singbox_plus");
  assert.equal(runnerCalls.find((call) => call.verification).verification.nodeResult.links[0].url, "tuic://result");
});

test("post-deploy verification downgrades to partial when an external shared rule is critical", async (t) => {
  const governance = criticalFirewallGovernance();
  const { app, recordStore } = await setup(t, {
    firewallGovernanceService: {
      async preview() { return governance; },
      async applyOwned() { throw new Error("not used"); }
    }
  });
  const saved = await recordStore.save({
    status: "managed",
    identity,
    desired: {
      ...desired,
      deploy: { method: "singbox_plus" },
      ssh: { user: "y", keyFile: "/tmp/gcp-key", port: 45400 }
    }
  });

  const response = await app.dispatch({ method: "POST", url: `/api/vm-records/${saved.id}/nodes/deploy` });
  const updated = await recordStore.get(saved.id);

  assert.equal(response.status, 200);
  assert.equal(response.body.job.status, "partial");
  assert.equal(response.body.job.result.verification.status, "partial");
  assert.equal(response.body.job.result.verification.firewall.status, "overexposed");
  assert.match(response.body.job.result.verification.checks.find((check) => check.id === "firewall").detail, /ruzhan1/);
  assert.equal(updated.verification.status, "partial");
  assert.equal(updated.observed.firewallGovernance.severity, "critical");
  assert.equal(updated.nodeResult.links.length, 1);
});

test("server app verifies a selected VM and persists local verification state", async (t) => {
  const { app, recordStore } = await setup(t, {
    deploymentVerifier: {
      async verify() {
        return {
          status: "passed",
          checkedAt: "2026-07-05T00:00:00.000Z",
          method: "singbox_plus",
          ssh: { desiredPort: 45400, actualPort: 22, fallback: true, verified: true, label: "SSH 实际连接 22（已从 45400 回退）" },
          checks: [{ id: "ssh", label: "SSH 连接", status: "passed", detail: "connected" }],
          firewall: { status: "matched", rules: [] },
          warnings: []
        };
      }
    }
  });
  const saved = await recordStore.save({
    status: "managed",
    identity,
    desired: { ...desired, deploy: { method: "singbox_plus" }, ssh: { user: "y", keyFile: "/tmp/gcp-key", port: 45400 } },
    nodeResult: { type: "singbox_plus", links: [{ name: "tuic-v5", protocol: "udp", port: "23293", url: "tuic://result" }] }
  });

  const response = await app.dispatch({ method: "POST", url: `/api/vm-records/${saved.id}/verify` });
  const updated = await recordStore.get(saved.id);

  assert.equal(response.status, 200);
  assert.equal(response.body.job.type, "verification");
  assert.equal(updated.verification.status, "passed");
  assert.equal(updated.observed.sshConnection.actualPort, 22);
});

test("known deployment verification still uses the metadata-safe live recognition probe", async (t) => {
  const probeCalls = [];
  const verificationInputs = [];
  const { app, recordStore } = await setup(t, {
    deploymentProbeService: {
      async probe(input, sshInput) {
        probeCalls.push({ input, sshInput });
        return {
          ssh: { desiredPort: 45400, actualPort: 45400, fallback: false, verified: true, label: "SSH 实际连接 45400" },
          services: [{ name: "sing-box", status: "active" }],
          ports: [
            { protocol: "udp", port: "23293", process: "sing-box", listening: true, exposureScope: "wildcard" },
            { protocol: "tcp", port: "39999", process: "sing-box", listening: true, exposureScope: "wildcard" }
          ],
          files: ["sing-box-systemd"],
          processes: [{ command: "sing-box", args: "/usr/local/bin/sing-box run" }],
          bbr: { enabled: true, congestionControl: "bbr", qdisc: "fq" },
          warnings: [],
          checkedAt: "2026-07-16T11:00:00.000Z"
        };
      }
    },
    firewallService: {
      async inspectInstanceExposure(input) {
        return { status: "matched", matchedPorts: input.expectedPorts, missingPorts: [], exposedPorts: input.expectedPorts, rules: [] };
      }
    },
    deploymentVerifier: {
      async verify(input) {
        verificationInputs.push(input);
        return {
          status: "passed",
          checkedAt: "2026-07-16T11:00:00.000Z",
          method: input.methodOverride,
          ssh: input.runtimeProbe.ssh,
          bbr: input.runtimeProbe.bbr,
          checks: [{ id: "ssh", label: "SSH 连接", status: "passed", detail: input.runtimeProbe.ssh.label }],
          services: input.runtimeProbe.services,
          ports: input.expectedRuntimePorts.map((port) => ({ ...port, expected: true, listening: true })),
          firewall: input.firewallProbe,
          warnings: []
        };
      }
    }
  });
  const saved = await recordStore.save({
    status: "managed",
    identity,
    desired: { ...desired, deploy: { method: "singbox_plus" }, ssh: { user: "y", keyFile: "/tmp/gcp-key", port: 45400 } },
    nodeResult: { type: "singbox_plus", links: [{ name: "tuic-v5", protocol: "udp", port: "23293", url: "tuic://result" }] }
  });

  const response = await app.dispatch({ method: "POST", url: `/api/vm-records/${saved.id}/verify` });

  assert.equal(response.status, 200);
  assert.equal(probeCalls.length, 1);
  assert.equal(verificationInputs[0].methodOverride, "singbox_plus");
  assert.equal(verificationInputs[0].runtimeProbe.ssh.actualPort, 45400);
  assert.equal(verificationInputs[0].firewallProbe.status, "matched");
  assert.deepEqual(verificationInputs[0].expectedRuntimePorts, [{ protocol: "udp", port: "23293" }]);
});

test("verification jobs retain node results and surface critical project firewall exposure", async (t) => {
  const governance = criticalFirewallGovernance();
  const { app, recordStore } = await setup(t, {
    firewallGovernanceService: {
      async preview() { return governance; },
      async applyOwned() { throw new Error("not used"); }
    },
    deploymentVerifier: {
      async verify() {
        return {
          status: "passed",
          checkedAt: "2026-07-16T09:20:00.000Z",
          method: "singbox_plus",
          ssh: { desiredPort: 45400, actualPort: 45400, fallback: false, verified: true, label: "SSH 实际连接 45400" },
          bbr: { enabled: true, congestionControl: "bbr", qdisc: "fq" },
          checks: [{ id: "firewall", label: "防火墙", status: "passed", detail: "自有规则匹配" }],
          firewall: { status: "overexposed", rules: [], missingPorts: [] },
          warnings: []
        };
      }
    }
  });
  const saved = await recordStore.save({
    status: "managed",
    identity,
    desired: { ...desired, deploy: { method: "singbox_plus" }, ssh: { user: "y", keyFile: "/tmp/gcp-key", port: 45400 } },
    nodeResult: { type: "singbox_plus", bbr: true, links: [{ name: "tuic-v5", protocol: "udp", port: "23293", url: "tuic://result" }] }
  });

  const response = await app.dispatch({ method: "POST", url: `/api/vm-records/${saved.id}/verify` });
  const updated = await recordStore.get(saved.id);

  assert.equal(response.status, 200);
  assert.equal(response.body.job.status, "partial");
  assert.equal(response.body.job.result.status, "partial");
  assert.equal(response.body.job.result.nodeResult.links[0].url, "tuic://result");
  assert.equal(response.body.job.result.firewall.status, "overexposed");
  assert.equal(response.body.job.result.firewall.ownedStatus, "matched");
  assert.equal(updated.verification.status, "partial");
  assert.equal(updated.observed.firewallGovernance.severity, "critical");
});

test("server app preserves last usable verification when the latest verification throws", async (t) => {
  const { app, recordStore } = await setup(t, {
    deploymentVerifier: {
      async verify() {
        throw new Error("SSH failed token=secret-value");
      }
    }
  });
  const previous = {
    status: "passed",
    checkedAt: "2026-07-10T10:00:00.000Z",
    method: "singbox_plus",
    ssh: { desiredPort: 45400, actualPort: 45400, verified: true }
  };
  const saved = await recordStore.save({
    status: "managed",
    identity,
    desired: { ...desired, deploy: { method: "singbox_plus" }, ssh: { user: "y", keyFile: "/tmp/gcp-key", port: 45400 } },
    verification: previous,
    observed: { sshConnection: previous.ssh }
  });

  const response = await app.dispatch({ method: "POST", url: `/api/vm-records/${saved.id}/verify` });
  const updated = await recordStore.get(saved.id);

  assert.equal(response.status, 500);
  assert.deepEqual(updated.verification, previous);
  assert.equal(updated.observed.lastProbeAttempt.status, "failed");
  assert.equal(updated.observed.lastProbeAttempt.evidenceAvailable, false);
  assert.equal(JSON.stringify(updated).includes("secret-value"), false);
});

test("server app deep-probes stale vm-only records before verifying BBR and firewall", async (t) => {
  const verificationInputs = [];
  const { app, recordStore } = await setup(t, {
    inventory: {
      async readObserved(input) {
        return {
          ...input,
          exists: true,
          status: "RUNNING",
          tags: ["vm-a"],
          labels: {},
          metadata: {},
          network: { externalIp: "203.0.113.10", externalIpMode: "ephemeral" }
        };
      },
      async listInstances() {
        return [];
      }
    },
    deploymentProbeService: {
      async probe(input, sshInput) {
        return {
          ssh: { desiredPort: sshInput.sshPort, actualPort: sshInput.sshPort, fallback: false, verified: true, label: `SSH 实际连接 ${sshInput.sshPort}` },
          services: [{ name: "x-ui", status: "active" }],
          ports: [
            { protocol: "tcp", port: "45400", process: "sshd", listening: true, exposureScope: "wildcard" },
            { protocol: "tcp", port: "8443", process: "x-ui", listening: true, exposureScope: "wildcard" },
            { protocol: "tcp", port: "11111", process: "xray-linux-amd64", listening: true, exposureScope: "network" },
            { protocol: "tcp", port: "62789", process: "x-ui", listening: true, exposureScope: "loopback" }
          ],
          files: ["x-ui-config-dir"],
          processes: [{ command: "x-ui", args: "/usr/local/x-ui/x-ui" }],
          containers: [],
          configSummary: [{ kind: "xray-inbound", protocols: ["vless"] }],
          bbr: { enabled: true, congestionControl: "bbr", qdisc: "fq" },
          warnings: [],
          checkedAt: "2026-07-10T00:00:00.000Z"
        };
      }
    },
    firewallService: {
      async inspectInstanceExposure(input) {
        return {
          status: "matched",
          matchedPorts: input.expectedPorts,
          missingPorts: [],
          exposedPorts: input.expectedPorts,
          rules: [{ name: "allow-xui", targetTags: ["vm-a"], sourceRanges: ["0.0.0.0/0"] }]
        };
      }
    },
    deploymentVerifier: {
      async verify(input) {
        verificationInputs.push(input);
        return {
          status: "passed",
          checkedAt: "2026-07-10T00:00:00.000Z",
          method: input.methodOverride,
          ssh: input.runtimeProbe.ssh,
          bbr: input.runtimeProbe.bbr,
          checks: [
            { id: "ssh", label: "SSH 连接", status: "passed", detail: input.runtimeProbe.ssh.label },
            { id: "bbr", label: "BBR", status: "passed", detail: "BBR 已开启" },
            { id: "firewall", label: "防火墙", status: "passed", detail: "规则匹配" }
          ],
          services: input.runtimeProbe.services,
          ports: input.expectedRuntimePorts.map((port) => ({ ...port, expected: true, listening: true })),
          firewall: input.firewallProbe,
          warnings: []
        };
      }
    }
  });
  const saved = await recordStore.save({
    status: "managed",
    identity,
    desired: { ...desired, deploy: { method: "vm_only" }, ssh: { user: "y", keyFile: "/tmp/gcp-key", port: 45400 } },
    observed: { exists: true, status: "RUNNING", tags: ["vm-a"], network: { externalIp: "203.0.113.10" } }
  });

  const response = await app.dispatch({ method: "POST", url: `/api/vm-records/${saved.id}/verify` });
  const updated = await recordStore.get(saved.id);

  assert.equal(response.status, 200);
  assert.equal(verificationInputs[0].methodOverride, "three_x_ui");
  assert.equal(updated.verification.methodConfidence, "high");
  assert.equal(updated.verification.methodSource, "ssh_deep_probe");
  assert.equal(verificationInputs[0].runtimeProbe.bbr.enabled, true);
  assert.equal(verificationInputs[0].firewallProbe.status, "matched");
  assert.deepEqual(verificationInputs[0].expectedRuntimePorts, [
    { protocol: "tcp", port: "8443" },
    { protocol: "tcp", port: "11111" }
  ]);
  assert.equal(updated.desired.deploy.method, "vm_only");
  assert.equal(updated.verification.method, "three_x_ui");
  assert.equal(updated.verification.bbr.enabled, true);
  assert.equal(updated.verification.firewall.status, "matched");
});

test("server app preserves partial node deployment status when firewall sync fails", async (t) => {
  const { app, recordStore } = await setup(t, {
    nodePipeline: {
      async deploy() {
        return {
          method: "singbox_plus",
          status: "partial",
          stages: ["install", "firewall_sync", "collect"],
          firewall: { status: "failed", error: "firewall denied", rules: [] },
          nodeResult: {
            type: "singbox_plus",
            links: [{ name: "tuic-v5", protocol: "udp", port: "23293", url: "tuic://result" }],
            firewall: { status: "failed", error: "firewall denied", rules: [] }
          }
        };
      }
    }
  });
  const saved = await recordStore.save({
    status: "managed",
    identity,
    desired: {
      ...desired,
      deploy: { method: "singbox_plus", network: "default", targetTags: ["vm-a"] },
      ssh: { user: "y", keyFile: "/tmp/gcp-key", port: 45400 }
    }
  });

  const response = await app.dispatch({ method: "POST", url: `/api/vm-records/${saved.id}/nodes/deploy` });
  const updated = await recordStore.get(saved.id);

  assert.equal(response.status, 200);
  assert.equal(response.body.job.status, "partial");
  assert.equal(response.body.job.result.firewall.status, "failed");
  assert.equal(updated.history.at(-1).status, "partial");
});

test("server app retires the legacy owned-firewall write endpoint without mutating cloud or records", async (t) => {
  const calls = [];
  const preview = {
    schemaVersion: 1,
    checkedAt: "2026-07-14T12:00:00.000Z",
    expiresAt: "2026-07-14T12:15:00.000Z",
    fingerprint: "firewall-preview-fingerprint",
    severity: "critical",
    findings: [{ name: "ruzhan1", ownership: "external", severity: "critical" }],
    affectedInstances: ["vm-a"],
    coverage: { ready: true, uniqueTag: "vm-a", freshness: "fresh", blockedReason: "" },
    ownedActions: [{ name: "gvc-vm-a-ssh-iap-tcp", action: "create" }],
    externalActions: [{ type: "manual-review", ruleName: "ruzhan1" }]
  };
  const { app, recordStore } = await setup(t, {
    firewallGovernanceService: {
      async preview() { return preview; },
      async applyOwned(input) {
        calls.push(input);
        input.onStage?.({ name: "ensure_owned_rules", status: "succeeded", detail: "owned rules ensured" });
        input.onStage?.({ name: "post_verify", status: "succeeded", detail: "post verification complete" });
        return {
          status: "partial",
          changes: [{ name: "gvc-vm-a-ssh-iap-tcp", action: "created" }],
          governance: { ...preview, ownedActions: [] }
        };
      }
    }
  });
  const saved = await recordStore.save({
    status: "managed",
    identity,
    desired: { ...desired, ssh: { user: "y", keyFile: "/tmp/gcp-key", port: 45400 } },
    observed: { firewallGovernance: preview }
  });

  const response = await app.dispatch({
    method: "POST",
    url: `/api/vm-records/${saved.id}/firewall/apply-owned`,
    body: { fingerprint: preview.fingerprint, rules: [{ name: "ruzhan1", action: "disable" }] }
  });
  const updated = await recordStore.get(saved.id);

  assert.equal(response.status, 404);
  assert.equal(calls.length, 0);
  assert.deepEqual(updated.observed.firewallGovernance, preview);
  assert.equal(updated.history.length, 0);
});

test("server app blocks maintenance and node cloud writes when live inventory preflight fails", async (t) => {
  const calls = [];
  const blockedInventory = {
    async readObserved() {
      throw new Error("ProxyError: Tunnel connection failed: 503 Service Unavailable");
    },
    async listInstances() {
      throw new Error("ProxyError: Tunnel connection failed: 503 Service Unavailable");
    }
  };
  const { app, recordStore } = await setup(t, {
    inventory: blockedInventory,
    maintenanceService: {
      async restartVm() { calls.push("restart"); },
      async systemUpdate() { calls.push("system-update"); }
    },
    nodePipeline: {
      async deploy() { calls.push("node-deploy"); }
    }
  });
  const saved = await recordStore.save({
    status: "managed",
    identity,
    desired: { ...desired, deploy: { method: "singbox_plus" }, ssh: { user: "y", keyFile: "/tmp/gcp-key", port: 45400 } }
  });

  const responses = [];
  responses.push(await app.dispatch({ method: "POST", url: `/api/vm-records/${saved.id}/maintenance/restart` }));
  responses.push(await app.dispatch({ method: "POST", url: `/api/vm-records/${saved.id}/maintenance/system-update` }));
  responses.push(await app.dispatch({ method: "POST", url: `/api/vm-records/${saved.id}/nodes/deploy` }));

  assert.equal(responses.every((response) => response.status === 503), true);
  assert.equal(responses.every((response) => response.body.code === "proxy_upstream"), true);
  assert.deepEqual(calls, []);
});
