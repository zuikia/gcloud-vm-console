import { spawn } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const BASE_URL = process.env.UI_AUDIT_URL || "http://127.0.0.1:8787";
const VIEWPORTS = [1728, 1440, 1280, 1024, 768, 390];
const ROUTES = ["workbench", "resources", "config", "tasks"];
const INSTANCE_STATUS_IDS = ["ssh", "bbr", "firewall", "services"];
const INSTANCE_ACTION_IDS = [
  "detailPrimary",
  "cloneVm",
  "deployNodes",
  "smartDiagnoseInstance",
  "adoptLocalInstance",
  "manageNetworkExposure",
  "restartVm",
  "systemUpdate",
  "showNodeResults"
];
const DEFAULT_CONFIGURATION = "default";
const DEFAULT_ACCOUNT = "user@example.com";
const DEFAULT_PROJECT = "example-project";
const uiRoot = new URL("..", import.meta.url);
const screenshotRoot = new URL("../output/playwright/", import.meta.url);

function source(relativePath) {
  return readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");
}

function staticAudit() {
  const html = source("public/index.html");
  const app = source("public/app.js");
  const css = source("public/styles.css");
  const issues = [];
  const pageSection = (view) => html.match(new RegExp(`<section id="page-${view}"[\\s\\S]*?(?=<section id="page-(?:${ROUTES.join("|")})"|</main>)`))?.[0] || "";

  for (const view of ROUTES) {
    if (!html.includes(`data-view="${view}"`)) issues.push(`missing view: ${view}`);
    if (!html.includes(`href="#${view}"`)) issues.push(`missing nav route: ${view}`);
  }
  for (const forbidden of ["Terraform", "ADC", "application-default", "cloud-link", "cloudLinks", "profileSelect", "保存关联", "关联到草稿"]) {
    if (`${html}\n${app}`.includes(forbidden)) issues.push(`active UI contains forbidden term: ${forbidden}`);
  }
  for (const required of [".app-shell", ".ops-panel", ".ops-metrics", ".doctor-checks", ".doctor-item", ".doctor-evidence", ".diagnostic-summary", ".compact-facts", ".evidence-timeline", ".evidence-step", ".resource-layout", ".technical-overview", ".technical-summary-row", ".technical-more-attributes", ".detail-operations[hidden]", ".config-layout", ".tasks-layout", ".resource-table", "@media (max-width: 900px)", "overflow-wrap: anywhere"]) {
    if (!css.includes(required)) issues.push(`missing layout contract token: ${required}`);
  }
  for (const required of [".task-log-primary", ".task-history-table", ".config-advanced", ".execution-summary", ".resource-mobile-meta", ".active-task-bar", "@font-face"]) {
    if (!css.includes(required) && !html.includes(required.replace(/^\./, "")) && !app.includes(required.replace(/^\./, ""))) {
      issues.push(`missing confirmed UI contract: ${required}`);
    }
  }
  for (const required of ["overviewOperations", "doctorPanel", "doctorRunBtn", "doctorSummary", "doctorChecks", "overviewNextAction", "mainAction", "diagnosticSummary", "copyDiagnosticSummary", "diagnosticSummaryRows", "evidenceTimeline", "detailContent", "technicalOverview", "technicalRecognitionSummary", "technicalIssueSummary", "technicalRecoverySummary", "technicalMoreAttributes", "detailCoreFacts", "detailNetworkFacts", "detailIdentityFacts", "technicalEvidence", "detailNodeResult", "detailFirewallResult", "detailOperations"]) {
    if (!html.includes(`id="${required}"`)) issues.push(`missing product structure: ${required}`);
  }
  if (!app.includes("diagnostic-summary-view-model.js")) issues.push("diagnostic summary model is not imported by app");
  if (/id="operationGuide"|id="operationGuidePrimary"|id="operationGuideIssues"/.test(html)) {
    issues.push("workbench: duplicate-overview-guidance");
  }
  for (const required of ["operation-scenario-view-model.js", "evidence-timeline-view-model.js", "copy-text.js"]) {
    if (!`${app}\n${source("public/lib/operation-guidance-view-model.js")}`.includes(required)) {
      issues.push(`missing scenario confidence module: ${required}`);
    }
  }
  if (!app.includes("./lib/node-result-view-model.js")) issues.push("node result view model is not imported by app");
  if (!app.includes("./lib/instance-technical-details-view-model.js")) issues.push("technical details view model is not imported by app");
  if (!css.includes(".detail-node-result") || !css.includes(".node-value-code")) {
    issues.push("missing compact detail node result styles");
  }
  for (const id of INSTANCE_STATUS_IDS) {
    const count = [...html.matchAll(new RegExp(`data-instance-status="${id}"`, "g"))].length;
    if (count !== 1) issues.push(`resources: canonical status ${id} static count ${count}`);
  }
  for (const id of INSTANCE_ACTION_IDS) {
    const count = [...html.matchAll(new RegExp(`id="${id}"`, "g"))].length;
    if (count !== 1) issues.push(`resources: instance action ${id} static count ${count}`);
  }
  if (/fonts\.googleapis\.com|fonts\.gstatic\.com/.test(`${html}\n${css}`)) issues.push("remote Google Fonts are not allowed in production UI");
  for (const view of ROUTES) {
    const section = pageSection(view);
    const primaryButtons = [...section.matchAll(/<button\b[^>]*class="[^"]*\bprimary\b[^"]*"/g)];
    if (primaryButtons.length > 1) issues.push(`${view}: duplicate primary buttons`);
  }
  const tasksSection = pageSection("tasks");
  if (/class="[^"]*\btasks-side\b/.test(tasksSection)) issues.push("tasks page still uses duplicated side result column");
  if (/节点结果[\s\S]*当前结果|当前结果[\s\S]*节点结果/.test(tasksSection)) issues.push("tasks page duplicates node/current result panels");
  if (html.includes('id="overviewAccount"') || html.includes('id="overviewProject"')) {
    issues.push("overview repeats active account/project metrics");
  }
  if (!/pendingContext:\s*\{/.test(app)) issues.push("account/project switching is not staged through pendingContext");
  if (!/function snapshotActiveContext\(/.test(app) || !/function restoreActiveContext\(/.test(app)) {
    issues.push("account/project switching lacks rollback snapshot helpers");
  }
  const useContextBody = app.match(/async function useSelectedContext\(\) \{([\s\S]*?)\n\}\n\nfunction resourceKey/)?.[1] || "";
  if (/state\.context = [\s\S]*?await refreshResources/.test(useContextBody)) {
    issues.push("active context is committed before resource sync succeeds");
  }
  if (/<details id="taskLogDetails"/.test(html)) issues.push("task log is still hidden behind details");
  if (/<pre(?![^>]*class="[^"]*log-output)/.test(html)) issues.push("bare pre without log-output class");
  return issues;
}

async function installFixtures(page) {
  await page.route("**/api/health", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      ok: true,
      mode: "gcloud-only",
      capabilities: {
        records: true,
        cloudInventory: true,
        changePreview: true,
        maintenance: true,
        nodePipeline: true,
        regionCatalog: true,
        freeRuleCalibration: true,
        persistentJobHistory: true,
        localSecretStore: true,
        sshDualEntry: true,
        portExposureGovernance: true,
        warpEgressManagement: true
      }
    })
  }));
  await page.route("**/api/local-security/ssh-auth", (route) => {
    const configured = page.viewportSize()?.width !== 390;
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        sshAuth: {
          configured,
          versionId: configured ? "layout-secret-version" : "",
          updatedAt: configured ? "2026-07-16T11:00:00.000Z" : ""
        }
      })
    });
  });
  await page.route("**/api/accounts", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      accounts: [
        {
          name: DEFAULT_CONFIGURATION,
          configuration: DEFAULT_CONFIGURATION,
          account: DEFAULT_ACCOUNT,
          projectId: DEFAULT_PROJECT
        },
        {
          name: "acct-no-project",
          configuration: "acct-no-project",
          account: "no-project-layout-audit@example.com",
          projectId: ""
        },
        {
          name: "acct-project-error",
          configuration: "acct-project-error",
          account: "project-error-layout-audit@example.com",
          projectId: ""
        }
      ]
    })
  }));
  await page.route("**/api/projects?**", (route) => {
    const noProjects = route.request().url().includes("no-project-layout-audit%40example.com");
    const projectError = route.request().url().includes("project-error-layout-audit%40example.com");
    if (projectError) {
      return route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: "mocked project list failure" })
      });
    }
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        projects: noProjects ? [] : [{
          projectId: DEFAULT_PROJECT,
          name: "My First Project",
          lifecycleState: "ACTIVE"
        }]
      })
    });
  });
  await page.route("**/api/vm-records?**", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      records: [{
        id: "vm-a-123",
        status: "managed",
        identity: {
          configuration: DEFAULT_CONFIGURATION,
          account: DEFAULT_ACCOUNT,
          projectId: DEFAULT_PROJECT,
          zone: "us-west1-b",
          name: "vm-a"
        },
        desired: {
          machineType: "e2-micro",
          image: "debian-cloud/debian-12",
          disk: { sizeGb: 30 },
          network: { name: "default", subnet: "default" },
          ssh: { user: "y", keyFile: "/redacted/layout-key", port: 45400 },
          deploy: { method: "singbox_plus" }
        },
        observed: {
          network: { externalIp: "203.0.113.10" },
          sshConnection: { desiredPort: 45400, actualPort: 22, fallback: true, verified: true, label: "SSH 实际连接 22（已从 45400 回退）" },
          warp: {
            schemaVersion: 1,
            supported: true,
            status: "connected",
            mode: "proxy",
            protocol: "masque",
            proxyPort: 40000,
            tier: "free",
            ipv4: "203.0.113.13",
            ipv6: "2001:db8::13",
            colo: { ipv4: "KIX", ipv6: "KIX" },
            capability: { serviceActive: true, cliAvailable: true, listenerVerified: true, routeVerified: true },
            affectedNodes: {
              count: 2,
              names: [
                "hy2-obfs-warp-with-an-extremely-long-layout-audit-node-name",
                "tuic-v5-warp-with-another-extremely-long-layout-audit-node-name"
              ]
            },
            checkedAt: new Date().toISOString(),
            lastProbeAttempt: { status: "succeeded", checkedAt: new Date().toISOString(), error: "" },
            lastReconnect: null
          },
          lastProbeAttempt: { status: "failed", checkedAt: "2026-07-10T11:59:00.000Z", category: "ssh", message: "SSH 连接失败，保留历史结果" },
          networkExposurePreview: {
            fingerprint: "layout-network-exposure-fingerprint",
            checkedAt: "2026-07-16T11:58:00.000Z",
            expiresAt: "2099-07-16T12:13:00.000Z",
            coverage: { ready: true, freshness: "fresh", blockedReason: "" },
            selection: { publicSsh22: false, ports: [{ protocol: "udp", port: "25737" }] },
            desiredExposure: {
              public: [{ protocol: "tcp", port: "45400" }, { protocol: "udp", port: "25737" }],
              iap: [{ protocol: "tcp", port: "22" }, { protocol: "tcp", port: "45400" }]
            },
            changes: { open: [{ protocol: "udp", port: "25737" }], retain: [{ protocol: "tcp", port: "45400" }], close: [] },
            isolation: {
              targetTag: "gvc-isolate-layout",
              allowPriority: 998,
              denyPriority: 999,
              ruleActions: [
                { purpose: "ssh-iap", sourceRanges: ["35.235.240.0/20"] },
                { purpose: "public-service", sourceRanges: ["0.0.0.0/0"] },
                { purpose: "isolation-deny", sourceRanges: ["0.0.0.0/0"] }
              ]
            },
            sshPolicy: { passwordVersion: "layout-secret-version" }
          },
          firewallGovernance: {
            checkedAt: "2026-07-14T12:00:00.000Z",
            expiresAt: "2099-07-14T12:15:00.000Z",
            fingerprint: "layout-firewall-governance-fingerprint",
            severity: "critical",
            findings: [{
              name: "ruzhan1-with-an-extremely-long-shared-firewall-rule-name-for-layout-audit",
              ownership: "external",
              severity: "critical",
              affectedInstances: ["vm-a", "instance-with-extremely-long-name-20260617-production-uswest-primary"]
            }],
            affectedInstances: ["vm-a", "instance-with-extremely-long-name-20260617-production-uswest-primary"],
            coverage: { ready: true, uniqueTag: "vm-a", freshness: "fresh", blockedReason: "" },
            ownedActions: [{
              action: "create",
              name: "gvc-vm-a-ssh-iap-tcp",
              protocol: "tcp",
              ports: ["22", "45400"],
              sourceRanges: ["35.235.240.0/20"],
              targetTags: ["vm-a"]
            }],
            externalActions: [{ type: "manual-review", ruleName: "ruzhan1", severity: "critical" }]
          }
        },
        nodeResult: {
          type: "singbox_plus",
          bbr: true,
          ssh: { desiredPort: 45400, actualPort: 22, fallback: true, verified: true, label: "SSH 实际连接 22（已从 45400 回退）" },
          links: [{
            name: "hy2-obfs-warp",
            protocol: "udp",
            port: "25737",
            url: `hy2://layout:${"a".repeat(120)}@203.0.113.10:25737?obfs=salamander&obfs-password=${"b".repeat(120)}#hy2-obfs-warp`
          }],
          firewall: { status: "failed", error: "layout audit firewall permission denied", rules: [] }
        },
        verification: {
          status: "partial",
          checkedAt: new Date().toISOString(),
          method: "singbox_plus",
          ssh: { desiredPort: 45400, actualPort: 22, fallback: true, verified: true },
          bbr: { enabled: true, congestionControl: "bbr", qdisc: "fq" },
          firewall: { status: "overexposed", broadRuleNames: ["ruzhan1"] },
          services: [{ name: "sing-box", status: "active" }],
          ports: [
            { protocol: "udp", port: "25737", process: "sing-box", scope: "wildcard", listening: true },
            { protocol: "tcp", port: "8080", process: "custom-service-with-a-long-layout-name", scope: "network", listening: true }
          ],
          checks: [
            { id: "ssh", label: "SSH 连接", status: "passed", detail: "SSH 实际连接 22（已从 45400 回退）" },
            { id: "ports", label: "端口监听", status: "partial", detail: "UDP 23293 已监听，UDP 25737 未确认，长错误文本用于验证不会撑破布局 abcdefghijklmnopqrstuvwxyz" },
            { id: "firewall", label: "防火墙", status: "failed", detail: "vm-a-very-long-firewall-rule-name-singbox-udp sourceRanges=0.0.0.0/0" }
          ],
          warnings: ["防火墙规则缺失：vm-a-very-long-firewall-rule-name-singbox-udp"]
        }
      }]
    })
  }));
  await page.route("**/api/vm-records", async (route) => {
    const body = route.request().postDataJSON();
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        record: {
          id: "layout-preview-record",
          status: body.status,
          identity: body.identity,
          desired: body.desired
        }
      })
    });
  });
  await page.route("**/api/vm-records/*/preview", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      preview: {
        identity: {
          account: DEFAULT_ACCOUNT,
          projectId: DEFAULT_PROJECT,
          zone: "us-west1-b",
          name: "gcloud-vm"
        },
        fingerprint: "layout-audit-preview-fingerprint-0123456789abcdef",
        actions: [{ classification: "in-place", id: "metadata" }]
      }
    })
  }));
  await page.route("**/api/cloud-instances?**", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      instances: [
        { name: "vm-a", zone: "us-west1-b", status: "RUNNING", machineType: "e2-micro", network: { externalIp: "203.0.113.10", name: "default", subnet: "default" } },
        { name: "instance-with-extremely-long-name-20260617-production-uswest-primary", zone: "asia-northeast1-a", status: "TERMINATED", machineType: "e2-micro", network: { externalIp: "203.0.113.123", name: "default", subnet: "default" } },
        { name: "ipv6-layout-stress-instance", zone: "europe-west9-b", status: "RUNNING", machineType: "e2-small", network: { externalIp: "2001:0db8:85a3:0000:0000:8a2e:0370:7334", name: "default", subnet: "default" } }
      ]
    })
  }));
  await page.route("**/api/cloud-instances/adoption-preview", async (route) => {
    const body = route.request().postDataJSON();
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        identity: body.identity,
        recognition: {
          method: "three_x_ui",
          confidence: "high",
          source: "guest_attributes",
          managedState: "external_managed",
          evidence: [{ source: "guest_attributes", label: "部署方式", value: "3X-UI", confidence: "high" }],
          warnings: [],
          suggestedAction: "adopt"
        },
        cloudInstance: null,
        guestAttributes: { available: true },
        sshProbe: { available: false }
      })
    });
  });
  await page.route("**/api/cloud-instances/adopt-local", async (route) => {
    const body = route.request().postDataJSON();
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        record: {
          id: "adopted-layout-record",
          status: "managed",
          identity: body.identity,
          desired: body.desired || { deploy: { method: "three_x_ui" } }
        }
      })
    });
  });
  await page.route("**/api/doctor?**", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      status: "warning",
      generatedAt: "2026-07-07T00:00:00.000Z",
      context: { configuration: DEFAULT_CONFIGURATION, account: DEFAULT_ACCOUNT, projectId: DEFAULT_PROJECT },
      summary: { pass: 5, warning: 5, blocked: 0 },
      checks: [
        { id: "gcloud_accounts", group: "local", label: "gcloud 账号", status: "pass", reason: "当前账号配置可读取。", evidence: DEFAULT_ACCOUNT, cloudWrite: false },
        { id: "project_access", group: "project", label: "项目访问", status: "pass", reason: "当前账号可读取项目。", evidence: DEFAULT_PROJECT, cloudWrite: false },
        { id: "api_services", group: "project", label: "所需 API", status: "warning", reason: "iam.googleapis.com 未确认。", evidence: "compute.googleapis.com / iap.googleapis.com", cloudWrite: false },
        { id: "free_rules", group: "catalog", label: "免费规则", status: "warning", reason: "缓存需要更新。", evidence: "cache", nextAction: "更新规则提示。", actionRef: "auditFreeRules", cloudWrite: false },
        { id: "inventory_sync", group: "inventory", label: "清单同步", status: "pass", reason: "本地和云端一致。", evidence: "2 cloud / 2 local", cloudWrite: false },
        { id: "ssh_state", group: "runtime", label: "SSH", status: "pass", reason: "已读取到 SSH 验证证据。", evidence: "actual 22, fallback from 45400", cloudWrite: false },
        { id: "verification_state", group: "runtime", label: "验证状态", status: "warning", reason: "部分实例需要重新验证。", evidence: "1/5 通过，3 部分通过", actionRef: "smartDiagnoseInstance", cloudWrite: false },
        { id: "firewall_state", group: "runtime", label: "防火墙", status: "warning", reason: "检测到规则过度开放。", evidence: "3 台实例 · ruzhan1", actionRef: "smartDiagnoseInstance", cloudWrite: false },
        { id: "bbr_state", group: "runtime", label: "BBR", status: "warning", reason: "部分实例尚未确认。", evidence: "3/5 已启用", actionRef: "smartDiagnoseInstance", cloudWrite: false },
        { id: "node_service_state", group: "runtime", label: "节点服务", status: "pass", reason: "已读取到节点服务证据。", evidence: `hy2://${"a".repeat(160)}`, cloudWrite: false }
      ]
    })
  }));
  await page.route("**/api/jobs", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      jobs: [{
        id: "layout-job-node",
        type: "node-deploy",
        recordId: "vm-a-123",
        status: "succeeded",
        stages: [
          { name: "node_pipeline", status: "running", detail: "Run deployment pipeline", at: "2026-06-18T10:00:00.000Z" },
          { name: "firewall_sync", status: "succeeded", detail: "Synchronize UDP ports", at: "2026-06-18T10:01:00.000Z" }
        ],
        result: {
          nodeResult: {
            type: "singbox_plus",
            bbr: true,
            links: [{ name: "tuic-v5", protocol: "udp", port: "23293", url: "tuic://layout-audit" }]
          }
        },
        error: null,
        createdAt: "2026-06-18T10:00:00.000Z",
        updatedAt: "2026-06-18T10:01:05.000Z"
      }, {
        id: "layout-job-interrupted",
        type: "maintenance-system-update",
        recordId: "vm-a-123",
        status: "interrupted",
        stages: [
          { name: "system_update", status: "running", detail: `Updating ${"package-".repeat(40)}`, at: "2026-07-12T10:00:00.000Z" },
          { name: "restart_recovery", status: "interrupted", detail: "本地服务重启，任务未自动续跑；请先运行只读探测确认云端实际状态。", at: "2026-07-12T10:05:00.000Z" }
        ],
        result: null,
        error: null,
        interruption: { reason: "server_restart", previousStatus: "running", detectedAt: "2026-07-12T10:05:00.000Z" },
        createdAt: "2026-07-12T10:00:00.000Z",
        updatedAt: "2026-07-12T10:05:00.000Z"
      }],
      meta: {
        storage: "persistent",
        recoveredInterrupted: 1,
        quarantined: 0,
        quarantineFailures: 0,
        pruned: 0,
        pruneFailures: 0,
        degradedWrites: 0,
        maxJobs: 200,
        maxAgeDays: 30
      }
    })
  }));
  const mockedJob = (type, label, result = {}) => ({
    id: `layout-${type}-${Date.now()}`,
    type,
    recordId: "vm-a-123",
    status: "succeeded",
    stages: [{ name: type, status: "succeeded", detail: label, at: "2026-07-06T00:00:00.000Z" }],
    result,
    error: null,
    createdAt: "2026-07-06T00:00:00.000Z",
    updatedAt: "2026-07-06T00:00:01.000Z"
  });
  await page.route("**/api/vm-records/*/maintenance/status", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ job: mockedJob("status", "检查状态") })
  }));
  await page.route("**/api/vm-records/*/verify", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      job: mockedJob("verify", "重新验证", {
        verification: {
          status: "passed",
          checkedAt: "2026-07-06T00:00:00.000Z",
          checks: [{ id: "ssh", label: "SSH 连接", status: "passed", detail: "SSH 实际连接 22" }]
        }
      })
    })
  }));
  await page.route("**/api/vm-records/*/warp/status", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      warp: {
        schemaVersion: 1,
        supported: true,
        status: "connected",
        mode: "proxy",
        protocol: "masque",
        proxyPort: 40000,
        tier: "free",
        ipv4: "203.0.113.13",
        ipv6: "2001:db8::13",
        colo: { ipv4: "KIX", ipv6: "KIX" },
        capability: { serviceActive: true, cliAvailable: true, listenerVerified: true, routeVerified: true },
        affectedNodes: {
          count: 2,
          names: ["hy2-obfs-warp-with-a-long-name", "tuic-v5-warp-with-a-long-name"]
        },
        checkedAt: new Date().toISOString(),
        lastProbeAttempt: { status: "succeeded", checkedAt: new Date().toISOString(), error: "" },
        lastReconnect: null
      }
    })
  }));
  await page.route("**/api/vm-records/*/warp/reconnect", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({
      job: mockedJob("warp-reconnect", "重连 WARP 出口", {
        status: "succeeded",
        outcome: "unchanged",
        warp: {
          schemaVersion: 1,
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
          checkedAt: new Date().toISOString(),
          lastReconnect: {
            outcome: "unchanged",
            status: "succeeded",
            before: { ipv4: "203.0.113.13", ipv6: "" },
            after: { ipv4: "203.0.113.13", ipv6: "" },
            completedAt: new Date().toISOString()
          }
        }
      })
    })
  }));
  await page.route("**/api/vm-records/*/maintenance/restart", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ job: mockedJob("restart", "重启实例") })
  }));
  await page.route("**/api/vm-records/*/maintenance/system-update", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ job: mockedJob("system-update", "系统更新") })
  }));
  await page.route("**/api/vm-records/*/nodes/deploy", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ job: mockedJob("node-deploy", "部署节点") })
  }));
  await page.route("**/api/vm-records/*/execute", (route) => route.fulfill({
    contentType: "application/json",
    body: JSON.stringify({ job: mockedJob("execute", "执行有效预览") })
  }));
}

