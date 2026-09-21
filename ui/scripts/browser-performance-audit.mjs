import { performance } from "node:perf_hooks";

import { countRequestWaves } from "../server/performance-audit.js";

const BASE_URL = process.env.UI_AUDIT_URL || "http://127.0.0.1:8787";
const DEFAULT_CONFIGURATION = "default";
const DEFAULT_ACCOUNT = "user@example.com";
const DEFAULT_PROJECT = "example-project";
const FIXTURE_DELAY_MS = 35;

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function json(body) {
  return JSON.stringify(body);
}

function requestName(url) {
  const parsed = new URL(url);
  if (!parsed.pathname.startsWith("/api/")) return "";
  return parsed.pathname.replace(/^\/api\//, "");
}

async function fulfill(route, body) {
  await wait(FIXTURE_DELAY_MS);
  await route.fulfill({ contentType: "application/json", body: json(body) });
}

async function installFixtures(page) {
  await page.route("**/api/health", (route) => fulfill(route, {
    ok: true,
    mode: "gcloud-only",
    capabilities: { persistentJobHistory: true }
  }));
  await page.route("**/api/jobs", (route) => fulfill(route, { jobs: [], meta: { storage: "persistent" } }));
  await page.route("**/api/accounts", (route) => fulfill(route, {
    accounts: [{
      name: DEFAULT_CONFIGURATION,
      configuration: DEFAULT_CONFIGURATION,
      account: DEFAULT_ACCOUNT,
      projectId: DEFAULT_PROJECT
    }]
  }));
  await page.route("**/api/projects?**", (route) => fulfill(route, {
    projects: [{ projectId: DEFAULT_PROJECT, name: "Performance Fixture", lifecycleState: "ACTIVE" }]
  }));
  await page.route("**/api/vm-records?**", (route) => fulfill(route, { records: [] }));
  await page.route("**/api/cloud-instances?**", (route) => fulfill(route, { instances: [] }));
  await page.route("**/api/regions?**", (route) => fulfill(route, {
    generatedAt: "2026-07-12T00:00:00.000Z",
    stale: false,
    source: { kind: "fixture" },
    freeRegionIds: ["us-west1"],
    regions: [{
      id: "us-west1",
      label: "美国/俄勒冈",
      group: "North America",
      zones: ["us-west1-a"],
      defaultZone: "us-west1-a",
      freeTier: "always_free"
    }]
  }));
  await page.route("**/api/free-rules?**", (route) => fulfill(route, {
    generatedAt: "2026-07-12T00:00:00.000Z",
    stale: false,
    source: { kind: "fixture" },
    rules: { compute: { machineType: "e2-micro", alwaysFreeRegions: ["us-west1"] } }
  }));
  await page.route("**/api/doctor?**", (route) => fulfill(route, {
    status: "pass",
    generatedAt: "2026-07-12T00:00:00.000Z",
    summary: { pass: 1, warning: 0, blocked: 0 },
    checks: []
  }));
}

const { chromium } = await import("playwright");
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const requestEvents = [];
  const eventByRequest = new Map();
  const nonReadRequests = [];
  const startedAt = performance.now();

  page.on("request", (request) => {
    const name = requestName(request.url());
    if (!name) return;
    if (!["GET", "HEAD", "OPTIONS"].includes(request.method())) {
      nonReadRequests.push(`${request.method()} ${name}`);
    }
    const event = { name, startedAt: performance.now() - startedAt, finishedAt: null };
    requestEvents.push(event);
    eventByRequest.set(request, event);
  });
  const finishRequest = (request) => {
    const event = eventByRequest.get(request);
    if (event) event.finishedAt = performance.now() - startedAt;
  };
  page.on("requestfinished", finishRequest);
  page.on("requestfailed", finishRequest);

  await page.addInitScript(() => {
    window.__GVC_PERF_MUTATIONS__ = { workbench: 0, resources: 0, config: 0, tasks: 0 };
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        const element = mutation.target?.nodeType === Node.ELEMENT_NODE
          ? mutation.target
          : mutation.target?.parentElement;
        const pageElement = element?.closest?.("[id^='page-']");
        const route = pageElement?.id?.replace(/^page-/, "");
        if (route && route in window.__GVC_PERF_MUTATIONS__) {
          window.__GVC_PERF_MUTATIONS__[route] += 1;
        }
      }
    });
    observer.observe(document, { subtree: true, childList: true, characterData: true, attributes: true });
  });

  await installFixtures(page);
  await page.goto(`${BASE_URL}/#workbench`, { waitUntil: "networkidle" });
  await page.waitForFunction(() => document.querySelector("#globalSyncState")?.textContent?.includes("数据已同步"), null, { timeout: 5000 });

  const validEvents = requestEvents.filter((event) => Number.isFinite(event.finishedAt));
  const report = {
    generatedAt: new Date().toISOString(),
    requestWaves: countRequestWaves(validEvents),
    requestCount: validEvents.length,
    requests: validEvents.map((event) => ({
      name: event.name,
      startedAtMs: Number(event.startedAt.toFixed(2)),
      durationMs: Number((event.finishedAt - event.startedAt).toFixed(2))
    })),
    duplicateRequests: Object.entries(validEvents.reduce((result, event) => {
      result[event.name] = (result[event.name] || 0) + 1;
      return result;
    }, {})).filter(([, count]) => count > 1).map(([name, count]) => ({ name, count })),
    nonReadRequests,
    mutationCounts: await page.evaluate(() => window.__GVC_PERF_MUTATIONS__)
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} finally {
  await browser.close();
}
