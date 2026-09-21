import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";

import { ensureServer, installFixtures } from "./browser-layout-audit.mjs";

const BASE_URL = process.env.UI_AUDIT_URL || "http://127.0.0.1:8787";
const DEFAULT_PROJECT = "example-project";
const ACCOUNTS = [
  { name: "default", configuration: "default", account: "user@example.com", projectId: DEFAULT_PROJECT },
  { name: "slow", configuration: "slow", account: "slow@example.com", projectId: "slow-project" },
  { name: "fast", configuration: "fast", account: "fast@example.com", projectId: "fast-project" }
];
const PENDING_BLOCKED_ACTIONS = [
  "openConfig", "refreshAll", "refreshResources", "doctorRunBtn", "saveDraft", "savePreview", "executePreview",
  "restartVm", "systemUpdate", "deployNodes", "applyNetworkExposure", "reconnectWarpEgress"
];

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function reply(route, body, status = 200) {
  return route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

async function readContext(page) {
  return page.evaluate((ids) => ({
    account: document.querySelector("#accountSelect")?.selectedOptions[0]?.textContent || "",
    project: document.querySelector("#projectSelect")?.value || "",
    projectOptions: [...document.querySelectorAll("#projectSelect option")].map((option) => option.value),
    scope: document.querySelector("#currentScope")?.textContent || "",
    sync: document.querySelector("#globalSyncState")?.textContent?.trim() || "",
    hint: document.querySelector("#contextHint")?.textContent || "",
    resourceCount: document.querySelectorAll("[data-resource-key]").length,
    visibleRoute: [...document.querySelectorAll("[data-view]")].find((view) => !view.hidden)?.dataset.view || "",
    useContextDisabled: document.querySelector("#useContext")?.disabled,
    disabled: Object.fromEntries(ids.map((id) => [id, Boolean(document.getElementById(id)?.disabled)]))
  }), PENDING_BLOCKED_ACTIONS);
}

async function audit() {
  const spawnedServer = await ensureServer();
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 920 } });
  const nonReadRequests = [];
  const pageErrors = [];
  const slowRequested = deferred();
  const releaseSlowResponse = deferred();
  const slowResponseFinished = deferred();
  let accountsAvailable = true;
  let slowResponseReleased = false;

  try {
    page.on("pageerror", (error) => pageErrors.push(error.message));
    page.on("request", (request) => {
      if (new URL(request.url()).pathname.startsWith("/api/") && !["GET", "HEAD", "OPTIONS"].includes(request.method())) {
        nonReadRequests.push(`${request.method()} ${new URL(request.url()).pathname}`);
      }
    });
    // This catch-all is registered first so no audit request can reach a real
    // gcloud account. Specific mock fixtures registered below take precedence.
    await page.route("**/api/**", (route) => {
      const pathname = new URL(route.request().url()).pathname;
      if (pathname === "/api/regions") {
        return reply(route, {
          source: { kind: "mock" }, stale: false, freeRegionIds: ["us-west1"],
          regions: [{ id: "us-west1", label: "美国/俄勒冈", group: "North America", zones: ["us-west1-b"], defaultZone: "us-west1-b", freeTier: "always_free" }]
        });
      }
      if (pathname === "/api/free-rules") {
        return reply(route, {
          source: { kind: "mock" }, stale: false,
          rules: { compute: { alwaysFreeRegions: ["us-west1"], machineType: "e2-micro", disk: { standardPersistentDiskGbMonths: 30 }, outbound: { allowanceGb: 1 } }, network: { externalIpv4: { separatePricing: true } } }
        });
      }
      return reply(route, { error: `Unexpected mock API request: ${pathname}` }, 501);
    });
    await installFixtures(page);
    await page.route("**/api/accounts", (route) => reply(route, { accounts: accountsAvailable ? ACCOUNTS : [] }));
    await page.route("**/api/projects?**", async (route) => {
      const account = new URL(route.request().url()).searchParams.get("account");
      if (account === "slow@example.com") {
        slowRequested.resolve();
        await releaseSlowResponse.promise;
        try {
          await reply(route, { projects: [{ projectId: "slow-project", name: "Slow account project" }] });
        } catch {
          // An aborted obsolete request is the intended result of the race guard.
        } finally {
          slowResponseFinished.resolve();
        }
        return;
      }
      return reply(route, { projects: [{ projectId: account === "fast@example.com" ? "fast-project" : DEFAULT_PROJECT, name: "Mock project" }] });
    });
    await page.addInitScript(() => localStorage.setItem("gcloud-vm-console.locale", "zh-CN"));
    await page.goto(`${BASE_URL}/?contextAudit=${Date.now()}#workbench`, { waitUntil: "networkidle" });
    await page.waitForFunction(() => document.querySelectorAll("[data-resource-key]").length === 3);
    const initial = await readContext(page);
    assert.match(initial.scope, /user@example\.com.*example-project/);

    await page.selectOption("#accountSelect", "1");
    await slowRequested.promise;
    await page.selectOption("#accountSelect", "2");
    await page.waitForFunction(() => document.querySelector("#projectSelect")?.value === "fast-project");
    let pending = await readContext(page);
    assert.match(pending.account, /fast@example\.com/);
    assert.deepEqual(pending.projectOptions, ["fast-project"]);
    assert.equal(pending.resourceCount, 0, "pending context must not present the old project's VM rows");
    assert.equal(pending.useContextDisabled, false, "the chosen context should remain explicitly applicable");
    for (const id of PENDING_BLOCKED_ACTIONS) assert.equal(pending.disabled[id], true, `${id} must be blocked while context is pending`);
    assert.match(`${pending.sync} ${pending.hint}`, /切换/, "pending selection needs visible apply guidance");

    releaseSlowResponse.resolve();
    slowResponseReleased = true;
    await slowResponseFinished.promise;
    await page.waitForTimeout(100);
    pending = await readContext(page);
    assert.match(pending.account, /fast@example\.com/);
    assert.equal(pending.project, "fast-project", "late projects from the previous account must not replace the newest selection");
    assert.deepEqual(pending.projectOptions, ["fast-project"]);

    await page.evaluate(() => { location.hash = "#resources"; });
    await page.waitForTimeout(80);
    assert.equal((await readContext(page)).visibleRoute, "workbench", "pending context must keep stale resource routes unavailable");

    await page.selectOption("#accountSelect", "0");
    await page.waitForFunction(() => document.querySelectorAll("[data-resource-key]").length === 3);
    const recovered = await readContext(page);
    assert.equal(recovered.project, DEFAULT_PROJECT);
    assert.equal(recovered.disabled.openConfig, false, "returning to the active context should restore current inventory and actions");
    assert.doesNotMatch(recovered.sync, /已选择其他项目|待切换/);

    accountsAvailable = false;
    await page.click("#reloadAccounts");
    await page.waitForFunction(() => document.querySelector("#accountSelect")?.options.length === 0);
    await page.waitForTimeout(80);
    const loggedOut = await readContext(page);
    assert.equal(loggedOut.resourceCount, 0, "an empty account reload must clear the old inventory");
    assert.doesNotMatch(loggedOut.scope, /user@example\.com|example-project/, "an empty account reload must clear the old active scope");
    assert.equal(loggedOut.disabled.openConfig, true);
    assert.equal(loggedOut.useContextDisabled, true);
    assert.match(loggedOut.hint, /登录|账号/, "an empty account reload needs actionable account guidance");

    assert.deepEqual(nonReadRequests, [], "context audit must not submit writes");
    assert.deepEqual(pageErrors, [], "context changes must not raise browser errors");
    console.log("browser context audit passed: account race, pending-action gates, active-context recovery, empty-account reset");
  } finally {
    if (!slowResponseReleased) releaseSlowResponse.resolve();
    await browser.close();
    if (spawnedServer) spawnedServer.kill();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await audit();