async function domClick(page, selector) {
  const result = await page.evaluate((targetSelector) => {
    const element = document.querySelector(targetSelector);
    if (!element) return { ok: false, reason: `missing ${targetSelector}` };
    element.scrollIntoView({ block: "center", inline: "center" });
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden" || rect.width <= 0 || rect.height <= 0) {
      return { ok: false, reason: `not visible ${targetSelector}` };
    }
    if ("disabled" in element && element.disabled) return { ok: false, reason: `disabled ${targetSelector}` };
    const x = Math.min(Math.max(rect.left + rect.width / 2, 0), document.documentElement.clientWidth - 1);
    const y = Math.min(Math.max(rect.top + rect.height / 2, 0), document.documentElement.clientHeight - 1);
    const topElement = document.elementFromPoint(x, y);
    if (topElement && !element.contains(topElement) && !topElement.contains(element)) {
      const id = topElement.id ? `#${topElement.id}` : "";
      const classes = [...topElement.classList].slice(0, 3).map((name) => `.${name}`).join("");
      return { ok: false, reason: `covered ${targetSelector} by ${topElement.tagName.toLowerCase()}${id}${classes}` };
    }
    element.click();
    return { ok: true };
  }, selector);
  if (!result.ok) throw new Error(result.reason);
  await page.waitForTimeout(0);
}

