import assert from "node:assert/strict";
import test from "node:test";

import { toOperationHint, toOperationHub } from "../public/lib/operation-hub-view-model.js";

test("operation hub asks for context first", () => {
  const hub = toOperationHub({ contextReady: false, selected: false, actionReadiness: {} });
  assert.equal(hub.primary.actionId, "mainAction");
  assert.equal(hub.groups[0].id, "setup");
});

test("operation hub prioritizes doctor before writes when doctor is blocked", () => {
  const hub = toOperationHub({
    contextReady: true,
    selected: true,
    doctorStatus: "blocked",
    actionReadiness: {
      doctorRunBtn: { id: "doctorRunBtn", label: "运行体检", enabled: true },
      deployNodes: { id: "deployNodes", label: "部署 Sing-Box-Plus", enabled: true }
    }
  });
  assert.equal(hub.primary.actionId, "doctorRunBtn");
});

test("operation hub groups low priority duplicate reads away from primary", () => {
  const hub = toOperationHub({
    contextReady: true,
    selected: true,
    hasCloudInstance: true,
    actionReadiness: {
      refreshAll: { id: "refreshAll", label: "刷新数据", enabled: true },
      refreshResources: { id: "refreshResources", label: "刷新清单", enabled: true },
      smartDiagnoseInstance: { id: "smartDiagnoseInstance", label: "智能诊断", enabled: true },
      adoptLocalInstance: { id: "adoptLocalInstance", label: "接管本地", enabled: true }
    }
  });
  assert.equal(hub.groups.some((group) => group.id === "diagnose"), true);
  const diagnose = hub.groups.find((group) => group.id === "diagnose");
  assert.deepEqual(diagnose.actions.map((action) => action.id), ["smartDiagnoseInstance", "adoptLocalInstance"]);
});

test("selected instance operation hub uses canonical disjoint groups", () => {
  const hub = toOperationHub({
    contextReady: true,
    selected: true,
    hasLocalRecord: true,
    deployMethod: "singbox_plus",
    actionReadiness: {
      detailPrimary: { id: "detailPrimary", label: "修改部署", enabled: true },
      cloneVm: { id: "cloneVm", label: "基于此新建", enabled: true },
      deployNodes: { id: "deployNodes", label: "部署 Sing-Box-Plus", enabled: true },
      smartDiagnoseInstance: { id: "smartDiagnoseInstance", label: "重新探测", enabled: true },
      manageNetworkExposure: { id: "manageNetworkExposure", label: "管理端口与 SSH", enabled: true },
      adoptLocalInstance: { id: "adoptLocalInstance", label: "接管本地", enabled: false },
      restartVm: { id: "restartVm", label: "重启实例", enabled: true },
      systemUpdate: { id: "systemUpdate", label: "系统更新", enabled: true },
      deleteLocalRecord: { id: "deleteLocalRecord", label: "移除本地记录", enabled: true },
      deleteCloudResource: { id: "deleteCloudResource", label: "删除云端资源", enabled: false }
    }
  });

  assert.deepEqual(hub.groups.map((group) => group.id), ["configure", "diagnose", "maintain", "danger"]);
  assert.deepEqual(hub.groups.find((group) => group.id === "configure").actions.map((item) => item.id), [
    "detailPrimary",
    "cloneVm",
    "deployNodes"
  ]);
  assert.deepEqual(hub.groups.find((group) => group.id === "diagnose").actions.map((item) => item.id), [
    "smartDiagnoseInstance"
  ]);
  assert.equal(hub.groups.flatMap((group) => group.actions).some((item) => item.id === "manageNetworkExposure"), false);
  assert.deepEqual(hub.groups.find((group) => group.id === "maintain").actions.map((item) => item.id), [
    "restartVm",
    "systemUpdate"
  ]);
});

