import { policyForAction } from "./action-policy.js";

export const ACTION_BUTTON_IDS = Object.freeze([
  "auditFreeRules",
  "clearLog",
  "cloneVm",
  "deleteCloudResource",
  "deleteLocalRecord",
  "deployNodes",
  "detailPrimary",
  "doctorRunBtn",
  "executePreview",
  "adoptLocalInstance",
  "manageWarpEgress",
  "refreshWarpStatus",
  "reconnectWarpEgress",
  "manageNetworkExposure",
  "saveNetworkExposurePreview",
  "applyNetworkExposure",
  "mainAction",
  "openConfig",
  "openTasks",
  "refreshAll",
  "refreshResources",
  "reloadAccounts",
  "restartVm",
  "saveDraft",
  "savePreview",
  "showNodeResults",
  "switchVm",
  "smartDiagnoseInstance",
  "systemUpdate",
  "useContext",
  "copyDiagnosticSummary"
]);

const DEPLOY_LABELS = {
  vm_only: "无需部署节点",
  singbox_plus: "部署 Sing-Box-Plus",
  three_x_ui: "部署 3X-UI",
  custom_startup: "运行自定义脚本"
};

const NODE_DEPLOY_METHODS = new Set(["singbox_plus", "three_x_ui", "custom_startup"]);
const LIVE_INVENTORY_ACTIONS = new Set([
  "openConfig",
  "detailPrimary",
  "cloneVm",
  "savePreview",
  "executePreview",
  "restartVm",
  "systemUpdate",
  "deployNodes",
  "manageNetworkExposure",
  "saveNetworkExposurePreview",
  "applyNetworkExposure",
  "reconnectWarpEgress"
]);

export function supportsNodeDeployment(method = "") {
  return NODE_DEPLOY_METHODS.has(String(method || ""));
}

function governed(id) {
  try {
    const policy = policyForAction(id);
    return { kind: policy.kind, confirmation: policy.confirmation };
  } catch {
    return { kind: "route", confirmation: "none" };
  }
}

function item(id, label, enabled, reason = "", override = {}) {
  return {
    id,
    label,
    enabled: Boolean(enabled),
    reason: enabled ? "" : String(reason || "当前状态不可用。"),
    ...governed(id),
    ...override
  };
}