async function clickAndCancelConfirmation(page, selector, issues, label, writeRequests) {
  const before = writeRequests.length;
  try {
    await domClick(page, selector);
    await page.waitForSelector("#actionConfirmDialog[open]", { timeout: 1500 });
    await domClick(page, '#actionConfirmDialog button[value="cancel"]');
    await page.waitForFunction(() => !document.querySelector("#actionConfirmDialog")?.open, undefined, { timeout: 1500 });
  } catch (error) {
    const debug = await page.evaluate((targetSelector) => {
      const element = document.querySelector(targetSelector);
      const detailOperations = document.querySelector("#detailOperations");
      const resourceSelected = document.querySelector("[data-resource-key][aria-selected='true']")?.textContent?.trim() || "";
      if (!element) return { exists: false, resourceSelected };
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      const ancestors = [];
      let parent = element.parentElement;
      while (parent && ancestors.length < 5) {
        const parentRect = parent.getBoundingClientRect();
        ancestors.push({
          tag: parent.tagName.toLowerCase(),
          id: parent.id || "",
          className: String(parent.className || ""),
          hidden: Boolean(parent.hidden),
          display: getComputedStyle(parent).display,
          rect: { width: Math.round(parentRect.width), height: Math.round(parentRect.height), x: Math.round(parentRect.x), y: Math.round(parentRect.y) }
        });
        parent = parent.parentElement;
      }
      return {
        exists: true,
        disabled: Boolean(element.disabled),
        text: element.textContent?.trim(),
        rect: { width: Math.round(rect.width), height: Math.round(rect.height), x: Math.round(rect.x), y: Math.round(rect.y) },
        display: style.display,
        visibility: style.visibility,
        ancestors,
        detailOperationsHidden: Boolean(detailOperations?.hidden),
        detailOperationsText: detailOperations?.textContent?.trim().slice(0, 200) || "",
        resourceSelected
      };
    }, selector).catch((debugError) => ({ debugError: debugError.message }));
    issues.push(`${label}: confirmation-cancel-failed ${error.message} ${JSON.stringify(debug)}`);
    return;
  }
  if (writeRequests.length !== before) issues.push(`${label}: confirmation-cancel-sent-write`);
}

async function clickReadWithoutConfirmation(page, selector, issues, label) {
  try {
    await domClick(page, selector);
    await page.waitForFunction(() => location.hash === "#tasks" || document.querySelector("#actionConfirmDialog")?.open === true, undefined, { timeout: 1500 }).catch(() => {});
    await page.waitForFunction((targetSelector) => document.querySelector(targetSelector)?.dataset.loading !== "true", selector, { timeout: 5000 }).catch(() => {});
    const open = await page.evaluate(() => document.querySelector("#actionConfirmDialog")?.open === true);
    if (open) {
      issues.push(`${label}: read-action-opened-confirmation`);
      await domClick(page, '#actionConfirmDialog button[value="cancel"]').catch(() => {});
    }
  } catch (error) {
    issues.push(`${label}: read-action-click-failed ${error.message}`);
  }
}

async function selectFirstResource(page) {
  await page.goto(`${BASE_URL}/#resources`, { waitUntil: "networkidle" });
  await page.waitForSelector('[data-view="resources"]:not([hidden])', { timeout: 5000 });
  await selectResourceByName(page, "vm-a");
  await page.goto(`${BASE_URL}/#workbench`, { waitUntil: "networkidle" });
  await page.waitForSelector('[data-view="workbench"]:not([hidden])', { timeout: 5000 });
}

async function selectResourceByName(page, name) {
  const selected = await page.evaluate((targetName) => {
    const rows = [...document.querySelectorAll("[data-resource-key]")];
    const row = rows.find((candidate) => candidate.textContent?.includes(targetName));
    if (!row) return false;
    row.scrollIntoView({ block: "center", inline: "center" });
    row.click();
    return true;
  }, name);
  if (!selected) throw new Error(`missing resource ${name}`);
  await page.waitForFunction(
    (targetName) => [...document.querySelectorAll("[data-resource-key]")].some((row) => row.getAttribute("aria-selected") === "true" && row.textContent?.includes(targetName)),
    name,
    { timeout: 1500 }
  );
}

async function prepareContext(page, { selectResource = true, fresh = false } = {}) {
  const freshQuery = fresh ? `?layoutAudit=${Date.now()}-${Math.random().toString(16).slice(2)}` : "";
  await page.goto(`${BASE_URL}/${freshQuery}#workbench`, { waitUntil: "networkidle" });
  await page.waitForSelector('[data-view="workbench"]:not([hidden])', { timeout: 5000 });
  await page.waitForFunction(() => Boolean(document.querySelector("#projectSelect")?.value), undefined, { timeout: 5000 }).catch(async (error) => {
    const debug = await page.evaluate(() => ({
      accountIndex: document.querySelector("#accountSelect")?.selectedIndex,
      accountText: document.querySelector("#accountSelect")?.textContent?.trim(),
      projectValue: document.querySelector("#projectSelect")?.value,
      projectText: document.querySelector("#projectSelect")?.textContent?.trim(),
      contextHint: document.querySelector("#contextHint")?.textContent?.trim(),
      inlineError: document.querySelector("#globalInlineError")?.textContent?.trim()
    }));
    const diagnostics = Array.isArray(page.__layoutDiagnostics) ? page.__layoutDiagnostics.slice(-6) : [];
    throw new Error(`project select not ready: ${JSON.stringify(debug)} diagnostics=${JSON.stringify(diagnostics)}; ${error.message}`);
  });
  await page.waitForFunction((projectId) => document.querySelector("#projectSelect")?.value === projectId, DEFAULT_PROJECT);
  await page.waitForFunction(
    (projectId) => document.querySelector("#currentScope")?.textContent?.includes(projectId),
    DEFAULT_PROJECT,
    { timeout: 1500 }
  ).catch(() => {
    return page.evaluate(() => ({
      currentScope: document.querySelector("#currentScope")?.textContent?.trim(),
      contextHint: document.querySelector("#contextHint")?.textContent?.trim(),
      inlineError: document.querySelector("#globalInlineError")?.textContent?.trim(),
      syncState: document.querySelector("#globalSyncState")?.textContent?.trim(),
      logTail: document.querySelector("#logOutput")?.textContent?.trim().split("\n").slice(-6)
    })).then((debug) => {
      const diagnostics = Array.isArray(page.__layoutDiagnostics) ? page.__layoutDiagnostics.slice(-6) : [];
      throw new Error(`default context was not auto-applied on boot: ${JSON.stringify(debug)} diagnostics=${JSON.stringify(diagnostics)}`);
    });
  });
  await page.waitForFunction(() => document.querySelector("#resourceCount")?.textContent?.trim() === "3 项");
  if (selectResource) await selectFirstResource(page);
}

