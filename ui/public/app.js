import { confirmationCopy, policyForAction } from "./lib/action-policy.js";
import { toActionReadiness } from "./lib/action-readiness-view-model.js";
import { createApiClient } from "./lib/api-client.js";
import { copyText } from "./lib/copy-text.js";
import { toDiagnosticSummary } from "./lib/diagnostic-summary-view-model.js";
import {
  diagnosticEvidenceForFocus,
  diagnosticVmFromResource,
  toDiagnosticFocus
} from "./lib/diagnostic-focus-view-model.js";
import { toDoctorView } from "./lib/doctor-view-model.js";
import { toEvidenceTimeline } from "./lib/evidence-timeline-view-model.js";
import { toFirewallGovernanceView } from "./lib/firewall-governance-view-model.js";
import { toInstanceDetailView } from "./lib/instance-detail-view-model.js";
import { toInstanceTechnicalDetailsView } from "./lib/instance-technical-details-view-model.js";
import { toNodeResultView } from "./lib/node-result-view-model.js";
import {
  NETWORK_PROFILE_RECOMMENDED,
  deriveStaticAddressName,
  toNetworkProfileView
} from "./lib/network-profile.js";
import { toNetworkExposureView } from "./lib/network-exposure-view-model.js";
import { toOperationHint, toOperationHub } from "./lib/operation-hub-view-model.js";
import { createRequestCoordinator } from "./lib/request-coordinator.js";
import { summarizeResourceSyncFailures } from "./lib/resource-sync-view-model.js";
import { taskStatusLabel, taskTimelineHint, toTaskResult, toTaskRow, toTaskSteps } from "./lib/task-view-model.js";
import { createTaskWorkspaceController } from "./lib/task-workspace-controller.js";
import { toWarpEgressView } from "./lib/warp-egress-view-model.js";
import { getLocaleTag, installI18n } from "./lib/i18n.js";

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const api = createApiClient();
const i18n = installI18n();

const FALLBACK_REGION_CATALOG = {
  source: { kind: "fallback" },
  freeRegionIds: ["us-west1", "us-central1", "us-east1"],
  regions: [
    { id: "africa-south1", label: "南非/约翰内斯堡", group: "Africa", zones: ["africa-south1-a", "africa-south1-b", "africa-south1-c"], defaultZone: "africa-south1-a", freeTier: "not_free" },
    { id: "asia-east1", label: "中国台湾/彰化", group: "Asia Pacific", zones: ["asia-east1-a", "asia-east1-b", "asia-east1-c"], defaultZone: "asia-east1-a", freeTier: "not_free" },
    { id: "asia-east2", label: "中国香港/香港", group: "Asia Pacific", zones: ["asia-east2-a", "asia-east2-b", "asia-east2-c"], defaultZone: "asia-east2-a", freeTier: "not_free" },
    { id: "asia-northeast1", label: "日本/东京", group: "Asia Pacific", zones: ["asia-northeast1-a", "asia-northeast1-b", "asia-northeast1-c"], defaultZone: "asia-northeast1-a", freeTier: "not_free" },
    { id: "asia-northeast2", label: "日本/大阪", group: "Asia Pacific", zones: ["asia-northeast2-a", "asia-northeast2-b", "asia-northeast2-c"], defaultZone: "asia-northeast2-a", freeTier: "not_free" },
    { id: "asia-northeast3", label: "韩国/首尔", group: "Asia Pacific", zones: ["asia-northeast3-a", "asia-northeast3-b", "asia-northeast3-c"], defaultZone: "asia-northeast3-a", freeTier: "not_free" },
    { id: "asia-south1", label: "印度/孟买", group: "Asia Pacific", zones: ["asia-south1-a", "asia-south1-b", "asia-south1-c"], defaultZone: "asia-south1-a", freeTier: "not_free" },
    { id: "asia-south2", label: "印度/德里", group: "Asia Pacific", zones: ["asia-south2-a", "asia-south2-b", "asia-south2-c"], defaultZone: "asia-south2-a", freeTier: "not_free" },
    { id: "asia-southeast1", label: "新加坡/新加坡", group: "Asia Pacific", zones: ["asia-southeast1-a", "asia-southeast1-b", "asia-southeast1-c"], defaultZone: "asia-southeast1-a", freeTier: "not_free" },
    { id: "asia-southeast2", label: "印度尼西亚/雅加达", group: "Asia Pacific", zones: ["asia-southeast2-a", "asia-southeast2-b", "asia-southeast2-c"], defaultZone: "asia-southeast2-a", freeTier: "not_free" },
    { id: "asia-southeast3", label: "马来西亚/吉隆坡", group: "Asia Pacific", zones: ["asia-southeast3-a", "asia-southeast3-b", "asia-southeast3-c"], defaultZone: "asia-southeast3-a", freeTier: "not_free" },
    { id: "australia-southeast1", label: "澳大利亚/悉尼", group: "Australia", zones: ["australia-southeast1-a", "australia-southeast1-b", "australia-southeast1-c"], defaultZone: "australia-southeast1-a", freeTier: "not_free" },
    { id: "australia-southeast2", label: "澳大利亚/墨尔本", group: "Australia", zones: ["australia-southeast2-a", "australia-southeast2-b", "australia-southeast2-c"], defaultZone: "australia-southeast2-a", freeTier: "not_free" },
    { id: "europe-central2", label: "波兰/华沙", group: "Europe", zones: ["europe-central2-a", "europe-central2-b", "europe-central2-c"], defaultZone: "europe-central2-a", freeTier: "not_free" },
    { id: "europe-north1", label: "芬兰/哈米纳", group: "Europe", zones: ["europe-north1-a", "europe-north1-b", "europe-north1-c"], defaultZone: "europe-north1-a", freeTier: "not_free" },
    { id: "europe-north2", label: "瑞典/斯德哥尔摩", group: "Europe", zones: ["europe-north2-a", "europe-north2-b", "europe-north2-c"], defaultZone: "europe-north2-a", freeTier: "not_free" },
    { id: "europe-southwest1", label: "西班牙/马德里", group: "Europe", zones: ["europe-southwest1-a", "europe-southwest1-b", "europe-southwest1-c"], defaultZone: "europe-southwest1-a", freeTier: "not_free" },
    { id: "europe-west1", label: "比利时/圣吉斯兰", group: "Europe", zones: ["europe-west1-b", "europe-west1-c", "europe-west1-d"], defaultZone: "europe-west1-b", freeTier: "not_free" },
    { id: "europe-west10", label: "德国/柏林", group: "Europe", zones: ["europe-west10-a", "europe-west10-b", "europe-west10-c"], defaultZone: "europe-west10-a", freeTier: "not_free" },
    { id: "europe-west12", label: "意大利/都灵", group: "Europe", zones: ["europe-west12-a", "europe-west12-b", "europe-west12-c"], defaultZone: "europe-west12-a", freeTier: "not_free" },
    { id: "europe-west2", label: "英国/伦敦", group: "Europe", zones: ["europe-west2-a", "europe-west2-b", "europe-west2-c"], defaultZone: "europe-west2-a", freeTier: "not_free" },
    { id: "europe-west3", label: "德国/法兰克福", group: "Europe", zones: ["europe-west3-a", "europe-west3-b", "europe-west3-c"], defaultZone: "europe-west3-a", freeTier: "not_free" },
    { id: "europe-west4", label: "荷兰/埃姆斯哈文", group: "Europe", zones: ["europe-west4-a", "europe-west4-b", "europe-west4-c"], defaultZone: "europe-west4-a", freeTier: "not_free" },
    { id: "europe-west6", label: "瑞士/苏黎世", group: "Europe", zones: ["europe-west6-a", "europe-west6-b", "europe-west6-c"], defaultZone: "europe-west6-a", freeTier: "not_free" },
    { id: "europe-west8", label: "意大利/米兰", group: "Europe", zones: ["europe-west8-a", "europe-west8-b", "europe-west8-c"], defaultZone: "europe-west8-a", freeTier: "not_free" },
    { id: "europe-west9", label: "法国/巴黎", group: "Europe", zones: ["europe-west9-a", "europe-west9-b", "europe-west9-c"], defaultZone: "europe-west9-a", freeTier: "not_free" },
    { id: "me-central1", label: "卡塔尔/多哈", group: "Middle East", zones: ["me-central1-a", "me-central1-b", "me-central1-c"], defaultZone: "me-central1-a", freeTier: "not_free" },
    { id: "me-central2", label: "沙特阿拉伯/达曼", group: "Middle East", zones: ["me-central2-a", "me-central2-b", "me-central2-c"], defaultZone: "me-central2-a", freeTier: "not_free" },
    { id: "me-west1", label: "以色列/特拉维夫", group: "Middle East", zones: ["me-west1-a", "me-west1-b", "me-west1-c"], defaultZone: "me-west1-a", freeTier: "not_free" },
    { id: "northamerica-northeast1", label: "加拿大/蒙特利尔", group: "North America", zones: ["northamerica-northeast1-a", "northamerica-northeast1-b", "northamerica-northeast1-c"], defaultZone: "northamerica-northeast1-a", freeTier: "not_free" },
    { id: "northamerica-northeast2", label: "加拿大/多伦多", group: "North America", zones: ["northamerica-northeast2-a", "northamerica-northeast2-b", "northamerica-northeast2-c"], defaultZone: "northamerica-northeast2-a", freeTier: "not_free" },
    { id: "northamerica-south1", label: "墨西哥/克雷塔罗", group: "North America", zones: ["northamerica-south1-a", "northamerica-south1-b", "northamerica-south1-c"], defaultZone: "northamerica-south1-a", freeTier: "not_free" },
    { id: "us-central1", label: "美国/爱荷华", group: "North America", zones: ["us-central1-a", "us-central1-b", "us-central1-c", "us-central1-f"], defaultZone: "us-central1-a", freeTier: "always_free" },
    { id: "us-east1", label: "美国/南卡罗来纳", group: "North America", zones: ["us-east1-b", "us-east1-c", "us-east1-d"], defaultZone: "us-east1-b", freeTier: "always_free" },
    { id: "us-east4", label: "美国/北弗吉尼亚", group: "North America", zones: ["us-east4-a", "us-east4-b", "us-east4-c"], defaultZone: "us-east4-a", freeTier: "not_free" },
    { id: "us-east5", label: "美国/哥伦布", group: "North America", zones: ["us-east5-a", "us-east5-b", "us-east5-c"], defaultZone: "us-east5-a", freeTier: "not_free" },
    { id: "us-south1", label: "美国/达拉斯", group: "North America", zones: ["us-south1-a", "us-south1-b", "us-south1-c"], defaultZone: "us-south1-a", freeTier: "not_free" },
    { id: "us-west1", label: "美国/俄勒冈", group: "North America", zones: ["us-west1-a", "us-west1-b", "us-west1-c"], defaultZone: "us-west1-a", freeTier: "always_free" },
    { id: "us-west2", label: "美国/洛杉矶", group: "North America", zones: ["us-west2-a", "us-west2-b", "us-west2-c"], defaultZone: "us-west2-a", freeTier: "not_free" },
    { id: "us-west3", label: "美国/盐湖城", group: "North America", zones: ["us-west3-a", "us-west3-b", "us-west3-c"], defaultZone: "us-west3-a", freeTier: "not_free" },
    { id: "us-west4", label: "美国/拉斯维加斯", group: "North America", zones: ["us-west4-a", "us-west4-b", "us-west4-c"], defaultZone: "us-west4-a", freeTier: "not_free" },
    { id: "southamerica-east1", label: "巴西/圣保罗", group: "South America", zones: ["southamerica-east1-a", "southamerica-east1-b", "southamerica-east1-c"], defaultZone: "southamerica-east1-a", freeTier: "not_free" },
    { id: "southamerica-west1", label: "智利/圣地亚哥", group: "South America", zones: ["southamerica-west1-a", "southamerica-west1-b", "southamerica-west1-c"], defaultZone: "southamerica-west1-a", freeTier: "not_free" }
  ]
};
const MACHINES = ["e2-micro", "e2-small", "e2-medium"];
const IMAGES = [
  ["debian-cloud/debian-12", "Debian 12 (推荐)"],
  ["ubuntu-os-cloud/ubuntu-2404-lts-amd64", "Ubuntu 24.04 LTS"],
  ["rocky-linux-cloud/rocky-linux-9", "Rocky Linux 9"]
];
// Public builds must never ship a real gcloud account or project selection.
// The user selects an available configuration and project during startup.
const DEFAULT_CONTEXT = Object.freeze({ configuration: "", account: "", projectId: "" });
const DEFAULT_REGION_ID = "us-west1";
const FIREWALL_FAILED_LABEL = "防火墙同步失败";
const EMPTY_INVENTORY_META = Object.freeze({
  source: "none",
  checkedAt: "",
  stale: true,
  ageSeconds: 0,
  retryAttempts: 0,
  blocker: null
});

const state = {
  accounts: [],
  projects: [],
  activeProjects: [],
  pendingContext: { configuration: "", account: "", projectId: "" },
  context: null,
  records: [],
  cloud: [],
  inventoryMeta: { ...EMPTY_INVENTORY_META },
  resources: [],
  recognitionPreviews: {},
  selectedKey: "",
  selectedRecordId: "",
  preview: null,
  previewExecutable: false,
  jobs: [],
  jobStorage: null,
  selectedJobId: "",
  previewFocused: false,
  lastJob: null,
  lastJobAt: null,
  serviceReady: false,
  regionCatalog: FALLBACK_REGION_CATALOG,
  derivedZone: "us-west1-a",
  freeRules: null,
  doctor: null,
  sshAuthStatus: { configured: false, versionId: "", updatedAt: "" },
  networkExposurePreview: null,
  networkExposureRecordId: "",
  networkExposurePreviewDirty: false,
  actionReadiness: {}
};

const {
  loadJobs,
  rememberJob,
  selectJob,
  selectedJob,
  focusPreview
} = createTaskWorkspaceController({
  state,
  fetchJobs: () => api("/api/jobs"),
  render: () => renderTaskWorkspace()
});

let activeRoute = "";
const contextRefreshCoordinator = createRequestCoordinator();

if ("scrollRestoration" in history) history.scrollRestoration = "manual";

function resetPageScroll() {
  window.scrollTo({ top: 0, left: 0 });
}

window.addEventListener("load", () => setTimeout(resetPageScroll, 80));

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;"
  })[char]);
}

function isAbortError(error) {
  return error?.name === "AbortError" || /aborted|aborterror/i.test(error?.message || "");
}

function toast(message, tone = "info") {
  const host = $("#toastHost");
  for (const existing of host.querySelectorAll(".toast")) {
    if (existing.textContent === message) existing.remove();
  }
  const node = document.createElement("div");
  node.className = `toast ${tone}`;
  node.setAttribute("role", "status");
  node.textContent = message;
  host.append(node);
  while (host.children.length > 3) host.firstElementChild?.remove();
  setTimeout(() => node.remove(), 3600);
}

function log(message) {
  const output = $("#logOutput");
  const stamp = new Date().toLocaleTimeString(getLocaleTag());
  output.textContent += `[${stamp}] ${i18n.translate(message)}\n`;
  output.scrollTop = output.scrollHeight;
}

function setSyncState(label, tone = "idle") {
  const sync = $("#globalSyncState");
  if (!sync) return;
  sync.className = `topbar-sync ${tone}`;
  const labelNode = sync.querySelector("span:last-child");
  if (labelNode) labelNode.textContent = label;
}

function knownActionPolicy(id) {
  if (!id) return null;
  try {
    return policyForAction(id);
  } catch {
    return null;
  }
}

function actionContextFor(id) {
  const item = selectedResource();
  const previewName = state.preview?.identity?.name;
  const vmName = previewName || item?.identity?.name || "所选实例";
  const deployMethod = effectiveDeployMethodForItem(item) || selectedDeployMethod() || "vm_only";
  const warpView = warpEgressViewForItem(item);
  return {
    id,
    vmName,
    deployMethod,
    account: state.context?.account || "",
    projectId: state.context?.projectId || "",
    firewallGovernance: item?.record?.observed?.firewallGovernance || item?.record?.verification?.firewallGovernance || null,
    networkExposurePreview: networkExposurePreviewForItem(item),
    networkPlan: state.preview?.networkPlan || null,
    affectedCount: warpView.visible ? warpView.affectedCount : 0
  };
}

function selectedDeployMethodForReadiness() {
  return selectedResource()?.record?.desired?.deploy?.method || selectedDeployMethod() || "vm_only";
}

function actionReadinessInput() {
  const item = selectedResource();
  const nodeResult = item?.record?.nodeResult;
  const exposureView = networkExposureViewForItem(item);
  const warpView = warpEgressViewForItem(item);
  const sshConnection = item?.record?.observed?.sshConnection || null;
  const password = $("#sshUnifiedPassword")?.value || "";
  const passwordInputValid = password.length >= 8
    && password.length <= 128
    && !/[\0\r\n:]/.test(password);
  const config = configValidation();
  return {
    serviceReady: state.serviceReady,
    contextReady: contextReady(),
    accountSelected: Boolean(currentAccount()),
    projectSelected: Boolean(currentProjectId()),
    selected: Boolean(item),
    hasLocalRecord: Boolean(item?.record?.id || state.selectedRecordId),
    hasCloudInstance: Boolean(item?.cloud),
    recognitionReady: Boolean(item && recognitionForItem(item)),
    hasRecognitionResult: Boolean(item && state.recognitionPreviews[item.key]?.recognition),
    hasVerificationResult: Boolean(item?.record?.verification),
    deployMethod: selectedDeployMethodForReadiness(),
    observedDeployMethod: item ? effectiveDeployMethodForItem(item) : "",
    hasNodeResult: Boolean(
      (Array.isArray(nodeResult?.links) && nodeResult.links.length)
      || nodeResult?.panel
    ),
    previewExecutable: Boolean(state.preview && state.previewExecutable),
    configValid: config.valid,
    configInvalidReason: config.reason,
    inventoryLive: state.inventoryMeta?.source === "live" && state.inventoryMeta?.stale !== true,
    hasFreshPortEvidence: exposureView.hasFreshPortEvidence,
    networkExposurePasswordReady: Boolean(state.sshAuthStatus?.configured || passwordInputValid),
    networkExposurePreviewReady: exposureView.canApply,
    hasWarpCandidate: Boolean(warpView.visible),
    warpSupported: Boolean(warpView.supported),
    warpStatus: warpView.status || "unknown",
    warpLastOutcome: item?.record?.observed?.warp?.lastReconnect?.outcome || "",
    warpReconnectReady: Boolean(warpView.reconnectEnabled),
    hasVerifiedSsh: Boolean(sshConnection?.verified && Number(sshConnection.actualPort) > 0),
    doctorSummary: state.doctor ? toDoctorView(state.doctor) : null
  };
}

