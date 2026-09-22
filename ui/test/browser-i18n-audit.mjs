import { copyFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { ensureServer, installFixtures, prepareContext } from "./browser-layout-audit.mjs";

const BASE_URL = process.env.UI_AUDIT_URL || "http://127.0.0.1:8787";
const ROUTES = ["workbench", "resources", "config", "tasks"];
const VIEWPORTS = [1440, 390];
const STORAGE_KEY = "gcloud-vm-console.locale";
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const outputRoot = path.join(projectRoot, "ui/output/playwright");
const demoRoot = path.join(projectRoot, "docs/demo");

function routeFallback(route) {
  const url = new URL(route.request().url());
  if (!url.pathname.startsWith("/api/")) return route.continue();
  const body = url.pathname.endsWith("/regions")
    ? {
        schemaVersion: 1,
        generatedAt: "2026-01-01T00:00:00.000Z",
        stale: false,
        source: { kind: "mock", reason: "browser i18n audit" },
        freeRegionIds: ["us-west1", "us-central1", "us-east1"],
        regions: [
          { id: "us-west1", label: "美国/俄勒冈", group: "North America", zones: ["us-west1-b"], defaultZone: "us-west1-b", freeTier: "always_free" },
          { id: "us-central1", label: "美国/爱荷华", group: "North America", zones: ["us-central1-a"], defaultZone: "us-central1-a", freeTier: "always_free" }
        ]
      }
    : url.pathname.endsWith("/free-rules") || url.pathname.endsWith("/free-rules/calibrate")
      ? {
          stale: false,
          generatedAt: "2026-01-01T00:00:00.000Z",
          source: { kind: "mock" },
          rules: {
            compute: {
              alwaysFreeRegions: ["us-west1", "us-central1", "us-east1"],
              provisioningModel: "non-preemptible",
              machineType: "e2-micro",
              disk: { standardPersistentDiskGbMonths: 30 },
              outbound: { allowanceGb: 1 }
            },
            network: { externalIpv4: { separatePricing: true } }
          }
        }
      : url.pathname.endsWith("/projects")
        ? { projects: [{ projectId: "example-project", name: "My First Project", lifecycleState: "ACTIVE" }] }
        : url.pathname.endsWith("/cloud-instances")
          ? { instances: [] }
          : url.pathname.endsWith("/jobs")
            ? { jobs: [], meta: { storage: "memory", recoveredInterrupted: 0, quarantined: 0 } }
            : url.pathname.endsWith("/doctor")
              ? { status: "pass", generatedAt: "2026-01-01T00:00:00.000Z", context: {}, summary: { pass: 0, warning: 0, blocked: 0 }, checks: [] }
              : url.pathname.endsWith("/health")
                ? { ok: true, mode: "gcloud-only", capabilities: {} }
                : url.pathname.endsWith("/local-security/ssh-auth")
                  ? { sshAuth: { configured: false, versionId: "", updatedAt: "" } }
                  : { ok: true };
  return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
}

function rawNodes(root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = [];
  let node;
  while ((node = walker.nextNode())) {
    const parent = node.parentElement;
    if (!parent || !node.nodeValue.trim() || parent.closest("script,style,noscript,template,[hidden],[data-i18n-ignore],#languageToggle")) continue;
    if (parent.closest("code,pre,.log-output,.node-value-code,[data-technical]")) continue;
    if (!parent.offsetParent && parent !== document.body) continue;
    nodes.push(node);
  }
  return nodes;
}

function auditLocale(page, locale, route, width) {
  return page.evaluate(({ locale, route, width }) => {
    const issues = [];
    const englishLeak = /\b(?:Overview|Instances|Deployment|Tasks|Refresh|Create|Select|Project|Account|Status|Running|Stopped|Loading|Current|Read[- ]only|Network|Region|Target|Mode|Key changes|Cloud|Execution|Preview|Apply|Cancel|Save|Delete|Open|Check|Error|Success|Warning|Switch|Instance|Task|Resources|Configuration|English|Chinese|No instances|No project|Not checked|Not selected)\b/i;
    const englishLeakToken = /\b(?:Overview|Instances|Deployment|Tasks|Refresh|Create|Select|Project|Account|Status|Running|Stopped|Loading|Current|Read[- ]only|Network|Region|Target|Mode|Key changes|Cloud|Execution|Preview|Apply|Cancel|Save|Delete|Open|Check|Error|Success|Warning|Switch|Instance|Task|Resources|Configuration|English|Chinese|No instances|No project|Not checked|Not selected|Environment|Free|Local|Services|System|Node|Deploy|Diagnostics|Firewall|Enabled|Unconfirmed|Run)\b/gi;
    const technicalOnly = (value) => {
      const text = String(value || "").trim();
      if (!text) return true;
      if (/^(?:[A-Za-z0-9_.$:@/?#=&+%\-]|\s)+$/.test(text)) return true;
      if (/^(?:RUNNING|TERMINATED|ACTIVE|PENDING|SSH|BBR|WARP|TUIC|Hysteria2|Sing-Box-Plus|3X-UI)$/i.test(text)) return true;
      if (/\b(?:example-project|user@example\.com|debian-cloud\/debian-\d+|e2-(?:micro|small)|us-[a-z0-9-]+|asia-[a-z0-9-]+|europe-[a-z0-9-]+|[0-9]{1,3}(?:\.[0-9]{1,3}){3})\b/i.test(text) && !/[\u4e00-\u9fff]/.test(text.replace(/(?:example-project|user@example\.com|debian-cloud\/debian-\d+|e2-(?:micro|small)|us-[a-z0-9-]+|asia-[a-z0-9-]+|europe-[a-z0-9-]+|[0-9]{1,3}(?:\.[0-9]{1,3}){3})/gi, ""))) return true;
      return false;
    };
    const hasEnglishUiLeak = (value) => {
      const text = String(value || "");
      for (const match of text.matchAll(englishLeakToken)) {
        const before = text[match.index - 1] || "";
        const after = text[match.index + match[0].length] || "";
        if (!/[A-Za-z0-9_.-]/.test(before) && !/[A-Za-z0-9_.-]/.test(after)) return true;
      }
      return false;
    };
    const root = document.documentElement;
    const expectedToggle = locale === "en-US" ? "中文" : "English";
    const expectedTitle = locale === "en-US" ? "切换到中文" : "Switch to English";
    const toggle = document.querySelector("#languageToggle");
    if (root.lang !== locale) issues.push(`${route}@${width}/${locale}: html.lang=${root.lang}`);
    if (!toggle || toggle.textContent.trim() !== expectedToggle) issues.push(`${route}@${width}/${locale}: toggle-label=${toggle?.textContent?.trim()}`);
    if (toggle?.getAttribute("title") !== expectedTitle) issues.push(`${route}@${width}/${locale}: toggle-title=${toggle?.getAttribute("title")}`);
    if (document.documentElement.scrollWidth > document.documentElement.clientWidth + 2) issues.push(`${route}@${width}/${locale}: horizontal-overflow`);
    for (const element of document.querySelectorAll("button:not([hidden]), input:not([hidden]), select:not([hidden]), textarea:not([hidden]), .nav a")) {
      const rect = element.getBoundingClientRect();
      if (rect.right > document.documentElement.clientWidth + 2) issues.push(`${route}@${width}/${locale}: clipped-control=${element.id || element.textContent.trim().slice(0, 24)}`);
      if (width === 390 && /^(?:BUTTON|A)$/.test(element.tagName) && rect.width > 0 && rect.height < 43) issues.push(`${route}@${width}/${locale}: undersized-control=${element.id || element.textContent.trim().slice(0, 24)}`);
    }
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const parent = node.parentElement;
      if (!parent || !node.nodeValue.trim() || parent.closest("script,style,noscript,template,[hidden],[data-i18n-ignore],#languageToggle,code,pre,.log-output,.node-value-code,[data-technical]")) continue;
      if (!parent.offsetParent && parent !== document.body) continue;
      const text = node.nodeValue.trim();
      if (locale === "en-US" && /[\u4e00-\u9fff]/.test(text) && !technicalOnly(text)) issues.push(`${route}@${width}/${locale}: untranslated-cn=${text.slice(0, 220)}`);
      if (locale === "zh-CN" && englishLeak.test(text) && hasEnglishUiLeak(text) && !technicalOnly(text)) issues.push(`${route}@${width}/${locale}: untranslated-en=${text.slice(0, 220)}`);
    }
    for (const element of document.querySelectorAll("[aria-label],[title],[placeholder]")) {
      if (element.closest("#languageToggle,[data-i18n-ignore],code,pre,.log-output,.node-value-code")) continue;
      for (const attribute of ["aria-label", "title", "placeholder"]) {
        const value = element.getAttribute(attribute) || "";
        if (!value) continue;
        if (locale === "en-US" && /[\u4e00-\u9fff]/.test(value) && !technicalOnly(value)) issues.push(`${route}@${width}/${locale}: untranslated-cn-${attribute}=${value}`);
        if (locale === "zh-CN" && englishLeak.test(value) && hasEnglishUiLeak(value) && !technicalOnly(value)) issues.push(`${route}@${width}/${locale}: untranslated-en-${attribute}=${value}`);
      }
    }
    return issues;
  }, { locale, route, width });
}

async function waitLocale(page, locale) {
  try {
    await page.waitForFunction((expected) => document.documentElement.lang === expected, locale, { timeout: 3000 });
  } catch (error) {
    const state = await page.evaluate(() => ({ lang: document.documentElement.lang, stored: localStorage.getItem("gcloud-vm-console.locale"), hash: location.hash }));
    throw new Error(`locale did not settle: expected=${locale} state=${JSON.stringify(state)}; ${error.message}`);
  }
  await page.waitForTimeout(40);
}

async function clickToggle(page) {
  const before = await page.evaluate(() => ({ lang: document.documentElement.lang, stored: localStorage.getItem("gcloud-vm-console.locale"), text: document.querySelector("#languageToggle")?.textContent, listener: Boolean(document.querySelector("#languageToggle")) }));
  await page.evaluate(() => document.querySelector("#languageToggle")?.click());
  await page.waitForTimeout(60);
  const after = await page.evaluate(() => ({ lang: document.documentElement.lang, stored: localStorage.getItem("gcloud-vm-console.locale"), text: document.querySelector("#languageToggle")?.textContent }));
  if (before.lang === after.lang) console.log(`toggle did not change: before=${JSON.stringify(before)} after=${JSON.stringify(after)}`);
}

async function selectDynamicResource(page, route) {
  if (route !== "resources") return;
  const row = page.locator('[data-resource-key]').filter({ hasText: "vm-a" }).first();
  await row.waitFor({ state: "visible", timeout: 3000 });
  await row.click();
  await page.waitForTimeout(40);
}

async function audit() {
  const spawnedServer = await ensureServer();
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const issues = [];
  try {
    // Register the broad route first; Playwright gives newer, fixture-specific
    // handlers precedence, so no request can escape to a real GCP project.
    await page.route("**/api/**", routeFallback);
    await installFixtures(page);
    await page.addInitScript(({ key }) => {
      if (!localStorage.getItem(key)) localStorage.setItem(key, "zh-CN");
    }, { key: STORAGE_KEY });
    for (const width of VIEWPORTS) {
      await page.setViewportSize({ width, height: 920 });
      await page.goto(`${BASE_URL}/?i18nAudit=${Date.now()}-${width}#workbench`, { waitUntil: "networkidle" });
      await prepareContext(page, { selectResource: true, fresh: true });
      for (const route of ROUTES) {
        if (route !== "workbench") {
          await page.goto(`${BASE_URL}/#${route}`, { waitUntil: "networkidle" });
          await page.waitForSelector(`[data-view="${route}"]:not([hidden])`, { timeout: 5000 });
          if (route === "tasks") {
            await page.locator('[data-job-id="layout-job-interrupted"]').click().catch(() => {});
            await page.waitForTimeout(40);
          }
        }
        await selectDynamicResource(page, route);
        await waitLocale(page, "zh-CN");
        issues.push(...await auditLocale(page, "zh-CN", route, width));
        if (route === "workbench" && process.env.UI_AUDIT_SCREENSHOTS === "1") {
          mkdirSync(outputRoot, { recursive: true });
          await page.screenshot({ path: path.join(outputRoot, `workbench-zh-CN-${width}.png`), fullPage: true });
        }
        await clickToggle(page);
        await waitLocale(page, "en-US");
        issues.push(...await auditLocale(page, "en-US", route, width));
        if (route === "workbench" && process.env.UI_AUDIT_SCREENSHOTS === "1") {
          await page.screenshot({ path: path.join(outputRoot, `workbench-en-US-${width}.png`), fullPage: true });
        }
        await page.reload({ waitUntil: "networkidle" });
        await selectDynamicResource(page, route);
        await waitLocale(page, "en-US");
        issues.push(...await auditLocale(page, "en-US", route, width));
        await clickToggle(page);
        await waitLocale(page, "zh-CN");
        await page.reload({ waitUntil: "networkidle" });
        await selectDynamicResource(page, route);
        await waitLocale(page, "zh-CN");
        issues.push(...await auditLocale(page, "zh-CN", route, width));
      }
    }
    if (process.env.UI_AUDIT_SCREENSHOTS === "1") {
      mkdirSync(demoRoot, { recursive: true });
      for (const locale of ["en-US", "zh-CN"]) {
        for (const width of VIEWPORTS) {
          copyFileSync(path.join(outputRoot, `workbench-${locale}-${width}.png`), path.join(demoRoot, `workbench-${locale}-${width}.png`));
        }
      }
    }
  } finally {
    await browser.close();
    if (spawnedServer) spawnedServer.kill();
  }
  if (issues.length) {
    console.error(issues.join("\n"));
    process.exitCode = 1;
  } else {
    console.log(`browser i18n audit passed: ${ROUTES.length} pages x ${VIEWPORTS.length} widths x 2 locales`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await audit();