async function returnToSelectedResource(page) {
  await page.goto(`${BASE_URL}/#resources`, { waitUntil: "networkidle" });
  await page.waitForSelector('[data-view="resources"]:not([hidden])', { timeout: 5000 });
  await selectResourceByName(page, "vm-a");
}

async function auditActionLogic(page, issues, writeRequests) {
  await page.setViewportSize({ width: 1440, height: 920 });
  await prepareContext(page, { selectResource: true, fresh: true });
  await clickReadWithoutConfirmation(page, "#doctorRunBtn", issues, "doctorRunBtn");
  await prepareContext(page, { selectResource: true, fresh: true });
  await returnToSelectedResource(page);
  await clickReadWithoutConfirmation(page, "#smartDiagnoseInstance", issues, "smartDiagnoseInstance");
  await returnToSelectedResource(page);
  await clickAndCancelConfirmation(page, "#restartVm", issues, "restartVm", writeRequests);
  await clickAndCancelConfirmation(page, "#systemUpdate", issues, "systemUpdate", writeRequests);
  if (!(await page.isDisabled("#deployNodes"))) {
    await clickAndCancelConfirmation(page, "#deployNodes", issues, "deployNodes", writeRequests);
  }
  await page.evaluate(() => {
    document.querySelector("#technicalDetails")?.setAttribute("open", "");
    document.querySelector("#technicalMoreAttributes")?.setAttribute("open", "");
    document.querySelector(".danger-zone.instance-disclosure")?.setAttribute("open", "");
  });
  if (!(await page.isDisabled("#manageNetworkExposure"))) {
    const writesBeforeOpen = writeRequests.length;
    await domClick(page, "#manageNetworkExposure");
    await page.waitForSelector("#networkExposureDialog[open]", { timeout: 1500 });
    if (writeRequests.length !== writesBeforeOpen) issues.push("manageNetworkExposure: opening-dialog-sent-write");
    if (!(await page.isDisabled("#applyNetworkExposure"))) {
      await clickAndCancelConfirmation(page, "#applyNetworkExposure", issues, "applyNetworkExposure", writeRequests);
    }
    await domClick(page, '#networkExposureDialog button[value="cancel"]');
  }
  const nodeResults = page.locator("#nodeResultsDetails");
  await nodeResults.evaluate((element) => { element.open = true; });
  if (!(await page.isDisabled("#manageWarpEgress"))) {
    const writesBeforeOpen = writeRequests.length;
    await domClick(page, "#manageWarpEgress");
    await page.waitForSelector("#warpEgressDialog[open]", { timeout: 1500 });
    if (writeRequests.length !== writesBeforeOpen) issues.push("manageWarpEgress: opening-dialog-sent-write");
    if (!(await page.isDisabled("#reconnectWarpEgress"))) {
      await clickAndCancelConfirmation(page, "#reconnectWarpEgress", issues, "reconnectWarpEgress", writeRequests);
    }
    await domClick(page, '#warpEgressDialog button[value="cancel"]');
  }
  await clickAndCancelConfirmation(page, "#deleteLocalRecord", issues, "deleteLocalRecord", writeRequests);

  await returnToSelectedResource(page);
  await selectResourceByName(page, "instance-with-extremely-long-name-20260617-production-uswest-primary");
  const beforeSmartDiagnose = await page.evaluate(() => ({
    hash: location.hash,
    selected: document.querySelector("[data-resource-key][aria-selected='true']")?.dataset.resourceKey || "",
    detailTitle: document.querySelector("#detailTitle")?.textContent?.trim(),
    smartDisabled: document.querySelector("#smartDiagnoseInstance")?.disabled,
    statusCount: document.querySelectorAll("[data-instance-status]").length,
    method: document.querySelector("#technicalRecognitionSummary strong")?.textContent?.trim(),
    checkedAt: document.querySelector("#detailCheckedAt")?.textContent?.trim(),
    actionLabel: document.querySelector("#smartDiagnoseInstance")?.textContent?.trim()
  }));
  if (!beforeSmartDiagnose.detailTitle?.includes("instance-with-extremely-long-name")) {
    issues.push(`smartDiagnoseInstanceRecognize: wrong-selection-before-click ${JSON.stringify(beforeSmartDiagnose)}`);
  }
  await clickReadWithoutConfirmation(page, "#smartDiagnoseInstance", issues, "smartDiagnoseInstanceRecognize");
  await page.waitForFunction(() => (
    document.querySelector("#technicalRecognitionSummary strong")?.textContent?.includes("3X-UI")
    && document.querySelector("#smartDiagnoseInstance")?.textContent?.includes("重新探测")
  ), undefined, { timeout: 5000 }).catch(() => {});
  const afterSmartDiagnose = await page.evaluate(() => ({
    selected: document.querySelector("[data-resource-key][aria-selected='true']")?.dataset.resourceKey || "",
    statusCount: [...document.querySelectorAll("[data-instance-status]")].filter((element) => {
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 && getComputedStyle(element).visibility !== "hidden";
    }).length,
    method: document.querySelector("#technicalRecognitionSummary strong")?.textContent?.trim(),
    checkedAt: document.querySelector("#detailCheckedAt")?.textContent?.trim(),
    actionLabel: document.querySelector("#smartDiagnoseInstance")?.textContent?.trim(),
    overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
  }));
  if (afterSmartDiagnose.statusCount !== 4 || beforeSmartDiagnose.statusCount !== 4) {
    issues.push(`recognition-status-count-changed ${beforeSmartDiagnose.statusCount}/${afterSmartDiagnose.statusCount}`);
  }
  if (!afterSmartDiagnose.method?.includes("3X-UI") || beforeSmartDiagnose.method?.includes("3X-UI")) {
    issues.push(`recognition-method-not-updated ${beforeSmartDiagnose.method}/${afterSmartDiagnose.method}`);
  }
  if (!afterSmartDiagnose.checkedAt?.includes("检查于") || afterSmartDiagnose.checkedAt === beforeSmartDiagnose.checkedAt) {
    issues.push(`recognition-checked-time-missing ${beforeSmartDiagnose.checkedAt}/${afterSmartDiagnose.checkedAt}`);
  }
  if (!afterSmartDiagnose.actionLabel?.includes("重新探测") || beforeSmartDiagnose.actionLabel?.includes("重新探测")) {
    issues.push(`recognition-action-label-not-updated ${beforeSmartDiagnose.actionLabel}/${afterSmartDiagnose.actionLabel}`);
  }
  if (afterSmartDiagnose.selected !== beforeSmartDiagnose.selected) {
    issues.push(`recognition-selection-changed ${beforeSmartDiagnose.selected}/${afterSmartDiagnose.selected}`);
  }
  if (afterSmartDiagnose.overflow) issues.push("recognition-horizontal-overflow");
  await page.evaluate(() => {
    if (location.hash !== "#resources") location.hash = "#resources";
  });
  await page.waitForSelector('[data-view="resources"]:not([hidden])', { timeout: 5000 });
  await selectResourceByName(page, "instance-with-extremely-long-name-20260617-production-uswest-primary");
  await page.waitForFunction(() => !document.querySelector("#adoptLocalInstance")?.disabled, undefined, { timeout: 5000 }).catch(async (error) => {
    const debug = await page.evaluate(() => ({
      hash: location.hash,
      selected: document.querySelector("[data-resource-key][aria-selected='true']")?.textContent?.trim(),
      smartDisabled: document.querySelector("#smartDiagnoseInstance")?.disabled,
      adoptDisabled: document.querySelector("#adoptLocalInstance")?.disabled,
      adoptHidden: document.querySelector("#adoptLocalInstance")?.hidden,
      recognition: document.querySelector("#deploymentRecognition")?.textContent?.trim(),
      detailTitle: document.querySelector("#detailTitle")?.textContent?.trim(),
      taskTitle: document.querySelector("#taskTitle")?.textContent?.trim(),
      logTail: document.querySelector("#logOutput")?.textContent?.trim().split("\n").slice(-6)
    })).catch((debugError) => ({ debugError: debugError.message }));
    issues.push(`adoptLocalInstance: not-enabled-after-recognition ${error.message} ${JSON.stringify(debug)}`);
  });
  if (!(await page.isDisabled("#adoptLocalInstance"))) {
    await clickAndCancelConfirmation(page, "#adoptLocalInstance", issues, "adoptLocalInstance", writeRequests);
  }

  await page.goto(`${BASE_URL}/#config`, { waitUntil: "networkidle" });
  await page.waitForSelector('[data-view="config"]:not([hidden])', { timeout: 5000 });
  await domClick(page, "#savePreview");
  await page.waitForSelector('[data-view="tasks"]:not([hidden])', { timeout: 5000 });
  await page.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: async () => { throw new Error("denied by layout audit"); } }
    });
    const diagnostics = document.querySelector("#taskDiagnosticsDetails");
    if (diagnostics) diagnostics.open = true;
  });
  await clickReadWithoutConfirmation(page, "#copyDiagnosticSummary", issues, "copyDiagnosticSummary");
  const copiedToast = await page.textContent("#toastHost").catch(() => "");
  if (!/备用方式|已复制/.test(copiedToast || "")) issues.push("copyDiagnosticSummary: fallback-copy-toast-missing");
  await page.evaluate(() => {
    const diagnostics = document.querySelector("#taskDiagnosticsDetails");
    if (diagnostics) diagnostics.open = false;
  });
  await clickAndCancelConfirmation(page, "#executePreview", issues, "executePreview", writeRequests);
}

