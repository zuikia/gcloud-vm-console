import assert from "node:assert/strict";
import test from "node:test";

import { ACTION_BUTTON_IDS, toActionReadiness } from "../public/lib/action-readiness-view-model.js";

test("action readiness disables context-bound actions until project is applied", () => {
  const view = toActionReadiness({
    serviceReady: true,
    contextReady: false,
    accountSelected: true,
    projectSelected: false,
    selected: false,
    hasLocalRecord: false,
    deployMethod: "vm_only",
    previewExecutable: false
  });

  assert.equal(view.openConfig.enabled, false);
  assert.match(view.openConfig.reason, /账号与项目/);
  assert.equal(view.refreshAll.enabled, false);
  assert.equal(view.doctorRunBtn.enabled, false);
  assert.match(view.doctorRunBtn.reason, /账号与项目/);
  assert.equal(view.useContext.enabled, false);
  assert.match(view.useContext.reason, /项目/);
  assert.equal(view.mainAction.enabled, true);
  assert.equal(view.mainAction.kind, "route");
});

test("action readiness enables selected instance reads and keeps vm-only deployment disabled", () => {
  const view = toActionReadiness({
    serviceReady: true,
    contextReady: true,
    accountSelected: true,
    projectSelected: true,
    selected: true,
    hasLocalRecord: true,
    hasCloudInstance: true,
    hasVerificationResult: true,
    deployMethod: "vm_only",
    previewExecutable: false
  });

  assert.equal(view.smartDiagnoseInstance.enabled, true);
  assert.equal(view.detailPrimary.label, "修改部署");
  assert.equal(view.smartDiagnoseInstance.label, "重新探测");
  assert.equal(view.restartVm.label, "重启实例");
  assert.equal(view.adoptLocalInstance.enabled, false);
  assert.match(view.adoptLocalInstance.reason, /已有本地记录/);
  assert.equal(view.deployNodes.enabled, false);
  assert.equal(view.deployNodes.label, "无需部署节点");
  assert.match(view.deployNodes.reason, /只开实例/);
  assert.equal(view.deleteCloudResource.enabled, false);
  assert.match(view.deleteCloudResource.reason, /未开放/);
});

test("action readiness distinguishes setup from modification and first probe from re-probe", () => {
  const cloudOnly = toActionReadiness({
    serviceReady: true,
    contextReady: true,
    accountSelected: true,
    projectSelected: true,
    selected: true,
    hasLocalRecord: false,
    hasCloudInstance: true,
    hasRecognitionResult: false,
    hasVerificationResult: false,
    deployMethod: "unmanaged_unknown"
  });
  const probed = toActionReadiness({
    serviceReady: true,
    contextReady: true,
    accountSelected: true,
    projectSelected: true,
    selected: true,
    hasLocalRecord: false,
    hasCloudInstance: true,
    hasRecognitionResult: true,
    hasVerificationResult: false,
    deployMethod: "three_x_ui"
  });

  assert.equal(cloudOnly.detailPrimary.label, "设置部署");
  assert.equal(cloudOnly.smartDiagnoseInstance.label, "运行只读探测");
  assert.equal(probed.smartDiagnoseInstance.label, "重新探测");
});

test("action readiness does not expose redeploy writes when recognition disagrees with local vm-only config", () => {
  const view = toActionReadiness({
    serviceReady: true,
    contextReady: true,
    accountSelected: true,
    projectSelected: true,
    selected: true,
    hasLocalRecord: true,
    hasCloudInstance: true,
    recognitionReady: true,
    deployMethod: "vm_only",
    observedDeployMethod: "three_x_ui",
    previewExecutable: false
  });

  assert.equal(view.deployNodes.enabled, false);
  assert.equal(view.deployNodes.label, "部署方式需确认");
  assert.match(view.deployNodes.reason, /本地配置仍是只开实例/);
});

test("action readiness disables node deployment for external or unknown methods", () => {
  for (const deployMethod of ["external_custom", "unmanaged_unknown"]) {
    const view = toActionReadiness({
      serviceReady: true,
      contextReady: true,
      accountSelected: true,
      projectSelected: true,
      selected: true,
      hasLocalRecord: true,
      hasCloudInstance: true,
      deployMethod
    });

    assert.equal(view.deployNodes.enabled, false, deployMethod);
    assert.equal(view.deployNodes.label, "节点部署不适用", deployMethod);
    assert.match(view.deployNodes.reason, /修改部署方式/, deployMethod);
  }
});


test("action readiness exposes doctor as read-only once context is ready", () => {
  const view = toActionReadiness({
    serviceReady: true,
    contextReady: true,
    accountSelected: true,
    projectSelected: true,
    selected: false,
    hasLocalRecord: false,
    deployMethod: "vm_only",
    previewExecutable: false
  });

  assert.equal(view.doctorRunBtn.enabled, true);
  assert.equal(view.doctorRunBtn.label, "运行体检");
  assert.equal(view.doctorRunBtn.kind, "read");
  assert.equal(view.doctorRunBtn.confirmation, "none");
});

