const rows = [
  ["refreshAll", "刷新数据", "global", "refresh", "global-toolbar", ["GET /api/vm-records", "GET /api/cloud-instances", "GET /api/regions", "GET /api/free-rules", "GET /api/doctor"], "read", "high"],
  ["openConfig", "新建实例", "global", "create-instance", "global-toolbar", [], "route", "high"],
  ["reloadAccounts", "重新读取", "overview", "refresh-context", "account-project", ["GET /api/accounts", "GET /api/projects"], "read", "medium"],
  ["useContext", "切换到此项目", "overview", "apply-context", "account-project", ["GET /api/vm-records", "GET /api/cloud-instances", "GET /api/regions", "GET /api/free-rules", "GET /api/doctor"], "read", "high"],
  ["doctorRunBtn", "运行体检", "overview", "diagnose", "doctor", ["GET /api/doctor"], "read", "high"],
  ["switchVm", "打开实例清单", "overview", "navigate", "selected-instance", [], "route", "medium"],
  ["mainAction", "选择账号与项目", "overview", "navigate", "next-action", [], "route", "high"],
  ["openTasks", "查看任务", "overview", "navigate", "recent-task", [], "route", "medium"],
  ["auditFreeRules", "更新规则提示", "overview", "diagnose", "cost-rules", ["POST /api/free-rules/calibrate"], "local-write", "low"],
  ["refreshResources", "刷新清单", "resources", "refresh", "inventory", ["GET /api/vm-records", "GET /api/cloud-instances", "GET /api/doctor"], "read", "medium"],
  ["smartDiagnoseInstance", "运行只读探测 / 重新探测", "resources", "diagnose", "diagnostics", ["POST /api/cloud-instances/adoption-preview", "POST /api/vm-records/:id/verify"], "read-local-write", "high"],
  ["adoptLocalInstance", "接管本地", "resources", "adopt-local", "recognition", ["POST /api/cloud-instances/adopt-local"], "local-write", "high"],
  ["manageNetworkExposure", "管理端口与 SSH", "resources", "open-network-exposure", "network-governance", [], "route", "medium"],
  ["saveNetworkExposurePreview", "生成端口预览", "resources", "preview-network-exposure", "network-exposure-dialog", ["PUT /api/local-security/ssh-auth", "POST /api/vm-records/:id/network-exposure/preview"], "local-sensitive-write", "high"],
  ["applyNetworkExposure", "应用端口策略", "resources", "apply-network-exposure", "network-exposure-dialog", ["POST /api/vm-records/:id/network-exposure/apply"], "cloud-write", "high"],
  ["detailPrimary", "设置部署 / 修改部署", "resources", "reuse-instance", "configuration", [], "route", "high"],
  ["cloneVm", "基于此新建", "resources", "reuse-instance", "configuration", [], "route", "medium"],
  ["deployNodes", "部署指定节点方式", "resources", "deploy-node", "configuration", ["POST /api/vm-records/:id/nodes/deploy"], "cloud-write", "high"],
  ["restartVm", "重启实例", "resources", "restart-instance", "maintenance", ["POST /api/vm-records/:id/maintenance/restart"], "cloud-write", "medium"],
  ["systemUpdate", "系统更新", "resources", "system-update", "maintenance", ["POST /api/vm-records/:id/maintenance/system-update"], "cloud-write", "medium"],
  ["showNodeResults", "查看节点结果", "resources", "view-node-results", "node-results", [], "route", "medium"],
  ["manageWarpEgress", "管理 WARP 出口", "resources", "manage-warp", "warp-egress", [], "route", "medium"],
  ["refreshWarpStatus", "重新检测 WARP 出口", "resources", "refresh-warp", "warp-egress", ["POST /api/vm-records/:id/warp/status"], "read-local-write", "medium"],
  ["reconnectWarpEgress", "重连 WARP 出口", "resources", "reconnect-warp", "warp-egress", ["POST /api/vm-records/:id/warp/reconnect"], "cloud-write", "high"],
  ["deleteLocalRecord", "移除本地记录", "resources", "local-danger", "danger", ["DELETE /api/vm-records/:id"], "local-danger", "low"],
  ["deleteCloudResource", "删除云端资源", "resources", "cloud-danger-disabled", "danger", [], "disabled", "low"],
  ["saveDraft", "保存草稿", "config", "save-draft", "deployment-form", ["POST /api/vm-records"], "local-write", "medium"],
  ["savePreview", "保存并生成预览", "config", "preview", "deployment-form", ["POST /api/vm-records", "POST /api/vm-records/:id/preview"], "read-local-write", "high"],
  ["executePreview", "执行有效预览", "tasks", "execute-preview", "preview-result", ["POST /api/vm-records/:id/execute"], "cloud-write", "high"],
  ["clearLog", "清空", "tasks", "local-view", "logs", [], "read", "low"],
  ["copyDiagnosticSummary", "复制摘要", "tasks", "diagnose", "diagnostics", [], "read", "medium"]
];

