import assert from "node:assert/strict";
import test from "node:test";

import { createDoctorService } from "../server/doctor-service.js";

function ids(payload) {
  return Object.fromEntries(payload.checks.map((check) => [check.id, check]));
}

test("doctor reports proxy listener state without changing proxy configuration", async () => {
  const service = createDoctorService({
    now: () => new Date("2026-07-14T12:00:00.000Z"),
    accountService: { listConfigurations: async () => [] },
    recordStore: { list: async () => [] },
    proxyInspector: {
      async inspect() {
        return { configured: true, status: "unreachable", endpoint: "127.0.0.1:1082", source: "https_proxy" };
      }
    }
  });

  const checks = ids(await service.run({}));
  assert.equal(checks.proxy_transport.status, "blocked");
  assert.match(checks.proxy_transport.evidence, /127\.0\.0\.1:1082/);
  assert.equal(checks.proxy_transport.cloudWrite, false);
});

test("doctor returns blocked checks when account and project context are missing", async () => {
  const service = createDoctorService({
    now: () => new Date("2026-07-07T00:00:00.000Z"),
    accountService: { listConfigurations: async () => [] },
    recordStore: { list: async () => [] }
  });

  const payload = await service.run({});
  const checks = ids(payload);

  assert.equal(payload.status, "blocked");
  assert.equal(payload.generatedAt, "2026-07-07T00:00:00.000Z");
  assert.equal(checks.gcloud_accounts.status, "blocked");
  assert.equal(checks.project_access.status, "blocked");
  assert.equal(checks.project_access.cloudWrite, false);
  assert.match(checks.project_access.nextAction, /选择账号和项目/);
});

test("doctor summarizes pass warning and blocked states without cloud writes", async () => {
  const calls = [];
  const service = createDoctorService({
    now: () => new Date("2026-07-07T00:00:00.000Z"),
    accountService: {
      listConfigurations: async () => [{ configuration: "acct-a", account: "user@example.com" }],
      listProjects: async () => [{ projectId: "project-a" }]
    },
    regionCatalog: {
      load: async () => ({
        stale: false,
        regions: [{ id: "us-west1" }],
        freeRegionIds: ["us-west1"],
        source: { type: "gcloud-derived" }
      })
    },
    freeRuleService: {
      load: async () => ({
        stale: true,
        rules: { compute: { alwaysFreeRegions: ["us-west1"] } },
        source: { type: "cache" }
      })
    },
    cloudInventory: {
      listInstances: async () => [{ name: "vm-a", status: "RUNNING", zone: "us-west1-b" }]
    },
    recordStore: {
      list: async () => [{ id: "rec-a", name: "vm-a", projectId: "project-a", verification: { status: "partial" } }]
    },
    runner: {
      runJson: async (args) => {
        calls.push(args);
        return [{ config: { name: "compute.googleapis.com" } }, { config: { name: "iap.googleapis.com" } }];
      }
    }
  });

  const payload = await service.run({ configuration: "acct-a", account: "user@example.com", projectId: "project-a" });
  const checks = ids(payload);

  assert.equal(payload.context.projectId, "project-a");
  assert.equal(checks.api_services.status, "warning");
  assert.match(checks.api_services.evidence, /iam.googleapis.com/);
  assert.equal(checks.region_catalog.status, "pass");
  assert.equal(checks.free_rules.status, "warning");
  assert.equal(checks.inventory_sync.status, "pass");
  assert.equal(checks.verification_state.status, "warning");
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].slice(0, 3), ["services", "list", "--enabled"]);
});

test("doctor reports whether the project inventory is live or restored from cache", async () => {
  let legacyListCalls = 0;
  const service = createDoctorService({
    now: () => new Date("2026-07-14T12:00:00.000Z"),
    accountService: {
      listConfigurations: async () => [{ configuration: "acct-a", account: "user@example.com" }],
      listProjects: async () => [{ projectId: "project-a" }]
    },
    regionCatalog: { load: async () => ({ stale: false, regions: [{ id: "us-west1" }] }) },
    freeRuleService: { load: async () => ({ stale: false, rules: { compute: { alwaysFreeRegions: ["us-west1"] } } }) },
    cloudInventory: {
      async listInstancesSnapshot() {
        return {
          instances: [{ name: "vm-a", status: "RUNNING" }],
          meta: {
            source: "cache",
            checkedAt: "2026-07-14T11:40:00.000Z",
            stale: true,
            ageSeconds: 1200,
            retryAttempts: 3,
            blocker: { category: "proxy", code: "proxy_upstream", message: "代理上游不可用" }
          }
        };
      },
      async listInstances() {
        legacyListCalls += 1;
        return [];
      }
    },
    recordStore: { list: async () => [] },
    runner: { runJson: async () => [
      { config: { name: "compute.googleapis.com" } },
      { config: { name: "iam.googleapis.com" } },
      { config: { name: "iap.googleapis.com" } }
    ] }
  });

  const checks = ids(await service.run({ configuration: "acct-a", account: "user@example.com", projectId: "project-a" }));
  assert.equal(legacyListCalls, 0);
  assert.equal(checks.inventory_source.status, "warning");
  assert.match(checks.inventory_source.reason, /缓存/);
  assert.match(checks.inventory_source.evidence, /20 分钟|1200/);
  assert.match(checks.inventory_source.evidence, /proxy_upstream/);
});