function setButtonReadiness(id, model) {
  const button = document.getElementById(id);
  if (!button || !model) return;
  button.textContent = model.label || button.textContent;
  button.disabled = !model.enabled;
  button.title = model.reason || "";
  if (model.reason) button.setAttribute("aria-label", `${model.label}：${model.reason}`);
  else button.removeAttribute("aria-label");
}

function applyActionReadiness() {
  const readiness = toActionReadiness(actionReadinessInput());
  state.actionReadiness = readiness;
  for (const [id, model] of Object.entries(readiness)) setButtonReadiness(id, model);
  const previewHint = $("#previewActionHint");
  renderOperationHub();
  if (previewHint) {
    previewHint.textContent = readiness.executePreview.enabled ? "执行前会再次确认预览指纹。" : readiness.executePreview.reason;
  }
}

function setInlineError(message = "") {
  const node = $("#globalInlineError");
  if (!node) return;
  node.hidden = !message;
  node.textContent = message;
}

let activeTaskClearTimer = 0;

function setActiveTask({ title, detail = "", stateLabel = "运行中", tone = "busy", persist = false } = {}) {
  const bar = $("#activeTaskBar");
  if (!bar) return;
  clearTimeout(activeTaskClearTimer);
  bar.hidden = false;
  bar.className = `active-task-bar ${tone}`;
  $("#activeTaskTitle").textContent = title || "正在处理任务";
  $("#activeTaskDetail").textContent = detail || "请等待当前操作完成。";
  $("#activeTaskState").textContent = stateLabel;
  $("#activeTaskState").className = `state-pill ${toneForStatus(tone === "error" ? "failed" : tone === "success" ? "done" : "running")}`;
  if (!persist && tone !== "busy") {
    activeTaskClearTimer = setTimeout(() => {
      bar.hidden = true;
    }, 4200);
  }
}

async function requestActionConfirmation(actionId, context = {}) {
  const policy = policyForAction(actionId);
  if (policy.confirmation === "none") return true;
  const dialog = $("#actionConfirmDialog");
  if (!dialog) throw new Error("确认框未初始化");
  const copy = confirmationCopy(actionId, context);
  dialog.returnValue = "";
  $("#actionConfirmTitle").textContent = copy.title;
  $("#actionConfirmImpact").textContent = copy.impact;
  $("#actionConfirmRisk").textContent = copy.risk;
  const verifyWrap = $("#actionConfirmVerifyWrap");
  const verifyPhrase = $("#actionConfirmPhrase");
  const verifyInput = $("#actionConfirmInput");
  const submitButton = dialog.querySelector("[data-confirm-submit]");
  submitButton.textContent = copy.confirmLabel;
  submitButton.disabled = Boolean(copy.verificationPhrase);
  verifyWrap.hidden = !copy.verificationPhrase;
  verifyPhrase.textContent = copy.verificationPhrase;
  verifyInput.value = "";

  const syncSubmitState = () => {
    if (!copy.verificationPhrase) {
      submitButton.disabled = false;
      return;
    }
    submitButton.disabled = verifyInput.value.trim() !== copy.verificationPhrase;
  };

  return new Promise((resolve) => {
    const cleanup = () => {
      verifyInput.removeEventListener("input", syncSubmitState);
      dialog.removeEventListener("close", onClose);
      resolve(dialog.returnValue === "confirm");
    };
    const onClose = () => cleanup();
    verifyInput.addEventListener("input", syncSubmitState);
    dialog.addEventListener("close", onClose, { once: true });
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
    if (copy.verificationPhrase) verifyInput.focus();
  });
}

async function withBusyButton(button, action, pendingMessage = "", options = {}) {
  if (!button || button.dataset.loading === "true") return undefined;
  const actionId = options.actionId || button.id;
  const policy = knownActionPolicy(actionId);
  const actionContext = options.context || actionContextFor(actionId);
  const actionCopy = policy ? confirmationCopy(actionId, actionContext) : null;
  if (policy && policy.confirmation !== "none") {
    const confirmed = await requestActionConfirmation(actionId, actionContext);
    if (!confirmed) return undefined;
  }
  button.disabled = true;
  button.dataset.loading = "true";
  button.setAttribute("aria-busy", "true");
  setInlineError("");
  setActiveTask({
    title: actionCopy?.title || pendingMessage || button.textContent?.trim() || "正在处理",
    detail: pendingMessage || policy?.impact || "操作正在执行。",
    stateLabel: "运行中",
    tone: "busy",
    persist: true
  });
  if (pendingMessage) toast(pendingMessage);
  try {
    const result = await action();
    setActiveTask({
      title: actionCopy?.title || button.textContent?.trim() || "操作完成",
      detail: "操作已结束，详情可在任务页或当前页面查看。",
      stateLabel: "完成",
      tone: "success"
    });
    return result;
  } catch (error) {
    if (error.body?.job) rememberJob(error.body.job);
    toast(error.message, "error");
    log(`操作失败: ${error.message}`);
    $("#taskLogPanel")?.scrollIntoView({ block: "nearest" });
    setInlineError(`操作失败：${error.message}`);
    setActiveTask({
      title: actionCopy?.title || button.textContent?.trim() || "操作失败",
      detail: error.message,
      stateLabel: "失败",
      tone: "error"
    });
    setSyncState("操作失败", "error");
    return undefined;
  } finally {
    button.disabled = false;
    delete button.dataset.loading;
    button.removeAttribute("aria-busy");
    renderContext();
    renderDetail();
    applyActionReadiness();
  }
}