const ROUTE_OR_REGISTRY_POLICY_SCOPES = new Set([
  "route",
  "read",
  "local-write",
  "read-local-write",
  "local-sensitive-write",
  "local-danger",
  "disabled"
]);

function freezeRow([id, label, page, intent, surface, apiRefs, writeScope, priority]) {
  return Object.freeze({
    id,
    label,
    page,
    group: surface,
    intent,
    surface,
    apiRefs: Object.freeze([...apiRefs]),
    writeScope,
    priority
  });
}

export const FUNCTION_INTENTS = Object.freeze(rows.map(freezeRow));

export const ACTION_INTENT_GROUPS = Object.freeze(
  FUNCTION_INTENTS.reduce((groups, item) => {
    const next = groups;
    next[item.intent] = Object.freeze([...(next[item.intent] || []), item.id]);
    return next;
  }, {})
);

function templateToNeedle(path) {
  return String(path || "").replace(/^[A-Z]+\s+/, "").replace(":id", "");
}

function hasHandlerReference(source, id) {
  const patterns = [
    `#${id}`,
    `getElementById("${id}"`,
    `$("${id}"`,
    `$("#${id}"`
  ];
  return patterns.some((pattern) => source.includes(pattern));
}

function apiRefCovered(source, apiPaths, apiRef) {
  if (!apiRef) return true;
  const path = String(apiRef).replace(/^[A-Z]+\s+/, "");
  if (apiPaths.includes(path)) return true;
  const dynamicSuffix = path.split("/:id/")[1];
  if (dynamicSuffix && (
    source.includes(`"${dynamicSuffix}"`)
    || source.includes(`/${dynamicSuffix}`)
  )) return true;
  return source.includes(templateToNeedle(path));
}

export function findDuplicateIntents(functions = FUNCTION_INTENTS) {
  const groups = new Map();
  for (const item of functions) {
    groups.set(item.intent, [...(groups.get(item.intent) || []), item]);
  }
  return [...groups.entries()]
    .filter(([, items]) => items.length > 1)
    .map(([intent, items]) => Object.freeze({ intent, ids: Object.freeze(items.map((item) => item.id)) }));
}

export function coverageRows({
  buttonIds = [],
  apiPaths = [],
  readinessIds = [],
  policyIds = [],
  handlerRefs = ""
} = {}) {
  return FUNCTION_INTENTS.map((item) => {
    const hasButton = buttonIds.includes(item.id);
    const hasReadiness = readinessIds.includes(item.id);
    const hasPolicy = policyIds.includes(item.id) || ROUTE_OR_REGISTRY_POLICY_SCOPES.has(item.writeScope);
    const hasHandler = hasHandlerReference(handlerRefs, item.id);
    const hasApis = item.apiRefs.every((apiRef) => apiRefCovered(handlerRefs, apiPaths, apiRef));
    const missing = [];
    if (!hasButton) missing.push("button");
    if (!hasReadiness) missing.push("readiness");
    if (!hasPolicy) missing.push("policy");
    if (!hasHandler) missing.push("handler");
    if (!hasApis) missing.push("api");
    return Object.freeze({
      ...item,
      hasButton,
      hasReadiness,
      hasPolicy,
      hasHandler,
      hasApis,
      missing: Object.freeze(missing),
      coverage: missing.length === 0 ? "ok" : "missing"
    });
  });
}
