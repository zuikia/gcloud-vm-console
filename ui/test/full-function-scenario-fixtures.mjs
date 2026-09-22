import { policyForAction } from "../public/lib/action-policy.js";
import { ACTION_BUTTON_IDS, toActionReadiness } from "../public/lib/action-readiness-view-model.js";
import { toDiagnosticSummary } from "../public/lib/diagnostic-summary-view-model.js";
import { FUNCTION_INTENTS } from "../public/lib/function-integrity-registry.js";
import { toInstanceDetailView } from "../public/lib/instance-detail-view-model.js";
import { toOperationGuidance } from "../public/lib/operation-guidance-view-model.js";
import { toOperationHub } from "../public/lib/operation-hub-view-model.js";
import { toOperationScenario } from "../public/lib/operation-scenario-view-model.js";
import { toTaskResult } from "../public/lib/task-view-model.js";
import { API_FLOW_REGISTRY } from "../server/api-flow-registry.js";

const BASE_CONTEXT = Object.freeze({
  configuration: "default",
  account: "user@example.com",
  projectId: "example-project"
});

const BASE_VM = Object.freeze({
  name: "console-instance",
  zone: "us-west1-b",
  externalIp: "203.0.113.8"
});

function actionInput(overrides = {}) {
  return {
    serviceReady: true,
    contextReady: true,
    accountSelected: true,
    projectSelected: true,
    selected: false,
    hasLocalRecord: false,
    hasCloudInstance: false,
    instanceStatus: "RUNNING",
    recognitionReady: false,
    deployMethod: "vm_only",
    previewExecutable: false,
    ...overrides
  };
}

function doctorView(status = "passed") {
  if (status === "blocked") {
    return {
      status,
      title: "项目访问失败",
      issues: [{
        label: "项目",
        status: "blocked",
        reason: "项目访问失败或实例清单同步失败。",
        actionRef: "doctorRunBtn",
        actionLabel: "运行体检"
      }]
    };
  }
  if (status === "warning") {
    return {
      status,
      title: "环境体检有提示",
      issues: [{ label: "验证", status: "warning", reason: "最近一次验证部分通过。" }]
    };
  }
  return { status, title: "环境体检通过", issues: [] };
}

function taskJob(overrides = {}) {
  return {
    id: "job-1",
    type: "verification",
    status: "succeeded",
    result: null,
    createdAt: "2026-07-08T09:00:00.000Z",
    updatedAt: "2026-07-08T09:00:01.000Z",
    ...overrides
  };
}

function cloudWritesWithoutConfirmation() {
  const missingActionPolicy = FUNCTION_INTENTS
    .filter((item) => item.writeScope === "cloud-write")
    .filter((item) => {
      try {
        return !["confirm", "typed"].includes(policyForAction(item.id).confirmation);
      } catch {
        return true;
      }
    })
    .map((item) => item.id);
  const missingApiConfirmation = API_FLOW_REGISTRY
    .filter((flow) => flow.writeScope === "cloud-write" && !["confirm", "typed"].includes(flow.confirmation))
    .map((flow) => `${flow.method} ${flow.path}`);
  return [...missingActionPolicy, ...missingApiConfirmation];
}

function enabledPreventableThrows(actions) {
  return actions
    .filter((action) => action.enabled && /需要先|未开放|不可用|没有本地记录/.test(action.reason || ""))
    .map((action) => action.id);
}

function rawSecretLeaks(parts) {
  const text = parts.filter(Boolean).join("\n");
  const leaks = [];
  if (/(?:vless|vmess|hy2|hysteria2|tuic|trojan|ss):\/\/(?!\[redacted-link\])\S+/i.test(text)) leaks.push("raw-node-link");
  if (/(password|token|secret|private[_-]?key)=((?!\[redacted\])\S+)/i.test(text)) leaks.push("raw-secret-param");
  if (/super-secret-token|raw-panel-password|uuid-secret/i.test(text)) leaks.push("known-secret-fixture");
  return leaks;
}