async function networkExposureDialogIssues(page, width) {
  const issues = [];
  const previousDisclosureState = await page.evaluate(() => {
    const technical = document.querySelector("#technicalDetails");
    const more = document.querySelector("#technicalMoreAttributes");
    const state = { technical: Boolean(technical?.open), more: Boolean(more?.open) };
    document.querySelector("#technicalDetails")?.setAttribute("open", "");
    document.querySelector("#technicalMoreAttributes")?.setAttribute("open", "");
    return state;
  });
  try {
    await domClick(page, "#manageNetworkExposure");
    await page.waitForSelector("#networkExposureDialog[open]", { timeout: 1500 });
    const metrics = await page.evaluate((viewportWidth) => {
      const dialog = document.querySelector("#networkExposureDialog");
      const form = dialog?.querySelector(".network-exposure-form");
      const dialogRect = dialog?.getBoundingClientRect();
      const visibleTargets = [...dialog.querySelectorAll("button, .port-choice, input[type='password']")].filter((element) => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return !element.hidden && style.display !== "none" && rect.width > 0 && rect.height > 0;
      });
      const under44 = visibleTargets
        .map((element) => ({
          label: element.id || element.textContent?.trim().slice(0, 24) || element.tagName,
          height: Math.round(element.getBoundingClientRect().height)
        }))
        .filter((entry) => entry.height < 44);
      const choices = [...dialog.querySelectorAll(".fixed-port-list .port-choice, .network-exposure-port-list .port-choice")]
        .map((element) => element.getBoundingClientRect());
      return {
        viewportWidth,
        dialog: dialogRect ? {
          left: dialogRect.left,
          right: dialogRect.right,
          width: dialogRect.width,
          height: dialogRect.height
        } : null,
        formOverflow: Boolean(form && form.scrollWidth > form.clientWidth + 2),
        documentOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 2,
        under44,
        mobileChoicesStacked: viewportWidth > 680 || choices.length < 2 || Math.abs(choices[0].top - choices[1].top) > 4,
        longValueOverflow: [...dialog.querySelectorAll("strong, small, span, dt, dd")].some((element) => {
          const style = getComputedStyle(element);
          return element.scrollWidth > element.clientWidth + 2 && style.overflowWrap !== "anywhere";
        }),
        previewReachableAboveActions: (() => {
          if (!form) return false;
          form.scrollTop = form.scrollHeight;
          const lastRow = dialog.querySelector(".network-exposure-preview-rows > div:last-child");
          const actions = dialog.querySelector(".network-exposure-actions");
          if (!lastRow || !actions) return true;
          const lastRect = lastRow.getBoundingClientRect();
          const actionsRect = actions.getBoundingClientRect();
          const reachable = lastRect.bottom <= actionsRect.top + 2;
          form.scrollTop = 0;
          return reachable;
        })()
      };
    }, width);
    if (!metrics.dialog) issues.push(`network-exposure-dialog@${width}: missing-dialog`);
    else {
      if (metrics.dialog.left < -1 || metrics.dialog.right > width + 1) {
        issues.push(`network-exposure-dialog@${width}: outside-viewport ${JSON.stringify(metrics.dialog)}`);
      }
      if (metrics.dialog.height > 920) issues.push(`network-exposure-dialog@${width}: height-overflow ${metrics.dialog.height}`);
    }
    if (metrics.formOverflow) issues.push(`network-exposure-dialog@${width}: internal-horizontal-overflow`);
    if (metrics.documentOverflow) issues.push(`network-exposure-dialog@${width}: page-horizontal-overflow`);
    if (metrics.under44.length) issues.push(`network-exposure-dialog@${width}: target-under-44 ${JSON.stringify(metrics.under44)}`);
    if (!metrics.mobileChoicesStacked) issues.push(`network-exposure-dialog@${width}: mobile-port-choices-not-stacked`);
    if (metrics.longValueOverflow) issues.push(`network-exposure-dialog@${width}: long-value-overflow`);
    if (!metrics.previewReachableAboveActions) issues.push(`network-exposure-dialog@${width}: preview-obscured-by-actions`);
    if (process.env.UI_AUDIT_SCREENSHOTS === "1" && [1440, 390].includes(width)) {
      await page.screenshot({
        path: fileURLToPath(new URL(`network-exposure-${width}.png`, screenshotRoot)),
        fullPage: false
      });
    }
  } catch (error) {
    issues.push(`network-exposure-dialog@${width}: open-failed ${error.message}`);
  } finally {
    const open = await page.evaluate(() => Boolean(document.querySelector("#networkExposureDialog")?.open)).catch(() => false);
    if (open) await domClick(page, '#networkExposureDialog button[value="cancel"]').catch(() => {});
    await page.evaluate((state) => {
      const technical = document.querySelector("#technicalDetails");
      const more = document.querySelector("#technicalMoreAttributes");
      if (technical) technical.open = state.technical;
      if (more) more.open = state.more;
    }, previousDisclosureState).catch(() => {});
  }
  return issues;
}

async function warpEgressDialogIssues(page, width) {
  const issues = [];
  const detailsWasOpen = await page.evaluate(() => {
    const details = document.querySelector("#nodeResultsDetails");
    const open = Boolean(details?.open);
    if (details) details.open = true;
    return open;
  });
  try {
    await domClick(page, "#manageWarpEgress");
    await page.waitForSelector("#warpEgressDialog[open]", { timeout: 1500 });
    const scenarios = [
      { name: "connected", state: "已连接", tone: "running", ipv4: "203.0.113.13", ipv6: "2001:db8::13", message: "" },
      { name: "disconnected", state: "已断开", tone: "warning", ipv4: "未获取", ipv6: "未获取", message: "需要手动确认后恢复 WARP 连接。" },
      { name: "unchanged", state: "已连接", tone: "running", ipv4: "203.0.113.13", ipv6: "未获取", message: "WARP 已恢复连接，但 IPv4 未变化。可再次确认后重试。" },
      { name: "partial", state: "需复核", tone: "warning", ipv4: "203.0.113.13", ipv6: "未获取", message: "WARP 已执行重连，但 IPv4 仍需重新检测确认。" },
      { name: "failed", state: "待检测", tone: "warning", ipv4: "未获取", ipv6: "未获取", message: `最近检测失败：${"transport-error-without-secrets-".repeat(8)}` }
    ];
    for (const scenario of scenarios) {
      const metrics = await page.evaluate(({ viewportWidth, scenario }) => {
        const dialog = document.querySelector("#warpEgressDialog");
        const form = dialog?.querySelector(".warp-egress-form");
        const state = dialog?.querySelector("#warpEgressState");
        if (state) {
          state.textContent = scenario.state;
          state.className = `state-pill ${scenario.tone}`;
        }
        const ipv4 = dialog?.querySelector("#warpIpv4");
        const ipv6 = dialog?.querySelector("#warpIpv6");
        const nodes = dialog?.querySelector("#warpAffectedNodes");
        const message = dialog?.querySelector("#warpReconnectResult");
        if (ipv4) ipv4.textContent = scenario.ipv4;
        if (ipv6) ipv6.textContent = scenario.ipv6;
        if (nodes) nodes.textContent = `${"hy2-obfs-warp-long-node-name-".repeat(5)} · ${"tuic-v5-warp-long-node-name-".repeat(5)}`;
        if (message) {
          message.hidden = !scenario.message;
          message.textContent = scenario.message;
        }
        const dialogRect = dialog?.getBoundingClientRect();
        const visibleTargets = [...(dialog?.querySelectorAll("button") || [])].filter((element) => {
          const rect = element.getBoundingClientRect();
          const style = getComputedStyle(element);
          return !element.hidden && style.display !== "none" && rect.width > 0 && rect.height > 0;
        });
        return {
          viewportWidth,
          dialog: dialogRect ? {
            left: dialogRect.left,
            right: dialogRect.right,
            width: dialogRect.width,
            height: dialogRect.height
          } : null,
          formOverflow: Boolean(form && form.scrollWidth > form.clientWidth + 2),
          documentOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 2,
          under44: visibleTargets
            .map((element) => ({ label: element.id || element.textContent?.trim(), height: Math.round(element.getBoundingClientRect().height) }))
            .filter((entry) => entry.height < 44),
          longValueOverflow: [...(dialog?.querySelectorAll("p, code, dt, dd, strong, small, span") || [])].some((element) => {
            const style = getComputedStyle(element);
            return element.scrollWidth > element.clientWidth + 2
              && !["anywhere", "break-word"].includes(style.overflowWrap)
              && !["break-all", "break-word"].includes(style.wordBreak);
          })
        };
      }, { viewportWidth: width, scenario });
      if (!metrics.dialog) issues.push(`warp-egress-dialog@${width}/${scenario.name}: missing-dialog`);
      else if (metrics.dialog.left < -1 || metrics.dialog.right > width + 1) {
        issues.push(`warp-egress-dialog@${width}/${scenario.name}: outside-viewport ${JSON.stringify(metrics.dialog)}`);
      }
      if (metrics.formOverflow) issues.push(`warp-egress-dialog@${width}/${scenario.name}: internal-horizontal-overflow`);
      if (metrics.documentOverflow) issues.push(`warp-egress-dialog@${width}/${scenario.name}: page-horizontal-overflow`);
      if (metrics.under44.length) issues.push(`warp-egress-dialog@${width}/${scenario.name}: target-under-44 ${JSON.stringify(metrics.under44)}`);
      if (metrics.longValueOverflow) issues.push(`warp-egress-dialog@${width}/${scenario.name}: long-value-overflow`);
    }
    if (process.env.UI_AUDIT_SCREENSHOTS === "1" && [1440, 390].includes(width)) {
      await page.screenshot({
        path: fileURLToPath(new URL(`warp-egress-${width}.png`, screenshotRoot)),
        fullPage: false
      });
    }
  } catch (error) {
    issues.push(`warp-egress-dialog@${width}: open-failed ${error.message}`);
  } finally {
    const open = await page.evaluate(() => Boolean(document.querySelector("#warpEgressDialog")?.open)).catch(() => false);
    if (open) await domClick(page, '#warpEgressDialog button[value="cancel"]').catch(() => {});
    await page.evaluate((open) => {
      const details = document.querySelector("#nodeResultsDetails");
      if (details) details.open = open;
    }, detailsWasOpen).catch(() => {});
  }
  return issues;
}