export function toActionReadiness(input = {}) {
  const contextReady = Boolean(input.contextReady);
  const serviceReady = input.serviceReady !== false;
  const selected = Boolean(input.selected);
  const hasLocalRecord = Boolean(input.hasLocalRecord);
  const hasCloudInstance = Boolean(input.hasCloudInstance);
  const recognitionReady = Boolean(input.recognitionReady);
  const hasRecognitionResult = Boolean(input.hasRecognitionResult);
  const hasVerificationResult = Boolean(input.hasVerificationResult);
  const accountSelected = Boolean(input.accountSelected);
  const projectSelected = Boolean(input.projectSelected);
  const deployMethod = input.deployMethod || "vm_only";
  const observedDeployMethod = input.observedDeployMethod || deployMethod;
  const previewExecutable = Boolean(input.previewExecutable);
  const configValid = input.configValid !== false;
  const configInvalidReason = String(input.configInvalidReason || "部署配置无效。");
  const inventoryLive = input.inventoryLive !== false;
  const hasFreshPortEvidence = Boolean(input.hasFreshPortEvidence);
  const networkExposurePasswordReady = Boolean(input.networkExposurePasswordReady);
  const networkExposurePreviewReady = Boolean(input.networkExposurePreviewReady);
  const hasNodeResult = Boolean(input.hasNodeResult);
  const hasWarpCandidate = Boolean(input.hasWarpCandidate);
  const warpSupported = Boolean(input.warpSupported);
  const warpStatus = String(input.warpStatus || "unknown");
  const warpLastOutcome = String(input.warpLastOutcome || "");
  const warpReconnectReady = input.warpReconnectReady !== false;
  const hasVerifiedSsh = Boolean(input.hasVerifiedSsh);
  const needsContext = "需要先在总览选择并切换账号与项目。";
  const needsSelected = "需要先在实例页选择一台实例。";
  const serviceReason = "本地控制台服务未连接。";
  const hasObservedNodeMethod = observedDeployMethod && observedDeployMethod !== "vm_only" && observedDeployMethod !== "unmanaged_unknown";
  const deployNodesApplicable = supportsNodeDeployment(deployMethod);
  const deployNodesLabel = deployNodesApplicable
    ? DEPLOY_LABELS[deployMethod]
    : deployMethod === "vm_only"
      ? (hasObservedNodeMethod ? "部署方式需确认" : "无需部署节点")
      : "节点部署不适用";
  const deployNodesReason = !hasLocalRecord
    ? "需要先接管为本地记录，再执行节点部署。"
    : deployMethod === "vm_only" && hasObservedNodeMethod
      ? "本地配置仍是只开实例；如需重新部署，请进入部署页选择部署方式并生成预览。"
      : deployMethod === "vm_only"
        ? "只开实例模式不安装代理软件，无需部署节点。"
        : !deployNodesApplicable
          ? "当前部署方式没有可自动执行的节点流水线，请先修改部署方式。"
          : (selected ? needsContext : needsSelected);
  const doctorWarning = ["warning", "blocked"].includes(input.doctorSummary?.status)
    ? input.doctorSummary.title || "环境体检有项目需要注意。"
    : "";
  const withDoctorWarning = (model) => (
    model.enabled && model.kind === "write" && doctorWarning
      ? { ...model, reason: doctorWarning }
      : model
  );
  const withInventoryGate = (model) => (
    !inventoryLive && LIVE_INVENTORY_ACTIONS.has(model.id)
      ? { ...model, enabled: false, reason: "当前为缓存清单，请先恢复实时连接。" }
      : model
  );

  const view = {
    reloadAccounts: item("reloadAccounts", "重新读取", serviceReady, serviceReason),
    useContext: item(
      "useContext",
      "切换到此项目",
      serviceReady && accountSelected && projectSelected,
      accountSelected ? "需要选择可用项目。" : "需要选择 gcloud 配置。"
    ),
    refreshAll: item("refreshAll", "刷新数据", serviceReady && contextReady, serviceReady ? needsContext : serviceReason),
    doctorRunBtn: item("doctorRunBtn", "运行体检", serviceReady && contextReady, serviceReady ? needsContext : serviceReason),
    openConfig: item("openConfig", "新建实例", serviceReady && contextReady, serviceReady ? needsContext : serviceReason),
    mainAction: item("mainAction", contextReady ? (selected ? "查看当前实例" : "打开实例清单") : "选择账号与项目", true, "", { kind: "route" }),
    switchVm: item("switchVm", "打开实例清单", contextReady, needsContext, { kind: "route" }),
    openTasks: item("openTasks", "查看任务", true, "", { kind: "route" }),
    refreshResources: item("refreshResources", "刷新清单", serviceReady && contextReady, serviceReady ? needsContext : serviceReason),
    detailPrimary: item(
      "detailPrimary",
      hasLocalRecord ? "修改部署" : "设置部署",
      contextReady && selected,
      selected ? needsContext : needsSelected,
      { kind: "route" }
    ),
    cloneVm: item("cloneVm", "基于此新建", contextReady && selected, selected ? needsContext : needsSelected, { kind: "route" }),
    smartDiagnoseInstance: item(
      "smartDiagnoseInstance",
      hasRecognitionResult || hasVerificationResult ? "重新探测" : "运行只读探测",
      contextReady && selected && (hasLocalRecord || hasCloudInstance),
      selected
        ? (hasLocalRecord || hasCloudInstance ? needsContext : "当前选择缺少本地记录和云端实例。")
        : needsSelected
    ),
    adoptLocalInstance: item(
      "adoptLocalInstance",
      "接管本地",
      contextReady && selected && hasCloudInstance && !hasLocalRecord && recognitionReady,
      hasLocalRecord
        ? "当前实例已有本地记录，无需接管。"
        : hasCloudInstance
          ? (recognitionReady ? needsContext : "需要先识别部署方式。")
          : "当前选择没有云端实例。"
    ),
    manageNetworkExposure: item(
      "manageNetworkExposure",
      "管理端口与 SSH",
      contextReady && selected && hasLocalRecord,
      !hasLocalRecord ? "需要先接管为本地记录。" : selected ? needsContext : needsSelected,
      { kind: "route", confirmation: "none" }
    ),
    saveNetworkExposurePreview: item(
      "saveNetworkExposurePreview",
      "生成端口预览",
      contextReady && selected && hasLocalRecord && hasFreshPortEvidence && networkExposurePasswordReady,
      !hasLocalRecord
        ? "需要先接管为本地记录。"
        : !hasFreshPortEvidence
          ? "监听证据已过期，请先运行只读探测。"
          : !networkExposurePasswordReady
            ? "首次使用需要输入本地统一 SSH 密码。"
          : needsContext,
      { kind: "local-sensitive-write", confirmation: "none" }
    ),
    applyNetworkExposure: item(
      "applyNetworkExposure",
      "应用端口策略",
      contextReady && selected && hasLocalRecord && networkExposurePreviewReady,
      !hasLocalRecord
        ? "需要先接管为本地记录。"
        : !networkExposurePreviewReady
          ? "需要先生成有效的端口策略预览。"
          : needsContext
    ),
    restartVm: item("restartVm", "重启实例", contextReady && selected, selected ? needsContext : needsSelected),
    systemUpdate: item("systemUpdate", "系统更新", contextReady && selected, selected ? needsContext : needsSelected),
    deployNodes: item(
      "deployNodes",
      deployNodesLabel,
      contextReady && selected && hasLocalRecord && deployNodesApplicable,
      deployNodesReason
    ),
    deleteLocalRecord: item(
      "deleteLocalRecord",
      "移除本地记录",
      contextReady && selected && hasLocalRecord,
      hasLocalRecord ? needsSelected : "当前选择没有本地记录。"
    ),
    deleteCloudResource: item("deleteCloudResource", "删除云端资源", false, "云端删除流程当前未开放。", { kind: "danger", confirmation: "typed" }),
    saveDraft: item(
      "saveDraft",
      "保存草稿",
      serviceReady && contextReady && configValid,
      !serviceReady ? serviceReason : !contextReady ? needsContext : configInvalidReason
    ),
    savePreview: item(
      "savePreview",
      previewExecutable ? "查看并执行预览" : "保存并生成预览",
      serviceReady && contextReady && configValid,
      !serviceReady ? serviceReason : !contextReady ? needsContext : configInvalidReason
    ),
    executePreview: item(
      "executePreview",
      "执行有效预览",
      serviceReady && contextReady && previewExecutable,
      previewExecutable ? needsContext : "需要先在部署页保存并生成有效预览。"
    ),
    showNodeResults: item(
      "showNodeResults",
      "查看节点结果",
      selected && hasNodeResult,
      selected ? "当前实例还没有节点结果。" : needsSelected,
      { kind: "route", confirmation: "none" }
    ),
    manageWarpEgress: item(
      "manageWarpEgress",
      "管理",
      contextReady && selected && hasLocalRecord && hasWarpCandidate,
      !hasLocalRecord
        ? "需要先接管为本地记录。"
        : !hasWarpCandidate
          ? "当前实例没有 WARP 节点或服务证据。"
          : selected ? needsContext : needsSelected,
      { kind: "route", confirmation: "none" }
    ),
    refreshWarpStatus: item(
      "refreshWarpStatus",
      "重新检测",
      contextReady && selected && hasLocalRecord && hasWarpCandidate && hasVerifiedSsh,
      !hasLocalRecord
        ? "需要先接管为本地记录。"
        : !hasWarpCandidate
          ? "当前实例没有 WARP 节点或服务证据。"
          : !hasVerifiedSsh
            ? "需要先确认可用的密钥 SSH 路径。"
            : selected ? needsContext : needsSelected
    ),
    reconnectWarpEgress: item(
      "reconnectWarpEgress",
      warpStatus === "disconnected"
        ? "恢复 WARP 连接"
        : warpLastOutcome === "unchanged"
          ? "再试一次"
          : "重连并尝试换 IP",
      contextReady && selected && hasLocalRecord && hasWarpCandidate && hasVerifiedSsh
        && warpSupported && warpReconnectReady && ["connected", "degraded", "disconnected"].includes(warpStatus),
      !hasLocalRecord
        ? "需要先接管为本地记录。"
        : !hasVerifiedSsh
          ? "需要先确认可用的密钥 SSH 路径。"
          : !warpSupported || !["connected", "degraded", "disconnected"].includes(warpStatus)
            ? "WARP 实时状态未确认，请先重新检测。"
            : !warpReconnectReady
              ? "最近检测失败，请先重新检测 WARP 状态。"
            : selected ? needsContext : needsSelected
    ),
    clearLog: item("clearLog", "清空", true),
    copyDiagnosticSummary: item("copyDiagnosticSummary", "复制摘要", true),
    auditFreeRules: item("auditFreeRules", "更新规则提示", serviceReady && contextReady, serviceReady ? needsContext : serviceReason)
  };

  return Object.fromEntries(ACTION_BUTTON_IDS.map((id) => [id, withInventoryGate(withDoctorWarning(view[id]))]));
}