test("doctor reports SSH firewall BBR and node verification state from local evidence", async () => {
  const service = createDoctorService({
    now: () => new Date("2026-07-07T00:00:00.000Z"),
    accountService: {
      listConfigurations: async () => [{ configuration: "acct-a", account: "user@example.com" }],
      listProjects: async () => [{ projectId: "project-a" }]
    },
    regionCatalog: {
      load: async () => ({ stale: false, regions: [{ id: "us-west1" }], freeRegionIds: ["us-west1"] })
    },
    freeRuleService: {
      load: async () => ({ stale: false, rules: { compute: { alwaysFreeRegions: ["us-west1"] } } })
    },
    cloudInventory: {
      listInstances: async () => [{ name: "vm-a", status: "RUNNING", zone: "us-west1-b" }]
    },
    recordStore: {
      list: async () => [{
        id: "rec-a",
        identity: { name: "vm-a", projectId: "project-a" },
        observed: { sshConnection: { verified: true, actualPort: 22, fallback: true } },
        nodeResult: { bbr: true, links: [{ name: "hy2", url: "hysteria2://example" }] },
        verification: {
          status: "passed",
          checkedAt: "2026-07-06T23:55:00.000Z",
          method: "singbox_plus",
          ssh: { verified: true, actualPort: 22, fallback: true },
          bbr: { enabled: true },
          firewall: { status: "matched", rules: [{ name: "vm-a-allow-hy2" }] },
          services: [{ name: "sing-box", status: "active" }],
          checks: [{ id: "service", label: "节点服务", status: "passed", detail: "active" }]
        }
      }]
    },
    runner: { runJson: async () => [{ config: { name: "compute.googleapis.com" } }, { config: { name: "iam.googleapis.com" } }, { config: { name: "iap.googleapis.com" } }] }
  });

  const payload = await service.run({ configuration: "acct-a", account: "user@example.com", projectId: "project-a" });
  const checks = ids(payload);

  assert.equal(checks.ssh_state.status, "pass");
  assert.match(checks.ssh_state.evidence, /22/);
  assert.equal(checks.firewall_state.status, "pass");
  assert.equal(checks.bbr_state.status, "pass");
  assert.equal(checks.node_service_state.status, "pass");
});

test("doctor synchronizes runtime summaries from each record's current evidence instead of the first matching record", async () => {
  const records = [
    {
      identity: { name: "example-singbox-instance", projectId: "project-a" },
      desired: { deploy: { method: "singbox_plus" } },
      verification: {
        status: "passed",
        checkedAt: "2026-07-10T11:58:00.000Z",
        method: "singbox_plus",
        ssh: { desiredPort: 45400, actualPort: 45400, verified: true, fallback: false },
        bbr: { enabled: true },
        firewall: { status: "overexposed", broadRuleNames: ["ruzhan1"] },
        services: [{ name: "sing-box", status: "active" }]
      },
      nodeResult: { links: [] }
    },
    {
      identity: { name: "example-xui-instance", projectId: "project-a" },
      desired: { deploy: { method: "three_x_ui" } },
      verification: {
        status: "passed",
        checkedAt: "2026-07-10T11:57:00.000Z",
        method: "three_x_ui",
        ssh: { desiredPort: 45400, actualPort: 45400, verified: true, fallback: false },
        bbr: { enabled: true },
        firewall: { status: "overexposed", broadRuleNames: ["ruzhan1"] },
        services: [{ name: "x-ui", status: "active" }]
      },
      nodeResult: { links: [] }
    }
  ];
  const service = createDoctorService({
    now: () => new Date("2026-07-10T12:00:00.000Z"),
    accountService: {
      listConfigurations: async () => [{ configuration: "acct-a", account: "user@example.com" }],
      listProjects: async () => [{ projectId: "project-a" }]
    },
    regionCatalog: { load: async () => ({ stale: false, regions: [{ id: "us-west1" }] }) },
    freeRuleService: { load: async () => ({ stale: false, rules: { compute: { alwaysFreeRegions: ["us-west1"] } } }) },
    cloudInventory: { listInstances: async () => records.map((record) => ({ name: record.identity.name, status: "RUNNING" })) },
    recordStore: { list: async () => records },
    runner: { runJson: async () => [
      { config: { name: "compute.googleapis.com" } },
      { config: { name: "iam.googleapis.com" } },
      { config: { name: "iap.googleapis.com" } }
    ] }
  });

  const checks = ids(await service.run({ configuration: "acct-a", account: "user@example.com", projectId: "project-a" }));
  assert.equal(checks.ssh_state.status, "pass");
  assert.match(checks.ssh_state.evidence, /2\/2 已验证/);
  assert.match(checks.ssh_state.evidence, /45400/);
  assert.equal(checks.bbr_state.status, "pass");
  assert.match(checks.bbr_state.evidence, /2\/2 已启用/);
  assert.equal(checks.firewall_state.status, "warning");
  assert.match(checks.firewall_state.reason, /过度开放/);
  assert.match(checks.firewall_state.evidence, /ruzhan1/);
  assert.equal(checks.node_service_state.status, "pass");
  assert.match(checks.node_service_state.evidence, /2\/2 运行中/);
  assert.doesNotMatch(checks.node_service_state.evidence, /0 links/);
});