async function instanceDetailLayoutIssues(page, width) {
  return page.evaluate(({ width, statusIds, actionIds }) => {
    const found = [];
    const visible = (element) => {
      if (!element || element.closest("[hidden]")) return false;
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
    };
    const close = (a, b, tolerance = 2) => Math.abs(a - b) <= tolerance;
    const uniqueCoordinates = (values, tolerance = 2) => values.reduce((groups, value) => {
      if (!groups.some((candidate) => close(candidate, value, tolerance))) groups.push(value);
      return groups;
    }, []);
    const statusElements = statusIds.map((id) => {
      const matches = [...document.querySelectorAll(`[data-instance-status="${id}"]`)].filter(visible);
      if (matches.length !== 1) found.push(`resources: duplicate canonical status ${id}: ${matches.length}`);
      return matches[0] || null;
    }).filter(Boolean);

    for (const id of actionIds) {
      const enabledVisible = [...document.querySelectorAll(`#${id}`)]
        .filter((element) => visible(element) && !element.disabled);
      if (enabledVisible.length > 1) {
        found.push(`resources: duplicate instance action ${id}: ${enabledVisible.length}`);
      }
    }

    const actionGroups = [...document.querySelectorAll("[data-action-group]")].filter(visible);
    for (const element of [
      ...statusElements.flatMap((status) => [...status.querySelectorAll("span, strong")]),
      ...actionGroups.flatMap((group) => [...group.querySelectorAll("summary span, summary small, button")].filter(visible))
    ]) {
      const parent = element.parentElement;
      if (!parent) continue;
      const rect = element.getBoundingClientRect();
      const parentRect = parent.getBoundingClientRect();
      if (rect.left < parentRect.left - 1 || rect.right > parentRect.right + 1) {
        found.push(`resources@${width}: instance-text-outside-container ${element.textContent?.trim().slice(0, 24)}`);
      }
    }

    if (width >= 1280 && statusElements.length === 4) {
      const rects = statusElements.map((element) => element.getBoundingClientRect());
      if (!rects.every((rect) => close(rect.top, rects[0].top) && close(rect.bottom, rects[0].bottom))) {
        found.push(`resources@${width}: instance-status-desktop-row`);
      }
      const groupRects = actionGroups.map((element) => element.getBoundingClientRect());
      if (groupRects.length !== 3 || !groupRects.every((rect) => close(rect.top, groupRects[0].top))) {
        found.push(`resources@${width}: instance-action-desktop-top`);
      }
    }

    if (width >= 768 && width <= 1024 && statusElements.length === 4) {
      const rects = statusElements.map((element) => element.getBoundingClientRect());
      const columns = uniqueCoordinates(rects.map((rect) => rect.left));
      const rows = uniqueCoordinates(rects.map((rect) => rect.top));
      if (columns.length !== 2 || rows.length !== 2) {
        found.push(`resources@${width}: instance-status-tablet-columns ${columns.length}x${rows.length}`);
      }
      const hub = document.querySelector("#operationHub");
      const maintain = document.querySelector('[data-action-group="maintain"]');
      const configure = document.querySelector('[data-action-group="configure"]');
      const diagnose = document.querySelector('[data-action-group="diagnose"]');
      if (hub && maintain && configure && diagnose) {
        const hubRect = hub.getBoundingClientRect();
        const maintainRect = maintain.getBoundingClientRect();
        const configureRect = configure.getBoundingClientRect();
        const diagnoseRect = diagnose.getBoundingClientRect();
        if (
          !close(maintainRect.left, hubRect.left)
          || !close(maintainRect.right, hubRect.right)
          || maintainRect.top <= Math.max(configureRect.top, diagnoseRect.top) + 2
        ) {
          found.push(`resources@${width}: instance-maintenance-tablet-row`);
        }
      } else {
        found.push(`resources@${width}: instance-maintenance-tablet-row missing`);
      }
    }

    if (width === 390 && statusElements.length === 4) {
      const rects = statusElements.map((element) => element.getBoundingClientRect());
      const columns = uniqueCoordinates(rects.map((rect) => rect.left));
      const rows = uniqueCoordinates(rects.map((rect) => rect.top));
      if (columns.length !== 1 || rows.length !== 4) {
        found.push(`resources@${width}: instance-status-mobile-column ${columns.length}x${rows.length}`);
      }
      const recommendedGroup = document.querySelector("#operationHub")?.dataset.recommendedGroup || "";
      const openGroups = actionGroups
        .filter((group) => group.open)
        .map((group) => group.dataset.actionGroup);
      const expectedOpen = recommendedGroup ? [recommendedGroup] : [];
      if (JSON.stringify(openGroups) !== JSON.stringify(expectedOpen)) {
        found.push(`resources@${width}: instance-mobile-auto-open-group ${openGroups.join(",")}/${recommendedGroup}`);
      }
      const controls = [
        ...document.querySelectorAll("#detailContent button:not([hidden]), #detailContent details > summary")
      ].filter(visible);
      for (const control of controls) {
        const rect = control.getBoundingClientRect();
        if (rect.height < 43.5) {
          found.push(`resources@${width}: instance-mobile-control-under-44 ${control.id || control.textContent?.trim().slice(0, 24)}`);
        }
      }
      if (document.documentElement.scrollWidth > document.documentElement.clientWidth + 1) {
        found.push(`resources@${width}: instance-mobile-horizontal-overflow`);
      }
    }
    return found;
  }, {
    width,
    statusIds: INSTANCE_STATUS_IDS,
    actionIds: INSTANCE_ACTION_IDS
  });
}

async function instanceDiagnosticLayoutIssues(page, width) {
  return page.evaluate((width) => {
    const found = [];
    const technicalDetails = document.querySelector("#technicalDetails");
    const moreAttributes = document.querySelector("#technicalMoreAttributes");
    if (moreAttributes?.open) {
      found.push(`resources@${width}: technical-more-attributes-open-by-default`);
      moreAttributes.open = false;
    }
    if (technicalDetails) technicalDetails.open = true;
    const overview = document.querySelector("#technicalOverview");
    const rows = [...(overview?.querySelectorAll(":scope > [data-technical-summary]") || [])];
    if (rows.length !== 3) {
      found.push(`resources@${width}: technical-summary-row-count ${rows.length}`);
    }
    if (overview?.querySelector("button, select")) {
      found.push(`resources@${width}: technical-primary-control-regression`);
    }
    const canonical = new Set(["SSH", "BBR", "防火墙", "服务"]);
    const duplicateLabels = rows
      .map((row) => row.querySelector(".technical-summary-label")?.textContent.trim())
      .filter((label) => canonical.has(label));
    if (duplicateLabels.length) {
      found.push(`resources@${width}: technical-duplicate-canonical-status ${duplicateLabels.join(",")}`);
    }
    if (width === 390) {
      for (const row of rows) {
        const rect = row.getBoundingClientRect();
        if (rect.height < 43.5) {
          found.push(`resources@${width}: technical-summary-target-under-44 ${row.dataset.technicalSummary}`);
        }
      }
      const moreSummaryRect = moreAttributes?.querySelector(":scope > summary")?.getBoundingClientRect();
      if (!moreSummaryRect || moreSummaryRect.height < 43.5) {
        found.push(`resources@${width}: technical-summary-target-under-44 more-attributes`);
      }
      const overviewRect = overview?.getBoundingClientRect();
      if (overviewRect && overviewRect.height > 264.5) {
        found.push(`resources@${width}: technical-overview-over-264 ${Math.round(overviewRect.height)}`);
      }
    }
    if (moreAttributes) moreAttributes.open = true;
    const evidenceLabels = [...document.querySelectorAll("#technicalEvidence dt")].map((element) => element.textContent.trim());
    for (const label of ["部署证据", "SSH 证据", "BBR 证据", "防火墙证据", "服务证据", "最新尝试"]) {
      if (!evidenceLabels.some((value) => value.includes(label))) {
        found.push(`resources@${width}: technical-evidence-row-missing ${label}`);
      }
    }
    for (const element of [overview, moreAttributes, ...rows, ...document.querySelectorAll("#technicalMoreAttributes dd, #technicalMoreAttributes select")].filter(Boolean)) {
      const rect = element.getBoundingClientRect();
      const parentRect = element.parentElement?.getBoundingClientRect();
      if (parentRect && rect.right > parentRect.right + 1) {
        found.push(`resources@${width}: technical-details-horizontal-overflow ${element.className || element.id}`);
      }
    }
    if (document.documentElement.scrollWidth > document.documentElement.clientWidth + 1) {
      found.push(`resources@${width}: technical-details-horizontal-overflow page`);
    }
    if (moreAttributes) {
      const resourceRows = [...document.querySelectorAll("[data-resource-key]")];
      if (resourceRows.length > 1) {
        moreAttributes.open = true;
        resourceRows[1].click();
        if (moreAttributes.open) {
          found.push(`resources@${width}: technical-more-attributes-stale-open`);
        }
        resourceRows[0].click();
      }
    }
    return found;
  }, width);
}

async function overviewDecisionBandIssues(page, width, stateLabel) {
  return page.evaluate(({ width, stateLabel }) => {
    const found = [];
    const vmPanel = document.querySelector("#overviewCurrentVm");
    const nextPanel = document.querySelector("#overviewNextAction");
    if (!vmPanel || !nextPanel) return [`workbench@${width}:${stateLabel}: missing-overview-decision-panels`];
    const vmRect = vmPanel.getBoundingClientRect();
    const nextRect = nextPanel.getBoundingClientRect();
    const desktopPair = width >= 768;
    if (vmRect.width <= 0 || vmRect.height <= 0 || nextRect.width <= 0 || nextRect.height <= 0) {
      found.push(`workbench@${width}:${stateLabel}: zero-size-overview-panel`);
    }
    if (desktopPair && Math.abs(vmRect.top - nextRect.top) > 2) {
      found.push(`workbench@${width}:${stateLabel}: overview-panel-top-misalignment ${Math.round(vmRect.top)}/${Math.round(nextRect.top)}`);
    }
    if (desktopPair && Math.abs(vmRect.bottom - nextRect.bottom) > 44) {
      found.push(`workbench@${width}:${stateLabel}: overview-panel-bottom-imbalance ${Math.round(vmRect.height)}/${Math.round(nextRect.height)}`);
    }
    const cta = nextPanel.querySelector("button");
    const steps = nextPanel.querySelector(".compact-steps");
    for (const [name, element] of [["cta", cta], ["steps", steps]]) {
      if (!element) {
        found.push(`workbench@${width}:${stateLabel}: missing-overview-${name}`);
        continue;
      }
      const rect = element.getBoundingClientRect();
      if (rect.left < nextRect.left - 1 || rect.right > nextRect.right + 1 || rect.bottom > nextRect.bottom + 1) {
        found.push(`workbench@${width}:${stateLabel}: overview-${name}-outside-panel`);
      }
    }
    const empty = document.querySelector("#selectedVmEmpty");
    const facts = document.querySelector("#selectedVmFacts");
    if (stateLabel === "unselected") {
      if (empty?.hidden) found.push(`workbench@${width}:${stateLabel}: empty-state-hidden`);
      if (empty) {
        const emptyRect = empty.getBoundingClientRect();
        if (desktopPair && emptyRect.height > 132) found.push(`workbench@${width}:${stateLabel}: empty-state-too-tall ${Math.round(emptyRect.height)}px`);
        if (emptyRect.right > vmRect.right + 1 || emptyRect.bottom > vmRect.bottom + 1) {
          found.push(`workbench@${width}:${stateLabel}: empty-state-outside-panel`);
        }
      }
    }
    if (stateLabel === "selected") {
      if (!empty?.hidden) found.push(`workbench@${width}:${stateLabel}: empty-state-visible`);
      if (!facts || facts.children.length < 4) found.push(`workbench@${width}:${stateLabel}: missing-selected-facts`);
      for (const dd of facts?.querySelectorAll("dd") || []) {
        if (dd.scrollWidth > dd.clientWidth + 2 && getComputedStyle(dd).overflowWrap !== "anywhere") {
          found.push(`workbench@${width}:${stateLabel}: fact-value-overflow ${dd.textContent.trim().slice(0, 24)}`);
        }
      }
    }
    for (const step of nextPanel.querySelectorAll(".compact-steps li")) {
      const rect = step.getBoundingClientRect();
      if (rect.width > 0 && rect.width < 42) found.push(`workbench@${width}:${stateLabel}: compact-step-too-narrow`);
      if (rect.right > nextRect.right + 1) found.push(`workbench@${width}:${stateLabel}: compact-step-overflow`);
    }
    return found;
  }, { width, stateLabel });
}

