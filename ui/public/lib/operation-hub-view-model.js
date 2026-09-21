import { supportsNodeDeployment } from "./action-readiness-view-model.js";

const GLOBAL_GROUP_DEFS = Object.freeze([
  Object.freeze({ id: "setup", title: "准备", actionIds: Object.freeze(["reloadAccounts", "useContext", "refreshAll", "refreshResources", "mainAction", "switchVm", "openConfig"]) }),
  Object.freeze({ id: "diagnose", title: "诊断", actionIds: Object.freeze(["smartDiagnoseInstance", "adoptLocalInstance", "doctorRunBtn", "auditFreeRules", "copyDiagnosticSummary"]) }),
  Object.freeze({ id: "operate", title: "维护", actionIds: Object.freeze(["restartVm", "systemUpdate"]) }),
  Object.freeze({ id: "deploy", title: "部署", actionIds: Object.freeze(["detailPrimary", "cloneVm", "deployNodes", "saveDraft", "savePreview", "executePreview"]) }),
  Object.freeze({ id: "danger", title: "危险操作", actionIds: Object.freeze(["deleteLocalRecord", "deleteCloudResource"]) })
]);

const INSTANCE_GROUP_DEFS = Object.freeze([
  Object.freeze({ id: "configure", title: "配置操作", actionIds: Object.freeze(["detailPrimary", "cloneVm", "deployNodes"]) }),
  Object.freeze({ id: "diagnose", title: "智能诊断", actionIds: Object.freeze(["smartDiagnoseInstance", "adoptLocalInstance"]) }),
  Object.freeze({ id: "maintain", title: "维护操作", actionIds: Object.freeze(["restartVm", "systemUpdate"]) }),
  Object.freeze({ id: "danger", title: "危险操作", actionIds: Object.freeze(["deleteLocalRecord", "deleteCloudResource"]) })
]);

function actionFrom(readiness = {}, id, fallbackLabel = id) {
  const action = readiness[id] || {};
  return {
    id,
    label: action.label || fallbackLabel,
    enabled: Boolean(action.enabled),
    reason: action.reason || "",
    kind: action.kind || "route",
    confirmation: action.confirmation || "none"
  };
}

function presentActions(readiness, ids, hiddenLowPriorityIds) {
  return ids
    .filter((id) => readiness[id] && !hiddenLowPriorityIds.includes(id))
    .map((id) => actionFrom(readiness, id));
}

function firstEnabled(readiness, ids) {
  const id = ids.find((candidate) => readiness[candidate]?.enabled);
  return id ? actionFrom(readiness, id) : null;
}

function primaryFor(input, hiddenLowPriorityIds) {
  const readiness = input.actionReadiness || {};
  if (!input.contextReady) {
    const action = actionFrom(readiness, "mainAction", "选择账号与项目");
    return { actionId: action.id, label: action.label, reason: action.reason || "先完成账号与项目上下文。" };
  }
  if (input.doctorStatus === "blocked" && readiness.doctorRunBtn?.enabled) {
    const action = actionFrom(readiness, "doctorRunBtn", "运行体检");
    return { actionId: action.id, label: action.label, reason: "环境体检阻塞时先处理诊断。" };
  }
  const selectedPrimary = firstEnabled(readiness, ["deployNodes", "detailPrimary", "smartDiagnoseInstance", "switchVm"]);
  if (selectedPrimary && !hiddenLowPriorityIds.includes(selectedPrimary.id)) {
    return { actionId: selectedPrimary.id, label: selectedPrimary.label, reason: selectedPrimary.reason || "当前上下文的下一步主操作。" };
  }
  const fallback = firstEnabled(readiness, ["openConfig", "mainAction", "refreshAll"]) || actionFrom(readiness, "mainAction", "选择账号与项目");
  return { actionId: fallback.id, label: fallback.label, reason: fallback.reason || "继续完成当前流程。" };
}

function hiddenLowPriority(input) {
  const readiness = input.actionReadiness || {};
  const hidden = [];
  if (readiness.refreshResources && readiness.refreshAll) hidden.push("refreshResources");
  if (
    input.selected
    && readiness.deployNodes
    && (!input.hasLocalRecord || !supportsNodeDeployment(input.deployMethod))
  ) hidden.push("deployNodes");
  if (input.selected && readiness.adoptLocalInstance && !readiness.adoptLocalInstance.enabled) hidden.push("adoptLocalInstance");
  return hidden;
}

export function toOperationHint(input = {}) {
  const recommendation = input.recommendation || {};
  const actionId = recommendation.actionId || "";
  const action = input.actionReadiness?.[actionId] || null;
  if (!actionId || !action || action.enabled || !action.reason) {
    return { visible: false, text: "" };
  }
  return {
    visible: true,
    text: `${action.label || recommendation.title || "当前操作"}：${action.reason}`
  };
}

export function toOperationHub(input = {}) {
  const readiness = input.actionReadiness || {};
  const hiddenLowPriorityIds = hiddenLowPriority(input);
  const groupDefs = input.selected ? INSTANCE_GROUP_DEFS : GLOBAL_GROUP_DEFS;
  const groups = groupDefs.map((group) => ({
    id: group.id,
    title: group.title,
    actions: presentActions(readiness, group.actionIds, hiddenLowPriorityIds)
  })).filter((group) => group.actions.length || group.id === "setup");

  return {
    primary: primaryFor(input, hiddenLowPriorityIds),
    groups,
    hiddenLowPriorityIds
  };
}