function routeFromHash() {
  const value = location.hash.replace(/^#/, "") || "workbench";
  const aliases = { overview: "workbench", create: "config", identity: "workbench", logs: "tasks" };
  return aliases[value] || value;
}

function showRoute(route = routeFromHash()) {
  const normalized = ["workbench", "resources", "config", "tasks"].includes(route) ? route : "workbench";
  const changed = activeRoute && activeRoute !== normalized;
  $$("[data-view]").forEach((view) => { view.hidden = view.dataset.view !== normalized; });
  $$("[data-route]").forEach((link) => {
    const active = link.dataset.route === normalized;
    link.classList.toggle("active", active);
    if (active) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });
  if (changed || !activeRoute) requestAnimationFrame(() => window.scrollTo({ top: 0, left: 0 }));
  activeRoute = normalized;
  renderDiagnosticSummary();
  renderEvidenceTimeline();
}

function selectedAccountFromControl() {
  return state.accounts[$("#accountSelect").selectedIndex] || null;
}

function accountConfiguration(account) {
  return account?.configuration || account?.name || "";
}

function accountMatchesContext(account, context) {
  return accountConfiguration(account) === context.configuration && account?.account === context.account;
}

function currentAccount() {
  const pending = state.pendingContext;
  return state.accounts.find((account) => (
    accountConfiguration(account) === pending.configuration && account.account === pending.account
  )) || selectedAccountFromControl();
}

function currentProjectId() {
  return state.pendingContext.projectId || "";
}

function contextReady() {
  const context = state.context;
  if (!context?.configuration || !context.account || !context.projectId) return false;
  const accountAvailable = state.accounts.some((account) => (
    accountConfiguration(account) === context.configuration && account.account === context.account
  ));
  const projectAvailable = state.activeProjects.some((project) => project.projectId === context.projectId);
  return accountAvailable && projectAvailable;
}

function updatePendingContextFromSelects({ projectId = $("#projectSelect")?.value || "" } = {}) {
  const account = selectedAccountFromControl();
  state.pendingContext = {
    configuration: accountConfiguration(account),
    account: account?.account || "",
    projectId
  };
}

function syncSelectsToPendingContext() {
  const accountIndex = state.accounts.findIndex((account) => (
    accountConfiguration(account) === state.pendingContext.configuration && account.account === state.pendingContext.account
  ));
  if (accountIndex >= 0) $("#accountSelect").selectedIndex = accountIndex;
  if (state.pendingContext.projectId && state.projects.some((project) => project.projectId === state.pendingContext.projectId)) {
    $("#projectSelect").value = state.pendingContext.projectId;
  }
}

function shouldAutoApplyPreferredContext() {
  if (state.context) return false;
  // Public builds intentionally ship without a maintainer-specific default.
  // After the read-only account/project discovery wave, use the first valid
  // selection so a fresh install is usable without embedding private context.
  return Boolean(
    state.pendingContext.configuration
    && state.pendingContext.account
    && state.pendingContext.projectId
    && state.projects.some((project) => project.projectId === state.pendingContext.projectId)
  );
}

function snapshotActiveContext() {
  return {
    context: state.context ? { ...state.context } : null,
    activeProjects: state.activeProjects.map((project) => ({ ...project })),
    pendingContext: { ...state.pendingContext },
    projects: state.projects.map((project) => ({ ...project })),
    records: structuredClone(state.records),
    cloud: structuredClone(state.cloud),
    inventoryMeta: structuredClone(state.inventoryMeta),
    resources: structuredClone(state.resources),
    recognitionPreviews: structuredClone(state.recognitionPreviews),
    selectedKey: state.selectedKey,
    selectedRecordId: state.selectedRecordId,
    preview: state.preview ? structuredClone(state.preview) : null,
    previewExecutable: state.previewExecutable,
    lastJob: state.lastJob ? structuredClone(state.lastJob) : null,
    lastJobAt: state.lastJobAt,
    doctor: state.doctor ? structuredClone(state.doctor) : null
  };
}

function restoreActiveContext(snapshot) {
  state.context = snapshot.context;
  state.activeProjects = snapshot.activeProjects;
  state.pendingContext = snapshot.pendingContext;
  state.projects = snapshot.projects;
  state.records = snapshot.records;
  state.cloud = snapshot.cloud;
  state.inventoryMeta = snapshot.inventoryMeta || { ...EMPTY_INVENTORY_META };
  state.resources = snapshot.resources;
  state.recognitionPreviews = snapshot.recognitionPreviews || {};
  state.selectedKey = snapshot.selectedKey;
  state.selectedRecordId = snapshot.selectedRecordId;
  state.preview = snapshot.preview;
  state.previewExecutable = snapshot.previewExecutable;
  state.lastJob = snapshot.lastJob;
  state.lastJobAt = snapshot.lastJobAt;
  state.doctor = snapshot.doctor;
  syncSelectsToPendingContext();
  renderInstanceNodeResult(selectedResource());
  renderPreview();
  renderResources();
  renderContext();
}

function setSelectOptions(select, items, labeler, valueKey = "value") {
  select.innerHTML = items.map((item, index) => {
    const value = item[valueKey] ?? index;
    return `<option value="${escapeHtml(value)}">${escapeHtml(labeler(item, index))}</option>`;
  }).join("");
}

function regionFromZone(zone) {
  return String(zone || "").replace(/-[a-z]$/, "");
}

function freeRegionIds() {
  return state.freeRules?.rules?.compute?.alwaysFreeRegions || state.regionCatalog?.freeRegionIds || [];
}

function isFreeRegion(regionId) {
  return freeRegionIds().includes(regionId);
}

function regionOptionLabel(region) {
  const free = isFreeRegion(region.id) ? " · 免费" : "";
  const label = region.label && region.label !== region.id ? ` · ${region.label}` : "";
  return `${region.id}${label}${free}`;
}

function groupedRegions() {
  const groups = new Map();
  for (const region of state.regionCatalog.regions || []) {
    const group = region.group || "Other";
    const list = groups.get(group) || [];
    list.push(region);
    groups.set(group, list);
  }
  return [...groups.entries()];
}

function renderRegionOptions({ preserveValue = true } = {}) {
  const select = $("#region");
  const previous = preserveValue ? select.value : "";
  const groups = groupedRegions();
  select.innerHTML = groups.map(([group, regions]) => `
    <optgroup label="${escapeHtml(group)}">
      ${regions.map((region) => `<option value="${escapeHtml(region.id)}">${escapeHtml(regionOptionLabel(region))}</option>`).join("")}
    </optgroup>
  `).join("");
  const availableIds = new Set((state.regionCatalog.regions || []).map((region) => region.id));
  const preferred = [
    previous,
    DEFAULT_REGION_ID,
    ...(state.regionCatalog.freeRegionIds || []),
    state.regionCatalog.regions?.[0]?.id || ""
  ].find((regionId) => regionId && availableIds.has(regionId));
  if (preferred) select.value = preferred;
  updateDerivedZone();
  renderRegionHelper();
}

function currentRegion() {
  return (state.regionCatalog.regions || []).find((region) => region.id === $("#region").value) || null;
}

function regionZones(region) {
  return Array.isArray(region?.zones) ? region.zones.filter(Boolean) : [];
}

function updateDerivedZone(preferredZone = "") {
  const region = currentRegion();
  const zones = regionZones(region);
  if (!region) {
    state.derivedZone = "";
    return "";
  }
  const manualZone = $("#zoneChoice")?.value || "";
  const nextZone = [preferredZone, manualZone, region.defaultZone, zones[0]]
    .find((zone) => zone && zones.includes(zone));
  state.derivedZone = nextZone || "";
  return state.derivedZone;
}

function sourceLabelForCatalog(source = {}) {
  return {
    "gcloud-derived": "gcloud",
    official: "官方",
    fallback: "内置备用",
    "stale-cache": "过期缓存"
  }[source.kind] || source.kind || "未知";
}

function renderRegionHelper(message = "") {
  const region = currentRegion();
  const helper = $("#regionZoneHelper");
  const title = $("#zoneChoiceTitle");
  const meta = $("#zoneChoiceMeta");
  const zone = $("#zoneChoice");
  const free = region && isFreeRegion(region.id);
  $("#regionFreeTierHint").textContent = region
    ? free
      ? "Always Free 区域；仍需注意公网 IPv4、磁盘和出站流量。"
      : "非 Always Free 区域；按当前 GCP 价格计费。"
    : "未选择区域。";
  const zones = regionZones(region);
  if (zone) {
    zone.innerHTML = zones.length
      ? zones.map((item) => `<option value="${escapeHtml(item)}">${escapeHtml(item)}</option>`).join("")
      : `<option value="">无可用 zone</option>`;
    zone.value = state.derivedZone || zones[0] || "";
    zone.disabled = !zones.length;
  }
  if (title) title.textContent = region ? `当前 zone：${state.derivedZone || "-"}` : "自动选择 zone";
  if (meta) meta.textContent = region
    ? zones.length ? `${zones.length} 个可用区，可手动切换` : "未读取到可用 zone"
    : "读取区域后显示可用区。";
  if (helper) helper.classList.toggle("is-free-region", Boolean(free));
  const source = state.regionCatalog.source || {};
  $("#regionCatalogSource").textContent = message || `区域目录：${sourceLabelForCatalog(source)}${state.regionCatalog.stale ? " · stale" : ""}`;
}

function renderStaticOptions() {
  renderRegionOptions({ preserveValue: false });
  setSelectOptions($("#machineType"), MACHINES.map((value) => ({ value })), (item) => item.value);
  $("#image").innerHTML = IMAGES.map(([value, label]) => `<option value="${escapeHtml(value)}">${escapeHtml(label)}</option>`).join("");
}

function renderContextScope() {
  const text = state.context ? `${state.context.account} / ${state.context.projectId}` : "尚未选择";
  $("#currentScope").textContent = text;
  if (!state.serviceReady) setSyncState("本地服务未连接", "error");
  else if (!contextReady()) setSyncState("等待选择上下文");
}

function renderContext() {
  renderContextScope();
  renderOverview();
  renderDoctorPanel();
  applyActionReadiness();
}

function renderOverview() {
  const item = selectedResource();
  const running = state.resources.filter((resource) => {
    const status = resource.cloud?.status || resource.record?.status || "";
    return String(status).toUpperCase() === "RUNNING";
  }).length;
  $("#overviewVmCount").textContent = String(state.resources.length);
  $("#overviewRunningCount").textContent = String(running);

  const itemSelected = Boolean(item);
  const ready = contextReady();
  $("#nextTitle").textContent = ready ? (itemSelected ? "检查当前实例状态" : "选择或创建实例") : "选择账号与项目";
  $("#nextBody").textContent = ready
    ? (itemSelected ? "进入实例页查看 SSH、BBR、防火墙和服务状态，需要时运行只读探测。" : "从统一清单选择已有实例，或创建一台新实例。")
    : "先确定操作上下文，避免对错误的项目执行命令。";
  $("#mainAction").textContent = ready ? (itemSelected ? "查看当前实例" : "打开实例清单") : "选择账号与项目";

  const currentStep = !ready ? "context" : itemSelected ? "config" : "resource";
  const order = ["context", "resource", "config"];
  $$(".compact-steps [data-step]").forEach((node) => {
    const nodeIndex = order.indexOf(node.dataset.step);
    const currentIndex = order.indexOf(currentStep);
    node.classList.toggle("active", nodeIndex === currentIndex);
    node.classList.toggle("done", nodeIndex < currentIndex);
  });

  if (state.lastJob) {
    const status = taskStatusLabel(state.lastJob.status || "完成");
    $("#recentTaskStatus").textContent = status;
    $("#recentTaskStatus").className = `state-pill ${toneForStatus(status)}`;
    $("#recentTaskName").textContent = state.lastJob.label || state.lastJob.type || "最近任务";
    $("#recentTaskTime").textContent = state.lastJobAt ? state.lastJobAt.toLocaleTimeString(getLocaleTag()) : "刚刚";
  } else {
    $("#recentTaskStatus").textContent = "暂无任务";
    $("#recentTaskStatus").className = "state-pill draft";
    $("#recentTaskName").textContent = "还没有执行预览或维护操作";
    $("#recentTaskTime").textContent = "--";
  }
}

function contextQuery(context = state.context) {
  if (!context) return "";
  return `configuration=${encodeURIComponent(context.configuration)}&account=${encodeURIComponent(context.account)}&projectId=${encodeURIComponent(context.projectId)}`;
}

function renderDoctorItems(items = []) {
  return items.map((item) => `
    <div class="doctor-item is-${escapeHtml(item.status)}">
      <span class="doctor-dot" aria-hidden="true"></span>
      <span class="doctor-label">${escapeHtml(item.label)}</span>
      <span class="doctor-reason">${escapeHtml(item.reason)}</span>
      ${item.evidence ? `<code class="doctor-evidence">${escapeHtml(item.evidence)}</code>` : ""}
      ${item.showNextAction ? `<span class="doctor-next">${escapeHtml(item.nextAction)}</span>` : ""}
    </div>
  `).join("");
}

function renderDoctorSection(section) {
  if (section.collapsible) {
    return `
      <details class="doctor-runtime-section is-${escapeHtml(section.status)}">
        <summary class="doctor-runtime-summary">
          <span class="doctor-runtime-dot" aria-hidden="true"></span>
          <span class="doctor-section-label">${escapeHtml(section.label)}</span>
          <span class="doctor-runtime-copy">${escapeHtml(section.summary)}</span>
          <span class="doctor-runtime-chevron" aria-hidden="true">⌄</span>
        </summary>
        <div class="doctor-section-items doctor-runtime-items">
          ${renderDoctorItems(section.items)}
        </div>
      </details>
    `;
  }
  return `
    <div class="doctor-section">
      <span class="doctor-section-label">${escapeHtml(section.label)}</span>
      <div class="doctor-section-items">
        ${renderDoctorItems(section.items)}
      </div>
    </div>
  `;
}

function renderDoctorPanel() {
  const summary = $("#doctorSummary");
  const checks = $("#doctorChecks");
  if (!summary || !checks) return;
  if (!state.doctor) {
    summary.textContent = contextReady() ? "点击运行体检，检查本机、项目、规则和实例状态。" : "选择账号和项目后可运行只读体检。";
    checks.innerHTML = "";
    return;
  }
  const view = toDoctorView(state.doctor);
  summary.textContent = view.title;
  checks.innerHTML = view.sections.map(renderDoctorSection).join("");
}

function currentDoctorView() {
  return state.doctor ? toDoctorView(state.doctor) : null;
}

function renderOperationHub() {
  const node = $("#operationHub");
  const hint = $("#detailActionHint");
  if (!node && !hint) return;
  const item = selectedResource();
  const detailView = currentInstanceDetailView();
  const hub = toOperationHub({
    contextReady: contextReady(),
    selected: Boolean(item),
    hasLocalRecord: Boolean(item?.record?.id),
    hasCloudInstance: Boolean(item?.cloud),
    deployMethod: selectedDeployMethodForReadiness(),
    doctorStatus: currentDoctorView()?.status || "",
    actionReadiness: state.actionReadiness || {}
  });
  const operationHint = toOperationHint({
    recommendation: detailView.recommendation,
    actionReadiness: state.actionReadiness || {}
  });
  if (node) {
    node.dataset.recommendation = detailView.recommendation.actionId || "";
    node.dataset.recommendedGroup = detailView.autoOpenGroupId || "";
    node.dataset.primaryAction = hub.primary?.actionId || "";
    node.dataset.hiddenLowPriority = hub.hiddenLowPriorityIds.join(" ");
    for (const id of ["refreshResources"]) {
      const button = document.getElementById(id);
      if (button) button.classList.toggle("is-demoted", hub.hiddenLowPriorityIds.includes(id));
    }
    for (const id of ["deployNodes", "adoptLocalInstance"]) {
      const button = document.getElementById(id);
      if (button) button.hidden = hub.hiddenLowPriorityIds.includes(id);
    }
    for (const group of node.querySelectorAll("[data-action-group]")) {
      const visibleButtons = [...group.querySelectorAll("button")].filter((button) => !button.hidden);
      group.dataset.hasEnabled = String(visibleButtons.some((button) => !button.disabled));
      group.dataset.visibleActionCount = String(visibleButtons.length);
    }
    const groupedButtons = [...node.querySelectorAll("button")];
    for (const button of groupedButtons) button.classList.remove("primary", "is-recommended");
    const recommended = document.getElementById(detailView.recommendation.actionId);
    if (recommended && node.contains(recommended) && !recommended.hidden) {
      recommended.classList.add("primary", "is-recommended");
    }
    syncInstanceActionDisclosures();
  }
  if (hint) {
    hint.hidden = !operationHint.visible;
    hint.textContent = operationHint.text;
  }
}

function syncInstanceActionDisclosures() {
  const hub = $("#operationHub");
  if (!hub) return;
  const mobile = matchMedia("(max-width: 767px)").matches;
  const selectedKey = state.selectedKey || "";
  const recommendedGroup = hub.dataset.recommendedGroup || "";
  const stateKey = `${selectedKey}:${recommendedGroup}:${mobile ? "mobile" : "desktop"}`;
  if (hub.dataset.disclosureStateKey === stateKey) return;
  $$("[data-action-group]").forEach((group) => {
    group.open = mobile ? group.dataset.actionGroup === recommendedGroup : true;
  });
  hub.dataset.disclosureStateKey = stateKey;
}

function currentDiagnosticFocus() {
  return toDiagnosticFocus({
    route: activeRoute || routeFromHash(),
    selectedResource: selectedResource(),
    selectedJob: selectedJob(),
    resources: state.resources
  });
}

function selectedDiagnosticSummary() {
  const focus = currentDiagnosticFocus();
  const evidence = diagnosticEvidenceForFocus(focus);
  return toDiagnosticSummary({
    context: state.context,
    selectedVm: diagnosticVmFromResource(focus.resource),
    doctorView: currentDoctorView(),
    selectedJob: evidence.selectedJob,
    nodeResult: evidence.nodeResult,
    verification: evidence.verification,
    recognition: focus.resource ? fallbackRecognitionForItem(focus.resource) : evidence.recognition
  });
}

function renderDiagnosticSummary() {
  const rows = $("#diagnosticSummaryRows");
  const title = $("#diagnosticSummaryTitle");
  const hint = $("#diagnosticSummaryHint");
  if (!rows || !title || !hint) return;
  const summary = selectedDiagnosticSummary();
  title.textContent = summary.title;
  hint.textContent = summary.rows.length ? "可复制给自己排查或记录当前状态。" : "选择实例或任务后生成可复制摘要。";
  const disclosureSummary = $("#taskDiagnosticsSummary");
  if (disclosureSummary) {
    disclosureSummary.textContent = summary.rows.length ? `${summary.rows.length} 项上下文与诊断` : "暂无诊断上下文";
  }
  rows.innerHTML = summary.rows.map((item) => `
    <div>
      <dt>${escapeHtml(item.label)}</dt>
      <dd>${escapeHtml(item.value)}</dd>
    </div>
  `).join("");
}

function renderEvidenceTimeline() {
  const node = $("#evidenceTimeline");
  if (!node) return;
  const focus = currentDiagnosticFocus();
  const evidence = diagnosticEvidenceForFocus(focus);
  const view = toEvidenceTimeline({
    doctorView: currentDoctorView(),
    selectedJob: evidence.selectedJob,
    verification: evidence.verification,
    nodeResult: evidence.nodeResult,
    recognition: focus.resource ? fallbackRecognitionForItem(focus.resource) : evidence.recognition
  });
  node.innerHTML = view.items.map((entry) => `
    <span class="evidence-step is-${escapeHtml(entry.tone)}">
      <strong>${escapeHtml(entry.label)}</strong>
      <span>${escapeHtml(entry.detail)}</span>
    </span>
  `).join("");
}

async function copyDiagnosticSummary() {
  const summary = selectedDiagnosticSummary();
  const result = await copyText(summary.text);
  if (result.ok) {
    toast(result.method === "fallback" ? "诊断摘要已复制（备用方式）" : "诊断摘要已复制", "success");
  } else {
    toast("复制失败，请手动选择诊断摘要内容", "error");
  }
}

async function fetchDoctor(context = state.context, { signal } = {}) {
  if (!context?.configuration || !context.account || !context.projectId) {
    return null;
  }
  return api(`/api/doctor?${contextQuery(context)}`, { signal });
}

async function loadDoctor(reason = "manual", context = state.context) {
  state.doctor = await fetchDoctor(context);
  renderDoctorPanel();
  if (reason === "manual") {
    log(`环境体检完成: ${state.doctor.status}`);
    toast(toDoctorView(state.doctor).title, state.doctor.status === "pass" ? "success" : "warn");
  }
  applyActionReadiness();
  renderDiagnosticSummary();
  renderEvidenceTimeline();
  return state.doctor;
}

async function fetchRegionCatalog(context = state.context, { signal } = {}) {
  if (!context?.configuration || !context.account || !context.projectId) {
    return FALLBACK_REGION_CATALOG;
  }
  return api(`/api/regions?${contextQuery(context)}`, { signal });
}

function renderFreeRuleSummary(payload = state.freeRules) {
  if (!payload) {
    $("#freeRuleSummary").textContent = "尚未校对。";
    $("#freeRuleSource").textContent = "来源：未校对";
    $("#freeRuleCheckedAt").textContent = "时间：--";
    return;
  }
  const compute = payload.rules?.compute || {};
  const network = payload.rules?.network || {};
  const regions = compute.alwaysFreeRegions || [];
  const diskText = compute.disk?.standardPersistentDiskGbMonths
    ? `${compute.disk.standardPersistentDiskGbMonths}GB 标准持久磁盘`
    : "30GB 标准持久磁盘";
  const outboundText = compute.outbound?.allowanceGb
    ? `${compute.outbound.allowanceGb}GB 北美出站`
    : "1GB 北美出站";
  const ipv4Text = network.externalIpv4?.separatePricing
    ? "公网 IPv4 独立计费"
    : "公网 IPv4 需单独核对";
  $("#freeRuleSummary").textContent = `${payload.stale ? "使用过期/备用规则：" : "已校对："}${compute.provisioningModel || "non-preemptible"} ${compute.machineType || "e2-micro"}，区域 ${regions.join(" / ")}，${diskText}，${outboundText}；${ipv4Text}，超出条件会计费。`;
  $("#freeRuleSource").textContent = `来源：${sourceLabelForCatalog(payload.source)}${payload.warning ? ` · ${payload.warning}` : ""}`;
  $("#freeRuleCheckedAt").textContent = `时间：${payload.generatedAt || "--"}`;
}

async function fetchFreeRules(context = state.context, { signal } = {}) {
  if (!context?.configuration || !context.account || !context.projectId) {
    return null;
  }
  return api(`/api/free-rules?${contextQuery(context)}`, { signal });
}

async function calibrateFreeRules() {
  if (!contextReady()) throw new Error("请先选择账号与项目。");
  state.freeRules = await api("/api/free-rules/calibrate", {
    method: "POST",
    body: state.context
  });
  renderFreeRuleSummary();
  renderRegionOptions();
  log(`免费规则已校对: ${sourceLabelForCatalog(state.freeRules.source)} / ${state.freeRules.generatedAt || "--"}`);
  toast("免费规则已校对", "success");
  return state.freeRules;
}

async function loadSshAuthStatus() {
  const response = await api("/api/local-security/ssh-auth");
  state.sshAuthStatus = response.sshAuth || { configured: false, versionId: "", updatedAt: "" };
  return state.sshAuthStatus;
}

async function loadAccounts({ preferDefault = false } = {}) {
  const previousConfiguration = state.context?.configuration || state.pendingContext.configuration || accountConfiguration(currentAccount());
  const data = await api("/api/accounts");
  state.accounts = data.accounts || [];
  setSelectOptions($("#accountSelect"), state.accounts, (item) => {
    const project = item.projectId ? ` / ${item.projectId}` : "";
    return `${item.name} / ${item.account || "未登录"}${project}`;
  });
  const previousIndex = state.accounts.findIndex((item) => accountConfiguration(item) === previousConfiguration);
  const defaultIndex = preferDefault
    ? state.accounts.findIndex((item) => accountMatchesContext(item, DEFAULT_CONTEXT))
    : -1;
  if (defaultIndex >= 0) $("#accountSelect").selectedIndex = defaultIndex;
  else if (previousIndex >= 0) $("#accountSelect").selectedIndex = previousIndex;
  $("#accountSelect").disabled = state.accounts.length === 0;
  updatePendingContextFromSelects({ projectId: "" });
  await loadProjects({ preferDefault });
  renderContext();
}

function resetAccountContextAfterLoadFailure() {
  state.accounts = [];
  state.projects = [];
  state.activeProjects = [];
  state.pendingContext = { ...DEFAULT_CONTEXT };
  state.context = null;
  resetSelectedVmContext({ render: false });
  const accountSelect = $("#accountSelect");
  const projectSelect = $("#projectSelect");
  if (accountSelect) {
    accountSelect.replaceChildren();
    accountSelect.disabled = true;
  }
  if (projectSelect) {
    projectSelect.innerHTML = '<option value="">没有可用项目</option>';
    projectSelect.disabled = true;
  }
}

function accountLoadFailureMessage(error) {
  if (error?.code === "gcloud_unavailable" || /gcloud.*(?:启动|available)|spawn.*gcloud/i.test(error?.message || "")) {
    return "本机无法启动 gcloud。请确认已安装 gcloud、已完成登录，然后点击“重新读取”。";
  }
  return "无法读取本机 gcloud 配置。请检查登录状态或网络，然后点击“重新读取”。";
}

function handleAccountLoadFailure(error) {
  resetAccountContextAfterLoadFailure();
  const guidance = accountLoadFailureMessage(error);
  renderContext();
  $("#contextHint").textContent = guidance;
  setSyncState("账号读取失败，请重新读取", "warn");
  setInlineError(`账号与项目读取失败：${guidance}`);
  return error;
}

async function loadProjects({ preferDefault = false } = {}) {
  const account = selectedAccountFromControl();
  const configuration = accountConfiguration(account);
  if (!configuration || !account?.account) {
    state.projects = [];
    state.pendingContext = { configuration: "", account: "", projectId: "" };
    $("#projectSelect").innerHTML = "<option value=\"\">没有可用项目</option>";
    $("#projectSelect").disabled = true;
    $("#contextHint").textContent = "当前配置没有可用账号。请先在本机完成 gcloud 登录。";
    renderContext();
    return;
  }
  $("#projectSelect").disabled = true;
  $("#projectSelect").innerHTML = "<option value=\"\">正在读取项目...</option>";
  let data;
  try {
    data = await api(`/api/projects?configuration=${encodeURIComponent(configuration)}&account=${encodeURIComponent(account.account)}`);
  } catch (error) {
    state.projects = [];
    updatePendingContextFromSelects({ projectId: "" });
    $("#projectSelect").innerHTML = "<option value=\"\">项目读取失败</option>";
    $("#contextHint").textContent = "项目读取失败。请检查网络或账号权限，然后重新读取。";
    renderContext();
    throw error;
  }
  state.projects = data.projects || [];
  if (state.projects.length) {
    setSelectOptions($("#projectSelect"), state.projects, (item) => `${item.projectId} ${item.name ? `- ${item.name}` : ""}`, "projectId");
    $("#projectSelect").disabled = false;
    $("#contextHint").textContent = "项目列表已按当前 gcloud 配置和账号同步。";
  } else {
    $("#projectSelect").innerHTML = "<option value=\"\">没有可用项目</option>";
    $("#contextHint").textContent = "此账号未返回可访问项目，请检查账号权限或切换 gcloud 配置。";
  }
  const preferredProjectId = state.context?.configuration === configuration && state.context?.account === account.account
    ? state.context.projectId
    : account.projectId;
  const selectedProjectId = preferDefault && accountMatchesContext(account, DEFAULT_CONTEXT)
    ? DEFAULT_CONTEXT.projectId
    : preferredProjectId;
  if (selectedProjectId && state.projects.some((project) => project.projectId === selectedProjectId)) {
    $("#projectSelect").value = selectedProjectId;
  }
  updatePendingContextFromSelects({ projectId: $("#projectSelect").value || "" });
  renderContext();
}

function resetSelectedVmContext({ render = true } = {}) {
  state.records = [];
  state.cloud = [];
  state.inventoryMeta = { ...EMPTY_INVENTORY_META };
  state.resources = [];
  state.selectedKey = "";
  state.selectedRecordId = "";
  state.preview = null;
  state.previewExecutable = false;
  state.lastJob = null;
  state.lastJobAt = null;
  state.doctor = null;
  state.networkExposurePreview = null;
  state.networkExposureRecordId = "";
  state.networkExposurePreviewDirty = false;
  if (render) {
    renderInstanceNodeResult(null);
    renderTaskNodeResult(null);
    renderPreview();
  }
}

function contextRefreshKey(context, scope = "context") {
  return [scope, context?.configuration, context?.account, context?.projectId].join("::");
}

async function captureContextRead(label, operation, fallback) {
  try {
    return { value: await operation(), warning: "" };
  } catch (error) {
    if (isAbortError(error)) throw error;
    return { value: fallback, warning: `${label}: ${error.message}` };
  }
}

async function fetchContextSnapshot(context, options = {}) {
  const { failOnDegraded = false, signal } = options;
  const [resources, regionCatalog, freeRules, doctor] = await Promise.all([
    fetchResourcesForContext(context, { failOnDegraded, signal }),
    captureContextRead(
      "区域目录读取失败",
      () => fetchRegionCatalog(context, { signal }),
      FALLBACK_REGION_CATALOG
    ),
    captureContextRead(
      "免费规则缓存读取失败",
      () => fetchFreeRules(context, { signal }),
      null
    ),
    captureContextRead(
      "环境体检读取失败",
      () => fetchDoctor(context, { signal }),
      null
    )
  ]);
  return {
    resources,
    regionCatalog: regionCatalog.value,
    freeRules: freeRules.value,
    doctor: doctor.value,
    warnings: [regionCatalog.warning, freeRules.warning, doctor.warning].filter(Boolean)
  };
}

async function fetchInventorySnapshot(context, options = {}) {
  const { failOnDegraded = false, signal } = options;
  const [resources, doctor] = await Promise.all([
    fetchResourcesForContext(context, { failOnDegraded, signal }),
    captureContextRead(
      "环境体检读取失败",
      () => fetchDoctor(context, { signal }),
      null
    )
  ]);
  return {
    resources,
    doctor: doctor.value,
    warnings: [doctor.warning].filter(Boolean)
  };
}

function commitInventorySnapshot(snapshot) {
  state.records = snapshot.resources.records;
  state.cloud = snapshot.resources.cloud;
  state.inventoryMeta = snapshot.resources.inventoryMeta || { ...EMPTY_INVENTORY_META };
  if (state.inventoryMeta.source !== "live" || state.inventoryMeta.stale) state.previewExecutable = false;
  state.doctor = snapshot.doctor;
  mergeResources();
  renderResources({ renderRelated: false });
  renderOverview();
  renderDoctorPanel();
  renderDiagnosticSummary();
  renderEvidenceTimeline();
  applyActionReadiness();
  for (const warning of snapshot.warnings) log(warning);
}

function commitContextSnapshot(context, snapshot, { activate = false, resetSelection = false } = {}) {
  if (activate) {
    state.context = { ...context };
    state.activeProjects = state.projects.map((project) => ({ ...project }));
  }
  if (resetSelection) resetSelectedVmContext({ render: false });
  state.records = snapshot.resources.records;
  state.cloud = snapshot.resources.cloud;
  state.inventoryMeta = snapshot.resources.inventoryMeta || { ...EMPTY_INVENTORY_META };
  if (state.inventoryMeta.source !== "live" || state.inventoryMeta.stale) state.previewExecutable = false;
  state.regionCatalog = snapshot.regionCatalog || FALLBACK_REGION_CATALOG;
  state.freeRules = snapshot.freeRules;
  state.doctor = snapshot.doctor;

  renderRegionOptions();
  renderFreeRuleSummary();
  if (snapshot.warnings.some((warning) => warning.startsWith("区域目录读取失败"))) {
    renderRegionHelper(`区域目录：内置备用 · ${snapshot.warnings.find((warning) => warning.startsWith("区域目录读取失败"))}`);
  }
  if (resetSelection) {
    renderInstanceNodeResult(null);
    renderTaskNodeResult(null);
    renderPreview();
  }
  mergeResources();
  renderResources({ renderRelated: false });
  renderTaskWorkspace({ renderRelated: false });
  renderContextScope();
  renderOverview();
  renderDoctorPanel();
  renderDiagnosticSummary();
  renderEvidenceTimeline();
  applyActionReadiness();
  for (const warning of snapshot.warnings) log(warning);
}

async function useSelectedContext() {
  const account = currentAccount();
  const projectId = currentProjectId();
  if (!account || !projectId) {
    toast("请选择账号和项目", "warn");
    return;
  }
  const snapshot = snapshotActiveContext();
  const nextContext = {
    configuration: accountConfiguration(account),
    account: account.account,
    projectId
  };
  setSyncState("正在同步资源", "busy");
  try {
    const coordinated = await contextRefreshCoordinator.run(
      contextRefreshKey(nextContext),
      ({ signal }) => fetchContextSnapshot(nextContext, { failOnDegraded: true, signal })
    );
    if (coordinated.stale) return { stale: true };
    commitContextSnapshot(nextContext, coordinated.value, { activate: true, resetSelection: true });
    const degraded = coordinated.value.resources.degraded;
    toast(degraded ? `已切换到 ${projectId}，当前显示缓存清单` : `已切换到 ${projectId}`, degraded ? "warn" : "success");
    setSyncState(degraded ? "正在显示缓存清单" : "数据已同步", degraded ? "warn" : "success");
    return { degraded: coordinated.value.resources.degraded };
  } catch (error) {
    if (isAbortError(error)) return { stale: true };
    restoreActiveContext(snapshot);
    setSyncState("切换失败，已保留原项目", "error");
    log(`项目切换失败: ${error.message}`);
    throw new Error(`切换失败，已保留原项目：${error.message}`);
  }
}

function resourceKey(identity) {
  return [identity.account, identity.projectId, identity.zone, identity.name].join("::");
}

function mergeResources() {
  const map = new Map();
  for (const record of state.records) {
    const key = resourceKey(record.identity);
    map.set(key, { key, record, cloud: null, identity: record.identity, source: "local" });
  }
  for (const cloud of state.cloud) {
    const key = resourceKey({ ...cloud, account: state.context?.account, projectId: state.context?.projectId });
    const existing = map.get(key);
    if (existing) {
      existing.cloud = cloud;
      existing.source = "managed";
    } else {
      map.set(key, {
        key,
        record: null,
        cloud,
        identity: {
          configuration: state.context?.configuration,
          account: state.context?.account,
          projectId: state.context?.projectId,
          zone: cloud.zone,
          name: cloud.name
        },
        source: "cloud"
      });
    }
  }
  state.resources = [...map.values()].sort((a, b) => a.identity.name.localeCompare(b.identity.name));
  if (state.selectedKey && !map.has(state.selectedKey)) {
    state.selectedKey = "";
    state.selectedRecordId = "";
  } else if (state.selectedKey) {
    state.selectedRecordId = map.get(state.selectedKey)?.record?.id || "";
  }
}

async function fetchResourcesForContext(context, { failOnDegraded = false, signal } = {}) {
  const query = `account=${encodeURIComponent(context.account)}&projectId=${encodeURIComponent(context.projectId)}`;
  const cloudQuery = `configuration=${encodeURIComponent(context.configuration)}&${query}`;
  let degraded = false;
  let hardFailure = false;
  const failures = [];
  const sameActiveContext = Boolean(state.context && contextRefreshKey(state.context) === contextRefreshKey(context));
  const [records, cloud] = await Promise.all([
    api(`/api/vm-records?${query}`, { signal }).catch((error) => {
      if (isAbortError(error)) throw error;
      degraded = true;
      if (!sameActiveContext || state.records.length === 0) hardFailure = true;
      failures.push(error.message);
      log(`本地记录读取失败: ${error.message}`);
      return { records: sameActiveContext ? structuredClone(state.records) : [] };
    }),
    api(`/api/cloud-instances?${cloudQuery}`, { signal }).catch((error) => {
      if (isAbortError(error)) throw error;
      degraded = true;
      const canUseMemory = sameActiveContext && state.cloud.length > 0;
      if (!canUseMemory) hardFailure = true;
      failures.push(error.message);
      log(`云端清单读取失败: ${error.message}`);
      return {
        instances: canUseMemory ? structuredClone(state.cloud) : [],
        meta: {
          source: canUseMemory ? "memory" : "none",
          checkedAt: state.inventoryMeta?.checkedAt || "",
          stale: true,
          ageSeconds: Number(state.inventoryMeta?.ageSeconds || 0),
          retryAttempts: Number(error.body?.retryAttempts || 1),
          blocker: { category: error.category || "network", code: error.code || "http_error", message: error.message }
        }
      };
    })
  ]);
  const inventoryMeta = cloud.meta || { source: "live", checkedAt: new Date().toISOString(), stale: false, ageSeconds: 0, retryAttempts: 1, blocker: null };
  if (inventoryMeta.source !== "live" || inventoryMeta.stale) {
    degraded = true;
    if (inventoryMeta.blocker?.message) failures.push(inventoryMeta.blocker.message);
  }
  if (hardFailure && failOnDegraded) throw new Error(`资源同步失败：${summarizeResourceSyncFailures(failures)}`);
  return {
    degraded,
    records: records.records || [],
    cloud: cloud.instances || [],
    inventoryMeta
  };
}

async function refreshAllContext() {
  if (!contextReady()) {
    state.records = [];
    state.cloud = [];
    state.inventoryMeta = { ...EMPTY_INVENTORY_META };
    state.resources = [];
    renderResources();
    renderTaskWorkspace();
    return;
  }
  setSyncState("正在同步资源", "busy");
  try {
    const coordinated = await contextRefreshCoordinator.run(
      contextRefreshKey(state.context, "context"),
      ({ signal }) => fetchContextSnapshot(state.context, { signal })
    );
    if (coordinated.stale) return { stale: true };
    commitContextSnapshot(state.context, coordinated.value);
    const degraded = coordinated.value.resources.degraded;
    setSyncState(degraded ? "部分数据未同步" : "数据已同步", degraded ? "warn" : "success");
    return { degraded };
  } catch (error) {
    if (isAbortError(error)) return { stale: true };
    setSyncState("资源同步失败", "error");
    throw error;
  }
}

async function refreshResources() {
  if (!contextReady()) {
    state.records = [];
    state.cloud = [];
    state.inventoryMeta = { ...EMPTY_INVENTORY_META };
    state.resources = [];
    state.doctor = null;
    renderResources({ renderRelated: false });
    renderOverview();
    renderDoctorPanel();
    renderDiagnosticSummary();
    renderEvidenceTimeline();
    applyActionReadiness();
    return;
  }
  setSyncState("正在同步实例清单", "busy");
  try {
    const coordinated = await contextRefreshCoordinator.run(
      contextRefreshKey(state.context, "inventory"),
      ({ signal }) => fetchInventorySnapshot(state.context, { signal })
    );
    if (coordinated.stale) return { stale: true };
    commitInventorySnapshot(coordinated.value);
    const degraded = coordinated.value.resources.degraded;
    setSyncState(degraded ? "部分实例未同步" : "实例清单已同步", degraded ? "warn" : "success");
    return { degraded };
  } catch (error) {
    if (isAbortError(error)) return { stale: true };
    setSyncState("实例清单同步失败", "error");
    throw error;
  }
}

function inventoryAgeLabel(seconds = 0) {
  const value = Math.max(0, Number(seconds || 0));
  if (value < 60) return "刚刚";
  if (value < 3600) return `${Math.floor(value / 60)} 分钟前`;
  if (value < 86400) return `${Math.floor(value / 3600)} 小时前`;
  return `${Math.floor(value / 86400)} 天前`;
}

function renderInventorySyncNotice() {
  const notice = $("#resourceSyncNotice");
  if (!notice) return;
  const meta = state.inventoryMeta || EMPTY_INVENTORY_META;
  let message = "";
  if (meta.source === "cache") {
    message = `正在显示 ${inventoryAgeLabel(meta.ageSeconds)} 的本地缓存；云端写操作已锁定。${meta.blocker?.message ? ` ${meta.blocker.message}` : ""}`;
  } else if (meta.source === "memory") {
    message = `实时读取失败，已保留当前会话中的上次清单；云端写操作已锁定。${meta.blocker?.message ? ` ${meta.blocker.message}` : ""}`;
  } else if (meta.source === "live" && meta.cacheWriteFailed) {
    message = "实时清单已同步，但本地缓存保存失败；这不影响当前查看。";
  }
  notice.hidden = !message;
  notice.textContent = message.slice(0, 320);
  notice.className = `resource-sync-notice${meta.source === "live" ? " is-warning" : " is-stale"}`;
}

function renderResources({ renderRelated = true } = {}) {
  renderInventorySyncNotice();
  const search = $("#resourceSearch").value.trim().toLowerCase();
  const visible = state.resources.filter((item) => {
    const haystack = `${item.identity.name} ${item.identity.projectId} ${item.identity.zone} ${item.cloud?.network?.externalIp || ""}`.toLowerCase();
    return !search || haystack.includes(search);
  });
  const emptyTitle = contextReady() ? "当前项目还没有实例" : "尚未选择账号与项目";
  const emptyBody = contextReady()
    ? "可以前往部署页保存新实例草稿，或刷新后重新检查云端清单。"
    : "先在总览页应用一个账号与项目，再读取本地记录和云端实例。";
  $("#resourceCount").textContent = `${visible.length} 项`;
  $("#resourceList").innerHTML = visible.length ? `
	    <table class="resource-table" aria-label="统一实例清单">
	      <thead>
	        <tr class="resource-table-head">
	          <th scope="col">实例</th>
	          <th scope="col">位置</th>
	          <th scope="col">状态</th>
	          <th scope="col">公网 IPv4</th>
	          <th scope="col">模式</th>
	        </tr>
	      </thead>
      <tbody>${visible.map(renderResourceRow).join("")}</tbody>
    </table>
  ` : `<div class="empty-state">
    <strong>${escapeHtml(emptyTitle)}</strong>
    <span>${escapeHtml(emptyBody)}</span>
  </div>`;
  renderDetail({ renderRelated, updateReadiness: renderRelated });
}

function toneForStatus(value) {
  const normalized = String(value || "").toLowerCase();
  if (normalized.includes("running") || normalized.includes("managed")) return "running";
  if (normalized.includes("error") || normalized.includes("failed")) return "error";
  if (normalized.includes("interrupted")) return "warning";
  if (normalized.includes("terminated") || normalized.includes("draft")) return "terminated";
  if (normalized.includes("cloud")) return "cloud";
  return "draft";
}

function sourceLabel(source) {
  return {
    local: "本地",
    cloud: "云端",
    managed: "已同步"
  }[source] || source;
}

function methodLabel(method) {
  return {
    vm_only: "只开实例",
    singbox_plus: "Sing-Box-Plus",
    three_x_ui: "3X-UI",
    custom_startup: "自定义脚本",
    external_custom: "外部自定义",
    unmanaged_unknown: "未识别"
  }[method] || method || "未管理";
}

function activeVerificationServices(verification = null) {
  return (Array.isArray(verification?.services) ? verification.services : [])
    .filter((service) => String(service?.status || "").toLowerCase() === "active")
    .map((service) => String(service?.name || ""));
}

function bbrProbeFromVerification(verification = null) {
  if (verification?.bbr && typeof verification.bbr === "object") {
    return {
      enabled: Boolean(verification.bbr.enabled),
      congestionControl: String(verification.bbr.congestionControl || ""),
      qdisc: String(verification.bbr.qdisc || "")
    };
  }
  if (typeof verification?.bbr === "boolean") {
    return {
      enabled: verification.bbr,
      congestionControl: verification.bbr ? "bbr" : "",
      qdisc: ""
    };
  }
  const check = (Array.isArray(verification?.checks) ? verification.checks : [])
    .find((item) => String(item?.id || "").toLowerCase() === "bbr");
  if (!check) return null;
  return {
    enabled: check.status === "passed",
    congestionControl: check.status === "passed" ? "bbr" : "",
    qdisc: ""
  };
}

function recognitionFromVerification(verification = null) {
  const active = activeVerificationServices(verification);
  const hasXui = active.includes("x-ui");
  const hasSingBox = active.includes("sing-box");
  if (hasXui && hasSingBox) {
    return {
      method: "external_custom",
      confidence: "low",
      score: 45,
      source: "local_verification",
      managedState: "managed",
      evidence: active.map((name) => ({ source: "local_verification", label: `服务 ${name}`, value: "active", confidence: "medium", sensitive: false })),
      probes: {
        ssh: verification.ssh || null,
        bbr: bbrProbeFromVerification(verification),
        firewall: verification.firewall || null,
        services: verification.services || [],
        processes: [],
        containers: [],
        configSummary: []
      },
      warnings: ["检测到多个代理服务同时运行。"],
      suggestedAction: "manual_choose"
    };
  }
  const method = hasXui ? "three_x_ui" : hasSingBox ? "singbox_plus" : "";
  if (!method) return null;
  return {
    method,
    confidence: "high",
    score: 80,
    source: "local_verification",
    managedState: "managed",
    evidence: [{ source: "local_verification", label: "部署方式", value: methodLabel(method), confidence: "high", sensitive: false }],
    probes: {
      ssh: verification.ssh || null,
      bbr: bbrProbeFromVerification(verification),
      firewall: verification.firewall || null,
      services: verification.services || [],
      processes: [],
      containers: [],
      configSummary: []
    },
    warnings: [],
    suggestedAction: "verify"
  };
}

function localRecognitionForRecord(record) {
  if (!record) return null;
  const verificationRecognition = recognitionFromVerification(record.verification);
  if (verificationRecognition) return verificationRecognition;
  if (record.nodeResult?.type) {
    return {
      method: record.nodeResult.type,
      confidence: "high",
      score: 90,
      source: "local_record",
      managedState: "managed",
      evidence: [{ source: "local_record", label: "节点结果", value: methodLabel(record.nodeResult.type), confidence: "high", sensitive: false }],
      probes: {
        ssh: record.nodeResult.ssh || record.observed?.sshConnection || null,
        bbr: record.nodeResult.bbr === undefined ? null : { enabled: Boolean(record.nodeResult.bbr), congestionControl: record.nodeResult.bbr ? "bbr" : "", qdisc: "" },
        firewall: record.nodeResult.firewall || null,
        services: [],
        processes: [],
        containers: [],
        configSummary: []
      },
      warnings: [],
      suggestedAction: "verify"
    };
  }
  const adoption = record.migration?.adoption?.recognition;
  if (adoption) return adoption;
  const method = record.desired?.deploy?.method || record.nodeResult?.type || record.verification?.method || "unmanaged_unknown";
  return {
    method,
    confidence: "high",
    source: "local_record",
    managedState: "managed",
    evidence: [{ source: "local_record", label: "部署方式", value: methodLabel(method), confidence: "high", sensitive: false }],
    warnings: [],
    suggestedAction: "verify"
  };
}

function recognitionForItem(item) {
  if (!item) return null;
  return state.recognitionPreviews[item.key]?.recognition || localRecognitionForRecord(item.record) || null;
}

function effectiveDeployMethodForItem(item) {
  if (!item) return "unmanaged_unknown";
  const recognition = recognitionForItem(item);
  return recognition?.method || item?.record?.desired?.deploy?.method || item?.record?.nodeResult?.type || "unmanaged_unknown";
}

function fallbackRecognitionForItem(item) {
  return recognitionForItem(item) || {
    method: item?.cloud ? "unmanaged_unknown" : "vm_only",
    confidence: item?.cloud ? "none" : "high",
    source: item?.cloud ? "none" : "local_record",
    managedState: item?.cloud ? "unknown" : "managed",
    evidence: [],
    warnings: item?.cloud ? ["尚未识别部署方式。"] : [],
    suggestedAction: item?.cloud ? "manual_choose" : "verify"
  };
}

function deployActionLabel(method) {
  return {
    vm_only: "无需部署节点",
    singbox_plus: "部署 Sing-Box-Plus",
    three_x_ui: "部署 3X-UI",
    custom_startup: "运行自定义脚本"
  }[method] || "部署方式未确认";
}

function updateDeployAction(item = selectedResource()) {
  const button = $("#deployNodes");
  if (!button) return;
  if (item) button.textContent = deployActionLabel(item.record?.desired?.deploy?.method || "vm_only");
}

function renderResourceRow(item) {
  const selected = item.key === state.selectedKey ? " selected" : "";
  const status = item.cloud?.status || item.record?.status || "draft";
  const tone = toneForStatus(status);
  const ip = item.cloud?.network?.externalIp || item.record?.observed?.network?.externalIp || "";
  const method = methodLabel(effectiveDeployMethodForItem(item));
  return `
    <tr class="resource-row${selected}" data-resource-key="${escapeHtml(item.key)}" tabindex="0" aria-selected="${selected ? "true" : "false"}">
      <td class="resource-cell resource-cell-main" data-label="实例">
        <div class="resource-title-line">
          <strong class="resource-name" title="${escapeHtml(item.identity.name)}">${escapeHtml(item.identity.name)}</strong>
          <span class="state-pill ${escapeHtml(tone)}">${escapeHtml(status)}</span>
        </div>
        <div class="resource-mobile-meta" aria-hidden="true">
          <span title="${escapeHtml(item.identity.zone)}">${escapeHtml(item.identity.zone)}</span>
          <code title="${escapeHtml(ip || "no-ip")}">${escapeHtml(ip || "no-ip")}</code>
          <span title="${escapeHtml(method)}">${escapeHtml(method)}</span>
        </div>
        <em title="${escapeHtml(sourceLabel(item.source))}">${escapeHtml(sourceLabel(item.source))}</em>
      </td>
      <td class="resource-cell resource-cell-zone" data-label="位置">
        <span title="${escapeHtml(item.identity.zone)}">${escapeHtml(item.identity.zone)}</span>
      </td>
      <td class="resource-cell resource-cell-status" data-label="状态">
        <span class="state-pill ${escapeHtml(tone)}">${escapeHtml(status)}</span>
      </td>
      <td class="resource-cell resource-cell-ip" data-label="公网 IPv4">
        <code title="${escapeHtml(ip || "no-ip")}">${escapeHtml(ip || "no-ip")}</code>
      </td>
      <td class="resource-cell resource-cell-mode" data-label="模式">
        <span title="${escapeHtml(method)}">${escapeHtml(method)}</span>
      </td>
    </tr>
  `;
}

function selectedResource() {
  return state.resources.find((item) => item.key === state.selectedKey) || null;
}

function currentInstanceDetailView() {
  const item = selectedResource();
  return toInstanceDetailView({
    item,
    recognitionPreview: item ? state.recognitionPreviews[item.key] || null : null,
    actionReadiness: state.actionReadiness || {}
  });
}

function formatDetailCheckedAt(value = "") {
  if (!value) return "尚未检查";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? String(value)
    : `检查于 ${date.toLocaleString(getLocaleTag(), { hour12: false })}`;
}

function renderInstanceStatusSummary(view) {
  const target = $("#instanceStatusSummary");
  if (!target) return;
  target.innerHTML = view.statuses.map((item) => `
    <div class="instance-status-item is-${escapeHtml(item.tone)}"
      data-instance-status="${escapeHtml(item.id)}">
      <span>${escapeHtml(item.label)}</span>
      <strong title="${escapeHtml(item.detail || item.value)}">${escapeHtml(item.value)}</strong>
      ${item.context ? `<small>${escapeHtml(item.context)}</small>` : ""}
    </div>
  `).join("");
}

function renderInstanceRecommendation(view) {
  $("#detailRecommendationTitle").textContent = view.recommendation.title;
  $("#detailRecommendationText").textContent = view.recommendation.detail;
  $("#detailRecommendation").dataset.actionId = view.recommendation.actionId || "";
  const showNodeResults = $("#showNodeResults");
  const shouldShow = view.recommendation.actionId === "showNodeResults";
  showNodeResults.hidden = !shouldShow;
  showNodeResults.disabled = !shouldShow;
}

function renderInstanceDetailView(view) {
  $("#detailTitle").textContent = view.header.name;
  $("#detailStateBadge").textContent = view.header.status;
  $("#detailStateBadge").className = `state-pill ${view.header.statusTone}`;
  $("#detailExternalIp").textContent = `公网 IP ${view.header.externalIp || "--"}`;
  $("#detailCheckedAt").textContent = formatDetailCheckedAt(view.header.checkedAt);
  $("#nodeResultsSummary").textContent = view.disclosures.nodeSummary;
  $("#dangerDetailsSummary").textContent = view.disclosures.dangerSummary;
  renderInstanceStatusSummary(view);
  renderInstanceRecommendation(view);
}

function selectedResourceForAction() {
  const selectedRow = document.querySelector("#page-resources:not([hidden]) [data-resource-key][aria-selected=\"true\"]");
  const domKey = selectedRow?.dataset.resourceKey || "";
  if (domKey && domKey !== state.selectedKey) {
    state.selectedKey = domKey;
    state.selectedRecordId = selectedResource()?.record?.id || "";
  }
  return selectedResource();
}

function renderFacts(target, facts) {
  target.innerHTML = Object.entries(facts).map(([key, value]) => `
    <div>
      <dt>${escapeHtml(key)}</dt>
      <dd title="${escapeHtml(value || "-")}">${escapeHtml(value || "-")}</dd>
    </div>
  `).join("");
}

let technicalDetailsResourceKey = "";

function renderTechnicalSummaryRow(target, summary) {
  if (!target || !summary) return;
  target.className = `technical-summary-row is-${escapeHtml(summary.tone || "muted")}`;
  target.querySelector("strong").textContent = summary.value || "-";
  const note = target.querySelector("small");
  note.textContent = summary.note || "";
  note.title = summary.note || "";
}

function renderTechnicalFactRows(target, rows = []) {
  if (!target) return;
  target.innerHTML = rows.map((row) => `
    <div>
      <dt>${escapeHtml(row.label)}</dt>
      <dd title="${escapeHtml(row.value)}">${escapeHtml(row.value)}</dd>
    </div>
  `).join("");
}

function renderTechnicalEvidence(rows = []) {
  const group = $("#technicalEvidenceGroup");
  const target = $("#technicalEvidence");
  if (!group || !target) return;
  group.hidden = !rows.length;
  target.innerHTML = rows.map((row) => `
    <div>
      <dt>${escapeHtml(row.group)} · ${escapeHtml(row.label)}</dt>
      <dd>${escapeHtml(row.value)}</dd>
    </div>
  `).join("");
}

function governanceForItem(item) {
  if (!item) return null;
  return item.record?.observed?.firewallGovernance ||
    item.record?.verification?.firewallGovernance ||
    state.recognitionPreviews[item.key]?.firewallGovernance ||
    null;
}

function networkExposurePreviewForItem(item) {
  const recordId = item?.record?.id || "";
  if (!recordId) return null;
  if (state.networkExposureRecordId === recordId) {
    if (state.networkExposurePreviewDirty) return null;
    if (state.networkExposurePreview) return state.networkExposurePreview;
  }
  return item.record?.observed?.networkExposurePreview || null;
}

function networkExposureViewForItem(item) {
  if (!item?.record) return toNetworkExposureView({ secretStatus: state.sshAuthStatus });
  const recordId = item.record.id || "";
  const editingWithoutPreview = state.networkExposureRecordId === recordId && state.networkExposurePreviewDirty;
  const record = editingWithoutPreview
    ? {
        ...item.record,
        observed: { ...(item.record.observed || {}), networkExposurePreview: null }
      }
    : item.record;
  return toNetworkExposureView({
    record,
    secretStatus: state.sshAuthStatus,
    preview: networkExposurePreviewForItem(item)
  });
}

function renderNetworkExposurePreview(view) {
  const target = $("#networkExposurePreview");
  if (!target) return;
  const rows = Array.isArray(view.preview.rows) ? view.preview.rows : [];
  target.className = `network-exposure-preview ${view.preview.tone === "warning" ? "warning" : view.preview.tone === "success" ? "success" : ""}`.trim();
  target.innerHTML = `
    <strong>${escapeHtml(view.preview.summary)}</strong>
    <span>${escapeHtml(view.preview.detail)}</span>
    ${view.preview.isolation ? `<small>${escapeHtml(view.preview.isolation)}</small>` : ""}
    ${rows.length ? `<dl class="network-exposure-preview-rows">
      ${rows.map((row) => `<div>
        <dt>${escapeHtml(row.label)}</dt>
        <dd title="${escapeHtml(row.value)}">${escapeHtml(row.value)}</dd>
      </div>`).join("")}
    </dl>` : ""}
  `;
}

function renderNetworkExposureDialog({ renderPorts = true } = {}) {
  const item = selectedResource();
  const view = networkExposureViewForItem(item);
  $("#networkExposureSubtitle").textContent = item?.record?.id
    ? `${view.vmName} · 只允许当前选择的公网入口`
    : "选择已有本地记录的实例后管理端口。";
  $("#networkExposureFreshness").textContent = view.freshnessLabel;
  $("#networkExposureFreshness").className = `state-pill ${view.freshnessTone}`;
  $("#sshSecretStatus").textContent = view.secret.label;
  $("#sshPasswordHint").textContent = view.secret.hint;
  $("#sshPasswordField").hidden = view.secret.configured;
  $("#sshUnifiedPassword").disabled = view.secret.configured;
  $("#networkExposurePortEmpty").hidden = view.candidates.length > 0;
  $("#networkExposurePortEmpty").textContent = view.evidenceHint;
  if (renderPorts) {
    $("#networkExposurePublic22").checked = view.publicSsh22;
    const selectedKeys = new Set(view.selectedPortKeys);
    $("#networkExposurePortList").innerHTML = view.candidates.map((candidate) => `
      <label class="port-choice">
        <input type="checkbox"
          data-exposure-port
          data-protocol="${escapeHtml(candidate.protocol)}"
          data-port="${escapeHtml(candidate.port)}"
          ${selectedKeys.has(candidate.key) ? "checked" : ""}>
        <span>
          <strong>${escapeHtml(candidate.protocol.toUpperCase())} ${escapeHtml(candidate.port)}</strong>
          <small>${escapeHtml(candidate.process)} · ${candidate.selectedByDefault ? "节点服务" : "手动选择"}</small>
        </span>
      </label>
    `).join("");
  }
  renderNetworkExposurePreview(view);
  applyActionReadiness();
  const previewButton = $("#saveNetworkExposurePreview");
  const applyButton = $("#applyNetworkExposure");
  previewButton.textContent = view.previewActionLabel;
  previewButton.hidden = view.canApply;
  applyButton.hidden = !view.canApply;
  previewButton.disabled = !state.actionReadiness.saveNetworkExposurePreview?.enabled;
  applyButton.disabled = !state.actionReadiness.applyNetworkExposure?.enabled;
}

function openNetworkExposureDialog() {
  const item = selectedResourceForAction();
  if (!item?.record?.id) throw new Error("需要先接管为本地记录。");
  state.networkExposureRecordId = item.record.id;
  state.networkExposurePreview = item.record.observed?.networkExposurePreview || null;
  state.networkExposurePreviewDirty = false;
  $("#sshUnifiedPassword").value = "";
  renderNetworkExposureDialog();
  const dialog = $("#networkExposureDialog");
  if (typeof dialog.showModal === "function") dialog.showModal();
  else dialog.setAttribute("open", "");
}

function markNetworkExposureSelectionDirty() {
  if (!state.networkExposureRecordId) return;
  state.networkExposurePreview = null;
  state.networkExposurePreviewDirty = true;
  renderNetworkExposureDialog({ renderPorts: false });
}

function selectedNetworkExposurePorts() {
  return $$('[data-exposure-port]:checked').map((input) => ({
    protocol: input.dataset.protocol,
    port: input.dataset.port
  }));
}

async function saveNetworkExposurePreview() {
  const item = selectedResourceForAction();
  if (!item?.record?.id || item.record.id !== state.networkExposureRecordId) {
    throw new Error("实例选择已变化，请重新打开端口管理。");
  }
  if (!state.sshAuthStatus?.configured) {
    const passwordInput = $("#sshUnifiedPassword");
    const response = await api("/api/local-security/ssh-auth", {
      method: "PUT",
      body: { password: passwordInput.value }
    });
    state.sshAuthStatus = response.sshAuth;
    passwordInput.value = "";
  }
  const response = await api(`/api/vm-records/${encodeURIComponent(item.record.id)}/network-exposure/preview`, {
    method: "POST",
    body: {
      publicSsh22: $("#networkExposurePublic22").checked,
      ports: selectedNetworkExposurePorts()
    }
  });
  state.networkExposurePreview = response.preview;
  state.networkExposurePreviewDirty = false;
  item.record.observed = { ...(item.record.observed || {}), networkExposurePreview: response.preview };
  renderNetworkExposureDialog();
  const openCount = Array.isArray(response.preview?.changes?.open) ? response.preview.changes.open.length : 0;
  const closeCount = Array.isArray(response.preview?.changes?.close) ? response.preview.changes.close.length : 0;
  log(`端口策略预览已生成: 新增 ${openCount} / 关闭 ${closeCount}`);
  toast(response.preview?.coverage?.ready ? "端口策略预览已生成" : "预览已生成，但当前不可执行", response.preview?.coverage?.ready ? "success" : "warn");
  return response;
}

async function applyNetworkExposurePolicy() {
  const item = selectedResourceForAction();
  const preview = networkExposurePreviewForItem(item);
  const view = networkExposureViewForItem(item);
  if (!item?.record?.id || !preview?.fingerprint || !view.canApply) {
    throw new Error("端口策略预览不可执行，请重新生成预览。");
  }
  $("#networkExposureDialog").close();
  return runRecordTask({
    endpoint: "network-exposure/apply",
    label: "应用端口策略",
    body: { fingerprint: preview.fingerprint }
  });
}

function renderFirewallGovernance(item, fallbackStatus = null) {
  const group = $("#firewallGovernanceGroup");
  const rows = $("#firewallGovernanceRows");
  const tone = $("#firewallGovernanceTone");
  const button = $("#manageNetworkExposure");
  if (!group || !rows || !tone || !button) return;
  const governance = governanceForItem(item);
  const view = toFirewallGovernanceView(governance, { fallbackStatus });
  const canManage = Boolean(item?.record?.id);
  group.hidden = !view.visible && !canManage;
  const visibleRows = view.visible ? view.rows : [{
    label: "端口策略",
    value: "等待只读探测",
    detail: "读取监听端口后，可配置 SSH 双入口和实例级隔离"
  }];
  rows.innerHTML = visibleRows.map((row) => `
    <div>
      <dt>${escapeHtml(row.label)}</dt>
      <dd><strong>${escapeHtml(row.value)}</strong><small>${escapeHtml(row.detail)}</small></dd>
    </div>
  `).join("");
  tone.textContent = view.statusLabel || visibleRows[0]?.value || "待检查";
  tone.className = `state-pill ${view.tone === "danger" ? "error" : view.tone === "warning" ? "warning" : view.visible ? "running" : "draft"}`;
  button.hidden = !canManage;
}

function renderInstanceTechnicalDetails(item) {
  const resourceKey = item?.key || "";
  const selectionChanged = resourceKey !== technicalDetailsResourceKey;
  const moreAttributes = $("#technicalMoreAttributes");
  if (selectionChanged && moreAttributes) moreAttributes.open = false;
  if (selectionChanged) $("#manualDeploymentMethod").value = "auto";
  technicalDetailsResourceKey = resourceKey;

  const view = toInstanceTechnicalDetailsView({
    item,
    recognition: item ? fallbackRecognitionForItem(item) : null,
    recognitionPreview: item ? state.recognitionPreviews[item.key] || null : null,
    verification: item?.record?.verification || null
  });
  renderTechnicalSummaryRow($("#technicalRecognitionSummary"), view.recognition);
  renderTechnicalSummaryRow($("#technicalIssueSummary"), view.issue);
  renderTechnicalSummaryRow($("#technicalRecoverySummary"), view.recovery);

  const groups = new Map(view.attributeGroups.map((group) => [group.id, group.rows]));
  renderTechnicalFactRows($("#detailCoreFacts"), groups.get("basic") || []);
  renderTechnicalFactRows($("#detailNetworkFacts"), groups.get("network") || []);
  renderTechnicalFactRows($("#detailIdentityFacts"), groups.get("identity") || []);
  renderTechnicalEvidence(view.evidence);
  const fallbackFirewallStatus = item
    ? currentInstanceDetailView().statuses.find((status) => status.id === "firewall") || null
    : null;
  renderFirewallGovernance(item, fallbackFirewallStatus);

  const issueText = view.issue.count ? view.issue.value : view.issue.value === "尚未验证" ? "尚未验证" : "无待处理问题";
  $("#technicalDetailsSummary").textContent = `${view.recognition.value} · ${issueText} · ${view.recovery.value}`;
  const attributeCount = view.attributeGroups.reduce((total, group) => total + group.rows.length, 0);
  const governance = toFirewallGovernanceView(governanceForItem(item), { fallbackStatus: fallbackFirewallStatus });
  const governanceSummary = !governance.visible
    ? ""
    : governance.pending
      ? " · 防火墙治理待分析"
      : ` · ${governance.rows[0]?.value || "防火墙治理"}`;
  $("#technicalMoreAttributesSummary").textContent = `${attributeCount} 项属性 · ${view.evidence.length} 条脱敏证据${governanceSummary}`;
}

function renderDetail({ renderRelated = true, updateReadiness = true } = {}) {
  const item = selectedResource();
  const detailPanel = $(".detail-panel");
  if (!item) {
    detailPanel.classList.toggle("is-selected", false);
    $("#detailTitle").textContent = "未选择实例";
    $("#detailTitle").removeAttribute("title");
    $("#detailSubtitle").textContent = "选择资源后显示详情和操作。";
    $("#detailEmpty").hidden = false;
    $("#detailContent").hidden = true;
    $("#detailCoreFacts").innerHTML = "";
    $("#detailNetworkFacts").innerHTML = "";
    $("#detailIdentityFacts").innerHTML = "";
    renderInstanceTechnicalDetails(null);
    $("#detailOperations").hidden = true;
    $("#selectedVmSummary").textContent = "未选择实例。";
    $("#selectedVmFacts").innerHTML = "";
    $("#selectedVmEmpty").hidden = false;
    $("#detailStateBadge").textContent = "未选择";
    $("#detailStateBadge").className = "state-pill draft";
    updateDeployAction(null);
    renderInstanceNodeResult(null);
    renderInstanceDetailView(currentInstanceDetailView());
    if (renderRelated) {
      renderOverview();
      renderDiagnosticSummary();
      renderEvidenceTimeline();
    }
    if (updateReadiness) applyActionReadiness();
    return;
  }
  $("#detailTitle").textContent = item.identity.name;
  detailPanel.classList.toggle("is-selected", true);
  $("#detailTitle").title = item.identity.name;
  $("#detailSubtitle").textContent = `${item.identity.projectId} / ${item.identity.zone}`;
  const network = item.cloud?.network || item.record?.desired?.network || {};
  const publicIp = item.cloud?.network?.externalIp || item.record?.observed?.network?.externalIp || "未分配";
  const effectiveMethod = effectiveDeployMethodForItem(item);
  const facts = {
    来源: sourceLabel(item.source),
    状态: item.cloud?.status || item.record?.status || "draft",
    公网: publicIp,
    机器: item.cloud?.machineType || item.record?.desired?.machineType || "",
    系统: item.record?.desired?.image || "",
    模式: methodLabel(effectiveMethod),
    账号: item.identity.account,
    项目: item.identity.projectId,
    位置: item.identity.zone,
    网络: network.name || "default",
    子网: network.subnet || "default"
  };
  $("#detailEmpty").hidden = true;
  $("#detailContent").hidden = false;
  $("#detailOperations").hidden = false;
  $("#selectedVmSummary").textContent = `${item.identity.name} / ${facts.状态}`;
  renderFacts($("#selectedVmFacts"), {
    状态: facts.状态,
    公网: facts.公网,
    位置: facts.位置,
    模式: facts.模式
  });
  $("#selectedVmEmpty").hidden = true;
  $("#detailStateBadge").textContent = facts.状态;
  $("#detailStateBadge").className = `state-pill ${toneForStatus(facts.状态)}`;
  updateDeployAction(item);
  renderInstanceDetailView(currentInstanceDetailView());
  renderInstanceTechnicalDetails(item);
  renderInstanceNodeResult(item);
  if (renderRelated) {
    renderOverview();
    renderDiagnosticSummary();
    renderEvidenceTimeline();
  }
  if (updateReadiness) applyActionReadiness();
}

function selectedDeployMethod() {
  return $("input[name=\"deployMethod\"]:checked")?.value || "vm_only";
}

function splitList(value) {
  return String(value || "")
    .split(/[,\s]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseLabelsJson(value) {
  try {
    const parsed = JSON.parse(value || "{}");
    if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") throw new Error("labels must be an object");
    return Object.fromEntries(Object.entries(parsed).map(([key, labelValue]) => [key, String(labelValue)]));
  } catch {
    return { managed_by: "gcp-vm-console" };
  }
}

function hashText(text) {
  let hash = 2166136261;
  for (const char of String(text || "")) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function updateDeployFields() {
  const custom = selectedDeployMethod() === "custom_startup";
  $("#startupScriptField").hidden = !custom;
  $("#startupScript").disabled = !custom;
  updateNetworkProfileFields();
}

function networkFormInput() {
  return {
    name: $("#network").value || "default",
    subnet: $("#subnet").value || "default",
    externalIpMode: $("#externalIpMode").value,
    networkTier: $("#networkTier").value,
    nicType: $("#nicType").value,
    addressName: $("#staticAddressName").value
  };
}

function currentNetworkProfileView() {
  return toNetworkProfileView(networkFormInput(), {
    instanceName: $("#vmName").value,
    deployMethod: selectedDeployMethod()
  });
}

function configValidation() {
  const name = String($("#vmName")?.value || "").trim();
  if (!name) return { valid: false, reason: "需要填写实例名称。" };
  const view = currentNetworkProfileView();
  if (!view.valid) return { valid: false, reason: view.reason };
  if (!$("#configForm")?.checkValidity()) return { valid: false, reason: "请检查实例名称、端口和网络字段格式。" };
  return { valid: true, reason: "" };
}

function updateNetworkProfileFields({ deriveAddress = false } = {}) {
  const mode = $("#externalIpMode")?.value || "ephemeral";
  const addressField = $("#staticAddressField");
  const addressInput = $("#staticAddressName");
  const tier = $("#networkTier");
  if (!addressField || !addressInput || !tier) return;
  const isStatic = mode === "static";
  addressField.hidden = !isStatic;
  addressInput.disabled = !isStatic;
  tier.disabled = mode === "none";
  if (isStatic && (deriveAddress || !addressInput.value)) {
    const autoManaged = addressInput.dataset.auto !== "false" || !addressInput.value;
    if (autoManaged) {
      addressInput.value = deriveStaticAddressName($("#vmName").value);
      addressInput.dataset.auto = "true";
    }
  }
  const view = currentNetworkProfileView();
  addressInput.setCustomValidity(isStatic && !view.profile ? view.reason : "");
  const hint = $("#networkProfileHint");
  if (hint) {
    hint.textContent = view.valid ? view.hint : view.reason;
    hint.classList.toggle("is-warning", !view.valid || isStatic);
  }
}

function formDesired() {
  const deployMethod = selectedDeployMethod();
  const sshPort = Number($("#sshPort").value || 45400);
  const networkInput = {
    name: $("#network").value || "default",
    subnet: $("#subnet").value || "default",
    externalIpMode: $("#externalIpMode").value,
    networkTier: $("#networkTier").value,
    nicType: $("#nicType").value,
    addressName: $("#staticAddressName").value
  };
  const networkView = toNetworkProfileView(networkInput, {
    instanceName: $("#vmName").value,
    deployMethod
  });
  if (!networkView.valid) throw new Error(networkView.reason);
  return {
    machineType: $("#machineType").value,
    image: $("#image").value,
    disk: { sizeGb: Number($("#diskSize").value || 30), type: "pd-standard" },
    network: networkView.profile,
    labels: {
      ...parseLabelsJson($("#labelsJson").value),
      managed_by: "gcp-vm-console",
      gvc_managed: "true",
      gvc_deploy_method: selectedDeployMethod()
    },
    tags: splitList($("#networkTags").value || $("#vmName").value),
    metadata: {
      ...($("#startupScript").value ? { startupScriptHash: hashText($("#startupScript").value) } : {}),
      gvcRecordSchema: "1",
      gvcDeployMethod: selectedDeployMethod()
    },
    deploy: {
      method: deployMethod,
      configureSshPort: deployMethod !== "vm_only" && sshPort !== 22
    },
    ssh: {
      user: $("#sshUser").value || "y",
      keyFile: $("#sshKeyFile").value || "",
      port: sshPort
    }
  };
}

function formIdentity() {
  if (!contextReady()) throw new Error("先在总览页选择账号与项目。");
  return {
    configuration: state.context.configuration,
    account: state.context.account,
    projectId: state.context.projectId,
    zone: state.derivedZone,
    name: $("#vmName").value
  };
}

function renderConfigSummary() {
  const target = contextReady()
    ? `${state.context.projectId} / ${state.derivedZone || "-"} / ${$("#vmName").value || "-"}`
    : "先选择账号与项目";
  const deployMethod = selectedDeployMethod();
  const sshPort = Number($("#sshPort").value || 45400);
  const networkView = currentNetworkProfileView();
  const changes = [
    `${$("#machineType").value || "-"} / ${$("#image").value || "-"}`,
    `${$("#diskSize").value || "30"}GB pd-standard`,
    `部署方式：${methodLabel(deployMethod)}`,
    `网络：${$("#network").value || "default"} / ${$("#subnet").value || "default"} · ${networkView.summary}`
  ];
  if (networkView.profile?.addressName) changes.push(`静态地址：${networkView.profile.addressName}`);
  if (sshPort !== 22) {
    changes.push(deployMethod === "vm_only"
      ? `SSH：期望 ${sshPort}，只开实例不会自动修改 sshd`
      : `SSH：${sshPort}，节点部署时配置并保留 22 救援`);
  }
  if (deployMethod === "custom_startup") changes.push(`startup script: ${hashText($("#startupScript").value)}`);

  $("#executionTarget").textContent = target;
  $("#executionMode").textContent = $("#configMode").textContent || "新建实例";
  $("#executionChanges").innerHTML = changes.map((item) => `<li>${escapeHtml(item)}</li>`).join("");
  const baseRisk = deployMethod === "vm_only"
    ? "只开实例模式不会安装代理软件；生成预览只读取云端状态，不会创建或修改实例。"
    : "节点部署会在实例创建后运行远程安装流程，并按结果同步防火墙端口；执行前必须重新确认。";
  $("#executionRisk").textContent = `${baseRisk} ${networkView.valid ? networkView.hint : networkView.reason}`;
  $("#executionPreviewState").textContent = state.preview?.fingerprint
    ? `预览 ${state.preview.fingerprint.slice(0, 12)}`
    : "无有效预览";
  $("#executionPreviewState").className = `state-pill ${state.preview?.fingerprint ? "cloud" : "draft"}`;
  $("#savePreview").textContent = state.previewExecutable ? "查看并执行预览" : "保存并生成预览";
  updateDeployFields();
}

function invalidatePreview({ silent = false } = {}) {
  if (!state.preview) return;
  state.preview = null;
  state.previewExecutable = false;
  renderPreview();
  if (!silent) {
    toast("部署已修改，请重新生成预览", "warn");
    log("部署变更已使旧预览失效");
  }
}

function handleConfigInput(event) {
  if (event?.target?.id === "staticAddressName") event.target.dataset.auto = "false";
  if (event?.target?.id === "vmName" || event?.target?.id === "externalIpMode") {
    updateNetworkProfileFields({ deriveAddress: true });
  } else if (["networkTier", "nicType"].includes(event?.target?.id) || event?.target?.name === "deployMethod") {
    updateNetworkProfileFields();
  }
  invalidatePreview();
  renderConfigSummary();
  applyActionReadiness();
}

function fillConfigFromResource(item, clone = false) {
  if (!item) return;
  invalidatePreview({ silent: true });
  $("#vmName").value = clone ? `${item.identity.name}-copy` : item.identity.name;
  const region = regionFromZone(item.identity.zone);
  $("#region").value = region;
  updateDerivedZone(item.identity.zone);
  renderRegionHelper(state.derivedZone === item.identity.zone ? "" : `原 zone 不可用，已改用 ${state.derivedZone || "默认 zone"}`);
  $("#machineType").value = item.cloud?.machineType || item.record?.desired?.machineType || "e2-micro";
  $("#image").value = item.record?.desired?.image || "debian-cloud/debian-12";
  $("#diskSize").value = item.cloud?.disk?.sizeGb || item.record?.desired?.disk?.sizeGb || 30;
  const network = networkFromResource(item);
  $("#network").value = network.name || "default";
  $("#subnet").value = network.subnet || "default";
  $("#externalIpMode").value = ["ephemeral", "static", "none"].includes(network.externalIpMode) ? network.externalIpMode : "ephemeral";
  $("#networkTier").value = ["PREMIUM", "STANDARD"].includes(network.networkTier) ? network.networkTier : "PREMIUM";
  $("#nicType").value = ["GVNIC", "VIRTIO_NET"].includes(network.nicType) ? network.nicType : "VIRTIO_NET";
  $("#staticAddressName").value = clone && network.externalIpMode === "static"
    ? deriveStaticAddressName($("#vmName").value)
    : network.addressName || deriveStaticAddressName($("#vmName").value);
  $("#staticAddressName").dataset.auto = clone || !network.addressName ? "true" : "false";
  $("#networkTags").value = (item.record?.desired?.tags || [item.identity.name]).join(", ");
  $("#labelsJson").value = JSON.stringify(item.record?.desired?.labels || { managed_by: "gcp-vm-console" });
  $("#sshUser").value = item.record?.desired?.ssh?.user || "y";
  $("#sshKeyFile").value = item.record?.desired?.ssh?.keyFile || "";
  $("#sshPort").value = item.record?.desired?.ssh?.port || 45400;
  const method = clone ? "vm_only" : item.record?.desired?.deploy?.method || "vm_only";
  const radio = $(`input[name="deployMethod"][value="${method}"]`);
  if (radio) radio.checked = true;
  const mode = clone ? "基于已有实例新建" : item.record ? "编辑实例" : "接管云端实例";
  $("#configMode").textContent = mode;
  $("#configMode").className = `state-pill ${clone ? "cloud" : "draft"}`;
  updateNetworkProfileFields({ deriveAddress: clone });
  renderConfigSummary();
}

function networkFromResource(item) {
  return {
    ...(item.cloud?.network || {}),
    ...(item.record?.observed?.network || {}),
    ...(item.record?.desired?.network || {})
  };
}

function desiredFromResource(item) {
  return {
    machineType: item.cloud?.machineType || item.record?.desired?.machineType || "e2-micro",
    image: item.record?.desired?.image || "debian-cloud/debian-12",
    disk: item.cloud?.disk || item.record?.desired?.disk || { sizeGb: 30, type: "pd-standard" },
    network: networkFromResource(item),
    labels: item.record?.desired?.labels || { managed_by: "gcp-vm-console" },
    tags: item.record?.desired?.tags || [item.identity.name],
    metadata: item.record?.desired?.metadata || {},
    deploy: item.record?.desired?.deploy || { method: "vm_only" },
    ssh: item.record?.desired?.ssh || {
      user: $("#sshUser")?.value || "y",
      keyFile: $("#sshKeyFile")?.value || "",
      port: Number($("#sshPort")?.value || 45400)
    }
  };
}

async function saveDraft({ preview = false } = {}) {
  const validation = configValidation();
  if (!validation.valid) throw new Error(validation.reason);
  const body = {
    status: state.selectedRecordId ? "managed" : "draft",
    identity: formIdentity(),
    desired: formDesired()
  };
  const saved = await api("/api/vm-records", { method: "POST", body });
  state.selectedRecordId = saved.record.id;
  state.selectedKey = resourceKey(saved.record.identity);
  toast("草稿已保存", "success");
  log(`保存实例记录: ${saved.record.identity.name}`);
  if (preview) {
    const result = await api(`/api/vm-records/${encodeURIComponent(saved.record.id)}/preview`, { method: "POST", body: {} });
    state.preview = result.preview;
    state.previewExecutable = true;
    state.lastJob = { status: "PREVIEW", label: `预览 ${saved.record.identity.name}`, type: "preview" };
    state.lastJobAt = new Date();
    focusPreview();
    renderPreview();
    location.hash = "#tasks";
    showRoute("tasks");
    toast("已生成变更预览", "success");
  }
  await refreshResources();
}

function renderPreview() {
  const preview = state.preview;
  if (!preview) {
    $("#previewState").textContent = "无有效预览";
    $("#previewState").className = "state-pill draft";
    $("#previewPanel").textContent = "先在部署页生成预览。";
    state.previewExecutable = false;
    setTimelineStep("draft");
    renderTaskSummary();
    renderConfigSummary();
    applyActionReadiness();
    return;
  }
  $("#previewState").textContent = preview.fingerprint.slice(0, 12);
  $("#previewState").className = "state-pill cloud";
  const actions = Array.isArray(preview.actions) ? preview.actions : [];
  const actionLabels = {
    "ensure-static-address": "校验或保留静态 IPv4",
    "ensure-replacement-static-address": "为替换实例保留静态 IPv4",
    "create-vm": "创建实例",
    "create-replacement-vm": "创建替换实例"
  };
  const networkSummary = preview.networkPlan
    ? toNetworkProfileView(preview.networkPlan, { instanceName: preview.identity.name }).summary
    : "";
  $("#previewPanel").innerHTML = `
    <div class="preview-meta">
      <strong>${escapeHtml(preview.identity.name)}</strong>
      <code>${escapeHtml(preview.fingerprint)}</code>
    </div>
    ${networkSummary ? `<p class="preview-network-summary">${escapeHtml(networkSummary)}</p>` : ""}
    <ul>${actions.map((action) => `<li>${escapeHtml(actionLabels[action.id] || action.id)}</li>`).join("") || "<li>无变化</li>"}</ul>
  `;
  setTimelineStep("preview");
  renderTaskSummary();
  renderConfigSummary();
  applyActionReadiness();
}

function renderTaskHistory() {
  const body = $("#taskHistoryBody");
  const notice = $("#taskStorageNotice");
  $("#taskHistoryCount").textContent = `${state.jobs.length} 项`;
  if (notice) {
    const meta = state.jobStorage || {};
    const messages = [];
    if (Number(meta.recoveredInterrupted) > 0) messages.push(`${meta.recoveredInterrupted} 个未完成任务已标记为服务中断`);
    if (Number(meta.quarantined) > 0) messages.push(`${meta.quarantined} 个无法读取的历史文件已隔离`);
    if (Number(meta.degradedWrites) > 0) messages.push(`${meta.degradedWrites} 次任务结果未能持久保存`);
    if (Number(meta.quarantineFailures) > 0 || Number(meta.pruneFailures) > 0) messages.push("部分本地历史维护操作未完成");
    notice.hidden = messages.length === 0;
    notice.textContent = messages.join("；");
  }
  if (!state.jobs.length) {
    body.innerHTML = "<tr><td colspan=\"5\">暂无任务。</td></tr>";
    return;
  }
  body.innerHTML = state.jobs.map((job) => {
    const row = toTaskRow(job, state.records);
    const selected = row.id === selectedJob()?.id;
    return `
      <tr data-job-id="${escapeHtml(row.id)}" tabindex="0" ${selected ? "aria-selected=\"true\"" : ""}>
        <td><strong>${escapeHtml(row.typeLabel)}</strong></td>
        <td>${escapeHtml(row.vmName)}</td>
        <td><time>${escapeHtml(row.time)}</time></td>
        <td><span class="state-pill ${escapeHtml(row.statusTone)}">${escapeHtml(row.statusLabel)}</span></td>
        <td>${escapeHtml(row.duration)}</td>
      </tr>
    `;
  }).join("");
}

function renderJobSteps(job) {
  const steps = toTaskSteps(job);
  $("#taskTimeline").innerHTML = steps.map((step, index) => `
    <li data-task-step="${escapeHtml(step.name || `step-${index}`)}" class="${escapeHtml(step.status)}">
      <span>${index + 1}</span>
      <div><strong>${escapeHtml(step.label)}</strong><small>${escapeHtml(step.detail || step.status)}</small></div>
    </li>
  `).join("");
  $("#timelineState").textContent = toTaskRow(job, state.records).statusLabel;
  $("#timelineState").className = `state-pill ${toTaskRow(job, state.records).statusTone}`;
  $("#taskTimelineHint").textContent = taskTimelineHint(job);
}

function renderPreviewTimeline(step = "draft") {
  $("#taskTimeline").innerHTML = `
    <li data-task-step="draft"><span>1</span><div><strong>保存草稿</strong><small>本地记录</small></div></li>
    <li data-task-step="preview"><span>2</span><div><strong>生成预览</strong><small>校验指纹</small></div></li>
    <li data-task-step="run"><span>3</span><div><strong>执行变更</strong><small>等待确认</small></div></li>
    <li data-task-step="result"><span>4</span><div><strong>查看结果</strong><small>尚未执行</small></div></li>
  `;
  setTimelineStep(step);
  $("#taskTimelineHint").textContent = taskTimelineHint(null);
}

let taskDisclosureSelectionKey = "";

function syncTaskOutputDisclosures(key) {
  if (key === taskDisclosureSelectionKey) return;
  taskDisclosureSelectionKey = key;
  for (const id of ["taskDiagnosticsDetails", "taskArtifactsDetails"]) {
    const disclosure = document.getElementById(id);
    if (disclosure) disclosure.open = false;
  }
}

function renderTaskSummary() {
  const job = selectedJob();
  syncTaskOutputDisclosures(job?.id || (state.previewFocused ? "preview" : "empty"));
  if (!job) {
    const hasPreview = Boolean(state.preview?.fingerprint);
    const previewName = state.preview?.identity?.name || selectedResource()?.identity?.name || "-";
    renderFacts($("#taskSummary"), {
      实例: previewName,
      预览: hasPreview ? state.preview.fingerprint.slice(0, 12) : "无",
      状态: state.lastJob?.status ? taskStatusLabel(state.lastJob.status) : "等待操作"
    });
    $("#taskResult").innerHTML = hasPreview
      ? "<strong>预览已生成</strong><span>尚未执行云端变更；确认预览指纹后再继续。</span>"
      : "尚未选择任务。";
    $("#taskRecovery").textContent = hasPreview
      ? "当前只保存了本地记录和变更预览，没有创建、部署或修改云端实例。"
      : "选中验证或部署任务后显示恢复建议。";
    $("#currentTaskLabel").textContent = hasPreview
      ? `变更预览 / ${previewName}`
      : "当前会话输出，切换页面不会清空。";
    renderPreviewTimeline(hasPreview ? "preview" : "draft");
    renderTaskNodeResult(null);
    return;
  }
  const row = toTaskRow(job, state.records);
  const result = toTaskResult(job, {
    record: state.records.find((record) => record.id === job.recordId) || null
  });
  renderFacts($("#taskSummary"), {
    任务: row.typeLabel,
    实例: row.vmName,
    状态: row.statusLabel,
    耗时: row.duration
  });
  $("#taskResult").innerHTML = `
    <strong>${escapeHtml(result.statusLabel)}</strong>
    <span>${escapeHtml(result.summary)}</span>
    ${result.error ? `<details><summary>原始错误</summary><pre>${escapeHtml(result.error)}</pre></details>` : ""}
    ${result.storageWarning ? `<div class="task-storage-warning">${escapeHtml(result.storageWarning)}</div>` : ""}
    ${result.canRetry ? "<span class=\"state-pill cloud\">可重试</span>" : ""}
  `;
  renderRecoveryView($("#taskRecovery"), result.recovery);
  $("#currentTaskLabel").textContent = `${row.typeLabel} / ${row.vmName}`;
  renderJobSteps(job);
  renderTaskNodeResult(result.nodeResult);
}

function renderTaskWorkspace({ renderRelated = true } = {}) {
  renderTaskHistory();
  renderTaskSummary();
  if (renderRelated) {
    renderDiagnosticSummary();
    renderEvidenceTimeline();
  }
}

function handleDelegatedRowInteraction(event) {
  if (event.type === "keydown" && !["Enter", " "].includes(event.key)) return;
  const row = event.target?.closest?.("[data-resource-key], [data-job-id]");
  if (!row) return;
  if (event.type === "keydown") event.preventDefault();
  if (row.dataset.resourceKey) {
    state.selectedKey = row.dataset.resourceKey;
    state.selectedRecordId = selectedResource()?.record?.id || "";
    renderResources();
    return;
  }
  if (row.dataset.jobId) selectJob(row.dataset.jobId);
}

function setTimelineStep(step) {
  const order = ["draft", "preview", "run", "result"];
  const index = Math.max(0, order.indexOf(step));
  $$("#taskTimeline [data-task-step]").forEach((item) => {
    const itemIndex = order.indexOf(item.dataset.taskStep);
    item.classList.toggle("done", itemIndex < index);
    item.classList.toggle("active", itemIndex === index);
  });
  $("#timelineState").textContent = {
    draft: "等待预览",
    preview: "预览已生成",
    run: "执行中",
    result: "已完成"
  }[step] || "等待预览";
  $("#timelineState").className = `state-pill ${step === "result" ? "running" : step === "run" ? "cloud" : "draft"}`;
}

function nodeStatusTone(view) {
  if (view.firewall?.status === "failed") return "cloud";
  return view.statusTone || (view.empty ? "draft" : "running");
}

function nodeCopyButton(value, label = "复制") {
  if (!value) return "";
  return `<button class="secondary compact node-copy link-copy" type="button" data-copy-value="${escapeHtml(value)}" data-copy-link="${escapeHtml(value)}">${label}</button>`;
}

function renderNodePanelRows(panel) {
  if (!panel) return "";
  return `
    <div class="node-value-list node-panel">
      <div class="node-list-heading">
        <strong>${escapeHtml(panel.title)}</strong>
        ${panel.port ? `<span>端口 ${escapeHtml(panel.port)}</span>` : ""}
      </div>
      ${panel.rows.map((row) => `
        <div class="node-value-row">
          <span>${escapeHtml(row.label)}</span>
          <code class="node-value-code" title="${escapeHtml(row.value)}">${escapeHtml(row.value)}</code>
          ${nodeCopyButton(row.copyValue)}
        </div>
      `).join("")}
    </div>
  `;
}

function renderNodeLinkRows(links) {
  if (!links.length) return "<div class=\"muted-block\">没有节点链接。</div>";
  return `
    <div class="node-value-list link-list">
      ${links.map((link) => `
        <div class="node-value-row link-row">
          <div class="node-value-label">
            <strong>${escapeHtml(link.label)}</strong>
            <span>${escapeHtml(link.meta || "节点链接")}</span>
          </div>
          <code class="node-value-code" title="${escapeHtml(link.url)}">${escapeHtml(link.url)}</code>
          ${nodeCopyButton(link.copyValue, "复制链接")}
        </div>
      `).join("")}
    </div>
  `;
}

function renderNodeView(target, view, { showStatusStrip = true } = {}) {
  if (!target) return;
  const sshLabel = view.ssh?.label || "SSH 实际连接未知";
  target.innerHTML = `
    ${showStatusStrip ? `<div class="node-status-strip">
      <span class="state-pill cloud">${escapeHtml(view.methodLabel)}</span>
      <span class="state-pill ${view.bbr.tone}">${escapeHtml(view.bbr.label)}</span>
      <span class="state-pill ${view.firewall.tone}">${escapeHtml(view.firewall.label)}</span>
      <span class="state-pill ${view.ssh?.fallback ? "cloud" : view.ssh?.verified ? "running" : "draft"}">${escapeHtml(sshLabel)}</span>
    </div>` : ""}
    ${view.empty ? `<div class="node-empty">${escapeHtml(view.emptyMessage)}</div>` : ""}
    ${view.warnings.map((warning) => `<div class="node-warning">${escapeHtml(warning)}</div>`).join("")}
    ${renderNodePanelRows(view.panel)}
    ${view.empty ? "" : renderNodeLinkRows(view.links)}
  `;
}

let firewallTargetOverride = null;

function renderFirewallResult(firewall) {
  const target = firewallTargetOverride || $("#firewallResult");
  firewallTargetOverride = null;
  if (!target) return;
  const rules = Array.isArray(firewall?.rules) ? firewall.rules : [];
  if (!rules.length) {
    if (firewall?.status === "failed") {
      target.textContent = `${FIREWALL_FAILED_LABEL}：${firewall.error || "请在维护操作中重试同步"}`;
      return;
    }
    target.textContent = firewall?.status === "not_required"
      ? "此模式无需同步防火墙端口。"
      : "防火墙同步结果会在节点部署后显示。";
    return;
  }
  target.innerHTML = `
    <strong>${escapeHtml(firewall.label || (firewall.status === "failed" ? FIREWALL_FAILED_LABEL : "防火墙已同步"))}</strong>
    <div class="firewall-rule-list">
      ${rules.map((rule) => `
        <div class="firewall-rule-row">
          <span>${escapeHtml(rule.name || "-")}</span>
          <code>${escapeHtml(rule.protocol || "-")}:${escapeHtml((rule.ports || []).join(",") || "-")}</code>
          <small>${escapeHtml(rule.actionLabel || rule.action || "已同步")}</small>
          <small>目标标签：${escapeHtml((rule.targetTags || []).join(",") || "-")}</small>
          <small>来源：${escapeHtml((rule.sourceRanges || []).join(",") || "-")}</small>
        </div>
      `).join("")}
    </div>
  `;
}

function renderFirewallInto(target, firewall) {
  firewallTargetOverride = target;
  renderFirewallResult(firewall);
}

function renderTaskNodeResult(nodeResult) {
  const view = toNodeResultView(nodeResult, {
    deployMethod: nodeResult?.type || ""
  });
  $("#nodeState").textContent = view.statusLabel;
  $("#nodeState").className = `state-pill ${nodeStatusTone(view)}`;
  const artifactSummary = $("#taskArtifactsSummary");
  if (artifactSummary) {
    const parts = [];
    if (view.links.length) parts.push(`${view.links.length} 条节点链接`);
    if (view.panel) parts.push("面板信息");
    const firewallRuleCount = Array.isArray(view.firewall?.rules) ? view.firewall.rules.length : 0;
    if (firewallRuleCount) parts.push(`${firewallRuleCount} 条防火墙规则`);
    artifactSummary.textContent = parts.join(" · ") || view.emptyMessage || "暂无节点与防火墙结果";
  }
  renderNodeView($("#nodeResult"), view);
  renderFirewallResult(view.firewall);
}

function renderInstanceNodeResult(item) {
  const record = item?.record || null;
  const view = toNodeResultView(record?.nodeResult || null, {
    deployMethod: effectiveDeployMethodForItem(item),
    hasLocalRecord: Boolean(record?.id),
    sshConnection: record?.observed?.sshConnection || null
  });
  const resultTarget = $("#detailNodeResult");
  const firewallTarget = $("#detailFirewallResult");
  const stateNode = $("#detailNodeState");
  const isLowValueVmOnly = view.methodLabel === "只开实例" && !view.links.length && !view.panel && !view.warnings.length;
  if (stateNode) {
    stateNode.textContent = view.statusLabel;
    stateNode.className = `state-pill ${nodeStatusTone(view)}`;
    stateNode.hidden = (view.empty && !view.warnings.length) || isLowValueVmOnly;
  }
  const hasNodeDetail = !isLowValueVmOnly && (!view.empty || view.warnings.length || view.links.length || view.panel);
  if (resultTarget) resultTarget.hidden = !hasNodeDetail;
  if (hasNodeDetail) renderNodeView(resultTarget, view, { showStatusStrip: false });
  const hasFirewallDetail = !view.empty && view.firewall?.status && !["unknown", "not_required"].includes(view.firewall.status);
  if (firewallTarget) firewallTarget.hidden = !hasFirewallDetail;
  if (hasFirewallDetail) renderFirewallInto(firewallTarget, view.firewall);
  renderWarpEgress(item);
}

let warpEgressResourceKey = "";

function warpEgressViewForItem(item) {
  return toWarpEgressView(item?.record || {});
}

function formatWarpEvidenceTime(view) {
  if (!view?.checkedAt) return "显式检测后显示证据时间";
  const date = new Date(view.checkedAt);
  const checked = Number.isNaN(date.getTime())
    ? view.checkedAt
    : date.toLocaleString(getLocaleTag(), { hour12: false });
  return `${view.freshnessLabel} · ${checked}`;
}

function renderWarpEgressDialog(item, view = warpEgressViewForItem(item)) {
  const dialog = $("#warpEgressDialog");
  if (!dialog || !item || !view.visible) return;
  $("#warpEgressSubtitle").textContent = `${item.identity.name} · ${view.tierLabel} · 手动检测更新`;
  $("#warpEgressState").textContent = view.statusLabel;
  $("#warpEgressState").className = `state-pill ${view.statusTone}`;
  $("#warpIpv4").textContent = view.ipv4;
  $("#warpIpv6").textContent = view.ipv6;
  $("#warpProtocol").textContent = `${view.protocolLabel} · ${view.tierLabel}`;
  $("#warpProxyPort").textContent = view.proxyPort ? `127.0.0.1:${view.proxyPort}` : "未确认";
  $("#warpColo").textContent = view.coloLabel;
  $("#warpCheckedAt").textContent = formatWarpEvidenceTime(view);
  $("#warpAffectedCount").textContent = `${view.affectedCount} 个`;
  $("#warpAffectedNodes").textContent = view.affectedNames.length
    ? view.affectedNames.join(" · ")
    : "尚未识别使用 WARP 的节点。";

  const attemptMessage = view.latestAttemptMessage
    || (!view.supported && view.capabilityReason ? `暂不可管理：${view.capabilityReason}` : "");
  const attempt = $("#warpLatestAttempt");
  attempt.hidden = !attemptMessage;
  attempt.textContent = attemptMessage;
  const result = $("#warpReconnectResult");
  result.hidden = !view.resultMessage;
  result.textContent = view.resultMessage;
  $("#reconnectWarpEgress").textContent = view.reconnectLabel;
}

function renderWarpEgress(item) {
  const row = $("#warpEgressRow");
  if (!row) return;
  const view = warpEgressViewForItem(item);
  row.hidden = !view.visible;
  if (!view.visible) {
    if ($("#warpEgressDialog")?.open) $("#warpEgressDialog").close();
    warpEgressResourceKey = "";
    return;
  }

  $("#warpEgressRowState").textContent = view.statusLabel;
  $("#warpEgressRowState").className = `state-pill ${view.statusTone}`;
  $("#warpEgressRowValue").textContent = view.summary;
  $("#warpEgressRowTime").textContent = formatWarpEvidenceTime(view);

  const dialog = $("#warpEgressDialog");
  if (dialog?.open && warpEgressResourceKey && warpEgressResourceKey !== item.key) {
    dialog.close();
    return;
  }
  if (dialog?.open) renderWarpEgressDialog(item, view);
}

function openWarpEgressDialog() {
  const item = selectedResourceForAction();
  const view = warpEgressViewForItem(item);
  if (!item?.record?.id) throw new Error("需要先接管为本地记录。");
  if (!view.visible) throw new Error("当前实例没有可管理的 WARP 节点或服务证据。");
  warpEgressResourceKey = item.key;
  renderWarpEgressDialog(item, view);
  const dialog = $("#warpEgressDialog");
  if (typeof dialog.showModal === "function") dialog.showModal();
  else dialog.setAttribute("open", "");
}

function updateSelectedWarpState(recordId, warp) {
  const item = selectedResourceForAction();
  if (!item?.record?.id || item.record.id !== recordId) {
    throw new Error("实例选择已变化，请重新打开 WARP 管理。");
  }
  item.record.observed = { ...(item.record.observed || {}), warp };
  return item;
}

async function refreshWarpStatus() {
  const item = selectedResourceForAction();
  if (!item?.record?.id || item.key !== warpEgressResourceKey) {
    throw new Error("实例选择已变化，请重新打开 WARP 管理。");
  }
  const response = await api(`/api/vm-records/${encodeURIComponent(item.record.id)}/warp/status`, {
    method: "POST",
    body: {}
  });
  updateSelectedWarpState(item.record.id, response.warp);
  const view = warpEgressViewForItem(item);
  log(`WARP 检测完成: ${view.statusLabel} / IPv4 ${view.ipv4}`);
  toast(view.latestAttemptMessage ? "WARP 检测失败，已保留上次结果" : "WARP 状态已更新", view.latestAttemptMessage ? "warn" : "success");
  renderDetail({ renderRelated: false });
  return response;
}

async function reconnectWarpEgress() {
  const item = selectedResourceForAction();
  if (!item?.record?.id || item.key !== warpEgressResourceKey) {
    throw new Error("实例选择已变化，请重新打开 WARP 管理。");
  }
  const response = await api(`/api/vm-records/${encodeURIComponent(item.record.id)}/warp/reconnect`, {
    method: "POST",
    body: {}
  });
  const job = response.job;
  state.lastJob = { ...job, label: "重连 WARP 出口" };
  state.lastJobAt = new Date();
  rememberJob(job);
  if (job?.result?.warp) updateSelectedWarpState(item.record.id, job.result.warp);
  const view = warpEgressViewForItem(item);
  log(`WARP 重连完成: ${job?.result?.outcome || job?.status || "未知"} / IPv4 ${view.ipv4}`);
  toast(view.resultMessage || "WARP 重连已结束", job?.status === "partial" ? "warn" : "success");
  renderTaskWorkspace({ renderRelated: false });
  renderOverview();
  renderDetail({ renderRelated: false });
  return response;
}

function recoveryTone(severity) {
  if (severity === "ok") return "running";
  if (severity === "critical") return "error";
  if (severity === "warning") return "cloud";
  return "draft";
}

function renderRecoveryView(target, recovery) {
  if (!target || !recovery) return;
  const actions = Array.isArray(recovery.actions) ? recovery.actions : [];
  const evidence = Array.isArray(recovery.evidence) ? recovery.evidence : [];
  target.innerHTML = `
    <div class="recovery-head">
      <span class="state-pill ${recoveryTone(recovery.severity)}">${escapeHtml(recovery.headline || "恢复建议")}</span>
      ${recovery.nodeLinksStillUsable ? "<span class=\"state-pill running\">链接保留</span>" : ""}
    </div>
    <p>${escapeHtml(recovery.explanation || "暂无恢复建议。")}</p>
    <div class="recovery-action-list">
      ${actions.map((item) => `
        <div class="recovery-action-row">
          <strong>${escapeHtml(item.label)}</strong>
          <span>${escapeHtml(item.detail || "")}</span>
          <small>${escapeHtml(item.kind === "guided_write" ? "需确认" : "只读")}</small>
        </div>
      `).join("")}
    </div>
    ${evidence.length ? `
      <div class="recovery-evidence">
        ${evidence.map((row) => `<span><strong>${escapeHtml(row.label)}</strong>${escapeHtml(row.value)}</span>`).join("")}
      </div>
    ` : ""}
  `;
}

async function executePreview() {
  if (!state.selectedRecordId || !state.preview?.fingerprint) {
    toast("没有可执行的有效预览", "warn");
    return;
  }
  try {
    setTimelineStep("run");
    state.previewExecutable = false;
    $("#executePreview").disabled = true;
    const result = await api(`/api/vm-records/${encodeURIComponent(state.selectedRecordId)}/execute`, {
      method: "POST",
      body: { previewFingerprint: state.preview.fingerprint, idempotencyKey: `ui-${Date.now()}` }
    });
    state.lastJob = { ...result.job, label: `执行 ${state.preview.identity.name}` };
    rememberJob(result.job);
    state.lastJobAt = new Date();
    $("#previewState").textContent = result.job.status;
    $("#previewState").className = `state-pill ${toneForStatus(result.job.status)}`;
    log(`执行完成: ${result.job.status}`);
    toast("任务已完成", "success");
    setTimelineStep("result");
    renderTaskWorkspace();
    renderOverview();
    await refreshResources();
    await loadJobs().catch((error) => log(`任务历史读取失败: ${error.message}`));
  } catch (error) {
    if (error.body?.job) rememberJob(error.body.job);
    log(`执行失败: ${error.message}`);
    state.previewExecutable = true;
    setTimelineStep("preview");
    throw error;
  }
}

async function ensureSelectedRecord() {
  const item = selectedResource();
  if (!item) throw new Error("请先选择一台实例。");
  if (item.record?.id) return item.record.id;
  const saved = await api("/api/vm-records", {
    method: "POST",
    body: {
      status: item.cloud ? "cloud" : "draft",
      identity: item.identity,
      desired: desiredFromResource(item),
      observed: item.cloud || null
    }
  });
  state.selectedRecordId = saved.record.id;
  log(`已为 ${saved.record.identity.name} 建立本地记录`);
  await refreshResources();
  return saved.record.id;
}

async function runRecordTask({ endpoint, label, body = {} }) {
  const recordId = await ensureSelectedRecord();
  log(`开始任务: ${label}`);
  const result = await api(`/api/vm-records/${encodeURIComponent(recordId)}/${endpoint}`, { method: "POST", body });
  state.lastJob = { ...result.job, label };
  state.lastJobAt = new Date();
  rememberJob(result.job);
  if (result.job?.result?.nodeResult) renderTaskNodeResult(result.job.result.nodeResult);
  log(`${label}: ${result.job?.status || "完成"}`);
  toast(result.job?.status === "partial" ? `${label}部分完成` : `${label}完成`, result.job?.status === "partial" ? "warn" : "success");
  renderTaskWorkspace();
  renderOverview();
  await refreshResources();
  renderInstanceNodeResult(selectedResource());
  await loadJobs().catch((error) => log(`任务历史读取失败: ${error.message}`));
  location.hash = "#tasks";
  showRoute("tasks");
  return true;
}

async function recognizeSelectedInstance() {
  const item = selectedResourceForAction();
  if (!item) throw new Error("请先选择一台实例。");
  if (!item.cloud) throw new Error("当前选择没有云端实例，无法执行外部识别。");
  const response = await api("/api/cloud-instances/adoption-preview", {
    method: "POST",
    body: {
      identity: item.identity,
      ssh: desiredFromResource(item).ssh
    }
  });
  state.recognitionPreviews[item.key] = {
    ...response,
    checkedAt: new Date().toISOString()
  };
  log(`部署识别完成: ${response.recognition.method} / ${response.recognition.confidence}`);
  renderResources();
  renderInstanceTechnicalDetails(selectedResource());
  applyActionReadiness();
  toast("识别完成", "success");
  return response;
}

async function adoptSelectedInstance() {
  const item = selectedResourceForAction();
  if (!item) throw new Error("请先选择一台实例。");
  if (!item.cloud) throw new Error("当前选择没有云端实例。");
  if (item.record?.id) throw new Error("当前实例已有本地记录，无需接管。");
  const preview = state.recognitionPreviews[item.key] || await recognizeSelectedInstance();
  const manualMethod = $("#manualDeploymentMethod").value;
  const userConfirmedMethod = manualMethod && manualMethod !== "auto" ? manualMethod : undefined;
  const response = await api("/api/cloud-instances/adopt-local", {
    method: "POST",
    body: {
      identity: item.identity,
      desired: {
        ...desiredFromResource(item),
        deploy: {
          ...desiredFromResource(item).deploy,
          method: userConfirmedMethod || preview.recognition.method
        }
      },
      recognition: preview.recognition,
      userConfirmedMethod
    }
  });
  state.selectedRecordId = response.record.id;
  log(`已接管为本地记录: ${response.record.identity.name} / ${response.record.desired.deploy.method}`);
  toast("已写入本地接管记录", "success");
  await refreshResources();
  state.selectedKey = resourceKey(response.record.identity);
  renderResources();
  return response;
}

async function smartDiagnoseSelectedInstance() {
  const item = selectedResourceForAction();
  if (!item) throw new Error("请先选择一台实例。");
  if (item.record?.id) {
    return runRecordTask({
      endpoint: "verify",
      label: "智能诊断"
    });
  }
  if (item.cloud) {
    return recognizeSelectedInstance();
  }
  throw new Error("当前选择缺少本地记录和云端实例，无法诊断。");
}

function openRoute(route) {
  location.hash = `#${route}`;
  showRoute(route);
}

function prepareNewConfig() {
  state.selectedRecordId = "";
  invalidatePreview({ silent: true });
  $("#configForm").reset();
  $("#externalIpMode").value = NETWORK_PROFILE_RECOMMENDED.externalIpMode;
  $("#networkTier").value = NETWORK_PROFILE_RECOMMENDED.networkTier;
  $("#nicType").value = NETWORK_PROFILE_RECOMMENDED.nicType;
  $("#staticAddressName").dataset.auto = "true";
  $("#staticAddressName").value = deriveStaticAddressName($("#vmName").value);
  updateNetworkProfileFields({ deriveAddress: true });
  updateDerivedZone();
  renderRegionHelper();
  $("#configMode").textContent = "新建实例";
  $("#configMode").className = "state-pill draft";
  renderConfigSummary();
  openRoute("config");
}

function bindEvents() {
  window.addEventListener("hashchange", () => showRoute());
  document.addEventListener("click", handleDelegatedRowInteraction);
  document.addEventListener("keydown", handleDelegatedRowInteraction);
  $("#reloadAccounts").addEventListener("click", (event) => withBusyButton(event.currentTarget, async () => {
    try {
      await loadAccounts();
    } catch (error) {
      handleAccountLoadFailure(error);
      throw error;
    }
    toast("账号与项目已重新读取", "success");
  }, "正在读取本机 gcloud 配置"));
  $("#accountSelect").addEventListener("change", () => {
    updatePendingContextFromSelects({ projectId: "" });
    loadProjects().catch((error) => {
      toast(error.message, "error");
      log(`项目读取失败: ${error.message}`);
    });
  });
  $("#projectSelect").addEventListener("change", () => {
    updatePendingContextFromSelects();
    renderContext();
  });
  $("#useContext").addEventListener("click", (event) => withBusyButton(event.currentTarget, useSelectedContext, "正在切换项目"));
  $("#doctorRunBtn").addEventListener("click", (event) => withBusyButton(event.currentTarget, () => loadDoctor("manual"), "正在运行只读体检"));
  $("#refreshAll").addEventListener("click", (event) => withBusyButton(event.currentTarget, async () => {
    const result = await refreshAllContext();
    toast(result?.degraded ? "部分数据读取失败，请查看任务日志" : "数据已刷新", result?.degraded ? "warn" : "success");
  }, "正在刷新数据"));
  $("#refreshResources").addEventListener("click", (event) => withBusyButton(event.currentTarget, async () => {
    const result = await refreshResources();
    toast(result?.degraded ? "部分资源读取失败，请查看任务日志" : "实例清单已刷新", result?.degraded ? "warn" : "success");
  }, "正在读取实例清单"));
  $("#resourceSearch").addEventListener("input", () => renderResources({ renderRelated: false }));
  $("#openConfig").addEventListener("click", prepareNewConfig);
  $("#mainAction").addEventListener("click", () => {
    if (!contextReady()) {
      $("#accountSelect").focus();
      toast("请先选择账号与项目", "warn");
      return;
    }
    openRoute("resources");
  });
  $("#switchVm").addEventListener("click", () => openRoute("resources"));
  $("#openTasks").addEventListener("click", () => openRoute("tasks"));
  $("#copyDiagnosticSummary").addEventListener("click", (event) => withBusyButton(event.currentTarget, copyDiagnosticSummary, "正在复制诊断摘要"));
  $("#manualDeploymentMethod").addEventListener("change", () => {
    applyActionReadiness();
  });
  $("#smartDiagnoseInstance").addEventListener("click", (event) => withBusyButton(event.currentTarget, smartDiagnoseSelectedInstance, "正在执行智能诊断"));
  $("#showNodeResults").addEventListener("click", () => {
    const details = $("#nodeResultsDetails");
    details.open = true;
    details.scrollIntoView({ block: "nearest" });
    details.querySelector("summary")?.focus();
  });
  $("#manageWarpEgress").addEventListener("click", () => {
    try {
      openWarpEgressDialog();
    } catch (error) {
      toast(error.message, "error");
    }
  });
  $("#refreshWarpStatus").addEventListener("click", (event) => withBusyButton(
    event.currentTarget,
    refreshWarpStatus,
    "正在检测 WARP 出口"
  ));
  $("#reconnectWarpEgress").addEventListener("click", (event) => withBusyButton(
    event.currentTarget,
    reconnectWarpEgress,
    "正在执行一次 WARP 重连",
    { context: actionContextFor("reconnectWarpEgress") }
  ));
  $("#warpEgressDialog").addEventListener("close", () => {
    warpEgressResourceKey = "";
  });
  matchMedia("(max-width: 767px)").addEventListener("change", syncInstanceActionDisclosures);
  $("#adoptLocalInstance").addEventListener("click", (event) => withBusyButton(event.currentTarget, adoptSelectedInstance, "正在写入本地接管记录"));
  $("#manageNetworkExposure").addEventListener("click", () => {
    try {
      openNetworkExposureDialog();
    } catch (error) {
      toast(error.message, "error");
    }
  });
  $("#networkExposurePublic22").addEventListener("change", markNetworkExposureSelectionDirty);
  $("#networkExposurePortList").addEventListener("change", (event) => {
    if (event.target.matches("[data-exposure-port]")) markNetworkExposureSelectionDirty();
  });
  $("#sshUnifiedPassword").addEventListener("input", () => {
    applyActionReadiness();
    const view = networkExposureViewForItem(selectedResource());
    $("#saveNetworkExposurePreview").textContent = view.previewActionLabel;
    $("#saveNetworkExposurePreview").disabled = !state.actionReadiness.saveNetworkExposurePreview?.enabled;
  });
  $("#networkExposureDialog").addEventListener("close", () => {
    $("#sshUnifiedPassword").value = "";
    state.networkExposurePreview = null;
    state.networkExposureRecordId = "";
    state.networkExposurePreviewDirty = false;
    applyActionReadiness();
  });
  $("#saveNetworkExposurePreview").addEventListener("click", (event) => withBusyButton(
    event.currentTarget,
    saveNetworkExposurePreview,
    "正在生成端口与 SSH 预览"
  ));
  $("#applyNetworkExposure").addEventListener("click", (event) => withBusyButton(
    event.currentTarget,
    applyNetworkExposurePolicy,
    "正在应用端口与 SSH 策略",
    { context: actionContextFor("applyNetworkExposure") }
  ));
  $("#detailPrimary").addEventListener("click", () => {
    fillConfigFromResource(selectedResource());
    openRoute("config");
  });
  $("#cloneVm").addEventListener("click", () => {
    state.selectedRecordId = "";
    fillConfigFromResource(selectedResource(), true);
    openRoute("config");
  });
  $("#saveDraft").addEventListener("click", (event) => withBusyButton(event.currentTarget, () => saveDraft(), "正在保存本地草稿"));
  $("#savePreview").addEventListener("click", (event) => withBusyButton(event.currentTarget, async () => {
    if (state.preview && state.previewExecutable) {
      openRoute("tasks");
      $("#executePreview").focus();
      toast("预览仍有效，可在任务页执行", "success");
      return;
    }
    await saveDraft({ preview: true });
  }, "正在读取云端状态并生成预览"));
  $("#executePreview").addEventListener("click", (event) => withBusyButton(event.currentTarget, executePreview, "正在执行已验证预览"));
  $("#clearLog").addEventListener("click", (event) => withBusyButton(event.currentTarget, async () => {
    $("#logOutput").textContent = "";
    toast("本地日志视图已清空");
  }));
  document.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-copy-value], [data-copy-link]");
    if (!button) return;
    const copyValue = button.dataset.copyValue || button.dataset.copyLink || "";
    try {
      await navigator.clipboard.writeText(copyValue);
      toast("已复制", "success");
    } catch {
      toast("复制失败，请展开内容后手动复制", "error");
    }
  });
  $("#auditFreeRules").addEventListener("click", (event) => withBusyButton(event.currentTarget, calibrateFreeRules, "正在校对官方免费规则"));
  $("#deleteLocalRecord").addEventListener("click", (event) => withBusyButton(event.currentTarget, async () => {
    if (!state.selectedRecordId) return toast("当前选择没有本地记录", "warn");
    await api(`/api/vm-records/${encodeURIComponent(state.selectedRecordId)}`, { method: "DELETE" });
    state.selectedRecordId = "";
    state.selectedKey = "";
    await refreshResources();
    toast("本地记录已移除", "success");
  }));
  $("#deleteCloudResource").addEventListener("click", () => {
    toast("云端删除流程当前未开放，不会执行任何云端删除。", "warn");
  });
  $("#restartVm").addEventListener("click", (event) => withBusyButton(event.currentTarget, () => runRecordTask({
    endpoint: "maintenance/restart",
    label: "重启实例"
  })));
  $("#systemUpdate").addEventListener("click", (event) => withBusyButton(event.currentTarget, () => runRecordTask({
    endpoint: "maintenance/system-update",
    label: "系统更新"
  })));
  $("#deployNodes").addEventListener("click", (event) => withBusyButton(event.currentTarget, () => runRecordTask({
    endpoint: "nodes/deploy",
    label: deployActionLabel(selectedResource()?.record?.desired?.deploy?.method || "vm_only")
  })));
  $("#region").addEventListener("change", () => {
    updateDerivedZone();
    renderRegionHelper();
    handleConfigInput();
  });
  $("#zoneChoice").addEventListener("change", () => {
    const zone = $("#zoneChoice");
    state.derivedZone = zone.value;
    renderRegionHelper();
    handleConfigInput();
  });
  $$("#configForm input, #configForm select, #configForm textarea").forEach((node) => node.addEventListener("input", handleConfigInput));
}

async function boot() {
  renderStaticOptions();
  renderConfigSummary();
  renderTaskWorkspace({ renderRelated: false });
  renderResources({ renderRelated: false });
  renderPreview();
  renderContext();
  renderDiagnosticSummary();
  renderEvidenceTimeline();
  bindEvents();
  showRoute();
  let health;
  try {
    health = await api("/api/health");
  } catch (error) {
    state.serviceReady = false;
    $("#serviceState").textContent = "本地服务不可用";
    $("#serviceState").className = "state-pill error";
    setSyncState("本地服务不可用", "error");
    toast(`服务不可用: ${error.message}`, "error");
    log(`服务不可用: ${error.message}`);
    return;
  }
  state.serviceReady = true;
  $("#serviceState").textContent = "本地服务正常";
  $("#serviceState").className = "state-pill running";
  setSyncState("等待选择上下文");
  log(`服务模式: ${health.mode || "unknown"}`);
  await Promise.all([
    loadJobs().catch((error) => log(`任务历史读取失败: ${error.message}`)),
    loadSshAuthStatus().catch((error) => log(`本地 SSH 密码状态读取失败: ${error.message}`)),
    loadAccounts({ preferDefault: true }).catch((error) => handleAccountLoadFailure(error))
  ]);
  if (shouldAutoApplyPreferredContext()) {
    await useSelectedContext().catch((error) => {
      setSyncState("默认项目自动切换失败", "warn");
      log(`默认项目自动切换失败: ${error.message}`);
    });
  }
}

boot();