async function installStressContent(page, route) {
  if (!["tasks", "resources"].includes(route)) return;
  await page.evaluate((currentRoute) => {
    const resourceSelected = document.querySelector("[data-resource-key][aria-selected='true']")?.textContent || "";
    if (currentRoute === "resources" && !resourceSelected.includes("vm-a")) return;
    const longLink = `hysteria2://layout-audit-user:${"a".repeat(96)}@2001:db8:85a3::8a2e:370:7334:25737/?obfs=salamander&obfs-password=${"b".repeat(96)}#hy2-obfs-warp-layout-audit`;
    const target = document.querySelector(currentRoute === "resources" ? "#detailNodeResult" : "#nodeResult");
    if (!target) return;
    target.innerHTML = `
      <div class="link-list">
        <div class="node-value-row link-row">
          <div class="node-value-label">
            <strong>hy2-obfs-warp-with-an-intentionally-long-display-name</strong>
            <span>hysteria2 / 25737 / UDP</span>
          </div>
          <code class="node-value-code">${longLink}</code>
          <button class="secondary compact node-copy link-copy" type="button" data-copy-value="${longLink}">复制链接</button>
        </div>
      </div>`;
    document.querySelector("#logOutput").textContent = `ERROR ${"project-permission-denied/".repeat(24)}\n${longLink}`;
  }, route);
}