function toDetailItem(selectedVm, readiness, nodeResult, verification) {
  if (!selectedVm) return null;
  const identity = {
    name: selectedVm.name || BASE_VM.name,
    zone: selectedVm.zone || BASE_VM.zone,
    projectId: selectedVm.projectId || BASE_CONTEXT.projectId,
    account: selectedVm.account || BASE_CONTEXT.account
  };
  const effectiveNodeResult = nodeResult || selectedVm.nodeResult || null;
  const effectiveVerification = verification || selectedVm.verification || null;
  return {
    key: `${identity.projectId}/${identity.zone}/${identity.name}`,
    source: readiness.hasLocalRecord ? "managed" : "cloud",
    identity,
    cloud: readiness.hasCloudInstance
      ? {
          status: selectedVm.status || "RUNNING",
          network: { externalIp: selectedVm.externalIp || "" }
        }
      : null,
    record: readiness.hasLocalRecord
      ? {
          id: `record-${identity.name}`,
          status: "managed",
          desired: { deploy: { method: readiness.deployMethod || "vm_only" } },
          observed: selectedVm.observed || {},
          nodeResult: effectiveNodeResult,
          verification: effectiveVerification
        }
      : null
  };
}

function scenario({
  id,
  name,
  readiness = {},
  route = "resources",
  selectedVm = null,
  selectedJob = null,
  nodeResult = null,
  verification = null,
  doctorStatus = "passed",
  clipboardDenied = false,
  expectedRecommendationAction = "",
  expectedAutoOpenGroup = ""
}) {
  const recognition = selectedJob?.result?.recognition || null;
  const readinessInput = actionInput({
    ...readiness,
    hasNodeResult: Boolean(nodeResult || selectedVm?.nodeResult),
    hasVerificationResult: Boolean(verification || selectedVm?.verification),
    hasRecognitionResult: Boolean(recognition),
    observedDeployMethod: recognition?.method || readiness.observedDeployMethod || readiness.deployMethod
  });
  const actionReadiness = toActionReadiness(readinessInput);
  const doctor = doctorView(doctorStatus);
  const taskResult = toTaskResult(selectedJob || taskJob({ result: nodeResult || verification ? { nodeResult, verification } : null }));
  const operationScenario = toOperationScenario({
    route,
    contextReady: readiness.contextReady !== false,
    selectedVm,
    actionReadiness,
    doctorView: doctor,
    previewExecutable: Boolean(readiness.previewExecutable),
    recentJob: selectedJob
  });
  const guidance = toOperationGuidance({
    route,
    contextReady: readiness.contextReady !== false,
    selectedVm,
    actionReadiness,
    doctorView: doctor,
    previewExecutable: Boolean(readiness.previewExecutable),
    recentJob: selectedJob
  });
  const hub = toOperationHub({
    contextReady: readiness.contextReady !== false,
    selected: Boolean(readiness.selected),
    hasCloudInstance: Boolean(readiness.hasCloudInstance),
    doctorStatus,
    actionReadiness
  });
  const diagnostic = toDiagnosticSummary({
    context: BASE_CONTEXT,
    selectedVm,
    doctorView: doctor,
    selectedJob,
    nodeResult,
    verification,
    recognition
  });
  const instanceDetail = toInstanceDetailView({
    item: toDetailItem(selectedVm, readinessInput, nodeResult, verification),
    recognitionPreview: recognition
      ? { checkedAt: selectedJob?.updatedAt || "", recognition }
      : null,
    actionReadiness,
    now: "2026-07-10T12:00:00.000Z"
  });
  const actions = ACTION_BUTTON_IDS.map((actionId) => actionReadiness[actionId]).filter(Boolean);

  return {
    id,
    name,
    actions,
    operationScenario,
    guidance,
    hub,
    taskResult,
    diagnostic,
    instanceDetail,
    expectedRecommendationAction,
    expectedAutoOpenGroup,
    clipboardDenied,
    cloudWritesWithoutConfirmation: cloudWritesWithoutConfirmation(),
    preventableThrows: enabledPreventableThrows(actions),
    rawSecretsLeaked: rawSecretLeaks([
      operationScenario.headline,
      operationScenario.detail,
      guidance.headline,
      guidance.detail,
      hub.primary?.label,
      hub.primary?.reason,
      taskResult.summary,
      diagnostic.text,
      JSON.stringify(instanceDetail)
    ])
  };
}