test("vm-only operation hub hides irrelevant node deployment", () => {
  const hub = toOperationHub({
    contextReady: true,
    selected: true,
    hasLocalRecord: true,
    deployMethod: "vm_only",
    actionReadiness: {
      detailPrimary: { id: "detailPrimary", label: "修改部署", enabled: true },
      cloneVm: { id: "cloneVm", label: "基于此新建", enabled: true },
      deployNodes: { id: "deployNodes", label: "无需部署节点", enabled: false },
      smartDiagnoseInstance: { id: "smartDiagnoseInstance", label: "重新探测", enabled: true },
      restartVm: { id: "restartVm", label: "重启实例", enabled: true },
      systemUpdate: { id: "systemUpdate", label: "系统更新", enabled: true }
    }
  });

  assert.ok(hub.hiddenLowPriorityIds.includes("deployNodes"));
  assert.equal(hub.groups.flatMap((group) => group.actions).some((item) => item.id === "deployNodes"), false);
});

test("operation hub keeps network exposure inside progressive governance details", () => {
  const hub = toOperationHub({
    contextReady: true,
    selected: true,
    hasLocalRecord: true,
    deployMethod: "singbox_plus",
    actionReadiness: {
      smartDiagnoseInstance: { id: "smartDiagnoseInstance", label: "重新探测", enabled: true },
      manageNetworkExposure: { id: "manageNetworkExposure", label: "管理端口与 SSH", enabled: true },
      applyNetworkExposure: { id: "applyNetworkExposure", label: "应用端口策略", enabled: false }
    }
  });

  assert.equal(hub.groups.flatMap((group) => group.actions).some((item) => item.id === "manageNetworkExposure"), false);
  assert.equal(hub.groups.flatMap((group) => group.actions).some((item) => item.id === "applyNetworkExposure"), false);
});

test("operation hub hides node deployment when the selected method has no pipeline", () => {
  const hub = toOperationHub({
    contextReady: true,
    selected: true,
    hasLocalRecord: true,
    deployMethod: "external_custom",
    actionReadiness: {
      detailPrimary: { id: "detailPrimary", label: "修改部署", enabled: true },
      cloneVm: { id: "cloneVm", label: "基于此新建", enabled: true },
      deployNodes: { id: "deployNodes", label: "节点部署不适用", enabled: false },
      smartDiagnoseInstance: { id: "smartDiagnoseInstance", label: "重新探测", enabled: true },
      restartVm: { id: "restartVm", label: "重启实例", enabled: true },
      systemUpdate: { id: "systemUpdate", label: "系统更新", enabled: true }
    }
  });

  assert.ok(hub.hiddenLowPriorityIds.includes("deployNodes"));
  assert.equal(hub.groups.flatMap((group) => group.actions).some((item) => item.id === "deployNodes"), false);
});

test("operation hint stays hidden when the recommendation already explains an available or manual next step", () => {
  assert.deepEqual(toOperationHint({
    recommendation: {
      actionId: "",
      title: "人工检查外部规则",
      detail: "外部共享规则仅提供人工建议。"
    },
    actionReadiness: {}
  }), { visible: false, text: "" });

  assert.deepEqual(toOperationHint({
    recommendation: {
      actionId: "smartDiagnoseInstance",
      title: "重新探测",
      detail: "更新只读证据。"
    },
    actionReadiness: {
      smartDiagnoseInstance: { label: "重新探测", enabled: true, reason: "" }
    }
  }), { visible: false, text: "" });
});

test("operation hint exposes only the disabled reason for the recommended action", () => {
  assert.deepEqual(toOperationHint({
    recommendation: {
      actionId: "deployNodes",
      title: "部署 Sing-Box-Plus",
      detail: "继续节点部署。"
    },
    actionReadiness: {
      deployNodes: {
        label: "部署 Sing-Box-Plus",
        enabled: false,
        reason: "先恢复实时实例清单。"
      }
    }
  }), {
    visible: true,
    text: "部署 Sing-Box-Plus：先恢复实时实例清单。"
  });
});