async function browserAudit() {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });
  const issues = [];
  try {
    const page = await browser.newPage();
    const browserDiagnostics = [];
    page.on("pageerror", (error) => browserDiagnostics.push(`pageerror: ${error.message}`));
    page.on("console", (message) => {
      if (["error", "warning"].includes(message.type())) browserDiagnostics.push(`${message.type()}: ${message.text()}`);
    });
    page.__layoutDiagnostics = browserDiagnostics;
    if (process.env.UI_AUDIT_SCREENSHOTS === "1") mkdirSync(fileURLToPath(screenshotRoot), { recursive: true });
    const writeRequests = [];
    const readOnlyRequestMethods = [];
    page.on("request", (request) => {
      if (!["GET", "HEAD", "OPTIONS"].includes(request.method())) writeRequests.push(`${request.method()} ${request.url()}`);
      if (request.url().includes("/api/doctor") || request.url().includes("/api/jobs")) {
        readOnlyRequestMethods.push(`${request.method()} ${request.url()}`);
      }
    });
    await installFixtures(page);
    for (const width of VIEWPORTS) {
      await page.setViewportSize({ width, height: 920 });
      await prepareContext(page, { selectResource: false, fresh: true });
      issues.push(...await overviewDecisionBandIssues(page, width, "unselected"));
      await selectFirstResource(page);
      for (const route of ROUTES) {
        await page.goto(`${BASE_URL}/#${route}`, { waitUntil: "networkidle" });
        await page.waitForSelector(`[data-view="${route}"]:not([hidden])`, { timeout: 5000 });
        if (route === "workbench" && width === 1440) {
          const scopeBefore = await page.textContent("#currentScope");
          await page.selectOption("#accountSelect", "1");
          await page.waitForFunction(() => document.querySelector("#projectSelect")?.textContent?.includes("没有可用项目"));
          if (!(await page.isDisabled("#useContext"))) issues.push(`${route}@${width}: no-project-account-enabled-context-switch`);
          if ((await page.textContent("#currentScope")) !== scopeBefore) issues.push(`${route}@${width}: account-dropdown-changed-active-context`);
          await page.selectOption("#accountSelect", "2");
          await page.waitForFunction(() => document.querySelector("#projectSelect")?.textContent?.includes("项目读取失败"));
          if (!(await page.isDisabled("#useContext"))) issues.push(`${route}@${width}: project-error-enabled-context-switch`);
          if ((await page.textContent("#currentScope")) !== scopeBefore) issues.push(`${route}@${width}: project-error-mutated-active-context`);
          await page.selectOption("#accountSelect", "0");
          await page.waitForFunction(() => Boolean(document.querySelector("#projectSelect")?.value));
        }
        if (route === "config" && width === 1440) {
          await domClick(page, "#savePreview");
          await page.waitForSelector('[data-view="tasks"]:not([hidden])');
          await page.goto(`${BASE_URL}/#config`, { waitUntil: "networkidle" });
          await page.fill("#vmName", "gcloud-vm-edited-after-preview");
          if (!(await page.isDisabled("#executePreview"))) issues.push(`${route}@${width}: edited-config-kept-preview-executable`);
          const previewState = await page.textContent("#previewState");
          if (!previewState?.includes("无有效预览")) issues.push(`${route}@${width}: edited-config-kept-preview-state`);
        }
        if (route === "resources") {
          const writesBeforeSelection = writeRequests.length;
          await selectResourceByName(page, "vm-a");
          const selected = await page.evaluate(() => [...document.querySelectorAll("[data-resource-key]")].some((row) => row.getAttribute("aria-selected") === "true" && row.textContent?.includes("vm-a")));
          if (!selected) issues.push(`${route}@${width}: row-click-did-not-select`);
          if (writeRequests.length !== writesBeforeSelection) issues.push(`${route}@${width}: row-click-triggered-write`);
          const writesBeforeDialog = writeRequests.length;
          issues.push(...await networkExposureDialogIssues(page, width));
          if (writeRequests.length !== writesBeforeDialog) issues.push(`${route}@${width}: opening-network-dialog-triggered-write`);
          const writesBeforeWarpDialog = writeRequests.length;
          issues.push(...await warpEgressDialogIssues(page, width));
          if (writeRequests.length !== writesBeforeWarpDialog) issues.push(`${route}@${width}: opening-warp-dialog-triggered-write`);
        }
        if (route === "tasks") {
          await domClick(page, '[data-job-id="layout-job-interrupted"]');
        }
        await installStressContent(page, route);
        if (route === "workbench") {
          issues.push(...await overviewDecisionBandIssues(page, width, "selected"));
        }
        const routeIssues = await page.evaluate(({ route, width }) => {
          const found = [];
          const documentWidth = document.documentElement.clientWidth;
          if (document.documentElement.scrollWidth > documentWidth + 2) {
            found.push(`${route}@${width}: horizontal-overflow ${document.documentElement.scrollWidth}/${documentWidth}`);
          }
          const brand = document.querySelector(".brand");
          if (brand && brand.scrollWidth > brand.clientWidth + 2) {
            found.push(`${route}@${width}: brand-wordmark-overflow ${brand.scrollWidth}/${brand.clientWidth}`);
          }
          for (const element of document.querySelectorAll("button, input, select, textarea, code, dd, .resource-row, .resource-cell, .resource-name, .panel")) {
            if (element.matches("input[type='radio'], input[type='checkbox']")) continue;
            const rect = element.getBoundingClientRect();
            if (rect.width > 0 && rect.right > documentWidth + 2) {
              found.push(`${route}@${width}: clipped ${element.tagName.toLowerCase()} ${Math.round(rect.right - documentWidth)}px`);
            }
            const text = (element.textContent || element.value || "").trim();
            if (text.length > 4 && rect.width > 0 && rect.width < 34) {
              found.push(`${route}@${width}: vertical-text-risk ${text.slice(0, 16)}`);
            }
          }
          const evidence = document.querySelector("#evidenceTimeline");
          if (route === "tasks" && !evidence) found.push(`${route}@${width}: missing-evidence-timeline`);
          for (const element of document.querySelectorAll("#diagnosticSummary, #diagnosticSummaryRows, #evidenceTimeline, .evidence-step")) {
            const rect = element.getBoundingClientRect();
            if (rect.width > 0 && rect.right > documentWidth + 2) {
              found.push(`${route}@${width}: guided-diagnostics-overflow ${element.id || element.className}`);
            }
            if (element.scrollWidth > element.clientWidth + 2 && getComputedStyle(element).overflowWrap !== "anywhere") {
              found.push(`${route}@${width}: scenario-content-not-contained ${element.id || element.className}`);
            }
          }
          for (const heading of document.querySelectorAll(".panel > .section-heading")) {
            const panel = heading.closest(".panel");
            if (!panel) continue;
            const panelRect = panel.getBoundingClientRect();
            const title = heading.querySelector("h2, h3, strong") || heading;
            const titleRect = title.getBoundingClientRect();
            if (titleRect.width > 0 && titleRect.left - panelRect.left < 10) {
              found.push(`${route}@${width}: panel-heading-left-clipped ${Math.round(titleRect.left - panelRect.left)}px`);
            }
          }
          if (width === 390) {
            for (const element of document.querySelectorAll("button:not([hidden]), .nav a")) {
              const rect = element.getBoundingClientRect();
              if (rect.width > 0 && rect.height < 43) found.push(`${route}@${width}: undersized-touch-target ${element.textContent.trim()}`);
            }
          }
          if (route === "tasks" || route === "resources") {
            const scope = route === "resources" ? document.querySelector("#detailNodeResult") : document;
            const longLink = scope?.querySelector(".node-value-code, .link-row code");
            if (longLink && longLink.scrollWidth > longLink.clientWidth) {
              const overflow = getComputedStyle(longLink).overflowX;
              if (!["auto", "scroll"].includes(overflow)) found.push(`${route}@${width}: long-link-has-no-scroll-container`);
            }
            if (!scope?.querySelector(".node-copy, .link-copy")) found.push(`${route}@${width}: node-link-copy-action-missing`);
          }
          if (route === "workbench" && width === 390) {
            const columns = getComputedStyle(document.querySelector("#overviewSummary")).gridTemplateColumns.split(" ").filter(Boolean);
            if (columns.length < 2) found.push(`${route}@${width}: mobile-summary-not-compact`);
            const opsPanel = document.querySelector("#overviewOperations");
            if (opsPanel && opsPanel.getBoundingClientRect().height > 360) found.push(`${route}@${width}: operations-panel-too-tall`);
          }
          if (route === "workbench") {
            if (document.querySelector("#operationGuide") || document.querySelectorAll("#overviewNextAction").length !== 1) {
              found.push(`${route}@${width}: duplicate-overview-guidance`);
            }
            const runtime = document.querySelector(".doctor-runtime-section");
            if (!runtime) found.push(`${route}@${width}: runtime-checks-not-collapsed`);
            if (runtime?.open) found.push(`${route}@${width}: runtime-checks-open-by-default`);
            if (!runtime?.querySelector(".doctor-runtime-summary")?.textContent?.includes("5 项检查")) {
              found.push(`${route}@${width}: runtime-summary-missing-count`);
            }
          }
          if (route === "workbench" && width >= 1280) {
            const vmPanel = document.querySelector("#overviewCurrentVm");
            const nextPanel = document.querySelector("#overviewNextAction");
            const facts = document.querySelector("#selectedVmFacts");
            const empty = document.querySelector("#selectedVmEmpty");
            if (vmPanel && facts && empty?.hidden && facts.children.length) {
              const panelRect = vmPanel.getBoundingClientRect();
              const factsRect = facts.getBoundingClientRect();
              const bottomSlack = panelRect.bottom - factsRect.bottom;
              if (bottomSlack > 52) found.push(`${route}@${width}: current-vm-panel-excess-bottom-space ${Math.round(bottomSlack)}px`);
              if (nextPanel) {
                const nextRect = nextPanel.getBoundingClientRect();
                const sameRow = Math.abs(panelRect.top - nextRect.top) <= 2;
                if (sameRow && panelRect.height > nextRect.height + 12) {
                  found.push(`${route}@${width}: current-vm-panel-taller-than-action ${Math.round(panelRect.height - nextRect.height)}px`);
                }
              }
            }
          }
          if (route === "resources" && width >= 1280) {
            const resourceLayout = document.querySelector(".resource-layout");
            const layoutColumns = resourceLayout ? getComputedStyle(resourceLayout).gridTemplateColumns.split(" ").filter(Boolean).length : 0;
            if (layoutColumns !== 1) found.push(`${route}@${width}: vm-layout-not-table-first`);
            const listPanel = document.querySelector(".resource-list-panel");
            const detailPanel = document.querySelector(".detail-panel");
            if (listPanel && detailPanel) {
              const listRect = listPanel.getBoundingClientRect();
              const detailRect = detailPanel.getBoundingClientRect();
              if (detailRect.y < listRect.y + listRect.height - 1) found.push(`${route}@${width}: detail-panel-side-rail-regression`);
            }
            const title = document.querySelector("#detailTitle");
            if (title?.getBoundingClientRect().height > 76) found.push(`${route}@${width}: detail-title-too-tall`);
          }
          if (route === "resources") {
            const detailContent = document.querySelector("#detailContent");
            if (!detailContent) found.push(`${route}@${width}: missing-detail-content`);
            const detailOperations = document.querySelector("#detailOperations");
            if (!detailOperations) found.push(`${route}@${width}: missing-detail-operations`);
            const verifyButton = document.querySelector("#smartDiagnoseInstance");
            if (!verifyButton) {
              found.push(`${route}@${width}: missing-smart-diagnose-action`);
            } else if (document.querySelector(".resource-row.selected") && verifyButton.disabled) {
              found.push(`${route}@${width}: selected-smart-diagnose-disabled`);
            }
            const technicalOverview = document.querySelector("#technicalOverview");
            if (!technicalOverview) found.push(`${route}@${width}: missing-technical-overview`);
            if (!document.querySelector(".resource-row.selected") && detailOperations && !detailOperations.hidden) {
              found.push(`${route}@${width}: empty-detail-actions-visible`);
            }
            if (!document.querySelector("#technicalMoreAttributes")) found.push(`${route}@${width}: missing-technical-more-attributes`);
            if (!document.querySelector("#detailNodeResult")) found.push(`${route}@${width}: missing-detail-node-result`);
            const recommendation = document.querySelector("#detailRecommendation");
            const hint = document.querySelector("#detailActionHint:not([hidden])");
            if (recommendation && hint) {
              const normalize = (value) => String(value || "").replace(/[：；，。\s]/g, "");
              const recommendationText = normalize(recommendation.textContent);
              const hintText = normalize(hint.textContent);
              if (hintText && (recommendationText.includes(hintText) || hintText.includes(recommendationText))) {
                found.push(`${route}@${width}: instance-duplicate-recommendation-hint`);
              }
            }
          }
          if (route === "tasks") {
            const taskRecovery = document.querySelector("#taskRecovery");
            if (!taskRecovery) found.push(`${route}@${width}: missing-task-recovery`);
            const historyScroll = document.querySelector("#taskHistory .table-scroll");
            if (historyScroll && historyScroll.scrollWidth > historyScroll.clientWidth + 2) {
              const overflowX = getComputedStyle(historyScroll).overflowX;
              if (!["auto", "scroll"].includes(overflowX)) found.push(`${route}@${width}: task-history-horizontal-overflow`);
            }
            const storageNotice = document.querySelector("#taskStorageNotice:not([hidden])");
            if (storageNotice) {
              const noticeRect = storageNotice.getBoundingClientRect();
              const panelRect = storageNotice.closest(".panel")?.getBoundingClientRect();
              if (panelRect && (noticeRect.left < panelRect.left - 1 || noticeRect.right > panelRect.right + 1)) {
                found.push(`${route}@${width}: task-storage-notice-overflow`);
              }
            }
            if (!document.querySelector('[data-job-id="layout-job-interrupted"] .state-pill.warning')) {
              found.push(`${route}@${width}: interrupted-task-warning-state-missing`);
            }
            const diagnostics = document.querySelector("#taskDiagnosticsDetails");
            const artifacts = document.querySelector("#taskArtifactsDetails");
            if (diagnostics?.open) found.push(`${route}@${width}: task-diagnostics-open-by-default`);
            if (artifacts?.open) found.push(`${route}@${width}: task-artifacts-open-by-default`);
            const timelineHint = document.querySelector("#taskTimelineHint")?.textContent || "";
            if (timelineHint.includes("预览指纹")) {
              found.push(`${route}@${width}: task-timeline-hint-preview-leak`);
            }
            if (width >= 1280) {
              const contextColumn = document.querySelector(".task-context-column");
              const outputPanel = document.querySelector(".task-output-panel");
              const contextRect = contextColumn?.getBoundingClientRect();
              const outputRect = outputPanel?.getBoundingClientRect();
              if (!contextRect || !outputRect || outputRect.width < contextRect.width * 1.35) {
                found.push(`${route}@${width}: task-detail-desktop-result-main-column`);
              }
              const contextPanels = [...(contextColumn?.querySelectorAll(":scope > .panel") || [])];
              if (outputRect && contextPanels.some((panel) => Math.abs(panel.getBoundingClientRect().height - outputRect.height) < 4)) {
                found.push(`${route}@${width}: task-detail-desktop-context-stretch`);
              }
            }
          }
          return found;
        }, { route, width });
        issues.push(...routeIssues);
        if (route === "resources") {
          issues.push(...await instanceDetailLayoutIssues(page, width));
          issues.push(...await instanceDiagnosticLayoutIssues(page, width));
        }
        if (process.env.UI_AUDIT_SCREENSHOTS === "1" && [1440, 390].includes(width)) {
          await page.evaluate(() => {
            window.scrollTo(0, 0);
            document.querySelector("#toastHost")?.replaceChildren();
          });
          await page.waitForTimeout(50);
          await page.screenshot({
            path: fileURLToPath(new URL(`${route}-${width}.png`, screenshotRoot)),
            fullPage: true
          });
        }
      }
    }
    await auditActionLogic(page, issues, writeRequests);
    const readOnlyWrites = readOnlyRequestMethods.filter((entry) => {
      const method = entry.split(" ", 1)[0];
      return !["GET", "HEAD", "OPTIONS"].includes(method);
    });
    if (readOnlyWrites.length) issues.push(`read-only-flow-sent-write ${readOnlyWrites.join(" | ")}`);
    await page.setViewportSize({ width: 390, height: 920 });
    await prepareContext(page);
    await page.goto(`${BASE_URL}/#resources`, { waitUntil: "networkidle" });
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await domClick(page, '.nav a[data-route="tasks"]');
    await page.waitForSelector('[data-view="tasks"]:not([hidden])');
    await page.waitForTimeout(50);
    if ((await page.evaluate(() => window.scrollY)) > 2) issues.push("route-change-preserved-stale-scroll-position");
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForSelector('[data-view="tasks"]:not([hidden])');
    await page.waitForTimeout(100);
    if ((await page.evaluate(() => window.scrollY)) > 2) issues.push("initial-load-preserved-stale-scroll-position");
  } finally {
    await browser.close();
  }
  return issues;
}

async function healthCheck() {
  try {
    const response = await fetch(`${BASE_URL}/api/health`);
    return response.ok;
  } catch {
    return false;
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function ensureServer() {
  if (await healthCheck()) return null;
  const child = spawn(process.execPath, ["server.js"], {
    cwd: uiRoot,
    stdio: ["ignore", "ignore", "pipe"]
  });
  let stderr = "";
  child.stderr?.setEncoding?.("utf8");
  child.stderr?.on("data", (chunk) => { stderr += chunk; });
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (await healthCheck()) return child;
    if (child.exitCode != null) break;
    await delay(250);
  }
  child.kill();
  throw new Error(`UI server is not reachable at ${BASE_URL}. ${stderr.trim() || "Start failed."}`);
}

const staticIssues = staticAudit();
if (staticIssues.length) {
  console.error(staticIssues.join("\n"));
  process.exit(1);
}

let spawnedServer = null;
try {
  spawnedServer = await ensureServer();
  const issues = await browserAudit();
  if (issues.length) {
    console.error(issues.join("\n"));
    process.exit(1);
  }
  console.log(`layout audit passed: ${ROUTES.length} pages x ${VIEWPORTS.length} widths`);
} catch (error) {
  console.error(`macos_sandbox_browser_blocked: ${error.message}`);
  process.exit(1);
} finally {
  if (spawnedServer) spawnedServer.kill();
}