test("action readiness surfaces doctor warning without enabling blocked writes", () => {
  const view = toActionReadiness({
    serviceReady: true,
    contextReady: true,
    accountSelected: true,
    projectSelected: true,
    selected: true,
    hasLocalRecord: true,
    deployMethod: "singbox_plus",
    previewExecutable: false,
    doctorSummary: { status: "warning", title: "环境体检有 2 项需要注意" }
  });

  assert.equal(view.deployNodes.enabled, true);
  assert.match(view.deployNodes.reason, /环境体检/);
  assert.equal(view.executePreview.enabled, false);
  assert.match(view.executePreview.reason, /有效预览/);
});

test("action readiness exposes write confirmations and preview gate", () => {
  const view = toActionReadiness({
    serviceReady: true,
    contextReady: true,
    accountSelected: true,
    projectSelected: true,
    selected: true,
    hasLocalRecord: true,
    deployMethod: "singbox_plus",
    previewExecutable: true
  });

  assert.equal(view.restartVm.confirmation, "confirm");
  assert.equal(view.systemUpdate.confirmation, "confirm");
  assert.equal(view.deployNodes.enabled, true);
  assert.equal(view.deployNodes.label, "部署 Sing-Box-Plus");
  assert.equal(view.deployNodes.confirmation, "confirm");
  assert.equal(view.executePreview.enabled, true);
  assert.equal(view.executePreview.confirmation, "confirm");
});

test("action readiness blocks draft and preview actions for an invalid network profile", () => {
  const view = toActionReadiness({
    serviceReady: true,
    contextReady: true,
    accountSelected: true,
    projectSelected: true,
    configValid: false,
    configInvalidReason: "Sing-Box-Plus 需要公网 IPv4。",
    previewExecutable: false
  });

  assert.equal(view.saveDraft.enabled, false);
  assert.equal(view.savePreview.enabled, false);
  assert.match(view.saveDraft.reason, /公网 IPv4/);
  assert.match(view.savePreview.reason, /公网 IPv4/);
});

test("action readiness enables local adoption only for selected cloud instances with recognition", () => {
  const localOnly = toActionReadiness({
    serviceReady: true,
    contextReady: true,
    accountSelected: true,
    projectSelected: true,
    selected: true,
    hasLocalRecord: true,
    hasCloudInstance: true,
    recognitionReady: true,
    deployMethod: "three_x_ui",
    previewExecutable: false
  });
  const cloudOnly = toActionReadiness({
    serviceReady: true,
    contextReady: true,
    accountSelected: true,
    projectSelected: true,
    selected: true,
    hasLocalRecord: false,
    hasCloudInstance: true,
    recognitionReady: true,
    deployMethod: "three_x_ui",
    previewExecutable: false
  });

  assert.equal(localOnly.adoptLocalInstance.enabled, false);
  assert.match(localOnly.adoptLocalInstance.reason, /已有本地记录/);
  assert.equal(cloudOnly.smartDiagnoseInstance.enabled, true);
  assert.equal(cloudOnly.adoptLocalInstance.enabled, true);
  assert.equal(cloudOnly.adoptLocalInstance.confirmation, "confirm");
  assert.equal(cloudOnly.deployNodes.enabled, false);
  assert.match(cloudOnly.deployNodes.reason, /接管为本地记录/);
});

test("action readiness locks every cloud-dependent write while cached inventory remains browseable", () => {
  const view = toActionReadiness({
    serviceReady: true,
    contextReady: true,
    inventoryLive: false,
    accountSelected: true,
    projectSelected: true,
    selected: true,
    hasLocalRecord: true,
    hasCloudInstance: true,
    recognitionReady: true,
    deployMethod: "singbox_plus",
    previewExecutable: true,
    hasFreshPortEvidence: true,
    networkExposurePasswordReady: true,
    networkExposurePreviewReady: true
  });

  for (const id of ["openConfig", "detailPrimary", "cloneVm", "savePreview", "executePreview", "restartVm", "systemUpdate", "deployNodes", "manageNetworkExposure", "saveNetworkExposurePreview", "applyNetworkExposure"]) {
    assert.equal(view[id].enabled, false, id);
    assert.match(view[id].reason, /缓存清单|实时连接/, id);
  }
  assert.equal(view.smartDiagnoseInstance.enabled, true);
  assert.equal(view.refreshResources.enabled, true);
  assert.equal(view.saveDraft.enabled, true);
  assert.equal(view.deleteLocalRecord.enabled, true);

  const cloudOnly = toActionReadiness({
    serviceReady: true,
    contextReady: true,
    inventoryLive: false,
    accountSelected: true,
    projectSelected: true,
    selected: true,
    hasCloudInstance: true,
    recognitionReady: true,
    hasRecognitionResult: true
  });
  assert.equal(cloudOnly.adoptLocalInstance.enabled, true);
});