export function buildFullFunctionScenarioMatrix() {
  const singboxNodeResult = {
    type: "singbox_plus",
    bbr: true,
    links: [{ type: "vless", value: "vless://uuid-secret@example.com:443?password=raw-panel-password" }]
  };
  const threeXUiNodeResult = {
    type: "three_x_ui",
    links: [],
    panel: { url: "http://203.0.113.8:2053/login?token=super-secret-token" }
  };
  const partialVerification = {
    status: "partial",
    checks: [{ id: "ssh", label: "SSH", status: "passed" }, { id: "service", label: "服务", status: "failed" }]
  };
  const failedVerification = {
    status: "failed",
    checks: [
      { id: "ssh", label: "SSH", status: "failed", detail: "SSH 连接失败" },
      { id: "service", label: "服务", status: "failed", detail: "目标服务未运行" }
    ]
  };
  const completeVerification = (checkedAt) => ({
    status: "passed",
    checkedAt,
    method: "singbox_plus",
    ssh: { desiredPort: 45400, actualPort: 45400, verified: true, fallback: false },
    bbr: { enabled: true },
    firewall: { status: "overexposed", broadRuleNames: ["ruzhan1"] },
    services: [{ name: "sing-box", status: "active" }],
    checks: []
  });

  return [
    scenario({
      id: "no-account-project",
      name: "未选择账号和项目",
      readiness: actionInput({ contextReady: false, accountSelected: false, projectSelected: false })
    }),
    scenario({
      id: "account-no-project",
      name: "已选账号但未选择项目",
      readiness: actionInput({ contextReady: false, accountSelected: true, projectSelected: false })
    }),
    scenario({
      id: "inventory-sync-failed",
      name: "项目可见但实例清单同步失败",
      readiness: actionInput({ contextReady: true }),
      doctorStatus: "blocked",
      selectedJob: taskJob({ status: "failed", error: "本地代理不可用：503 Service Unavailable" })
    }),
    scenario({
      id: "no-selected-instance",
      name: "上下文已就绪但未选择实例",
      readiness: actionInput({ contextReady: true, selected: false })
    }),
    scenario({
      id: "cloud-only-unknown",
      name: "云端实例尚未识别",
      readiness: actionInput({ selected: true, hasCloudInstance: true, hasLocalRecord: false, recognitionReady: false }),
      selectedVm: { ...BASE_VM, name: "external-unknown" },
      expectedRecommendationAction: "smartDiagnoseInstance",
      expectedAutoOpenGroup: "diagnose"
    }),
    scenario({
      id: "cloud-only-recognized-before-adoption",
      name: "云端实例已识别但未接管",
      readiness: actionInput({ selected: true, hasCloudInstance: true, hasLocalRecord: false, recognitionReady: true, deployMethod: "three_x_ui" }),
      selectedVm: { ...BASE_VM, name: "external-recognized" },
      selectedJob: taskJob({ result: { recognition: { method: "three_x_ui", confidence: "high", source: "guest_attributes" } } }),
      expectedRecommendationAction: "adoptLocalInstance",
      expectedAutoOpenGroup: "diagnose"
    }),
    scenario({
      id: "adopted-external-instance",
      name: "外部实例已接管为本地记录",
      readiness: actionInput({ selected: true, hasCloudInstance: true, hasLocalRecord: true, recognitionReady: true, deployMethod: "external_custom" }),
      selectedVm: { ...BASE_VM, name: "adopted-external" },
      expectedRecommendationAction: "smartDiagnoseInstance",
      expectedAutoOpenGroup: "diagnose"
    }),
    scenario({
      id: "local-vm-only-instance",
      name: "本地只开实例记录",
      readiness: actionInput({ selected: true, hasLocalRecord: true, deployMethod: "vm_only" }),
      selectedVm: { ...BASE_VM, name: "vm-only" },
      expectedRecommendationAction: "smartDiagnoseInstance",
      expectedAutoOpenGroup: "diagnose"
    }),
    scenario({
      id: "local-singbox-plus-node-links",
      name: "本地 Sing-Box-Plus 实例已有节点链接",
      readiness: actionInput({ selected: true, hasLocalRecord: true, deployMethod: "singbox_plus" }),
      selectedVm: { ...BASE_VM, name: "singbox-plus", nodeResult: singboxNodeResult },
      nodeResult: singboxNodeResult,
      expectedRecommendationAction: "showNodeResults",
      expectedAutoOpenGroup: ""
    }),
    scenario({
      id: "local-three-x-ui-panel",
      name: "本地 3X-UI 实例已有面板信息",
      readiness: actionInput({ selected: true, hasLocalRecord: true, deployMethod: "three_x_ui" }),
      selectedVm: { ...BASE_VM, name: "three-x-ui", nodeResult: threeXUiNodeResult },
      nodeResult: threeXUiNodeResult,
      expectedRecommendationAction: "showNodeResults",
      expectedAutoOpenGroup: ""
    }),
    scenario({
      id: "preview-invalidated",
      name: "预览存在但已失效",
      route: "config",
      readiness: actionInput({ selected: true, hasLocalRecord: true, deployMethod: "singbox_plus", previewExecutable: false }),
      selectedVm: { ...BASE_VM, name: "preview-invalidated" },
      expectedRecommendationAction: "deployNodes",
      expectedAutoOpenGroup: "configure"
    }),
    scenario({
      id: "preview-executable",
      name: "预览有效可执行",
      route: "config",
      readiness: actionInput({ selected: true, hasLocalRecord: true, deployMethod: "singbox_plus", previewExecutable: true }),
      selectedVm: { ...BASE_VM, name: "preview-ready" },
      expectedRecommendationAction: "deployNodes",
      expectedAutoOpenGroup: "configure"
    }),
    scenario({
      id: "verification-partial",
      name: "验证部分通过",
      readiness: actionInput({ selected: true, hasLocalRecord: true, deployMethod: "singbox_plus" }),
      selectedVm: { ...BASE_VM, name: "partial", verification: partialVerification },
      verification: partialVerification,
      doctorStatus: "warning",
      expectedRecommendationAction: "smartDiagnoseInstance",
      expectedAutoOpenGroup: "diagnose"
    }),
    scenario({
      id: "verification-failed",
      name: "验证失败",
      readiness: actionInput({ selected: true, hasLocalRecord: true, deployMethod: "singbox_plus" }),
      selectedVm: { ...BASE_VM, name: "failed", verification: failedVerification },
      verification: failedVerification,
      doctorStatus: "warning",
      expectedRecommendationAction: "smartDiagnoseInstance",
      expectedAutoOpenGroup: "diagnose"
    }),
    scenario({
      id: "clipboard-denied",
      name: "剪贴板拒绝时保留摘要内容",
      readiness: actionInput({ selected: true, hasLocalRecord: true, deployMethod: "singbox_plus" }),
      selectedVm: { ...BASE_VM, name: "clipboard-denied" },
      clipboardDenied: true,
      expectedRecommendationAction: "deployNodes",
      expectedAutoOpenGroup: "configure"
    }),
    scenario({
      id: "long-values-contained",
      name: "长实例名、项目、IP、链接和错误保持容器内展示",
      readiness: actionInput({ selected: true, hasLocalRecord: true, deployMethod: "singbox_plus" }),
      selectedVm: {
        name: "very-long-instance-name-that-should-wrap-inside-the-detail-panel-without-horizontal-overflow",
        zone: "europe-west9-b",
        externalIp: "2001:db8:85a3:0000:0000:8a2e:0370:7334",
        nodeResult: singboxNodeResult,
        verification: partialVerification
      },
      selectedJob: taskJob({
        status: "failed",
        error: "download failed token=super-secret-token vless://uuid-secret@example.com:443?password=raw-panel-password",
        result: { nodeResult: singboxNodeResult, verification: partialVerification }
      }),
      nodeResult: singboxNodeResult,
      verification: partialVerification,
      expectedRecommendationAction: "smartDiagnoseInstance",
      expectedAutoOpenGroup: "diagnose"
    }),
    scenario({
      id: "fresh-evidence",
      name: "十五分钟内的实时证据",
      readiness: actionInput({ selected: true, hasLocalRecord: true, deployMethod: "singbox_plus" }),
      selectedVm: { ...BASE_VM, name: "fresh-evidence", verification: completeVerification("2026-07-10T11:55:00.000Z") },
      verification: completeVerification("2026-07-10T11:55:00.000Z"),
      expectedRecommendationAction: "deployNodes",
      expectedAutoOpenGroup: "configure"
    }),
    scenario({
      id: "aging-evidence",
      name: "十五分钟至六小时的近期证据",
      readiness: actionInput({ selected: true, hasLocalRecord: true, deployMethod: "singbox_plus" }),
      selectedVm: { ...BASE_VM, name: "aging-evidence", verification: completeVerification("2026-07-10T10:00:00.000Z") },
      verification: completeVerification("2026-07-10T10:00:00.000Z"),
      expectedRecommendationAction: "deployNodes",
      expectedAutoOpenGroup: "configure"
    }),
    scenario({
      id: "stale-retained-evidence",
      name: "超过六小时的历史证据",
      readiness: actionInput({ selected: true, hasLocalRecord: true, deployMethod: "singbox_plus" }),
      selectedVm: { ...BASE_VM, name: "stale-evidence", verification: completeVerification("2026-07-10T02:00:00.000Z") },
      verification: completeVerification("2026-07-10T02:00:00.000Z"),
      expectedRecommendationAction: "deployNodes",
      expectedAutoOpenGroup: "configure"
    }),
    scenario({
      id: "latest-attempt-failed",
      name: "最新探测失败但保留最后结果",
      readiness: actionInput({ selected: true, hasLocalRecord: true, deployMethod: "singbox_plus" }),
      selectedVm: {
        ...BASE_VM,
        name: "latest-failed",
        verification: completeVerification("2026-07-10T11:40:00.000Z"),
        observed: { lastProbeAttempt: { status: "failed", checkedAt: "2026-07-10T11:59:00.000Z", category: "ssh", message: "SSH 连接失败" } }
      },
      verification: completeVerification("2026-07-10T11:40:00.000Z"),
      expectedRecommendationAction: "smartDiagnoseInstance",
      expectedAutoOpenGroup: "diagnose"
    }),
    scenario({
      id: "live-method-drift",
      name: "新探测覆盖旧部署结论",
      readiness: actionInput({ selected: true, hasLocalRecord: true, deployMethod: "singbox_plus" }),
      selectedVm: { ...BASE_VM, name: "method-drift", verification: completeVerification("2026-07-10T02:00:00.000Z") },
      verification: completeVerification("2026-07-10T02:00:00.000Z"),
      selectedJob: taskJob({
        updatedAt: "2026-07-10T11:58:00.000Z",
        result: { recognition: { method: "three_x_ui", confidence: "high", source: "ssh_deep_probe", probes: { services: [{ name: "x-ui", status: "active" }] } } }
      }),
      expectedRecommendationAction: "deployNodes",
      expectedAutoOpenGroup: "configure"
    }),
    scenario({
      id: "unknown-evidence-time",
      name: "证据时间未知",
      readiness: actionInput({ selected: true, hasLocalRecord: true, deployMethod: "singbox_plus" }),
      selectedVm: { ...BASE_VM, name: "unknown-time", verification: completeVerification("") },
      verification: completeVerification(""),
      expectedRecommendationAction: "deployNodes",
      expectedAutoOpenGroup: "configure"
    }),
    scenario({
      id: "probe-recovered",
      name: "失败后新探测恢复",
      readiness: actionInput({ selected: true, hasLocalRecord: true, deployMethod: "singbox_plus" }),
      selectedVm: {
        ...BASE_VM,
        name: "probe-recovered",
        verification: completeVerification("2026-07-10T11:59:00.000Z"),
        observed: { lastProbeAttempt: { status: "passed", checkedAt: "2026-07-10T11:59:00.000Z", evidenceAvailable: true } }
      },
      verification: completeVerification("2026-07-10T11:59:00.000Z"),
      expectedRecommendationAction: "deployNodes",
      expectedAutoOpenGroup: "configure"
    })
  ];
}
