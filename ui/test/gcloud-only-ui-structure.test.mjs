import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { ACTION_BUTTON_IDS } from "../public/lib/action-readiness-view-model.js";
import { summarizeResourceSyncFailures } from "../public/lib/resource-sync-view-model.js";

const index = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
const app = await readFile(new URL("../public/app.js", import.meta.url), "utf8");
const operationGuidance = await readFile(new URL("../public/lib/operation-guidance-view-model.js", import.meta.url), "utf8");
const technicalDetailsModel = await readFile(new URL("../public/lib/instance-technical-details-view-model.js", import.meta.url), "utf8");
const styles = await readFile(new URL("../public/styles.css", import.meta.url), "utf8");

function parseOklch(block, token) {
  const match = block.match(new RegExp(`${token}:\\s*oklch\\(([\\d.]+)\\s+([\\d.]+)\\s+([\\d.]+)`));
  assert.ok(match, `missing OKLCH token ${token}`);
  return match.slice(1).map(Number);
}

function relativeLuminance([lightness, chroma, hue]) {
  const radians = hue * Math.PI / 180;
  const a = chroma * Math.cos(radians);
  const b = chroma * Math.sin(radians);
  const lPrime = lightness + 0.3963377774 * a + 0.2158037573 * b;
  const mPrime = lightness - 0.1055613458 * a - 0.0638541728 * b;
  const sPrime = lightness - 0.0894841775 * a - 1.291485548 * b;
  const l = lPrime ** 3;
  const m = mPrime ** 3;
  const s = sPrime ** 3;
  const rgb = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s
  ].map((value) => Math.max(0, Math.min(1, value)));
  return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
}