test("network exposure preview requires fresh listeners and a configured or newly entered local password", () => {
  const base = {
    serviceReady: true,
    contextReady: true,
    accountSelected: true,
    projectSelected: true,
    selected: true,
    hasLocalRecord: true,
    hasCloudInstance: true,
    inventoryLive: true,
    deployMethod: "singbox_plus"
  };
  const missingPassword = toActionReadiness({
    ...base,
    hasFreshPortEvidence: true,
    networkExposurePasswordReady: false
  });
  assert.equal(missingPassword.manageNetworkExposure.enabled, true);
  assert.equal(missingPassword.saveNetworkExposurePreview.enabled, false);
  assert.match(missingPassword.saveNetworkExposurePreview.reason, /本地统一 SSH 密码/);

  const ready = toActionReadiness({
    ...base,
    hasFreshPortEvidence: true,
    networkExposurePasswordReady: true,
    networkExposurePreviewReady: true
  });
  assert.equal(ready.saveNetworkExposurePreview.enabled, true);
  assert.equal(ready.applyNetworkExposure.enabled, true);
  assert.equal(ready.applyNetworkExposure.confirmation, "typed");
});

test("action readiness covers every static action button exactly once", () => {
  assert.deepEqual([...new Set(ACTION_BUTTON_IDS)].sort(), ACTION_BUTTON_IDS.toSorted());
  const view = toActionReadiness({
    serviceReady: true,
    contextReady: true,
    accountSelected: true,
    projectSelected: true,
    selected: true,
    hasLocalRecord: true,
    deployMethod: "three_x_ui",
    previewExecutable: false
  });
  for (const id of ACTION_BUTTON_IDS) {
    assert.ok(view[id], `missing readiness for ${id}`);
    assert.equal(view[id].id, id);
    assert.equal(typeof view[id].label, "string");
    assert.equal(typeof view[id].enabled, "boolean");
    assert.equal(typeof view[id].reason, "string");
  }
});

test("WARP actions stay inside node results and fail closed without live support", () => {
  const candidate = toActionReadiness({
    serviceReady: true,
    contextReady: true,
    selected: true,
    hasLocalRecord: true,
    hasWarpCandidate: true,
    warpSupported: false,
    warpStatus: "unknown",
    hasVerifiedSsh: true,
    inventoryLive: true
  });
  assert.equal(candidate.manageWarpEgress.enabled, true);
  assert.equal(candidate.refreshWarpStatus.enabled, true);
  assert.equal(candidate.reconnectWarpEgress.enabled, false);
  assert.match(candidate.reconnectWarpEgress.reason, /重新检测|未确认/);

  const ready = toActionReadiness({
    serviceReady: true,
    contextReady: true,
    selected: true,
    hasLocalRecord: true,
    hasWarpCandidate: true,
    warpSupported: true,
    warpStatus: "connected",
    hasVerifiedSsh: true,
    inventoryLive: true
  });
  assert.equal(ready.reconnectWarpEgress.enabled, true);
  assert.equal(ready.reconnectWarpEgress.confirmation, "confirm");

  const unchanged = toActionReadiness({
    serviceReady: true,
    contextReady: true,
    selected: true,
    hasLocalRecord: true,
    hasWarpCandidate: true,
    warpSupported: true,
    warpStatus: "connected",
    warpLastOutcome: "unchanged",
    hasVerifiedSsh: true,
    inventoryLive: true
  });
  assert.equal(unchanged.reconnectWarpEgress.label, "再试一次");

  const failedLatestProbe = toActionReadiness({
    serviceReady: true,
    contextReady: true,
    selected: true,
    hasLocalRecord: true,
    hasWarpCandidate: true,
    warpSupported: true,
    warpStatus: "connected",
    warpReconnectReady: false,
    hasVerifiedSsh: true,
    inventoryLive: true
  });
  assert.equal(failedLatestProbe.reconnectWarpEgress.enabled, false);
  assert.match(failedLatestProbe.reconnectWarpEgress.reason, /最近检测失败|重新检测/);

  const cached = toActionReadiness({
    serviceReady: true,
    contextReady: true,
    selected: true,
    hasLocalRecord: true,
    hasWarpCandidate: true,
    warpSupported: true,
    warpStatus: "connected",
    hasVerifiedSsh: true,
    inventoryLive: false
  });
  assert.equal(cached.refreshWarpStatus.enabled, true);
  assert.equal(cached.reconnectWarpEgress.enabled, false);
  assert.match(cached.reconnectWarpEgress.reason, /实时连接/);
});