test("doctor marks retained evidence as historical after the newest probe attempt fails", async () => {
  const record = {
    identity: { name: "vm-a", projectId: "project-a" },
    desired: { deploy: { method: "singbox_plus" } },
    observed: { lastProbeAttempt: { status: "failed", checkedAt: "2026-07-10T11:59:00.000Z", message: "SSH 连接失败" } },
    verification: {
      status: "passed", checkedAt: "2026-07-10T11:40:00.000Z", method: "singbox_plus",
      ssh: { actualPort: 45400, verified: true }, bbr: { enabled: true },
      firewall: { status: "matched" }, services: [{ name: "sing-box", status: "active" }]
    }
  };
  const service = createDoctorService({
    now: () => new Date("2026-07-10T12:00:00.000Z"),
    accountService: {
      listConfigurations: async () => [{ configuration: "acct-a", account: "user@example.com" }],
      listProjects: async () => [{ projectId: "project-a" }]
    },
    regionCatalog: { load: async () => ({ stale: false, regions: [{ id: "us-west1" }] }) },
    freeRuleService: { load: async () => ({ stale: false, rules: { compute: { alwaysFreeRegions: ["us-west1"] } } }) },
    cloudInventory: { listInstances: async () => [{ name: "vm-a", status: "RUNNING" }] },
    recordStore: { list: async () => [record] },
    runner: { runJson: async () => [
      { config: { name: "compute.googleapis.com" } },
      { config: { name: "iam.googleapis.com" } },
      { config: { name: "iap.googleapis.com" } }
    ] }
  });

  const checks = ids(await service.run({ configuration: "acct-a", account: "user@example.com", projectId: "project-a" }));
  assert.equal(checks.ssh_state.status, "warning");
  assert.match(checks.ssh_state.reason, /历史|失败/);
  assert.match(checks.ssh_state.evidence, /45400/);
});

test("doctor treats observed active services as applicable even when persisted intent is vm-only", async () => {
  const record = {
    identity: { name: "xui-a", projectId: "project-a" },
    desired: { deploy: { method: "vm_only" } },
    verification: {
      status: "passed",
      checkedAt: "2026-07-10T11:59:00.000Z",
      method: "three_x_ui",
      methodConfidence: "high",
      methodSource: "ssh_deep_probe",
      ssh: { verified: true, actualPort: 45400 },
      bbr: { enabled: true },
      firewall: { status: "overexposed", broadRuleNames: ["ruzhan1"] },
      services: [{ name: "x-ui", status: "active" }]
    }
  };
  const service = createDoctorService({
    now: () => new Date("2026-07-10T12:00:00.000Z"),
    accountService: {
      listConfigurations: async () => [{ configuration: "acct-a", account: "user@example.com" }],
      listProjects: async () => [{ projectId: "project-a" }]
    },
    regionCatalog: { load: async () => ({ stale: false, regions: [{ id: "us-west1" }] }) },
    freeRuleService: { load: async () => ({ stale: false, rules: { compute: { alwaysFreeRegions: ["us-west1"] } } }) },
    cloudInventory: { listInstances: async () => [{ name: "xui-a", status: "RUNNING" }] },
    recordStore: { list: async () => [record] },
    runner: { runJson: async () => [
      { config: { name: "compute.googleapis.com" } },
      { config: { name: "iam.googleapis.com" } },
      { config: { name: "iap.googleapis.com" } }
    ] }
  });
  const checks = ids(await service.run({ configuration: "acct-a", account: "user@example.com", projectId: "project-a" }));
  assert.equal(checks.node_service_state.status, "pass");
  assert.match(checks.node_service_state.evidence, /x-ui/);
});