function contrastRatio(foreground, background) {
  const first = relativeLuminance(foreground);
  const second = relativeLuminance(background);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

test("gcloud-only UI exposes exactly the four approved pages", () => {
  const routes = [...index.matchAll(/data-view="([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(routes, ["workbench", "resources", "config", "tasks"]);
  assert.match(index, /href="#workbench"[^>]*>[\s\S]*总览[\s\S]*<\/a>/);
  assert.match(index, /href="#resources"[^>]*>[\s\S]*实例[\s\S]*<\/a>/);
  assert.match(index, /href="#config"[^>]*>[\s\S]*部署[\s\S]*<\/a>/);
  assert.match(index, /href="#tasks"[^>]*>[\s\S]*任务[\s\S]*<\/a>/);
  assert.match(index, /id="page-resources"[\s\S]*?<h1>实例<\/h1>/);
  assert.match(index, /id="page-config"[\s\S]*?<h1>部署<\/h1>/);
  assert.doesNotMatch(index, />工作台<|>VM 资源<|>配置 VM<|>任务与结果</);
  for (const route of routes) {
    assert.match(index, new RegExp(`<section id="page-${route}"[^>]*data-view="${route}"`));
    assert.doesNotMatch(index, new RegExp(`<section id="${route}"`));
  }
});

test("visible copy uses instance and deployment naming consistently", () => {
  const staleHtmlCopy = [
    "<h1>VM</h1>",
    "<h1>配置</h1>",
    "VM 配置",
    "配置此 VM",
    "新建 VM",
    "当前 VM",
    "VM 清单",
    "选择 VM",
    "只开 VM",
    "云端 VM"
  ];
  for (const text of staleHtmlCopy) assert.doesNotMatch(index, new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

  const staleDynamicCopy = [
    "继续管理当前 VM",
    "选择或创建 VM",
    "当前 VM 已选中",
    "已有 VM",
    "打开 VM 清单",
    "当前项目还没有 VM",
    "新 VM",
    "VM 清单已刷新",
    "正在读取 VM 清单",
    "未选择 VM",
    "只开 VM",
    "新建 VM",
    "编辑 VM",
    "基于已有 VM 新建",
    "接管云端 VM",
    "请先选择一台 VM",
    "保存 VM 记录",
    "重启 VM"
  ];
  for (const text of staleDynamicCopy) assert.doesNotMatch(app, new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

  assert.match(index, /<h2>实例部署<\/h2>/);
  assert.match(index, /id="openConfig"[^>]*>新建实例<\/button>/);
  assert.match(app, /只开实例/);
  assert.match(app, /重启实例/);
});

test("resource sync errors preserve actionable proxy and project access details", () => {
  assert.match(
    summarizeResourceSyncFailures([
      "本地代理不可用：gcloud 连接 Google API 时代理隧道返回 503。请检查 127.0.0.1:1082/MacPacket 或临时关闭代理后重试。"
    ]),
    /本地代理不可用.*503/
  );
  assert.match(
    summarizeResourceSyncFailures([
      "项目访问失败：当前账号可能没有权限，或 Compute Engine API 未启用。请确认账号、项目和 API 状态后重试。"
    ]),
    /项目访问失败.*Compute Engine API/
  );
  assert.equal(summarizeResourceSyncFailures([]), "请检查项目权限或网络后重试。");
});

test("sidebar uses product wordmark navigation and local gcloud status", () => {
  assert.match(index, /<div class="brand" aria-label="GCP VM Console">/);
  assert.match(index, /brand-word">GCP/);
  assert.match(index, /brand-word">VM/);
  assert.match(index, /brand-word brand-accent">CONSOLE/);
  assert.match(index, /Gcloud · 本地/);
  assert.match(styles, /\.brand \{\n\s*position: relative;\n\s*display: flex;/);
  assert.match(styles, /\.brand-dot \{/);
  assert.match(styles, /\.brand-word \{[\s\S]*?font-size: 14px;/);
  assert.match(styles, /@media \(max-width: 430px\)[\s\S]*?\.brand-word \{\n\s*font-size: 12px;/);
  assert.match(styles, /\.nav a svg \{/);
  assert.doesNotMatch(index, /brand-mark|brand-copy|Local operations|gcloud-only/);
});

test("overview is a mature console summary instead of a duplicated setup page", () => {
  for (const id of ["overviewOperations", "overviewSummary", "overviewCurrentVm", "overviewRecentTask", "overviewNextAction"]) {
    assert.match(index, new RegExp(`id="${id}"`));
  }
  assert.match(index, /class="[^"]*\bops-panel\b[^"]*"/);
  assert.match(index, /class="[^"]*\bops-header\b[^"]*"/);
  assert.ok(index.indexOf('id="overviewOperations"') < index.indexOf('id="overviewCurrentVm"'), "operations panel should lead the overview");
  assert.ok(index.indexOf('id="overviewSummary"') < index.indexOf('id="overviewCurrentVm"'), "summary metrics should stay above VM cards");
  assert.match(index, /账号与项目/);
  assert.match(index, /费用与安全/);
  assert.doesNotMatch(index, /连接信息/);
  assert.doesNotMatch(index, /id="overviewAccount"|id="overviewProject"/);
  assert.match(index, /id="overviewVmCount"/);
  assert.match(index, /id="overviewRunningCount"/);
  assert.match(styles, /--overview-decision-min-height: 224px;/);
  assert.match(styles, /\.overview-grid \{[\s\S]*?align-items: stretch;/);
  assert.match(styles, /\.overview-vm-panel \{\n\s*display: flex;\n\s*grid-area: vm;\n\s*flex-direction: column;\n\s*min-height: var\(--overview-decision-min-height\);/);
  assert.match(styles, /#selectedVmFacts:not\(:empty\) \{\n\s*margin-top: auto;/);
  assert.match(styles, /#selectedVmEmpty:not\(\[hidden\]\) \{\n\s*margin-top: auto;/);
  assert.match(styles, /\.next-action-panel \{\n\s*display: flex;\n\s*grid-area: next;\n\s*flex-direction: column;\n\s*min-height: var\(--overview-decision-min-height\);/);
  assert.match(styles, /\.next-action-panel > button \{\n\s*width: 100%;\n\s*margin-top: auto;/);
  assert.match(styles, /\.overview-facts \{\n\s*padding-top: 12px;\n\s*border-top: 1px solid var\(--border-subtle\);/);
  assert.match(styles, /\.overview-facts > div \{\n\s*min-height: 0;\n\s*padding-block: 0;\n\s*border-bottom: 0;/);
});

test("operational doctor is compact and does not add a route", () => {
  assert.match(index, /id="doctorPanel"/);
  assert.match(index, /id="doctorRunBtn"/);
  assert.match(index, /id="doctorSummary"/);
  assert.match(index, /id="doctorChecks"/);
  assert.doesNotMatch(index, /href="#doctor"/);
  assert.match(app, /doctor-view-model\.js/);
  assert.match(app, /\/api\/doctor/);
  assert.match(styles, /\.doctor-checks \{/);
  assert.match(styles, /\.doctor-runtime-summary \{/);
  assert.match(styles, /\.doctor-runtime-section:not\(\[open\]\) > \.doctor-runtime-items \{\n\s*display: none;/);
  assert.match(styles, /\.doctor-item \{/);
  assert.match(styles, /\.doctor-evidence \{/);
});

test("record evidence changes refresh resources and Doctor in one context snapshot", () => {
  const runRecordTask = app.match(/async function runRecordTask\([\s\S]*?\n}\n\nasync function recognizeSelectedInstance/)?.[0] || "";
  assert.match(runRecordTask, /await refreshResources\(\)/);
  assert.doesNotMatch(runRecordTask, /syncDoctorAfterEvidenceChange/);
  assert.doesNotMatch(runRecordTask, /previewState/);
  const snapshot = app.match(/async function fetchContextSnapshot\([^)]*\) \{([\s\S]*?)\n\}/)?.[1] || "";
  assert.match(snapshot, /fetchDoctor\(context/);
});

test("overview has one next-step owner and diagnostics stay inside existing pages", () => {
  assert.doesNotMatch(index, /id="operationGuide"|id="operationGuidePrimary"|id="operationGuideIssues"/);
  assert.equal([...index.matchAll(/id="overviewNextAction"/g)].length, 1);
  assert.match(index, /id="diagnosticSummary"/);
  assert.match(index, /id="copyDiagnosticSummary"/);
  assert.doesNotMatch(index, /href="#guide"|href="#diagnostics"/);
  assert.doesNotMatch(app, /function renderOperationGuide\(|#operationGuidePrimary/);
  assert.match(app, /检查当前实例状态/);
  assert.match(app, /SSH、BBR、防火墙和服务状态/);
  assert.match(app, /diagnostic-summary-view-model\.js/);
  assert.doesNotMatch(styles, /\.operation-guide\s*\{|\.guide-issue\s*\{/);
  assert.match(styles, /\.diagnostic-summary \{/);
  assert.match(index, /styles\.css\?v=[^"']+/);
  assert.match(index, /app\.js\?v=[^"']+/);
});

test("instance detail groups secondary operations without adding a route", () => {
  assert.match(index, /id="operationHub"/);
  assert.match(index, /data-action-group="diagnose"/);
  assert.match(index, /data-action-group="maintain"/);
  assert.match(index, /data-action-group="configure"/);
  assert.doesNotMatch(index, /href="#operation-hub"|data-view="operation-hub"/);
  assert.match(styles, /\.operation-hub \{/);
  assert.match(styles, /\.action-cluster \{/);
  assert.equal([...index.matchAll(/id="smartDiagnoseInstance"/g)].length, 1);
  assert.equal([...index.matchAll(/id="adoptLocalInstance"/g)].length, 1);
  assert.doesNotMatch(index, /id="checkStatus"|id="verifyInstance"|id="recognizeInstance"/);
  assert.match(index, /id="detailActionHint"[^>]*hidden/);
  assert.match(app, /toOperationHint/);
  assert.match(app, /hint\.hidden = !operationHint\.visible/);
});

test("selected instance uses the status-first progressive disclosure structure", () => {
  for (const id of [
    "instanceStatusSummary",
    "detailRecommendation",
    "detailRecommendationTitle",
    "detailRecommendationText",
    "technicalDetails",
    "nodeResultsDetails",
    "showNodeResults"
  ]) {
    assert.match(index, new RegExp(`id="${id}"`));
  }

  for (const statusId of ["ssh", "bbr", "firewall", "services"]) {
    assert.equal(
      [...index.matchAll(new RegExp(`data-instance-status="${statusId}"`, "g"))].length,
      1,
      `${statusId} must have one canonical status owner`
    );
  }

  const configureStart = index.indexOf('data-action-group="configure"');
  const diagnoseStart = index.indexOf('data-action-group="diagnose"');
  const maintainStart = index.indexOf('data-action-group="maintain"');
  const dangerStart = index.indexOf('class="danger-zone instance-disclosure"');
  const deployIndex = index.indexOf('id="deployNodes"');
  assert.ok(configureStart < deployIndex && deployIndex < diagnoseStart, "node deployment belongs to configuration");
  assert.ok(maintainStart < dangerStart, "maintenance must precede danger disclosure");
  assert.ok(deployIndex < maintainStart, "maintenance must not own node deployment");

  for (const group of ["configure", "diagnose", "maintain"]) {
    assert.match(index, new RegExp(`<details[^>]+data-action-group="${group}"`));
  }
});

test("status-first instance layout defines exact desktop tablet and mobile geometry", () => {
  for (const selector of [
    ".instance-detail-header",
    ".instance-status-summary",
    ".instance-status-item",
    ".instance-recommendation",
    ".instance-action-groups",
    ".instance-disclosure",
    ".action-cluster-body"
  ]) {
    assert.match(styles, new RegExp(selector.replaceAll(".", "\\.")));
  }

  assert.match(styles, /\.detail-panel\.is-selected \{\s*grid-template-columns: minmax\(0, 1fr\);/);
  assert.match(styles, /\.instance-status-summary \{[\s\S]*?grid-template-columns: repeat\(4, minmax\(0, 1fr\)\);/);
  assert.match(styles, /\.instance-action-groups \{[\s\S]*?grid-template-columns: repeat\(3, minmax\(0, 1fr\)\);/);
  assert.match(styles, /@media \(max-width: 1080px\)[\s\S]*?\.instance-status-summary \{[\s\S]*?repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(styles, /@media \(max-width: 1080px\)[\s\S]*?\.instance-action-groups \{[\s\S]*?repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(styles, /@media \(max-width: 1080px\)[\s\S]*?\[data-action-group="maintain"\] \{[\s\S]*?grid-column: 1 \/ -1/);
  assert.match(styles, /@media \(max-width: 767px\)[\s\S]*?\.instance-status-summary,[\s\S]*?\.instance-action-groups \{[\s\S]*?grid-template-columns: minmax\(0, 1fr\)/);
  assert.match(styles, /@media \(max-width: 767px\)[\s\S]*?\.instance-status-item \{[\s\S]*?min-height: 0/);
  assert.match(styles, /@media \(max-width: 767px\)[\s\S]*?\.technical-more-attributes > summary,[\s\S]*?min-height: 44px/);
  assert.match(styles, /\.action-cluster-body \{[\s\S]*?grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/);
  assert.match(app, /group\.dataset\.visibleActionCount/);
  assert.match(styles, /\.action-cluster\[data-visible-action-count="1"\][\s\S]*?grid-column: 1 \/ -1;/);
  assert.match(styles, /\.action-cluster\[data-visible-action-count="3"\][\s\S]*?grid-column: 1 \/ -1;/);
  assert.match(styles, /@media \(max-width: 767px\)[\s\S]*?\.action-cluster-body \{[\s\S]*?grid-template-columns: minmax\(0, 1fr\);/);
});

test("new deployment defaults to a deliberate low-cost region and summarizes zones without repetition", () => {
  assert.match(app, /const DEFAULT_REGION_ID = "us-west1";/);
  const optionsBody = app.match(/function renderRegionOptions\([^)]*\) \{([\s\S]*?)\n\}/)?.[1] || "";
  assert.match(optionsBody, /DEFAULT_REGION_ID/);
  assert.doesNotMatch(optionsBody, /state\.regionCatalog\.regions\?\.\[0\].*select\.value/);
  const helperBody = app.match(/function renderRegionHelper\([^)]*\) \{([\s\S]*?)\n\}/)?.[1] || "";
  assert.match(helperBody, /\$\{zones\.length\} 个可用区/);
  assert.doesNotMatch(helperBody, /zones\.join/);
});

test("task workspace gives results the main column and folds secondary evidence", () => {
  assert.match(index, /class="task-context-column"/);
  assert.match(index, /<details id="taskDiagnosticsDetails"[^>]*class="task-output-disclosure"/);
  assert.match(index, /<details id="taskArtifactsDetails"[^>]*class="task-output-disclosure"/);
  assert.doesNotMatch(index, /<details id="taskDiagnosticsDetails"[^>]*open/);
  assert.doesNotMatch(index, /<details id="taskArtifactsDetails"[^>]*open/);
  assert.match(index, /id="taskTimelineHint"/);
  assert.match(styles, /\.task-detail-grid \{[\s\S]*?grid-template-columns: minmax\(260px, 0\.72fr\) minmax\(0, 1\.6fr\);[\s\S]*?align-items: start;/);
  assert.match(styles, /\.task-context-column \{[\s\S]*?display: grid;[\s\S]*?align-self: start;/);
  assert.match(styles, /\.task-output-panel \{[\s\S]*?align-self: start;/);
  assert.match(styles, /@media \(max-width: 1080px\)[\s\S]*?\.task-detail-grid \{[\s\S]*?grid-template-columns: 1fr;/);
});

test("navigation focus remains accessible without mimicking a second selected route", () => {
  assert.match(styles, /\.nav a:focus-visible \{[\s\S]*?outline: 2px solid var\(--border-accent\);[\s\S]*?box-shadow: none !important;/);
});

test("instance detail contains long values without page-level expansion", () => {
  for (const selector of [
    "#detailTitle",
    "#detailSubtitle",
    ".instance-detail-meta",
    ".instance-status-item strong",
    ".instance-recommendation",
    ".technical-summary-row strong",
    ".technical-summary-row small",
    ".technical-facts dd",
    ".technical-evidence-list dd",
    ".firewall-rule-row",
    ".recovery-action-row"
  ]) {
    const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    assert.match(styles, new RegExp(`${escaped}[\\s\\S]{0,500}overflow-wrap: anywhere`));
  }
  assert.match(styles, /\.node-value-code \{[\s\S]*?max-width: 100%;[\s\S]*?overflow-x: auto;/);
});

test("scenario confidence additions stay compact and inside existing routes", () => {
  assert.match(index, /id="evidenceTimeline"/);
  assert.doesNotMatch(index, /href="#scenario"|href="#evidence"/);
  assert.match(operationGuidance, /operation-scenario-view-model\.js/);
  assert.match(app, /evidence-timeline-view-model\.js/);
  assert.match(app, /copy-text\.js/);
  assert.match(styles, /\.evidence-timeline \{/);
  assert.match(styles, /\.evidence-step \{/);
});

test("gcloud-only UI removes old Terraform ADC Profile and link workflow surfaces", () => {
  const activeUi = `${index}\n${app}`;
  assert.doesNotMatch(activeUi, /Terraform|ADC|application-default|cloud-link|cloudLinks|保存关联|关联到草稿|Profile 下拉|profileSelect/);
  assert.doesNotMatch(index, /id="identity"|data-view="identity"|id="overview"|data-view="overview"|id="create"|data-view="create"/);
});

test("gcloud-only UI keeps normal create actions to draft save and preview generation", () => {
  assert.match(index, /id="saveDraft"/);
  assert.match(index, /id="savePreview"/);
  assert.doesNotMatch(index, /createAndDeploy|terraformApply|terraformPlan|saveCloudLink/);
});

test("configuration desired state includes safe deployment recognition markers only", () => {
  const formDesiredBody = app.match(/function formDesired\(\) \{([\s\S]*?)\n\}/)?.[1] || "";
  assert.match(formDesiredBody, /gvc_managed:\s*"true"/);
  assert.match(formDesiredBody, /gvc_deploy_method:\s*selectedDeployMethod\(\)/);
  assert.match(formDesiredBody, /gvcRecordSchema:\s*"1"/);
  assert.match(formDesiredBody, /gvcDeployMethod:\s*selectedDeployMethod\(\)/);
  assert.doesNotMatch(formDesiredBody, /vless:\/\/|vmess:\/\/|hy2:\/\/|hysteria2:\/\/|tuic:\/\/|ss:\/\/|password|token|private/i);
});

test("gcloud-only UI maintenance and node buttons call concrete API endpoints", () => {
  assert.match(index, /id="smartDiagnoseInstance"/);
  assert.match(index, /id="restartVm"/);
  assert.match(index, /id="systemUpdate"/);
  assert.match(index, /id="deployNodes"/);
  assert.match(index, /id="sshUser"/);
  assert.match(index, /id="sshKeyFile"/);
  assert.match(index, /id="sshPort"/);
  assert.match(app, /adoption-preview/);
  assert.match(app, /endpoint: "verify"/);
  assert.match(app, /maintenance\/restart/);
  assert.match(app, /maintenance\/system-update/);
  assert.match(app, /nodes\/deploy/);
  assert.doesNotMatch(app, /入口已准备|后端接入后/);
});

test("configuration form is region-only and derives zones from the region catalog", () => {
  assert.match(index, /id="region"/);
  assert.match(index, /id="regionZoneHelper"/);
  assert.match(index, /id="regionCatalogSource"/);
  assert.match(index, /id="regionFreeTierHint"/);
  assert.match(index, /id="zoneChoice"/);
  assert.doesNotMatch(index, /id="zone"|name="zone"|<span>可用区<\/span><input/);
  assert.match(app, /regionCatalog:/);
  assert.match(app, /derivedZone:/);
  assert.match(app, /async function fetchRegionCatalog/);
  assert.match(app, /fetchContextSnapshot[\s\S]*fetchRegionCatalog/);
  assert.match(app, /function updateDerivedZone/);
  assert.match(app, /function renderRegionHelper/);
  assert.match(app, /zoneChoice/);
  assert.match(app, /state\.derivedZone = zone\.value/);
  assert.doesNotMatch(app, /\$\("#zone"\)/);
  assert.doesNotMatch(app, /\$\("#region"\)\.value}-b/);
});

test("fallback region catalog is complete enough when region API is unavailable", () => {
  const fallbackBody = app.match(/const FALLBACK_REGION_CATALOG = \{([\s\S]*?)\n\};/)?.[1] || "";
  const regionIds = [...fallbackBody.matchAll(/\{\s*id: "([^"]+)"/g)].map((match) => match[1]);
  const labels = [...fallbackBody.matchAll(/\{\s*id: "([^"]+)".*?label: "([^"]+)"/g)].map((match) => ({ id: match[1], label: match[2] }));
  assert.ok(regionIds.length >= 40, `expected at least 40 fallback regions, got ${regionIds.length}`);
  for (const id of ["us-west1", "us-central1", "us-east1", "asia-southeast2", "europe-west9", "africa-south1"]) {
    assert.ok(regionIds.includes(id), `missing fallback region ${id}`);
  }
  assert.equal(labels.length, regionIds.length);
  for (const { id, label } of labels) {
    assert.notEqual(label, id, `${id} should not use the bare region id as its label`);
    assert.match(label, /^[\u4e00-\u9fff]+\/[\u4e00-\u9fff（）]+$/u, `${id} should use Chinese country/city label`);
  }
  assert.match(fallbackBody, /asia-southeast2", label: "印度尼西亚\/雅加达"/);
  assert.match(fallbackBody, /europe-west9", label: "法国\/巴黎"/);
  assert.match(fallbackBody, /us-west1", label: "美国\/俄勒冈"/);
});

test("startup script treats stale gcloud-only health without current local capabilities as stale", async () => {
  const startScript = await readFile(new URL("../../scripts/start-ui.sh", import.meta.url), "utf8");
  assert.match(startScript, /runtime-revision\.mjs/);
  assert.match(startScript, /runtimeRevision/);
  assert.match(startScript, /EXPECTED_REVISION/);
  assert.match(startScript, /"regionCatalog":true/);
  assert.match(startScript, /"freeRuleCalibration":true/);
  assert.match(startScript, /"persistentJobHistory":true/);
  assert.match(startScript, /"runtimeOptimization":true/);
  assert.match(startScript, /"networkResilience":true/);
  assert.match(startScript, /"resilientInventory":true/);
  assert.match(startScript, /"firewallGovernance":true/);
  assert.match(startScript, /"metadataSafeReadOnlySsh":true/);
});

test("free rule calibration is backed by API and updates source metadata", () => {
  assert.match(index, /id="freeRuleSource"/);
  assert.match(index, /id="freeRuleCheckedAt"/);
  assert.match(app, /free-rules\/calibrate/);
  assert.match(app, /free-rules/);
  assert.match(app, /function renderFreeRuleSummary/);
  assert.match(app, /公网 IPv4 独立计费/);
  assert.match(app, /30GB 标准持久磁盘/);
  assert.match(app, /1GB 北美出站/);
  assert.doesNotMatch(app, /当前为本地提示：免费规则需要按 Google Cloud 官网实时校对/);
});

test("node deployment controls expose the exact deployment pipeline", () => {
  assert.match(app, /部署 Sing-Box-Plus/);
  assert.match(app, /部署 3X-UI/);
  assert.match(app, /无需部署节点/);
  assert.match(app, /运行自定义脚本/);
  assert.doesNotMatch(app, /运行自定义部署/);
  assert.match(app, /function deployActionLabel/);
  assert.match(app, /function updateDeployAction/);
  assert.match(app, /function renderFirewallResult/);
  assert.match(index, /id="firewallResult"/);
});

test("firewall result UI exposes rule name protocol ports target tags and source ranges", () => {
  const renderBody = app.match(/function renderFirewallResult\(firewall\) \{([\s\S]*?)\n\}\n\nasync function executePreview/)?.[1] || "";
  assert.match(renderBody, /rule\.name/);
  assert.match(renderBody, /rule\.protocol/);
  assert.match(renderBody, /rule\.ports/);
  assert.match(renderBody, /rule\.targetTags/);
  assert.match(renderBody, /rule\.sourceRanges/);
  assert.match(renderBody, /目标标签/);
  assert.match(renderBody, /来源/);
});

test("gcloud-only UI uses the gcloud configuration name when loading projects", () => {
  assert.match(app, /function accountConfiguration\(account\)/);
  assert.match(app, /accountConfiguration\(account\)/);
  assert.doesNotMatch(app, /if \(!account\?\.configuration \|\| !account\?\.account\)/);
});

test("account and project switching cannot fall back to stale context state", () => {
  const currentProjectBody = app.match(/function currentProjectId\(\) \{([\s\S]*?)\n\}/)?.[1] || "";
  assert.doesNotMatch(currentProjectBody, /state\.context/);
  assert.match(app, /function resetSelectedVmContext\(/);
  assert.match(app, /function restoreActiveContext\(/);
});

test("account and project switching stages pending context before committing", () => {
  assert.match(app, /pendingContext:\s*\{/);
  assert.match(app, /function updatePendingContextFromSelects\(/);
  assert.match(app, /function snapshotActiveContext\(/);
  assert.match(app, /function restoreActiveContext\(/);

  const currentAccountBody = app.match(/function currentAccount\(\) \{([\s\S]*?)\n\}/)?.[1] || "";
  assert.match(currentAccountBody, /state\.pendingContext/);
  assert.match(currentAccountBody, /pending\.configuration/);
  const currentProjectBody = app.match(/function currentProjectId\(\) \{([\s\S]*?)\n\}/)?.[1] || "";
  assert.match(currentProjectBody, /state\.pendingContext\.projectId/);

  const accountChangeBody = app.match(/\$\("#accountSelect"\)\.addEventListener\("change", \(\) => \{([\s\S]*?)\n\s*\}\);/)?.[1] || "";
  assert.match(accountChangeBody, /updatePendingContextFromSelects\(/);
  assert.doesNotMatch(accountChangeBody, /state\.context|refreshResources\(/);

  const useContextBody = app.match(/async function useSelectedContext\(\) \{([\s\S]*?)\n\}\n\nfunction resourceKey/)?.[1] || "";
  assert.match(useContextBody, /const snapshot = snapshotActiveContext\(\)/);
  assert.match(useContextBody, /restoreActiveContext\(snapshot\)/);
  assert.doesNotMatch(useContextBody, /state\.context = [\s\S]*?await refreshResources/);
});

test("active context stays bound to an available account and project", () => {
  const contextReadyBody = app.match(/function contextReady\(\) \{([\s\S]*?)\n\}/)?.[1] || "";
  assert.match(contextReadyBody, /state\.accounts\.some/);
  assert.match(contextReadyBody, /state\.activeProjects\.some/);
  assert.match(app, /const preferredProjectId = state\.context\?\.configuration === configuration/);
});

test("preferred account and project are selected and applied on initial boot", () => {
  assert.match(app, /const DEFAULT_CONTEXT = Object\.freeze\(\{ configuration: "", account: "", projectId: "" \}\)/);
  assert.match(app, /function accountMatchesContext\(account, context\)/);
  assert.match(app, /function shouldAutoApplyPreferredContext\(\)/);
  const autoApplyBody = app.match(/function shouldAutoApplyPreferredContext\(\) \{([\s\S]*?)\n\}/)?.[1] || "";
  assert.match(autoApplyBody, /state\.pendingContext\.configuration/);
  assert.match(autoApplyBody, /state\.pendingContext\.projectId/);
  assert.match(autoApplyBody, /state\.projects\.some/);
  assert.match(app, /Promise\.all\(\[[\s\S]*loadJobs\([\s\S]*loadAccounts\(\{ preferDefault: true \}\)/);
  assert.match(app, /if \(shouldAutoApplyPreferredContext\(\)\) \{\s*await useSelectedContext\(\)\.catch/);
});

test("editing VM configuration invalidates the previous executable preview", () => {
  assert.match(app, /previewExecutable/);
  assert.match(app, /function invalidatePreview\(/);
  assert.match(app, /function handleConfigInput\(/);
  assert.match(app, /#configForm input, #configForm select, #configForm textarea/);
});

test("instance inventory exposes only the five approved desktop columns", () => {
  assert.match(app, /class="resource-table"/);
  const tableHead = app.match(/<thead>[\s\S]*?<\/thead>/)?.[0] || "";
  const approvedLabels = ["实例", "位置", "状态", "公网 IPv4", "模式"];
  for (const label of approvedLabels) assert.match(tableHead, new RegExp(`>${label}<`));
  assert.doesNotMatch(tableHead, /账号 \/ 项目|机器/);
  assert.match(styles, /\.resource-table-head th:nth-child\(1\) \{ width: 32%; \}/);
  assert.match(styles, /\.resource-table-head th:nth-child\(2\) \{ width: 22%; \}/);
  assert.match(styles, /\.resource-table-head th:nth-child\(3\) \{ width: 14%; \}/);
  assert.match(styles, /\.resource-table-head th:nth-child\(4\) \{ width: 20%; \}/);
  assert.match(styles, /\.resource-table-head th:nth-child\(5\) \{ width: 12%; \}/);
  assert.doesNotMatch(app, /resource-cell-project|resource-cell-machine/);
});

test("new instance firewall tags default to the instance name instead of a shared console tag", () => {
  const networkTagField = index.match(/<input id="networkTags"[^>]*>/)?.[0] || "";
  assert.doesNotMatch(networkTagField, /value="gcp-vm-console"/);
  assert.match(app, /tags:\s*splitList\(\$\(("#networkTags"|'#networkTags')\)\.value \|\| \$\(("#vmName"|'#vmName')\)\.value\)/);
});

test("new node deployments explicitly configure a selected non-default SSH port while vm-only stays descriptive", () => {
  assert.match(app, /configureSshPort:\s*deployMethod !== "vm_only" && sshPort !== 22/);
  assert.match(app, /节点部署时配置并保留 22 救援/);
  assert.match(app, /只开实例不会自动修改 sshd/);
});

test("new public VMs persist and summarize the selected network profile", () => {
  assert.match(index, /id="externalIpMode"/);
  assert.match(index, /id="networkTier"/);
  assert.match(index, /id="nicType"/);
  assert.match(app, /networkTier:\s*\$\("#networkTier"\)\.value/);
  assert.match(app, /nicType:\s*\$\("#nicType"\)\.value/);
  assert.match(app, /toNetworkProfileView/);
});

test("new VM default disk type stays aligned with Always Free guidance", () => {
  assert.match(app, /disk:\s*\{\s*sizeGb:\s*Number\(\$\(("#diskSize"|'#diskSize')\)\.value \|\| 30\),\s*type:\s*"pd-standard"\s*\}/);
  assert.doesNotMatch(app, /pd-balanced/);
});

test("instance inventory keeps mobile metadata grouped without horizontal scrolling", () => {
  assert.match(app, /class="[^"]*\bresource-mobile-meta\b[^"]*"/);
  assert.match(styles, /\.resource-table-head,\n\.resource-row/);
  assert.match(styles, /white-space: normal;\n\s*overflow-wrap: anywhere/);
  assert.match(styles, /@media \(max-width: 900px\)[\s\S]*\.resource-table thead \{\n\s*display: none;/);
  assert.doesNotMatch(styles, /@media \(max-width: 900px\)[\s\S]*\.resource-table \{\n\s*min-width:/);
});

test("instance page keeps the inventory table first instead of a tall side inspector", () => {
  assert.match(styles, /\.resource-layout \{\n\s*display: grid;\n\s*min-width: 0;\n\s*grid-template-columns: minmax\(0, 1fr\);/);
  assert.doesNotMatch(styles, /\.detail-panel,\n\.summary-panel \{\n\s*position: sticky/);
  assert.match(app, /detailPanel\.classList\.toggle\("is-selected", false\)/);
  assert.match(app, /detailPanel\.classList\.toggle\("is-selected", true\)/);
});

test("instance detail panel exposes cloud-console resource sections", () => {
  for (const id of ["detailEmpty", "detailContent", "detailCoreFacts", "detailNetworkFacts", "detailIdentityFacts", "detailOperations"]) {
    assert.match(index, new RegExp(`id="${id}"`));
  }
  assert.match(index, /id="technicalMoreAttributes"/);
  assert.match(index, /id="technicalBasicTitle">基础/);
  assert.match(index, /id="technicalNetworkTitle">网络/);
  assert.match(index, /id="technicalIdentityTitle">身份/);
  assert.match(styles, /\.detail-content/);
  assert.match(styles, /\.technical-attribute-groups/);
  assert.match(styles, /\.technical-facts > div/);
  assert.match(styles, /\.detail-panel\.is-selected \.section-heading \{\n\s*grid-template-columns: minmax\(0, 1fr\);/);
  assert.match(styles, /\.detail-panel\.is-selected #detailTitle \{\n\s*font-family: var\(--font-sans\);/);
  assert.match(app, /renderTechnicalFactRows\(\$\("#detailCoreFacts"\)/);
  assert.match(app, /renderTechnicalFactRows\(\$\("#detailNetworkFacts"\)/);
  assert.match(app, /renderTechnicalFactRows\(\$\("#detailIdentityFacts"\)/);
});

test("instance detail operations stay hidden until an instance is selected", () => {
  const operationsIndex = index.indexOf('id="detailOperations"');
  assert.ok(operationsIndex > index.indexOf('id="detailContent"'), "detail operations should follow facts instead of replacing the detail content");
  assert.ok(operationsIndex < index.indexOf('id="deleteCloudResource"'), "maintenance and danger controls should live inside detailOperations");
  assert.match(styles, /\.detail-operations\[hidden\]/);
  assert.match(app, /\$\("#detailOperations"\)\.hidden = true/);
  assert.match(app, /\$\("#detailOperations"\)\.hidden = false/);
});

test("visual system defines complete semantic tokens for both themes", () => {
  assert.match(styles, /:root\[data-theme="light"\]/);
  for (const token of ["--surface-canvas", "--surface-panel", "--text-primary", "--border-default", "--space-4", "--control-height", "--z-toast", "--motion-fast"]) {
    assert.match(styles, new RegExp(`${token}:`));
  }
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/);
});

test("dark theme text tokens keep WCAG AA contrast on panels", () => {
  const darkTheme = styles.slice(0, styles.indexOf(':root[data-theme="light"]'));
  const panel = parseOklch(darkTheme, "--surface-panel");
  for (const token of ["--text-primary", "--text-secondary", "--text-muted", "--text-faint"]) {
    assert.ok(contrastRatio(parseOklch(darkTheme, token), panel) >= 4.5, `${token} is below 4.5:1`);
  }
});

test("reserved light theme text tokens keep WCAG AA contrast on panels", () => {
  const lightStart = styles.indexOf(':root[data-theme="light"]');
  const lightTheme = styles.slice(lightStart, styles.indexOf("\n* {", lightStart));
  const panel = parseOklch(lightTheme, "--surface-panel");
  for (const token of ["--text-primary", "--text-secondary", "--text-muted", "--text-faint"]) {
    assert.ok(contrastRatio(parseOklch(lightTheme, token), panel) >= 4.5, `${token} is below 4.5:1 in light theme`);
  }
});

test("async controls share busy feedback and unsafe actions start disabled", () => {
  assert.match(app, /async function withBusyButton\(/);
  assert.match(index, /id="activeTaskBar"/);
  assert.match(index, /id="actionConfirmDialog"/);
  assert.match(app, /function renderDetail\(\{ renderRelated = true, updateReadiness = true \} = \{\}\)/);
  assert.match(index, /id="executePreview"[^>]*disabled/);
  assert.match(index, /id="detailPrimary"[^>]*disabled/);
  assert.match(index, /id="cloneVm"[^>]*disabled/);
  assert.match(index, /id="smartDiagnoseInstance"[^>]*disabled/);
});

test("busy task titles use the same context-aware copy as their confirmation", () => {
  assert.match(app, /const actionCopy = policy \? confirmationCopy\(actionId, actionContext\) : null/);
  assert.match(app, /title: actionCopy\?\.title \|\| pendingMessage/);
});

test("cloud preview execution requires an explicit final confirmation", () => {
  assert.match(app, /import \{ confirmationCopy, policyForAction \} from "\.\/lib\/action-policy\.js"/);
  assert.match(app, /requestActionConfirmation\(actionId/);
  assert.match(app, /\$\("#executePreview"\)\.addEventListener\("click", \(event\) => withBusyButton\(event\.currentTarget, executePreview, "正在执行已验证预览"\)/);
  assert.doesNotMatch(app, /window\.confirm|[^.]confirm\(/);
});

test("action readiness model is imported and disabled reasons have compact anchors", () => {
  assert.match(app, /action-readiness-view-model\.js/);
  assert.match(app, /function applyActionReadiness/);
  assert.match(index, /id="detailActionHint"/);
  assert.match(index, /id="previewActionHint"/);
  assert.match(styles, /\.action-hint/);
});

test("vm-only deploy button cannot be re-enabled by legacy deploy updater", () => {
  const updateBody = app.match(/function updateDeployAction\(item = selectedResource\(\)\) \{([\s\S]*?)\n\}/)?.[1] || "";
  assert.doesNotMatch(updateBody, /button\.disabled = false/);
  assert.match(app, /applyActionReadiness\(\)/);
});

test("selected instance consolidates runtime status into one canonical summary", () => {
  const ids = [...index.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(ids.filter((id) => id === "nodeResult").length, 1);
  assert.equal(ids.filter((id) => id === "detailNodeResult").length, 1);
  assert.equal(ids.filter((id) => id === "firewallResult").length, 1);
  assert.equal(ids.filter((id) => id === "detailFirewallResult").length, 1);
  for (const id of ["technicalRecognitionSummary", "technicalIssueSummary", "technicalRecoverySummary", "smartDiagnoseInstance"]) {
    assert.equal(ids.filter((value) => value === id).length, 1, `${id} should exist once`);
  }
  assert.equal(ids.filter((value) => value === "taskRecovery").length, 1, "taskRecovery should exist once");
  assert.match(index, /id="instanceStatusSummary"/);
  assert.match(index, /id="technicalDetails"[^>]*class="instance-disclosure"/);
  assert.match(index, /id="nodeResultsDetails"[^>]*class="instance-disclosure"/);
  assert.ok(index.indexOf('id="technicalRecognitionSummary"') < index.indexOf('id="technicalIssueSummary"'), "recognition should lead issue summary");
  assert.ok(index.indexOf('id="technicalIssueSummary"') < index.indexOf('id="technicalRecoverySummary"'), "issue should lead recovery summary");
  assert.ok(index.indexOf('id="technicalDetails"') < index.indexOf('id="nodeResultsDetails"'), "technical details should precede node results");
  assert.ok(index.indexOf('id="nodeResultsDetails"') < index.indexOf('id="detailNodeResult"'), "node output should live in the node disclosure");
  assert.match(index, /id="detailNodeState"/);
  assert.match(index, /id="detailNodeResult"/);
  assert.match(index, /id="detailFirewallResult"/);
  assert.match(index, /id="smartDiagnoseInstance"/);
  assert.match(index, /id="taskRecovery"/);
  assert.match(app, /toNodeResultView/);
  assert.match(app, /toInstanceTechnicalDetailsView/);
  assert.match(app, /renderInstanceNodeResult/);
  assert.match(app, /renderInstanceTechnicalDetails/);
  assert.match(app, /renderRecoveryView/);
  assert.match(app, /renderTaskNodeResult/);
  assert.match(app, /detailNodeResult/);
  assert.match(app, /SSH 实际连接/);
  assert.match(app, /const isLowValueVmOnly/);
  assert.match(styles, /\.recovery-panel/);
  assert.match(styles, /\.recovery-action-row/);
  assert.doesNotMatch(app, /renderNodeResult\(item\.record\?\.nodeResult \|\| null\)/);
});

test("instance rendering is driven by the canonical detail view without repeated status strips", () => {
  assert.match(app, /instance-detail-view-model\.js/);
  assert.match(app, /toInstanceDetailView/);
  assert.match(app, /function currentInstanceDetailView\(\)/);
  assert.match(app, /function renderInstanceStatusSummary\(/);
  assert.match(app, /function renderInstanceRecommendation\(/);
  assert.match(app, /renderNodeView\(resultTarget,\s*view,\s*\{\s*showStatusStrip:\s*false\s*\}\)/);
  assert.match(app, /function renderNodeView\(target,\s*view,\s*\{\s*showStatusStrip\s*=\s*true\s*\}\s*=\s*\{\}\)/);
});

test("instance verification renders one compact diagnostic hierarchy", () => {
  assert.match(app, /toInstanceTechnicalDetailsView/);
  assert.match(app, /function renderTechnicalSummaryRow\(/);
  assert.match(app, /function renderInstanceTechnicalDetails\(/);
  assert.doesNotMatch(app, /diagnostic-issue-list|diagnostic-recovery-steps|renderInstanceRecoveryView|renderVerification/);
  assert.doesNotMatch(index, /verificationResult|verificationRecovery|verificationState/);
});

test("instance diagnostic styling uses a linear hierarchy instead of nested cards", () => {
  for (const selector of [
    ".technical-overview",
    ".technical-summary-row",
    ".technical-more-attributes",
    ".technical-attribute-groups",
    ".technical-facts",
    ".technical-evidence-list"
  ]) {
    assert.match(styles, new RegExp(selector.replaceAll(".", "\\.")));
  }
  assert.match(styles, /\.technical-summary-row \{[\s\S]*?border-bottom: 1px solid var\(--border-subtle\)/);
  assert.match(styles, /@media \(max-width: 767px\)[\s\S]*?\.technical-more-attributes > summary,[\s\S]*?min-height: 44px/);
});

test("instance technical details use three summaries and one secondary disclosure", () => {
  for (const id of [
    "technicalOverview",
    "technicalRecognitionSummary",
    "technicalIssueSummary",
    "technicalRecoverySummary",
    "technicalMoreAttributes"
  ]) {
    assert.equal([...index.matchAll(new RegExp(`id="${id}"`, "g"))].length, 1, `${id} should exist once`);
  }
  const overview = index.match(/<div id="technicalOverview"[\s\S]*?<details id="technicalMoreAttributes"/)?.[0] || "";
  assert.equal([...overview.matchAll(/data-technical-summary=/g)].length, 3);
  assert.doesNotMatch(overview, /<button|<select|class="[^"]*fact-grid/);
  assert.match(index, /<details id="technicalMoreAttributes"(?![^>]*\bopen\b)/);
  assert.match(app, /instance-technical-details-view-model\.js/);
  assert.match(app, /toInstanceTechnicalDetailsView/);
});

test("instance header and primary technical layer have single information owners", () => {
  const headerMeta = index.match(/<div class="instance-detail-meta"[\s\S]*?<\/div>/)?.[0] || "";
  assert.doesNotMatch(headerMeta, /detailMethod|部署方式/);
  const overview = index.match(/<div id="technicalOverview"[\s\S]*?<details id="technicalMoreAttributes"/)?.[0] || "";
  for (const duplicate of ["SSH", "BBR", "防火墙", "服务"]) {
    assert.doesNotMatch(overview, new RegExp(`>${duplicate}<`), `${duplicate} must stay in canonical status only`);
  }
  const moreAttributes = index.match(/<details id="technicalMoreAttributes"[\s\S]*?<\/details>/)?.[0] || "";
  for (const id of ["detailCoreFacts", "detailNetworkFacts", "detailIdentityFacts", "manualDeploymentMethod"]) {
    assert.match(moreAttributes, new RegExp(`id="${id}"`), `${id} belongs in more attributes`);
  }
});

test("selected instance exposes compact external recognition and local adoption controls", () => {
  assert.match(index, /id="technicalRecognitionSummary"/);
  assert.match(index, /id="smartDiagnoseInstance"/);
  assert.match(index, /id="adoptLocalInstance"/);
  assert.match(index, /id="manualDeploymentMethod"/);
  for (const id of ["technicalRecognitionSummary", "smartDiagnoseInstance", "adoptLocalInstance", "manualDeploymentMethod"]) {
    assert.equal([...index.matchAll(new RegExp(`id="${id}"`, "g"))].length, 1, `${id} should exist once`);
  }
  assert.match(technicalDetailsModel, /deployment-recognition-view-model\.js/);
  assert.match(app, /adoption-preview/);
  assert.match(app, /adopt-local/);
  assert.match(app, /function recognitionForItem/);
  assert.match(app, /function effectiveDeployMethodForItem/);
  assert.match(app, /function recognitionFromVerification/);
  assert.match(app, /function bbrProbeFromVerification/);
  assert.match(app, /bbr:\s*bbrProbeFromVerification\(verification\)/);
  const rowBody = app.match(/function renderResourceRow\(item\) \{([\s\S]*?)\n\}/)?.[1] || "";
  assert.match(rowBody, /effectiveDeployMethodForItem\(item\)/);
  assert.doesNotMatch(rowBody, /item\.record\?\.desired\?\.deploy\?\.method \|\| "vm_only"/);
  const effectiveBody = app.match(/function effectiveDeployMethodForItem\(item\) \{([\s\S]*?)\n\}/)?.[1] || "";
  assert.match(effectiveBody, /recognitionForItem\(item\)/);
  assert.match(effectiveBody, /recognition\?\.method \|\| item\?\.record\?\.desired\?\.deploy\?\.method/);
  const detailBody = app.match(/function renderDetail\([^)]*\) \{([\s\S]*?)\nfunction selectedDeployMethod/)?.[1] || "";
  assert.match(detailBody, /effectiveDeployMethodForItem\(item\)/);
  assert.doesNotMatch(detailBody, /desired\?\.deploy\?\.method \|\| recognition\.method/);
  assert.match(styles, /\.technical-summary-row \{/);
  assert.match(styles, /\.technical-evidence-list \{/);
  assert.match(styles, /overflow-wrap: anywhere/);
});

test("external recognition UI keeps deep evidence but delegates canonical probe facts", () => {
  assert.doesNotMatch(app, /view\.probeFacts|recognition-probe-facts/);
  assert.match(technicalDetailsModel, /view\.evidenceGroups/);
  assert.match(technicalDetailsModel, /view\.detailRows/);
  assert.match(app, /renderTechnicalEvidence/);
  assert.match(styles, /\.technical-evidence-list > div/);
  assert.match(styles, /\.technical-evidence-list dd \{[\s\S]*?overflow-wrap: anywhere;/);
});

test("node result UI contains long-link containment and adjacent copy controls", () => {
  assert.match(styles, /\.detail-node-result/);
  assert.match(styles, /\.node-value-row/);
  assert.match(styles, /\.node-value-code/);
  assert.match(styles, /\.node-value-code \{[\s\S]*?overflow-x: auto;/);
  assert.match(styles, /\.node-copy/);
  assert.match(app, /data-copy-value/);
  assert.match(app, /复制/);
  assert.match(app, /防火墙同步失败/);
});

test("configuration and task pages expose stable product sections", () => {
  assert.match(index, /class="panel config-form-panel"/);
  assert.match(index, /class="form-section"/);
  assert.match(index, /class="[^"]*\bconfig-advanced\b[^"]*"/);
  assert.match(index, /class="[^"]*\bexecution-summary\b[^"]*"/);
  assert.match(index, /id="taskLogPanel"/);
  assert.match(index, /id="taskHistory"/);
  assert.doesNotMatch(index, /class="tasks-side"/);
});

test("configuration workflow separates core fields from advanced controls", () => {
  const configSection = index.match(/<section id="page-config"[\s\S]*?<section id="page-tasks"/)?.[0] || "";
  const advanced = configSection.match(/<details class="[^"]*\bconfig-advanced\b[^"]*"[\s\S]*?<\/details>/)?.[0] || "";

  for (const id of ["vmName", "region", "regionZoneHelper", "image", "machineType", "diskSize", "deployModes"]) {
    assert.match(configSection, new RegExp(`id="${id}"`), `${id} should stay in the config workflow`);
    assert.ok(configSection.indexOf(`id="${id}"`) < configSection.indexOf("<details"), `${id} should be visible before advanced details`);
  }
  assert.doesNotMatch(configSection, /id="zone"|name="zone"/);

  for (const id of ["network", "subnet", "sshUser", "sshKeyFile", "sshPort", "networkTags", "labelsJson", "startupScript"]) {
    assert.match(advanced, new RegExp(`id="${id}"`), `${id} should live inside the advanced disclosure`);
  }

  assert.match(advanced, /<summary>[\s\S]*网络[\s\S]*SSH[\s\S]*标签[\s\S]*启动脚本/);
});

test("configuration execution summary is not a mirrored form table", () => {
  const configSection = index.match(/<section id="page-config"[\s\S]*?<section id="page-tasks"/)?.[0] || "";
  const summary = configSection.match(/<aside class="[^"]*\bexecution-summary\b[^"]*"[\s\S]*?<\/aside>/)?.[0] || "";

  assert.doesNotMatch(configSection, /id="configSummary"/);
  for (const id of ["executionTarget", "executionMode", "executionChanges", "executionRisk", "executionPreviewState"]) {
    assert.match(summary, new RegExp(`id="${id}"`), `${id} should be rendered in the execution summary`);
  }
  assert.match(summary, /id="savePreview"[^>]*class="[^"]*\bprimary\b[^"]*"/);
  assert.match(summary, /id="saveDraft"[^>]*class="[^"]*\bsecondary\b[^"]*"/);
});

test("custom startup script changes are represented in desired preview data", () => {
  assert.match(app, /function hashText\(text\)/);
  assert.match(app, /startupScriptHash: hashText\(\$\(("#startupScript"|'#startupScript')\)\.value\)/);
  assert.match(app, /networkTags/);
  assert.match(app, /labelsJson/);
});

test("instance inventory renders a context-aware empty state during boot", () => {
  assert.match(app, /const emptyTitle = contextReady\(\) \? "当前项目还没有实例" : "尚未选择账号与项目"/);
  assert.match(app, /async function boot\(\) \{[\s\S]*?renderResources\(\{ renderRelated: false \}\);/);
});

test("each page exposes at most one emphasized primary action", () => {
  for (const view of ["workbench", "resources", "config", "tasks"]) {
    const section = index.match(new RegExp(`<section id="${view}"[\\s\\S]*?(?=<section id="(?:workbench|resources|config|tasks)"|</main>)`))?.[0] || "";
    const primaryButtons = [...section.matchAll(/<button\b[^>]*class="[^"]*\bprimary\b[^"]*"/g)];
    assert.ok(primaryButtons.length <= 1, `${view} has ${primaryButtons.length} primary buttons`);
  }
});

test("task logs lead the task page and remain expanded", () => {
  assert.match(index, /id="taskLogPanel"/);
  assert.match(index, /class="[^"]*\btask-log-primary\b[^"]*"/);
  assert.ok(index.indexOf('id="taskLogPanel"') < index.indexOf('id="taskHistory"'));
  assert.doesNotMatch(index, /<details id="taskLogDetails"/);
  assert.match(styles, /\.log-panel\.task-log-primary \{\n\s*padding: 16px;/);
  assert.match(index, /id="taskHistory"[\s\S]*class="[^"]*\btask-history-table\b[^"]*"/);
  assert.doesNotMatch(index, /节点结果[\s\S]*当前结果|当前结果[\s\S]*节点结果/);
});

test("resource inventory uses semantic table markup with keyboard-selectable rows", () => {
  assert.match(app, /<table class="resource-table"/);
  assert.match(app, /<tr[^>]*data-resource-key=/);
  assert.match(app, /tabindex="0"/);
  assert.match(app, /\["Enter", " "\]\.includes\(event\.key\)/);
});

test("node links expose compact metadata and a copy action", () => {
  assert.match(app, /class="[^"]*\blink-copy\b[^"]*"/);
  assert.match(app, /data-copy-link=/);
  assert.match(app, /复制链接/);
  assert.match(app, /navigator\.clipboard\.writeText/);
});

test("global context reports sync state without duplicating page actions", () => {
  assert.match(index, /id="globalSyncState"/);
  assert.match(index, /aria-live="polite"/);
  assert.match(styles, /\.topbar-sync/);
});

test("initial load and route changes reset stale page scroll", () => {
  assert.match(app, /history\.scrollRestoration = "manual"/);
  assert.match(app, /if \(changed \|\| !activeRoute\) requestAnimationFrame\(\(\) => window\.scrollTo/);
  assert.match(app, /window\.addEventListener\("load", \(\) => setTimeout\(resetPageScroll, 80\)\)/);
  assert.match(styles, /scroll-padding-top: calc\(var\(--topbar-height\) \+ 12px\)/);
  assert.match(styles, /html \{[\s\S]*?scroll-behavior: auto;/);
  assert.match(styles, /\.page \{[\s\S]*?scroll-margin-top: calc\(var\(--topbar-height\) \+ 12px\)/);
});

test("static controls have unique ids and every enabled button has a handler", () => {
  const ids = [...index.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(new Set(ids).size, ids.length);

  const buttonIds = [...index.matchAll(/<button\b[^>]*\bid="([^"]+)"[^>]*>/g)]
    .filter((match) => !/data-i18n-control/.test(match[0]))
    .map((match) => match[1]);
  const intentionallyDisabled = new Set(["deleteCloudResource"]);
  const missingHandlers = buttonIds.filter((id) => !intentionallyDisabled.has(id) && !app.includes(`$("#${id}").addEventListener`));
  assert.deepEqual(missingHandlers, []);
});

test("every static button id is covered by action readiness", () => {
  const buttonIds = [...index.matchAll(/<button\b[^>]*\bid="([^"]+)"[^>]*>/g)]
    .filter((match) => !/data-i18n-control/.test(match[0]))
    .map((match) => match[1])
    .sort();
  assert.deepEqual(buttonIds, ACTION_BUTTON_IDS.toSorted());
});
