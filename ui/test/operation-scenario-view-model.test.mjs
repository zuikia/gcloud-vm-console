import assert from "node:assert/strict";
import test from "node:test";

import { toOperationScenario } from "../public/lib/operation-scenario-view-model.js";

function action(id, label = id, enabled = true) {
  return { id, label, enabled, kind: "read", confirmation: "none", reason: "" };
}

test("scenario blocks all journeys until context is selected", () => {
  const view = toOperationScenario({
    route: "workbench",
    contextReady: false,
    actionReadiness: { useContext: action("useContext", "切换到此项目", false) }
  });
  assert.equal(view.id, "no_context");
  assert.equal(view.tone, "blocked");
  assert.equal(view.primaryActionId, "useContext");
  assert.match(view.headline, /账号与项目/);
});

test("scenario prioritizes blocked doctor project issue", () => {
  const view = toOperationScenario({
    route: "workbench",
    contextReady: true,
    doctorView: {
      status: "blocked",
      issues: [{ id: "project_access", label: "项目访问", status: "blocked", actionRef: "reloadAccounts", actionLabel: "重新读取" }]
    },
    actionReadiness: { reloadAccounts: action("reloadAccounts", "重新读取") }
  });
  assert.equal(view.id, "project_blocked");
  assert.equal(view.primaryActionId, "reloadAccounts");
  assert.equal(view.evidence[0].label, "项目访问");
});

test("scenario sends executable deployment preview to existing execute button", () => {
  const view = toOperationScenario({
    route: "config",
    contextReady: true,
    previewExecutable: true,
    actionReadiness: { executePreview: action("executePreview", "执行有效预览") }
  });
  assert.equal(view.id, "preview_ready");
  assert.equal(view.primaryActionId, "executePreview");
  assert.equal(view.tone, "ready");
});

test("scenario handles partial verification before node links exist", () => {
  const view = toOperationScenario({
    route: "resources",
    contextReady: true,
    selectedVm: { name: "vm-a", verification: { status: "partial" } },
    actionReadiness: { smartDiagnoseInstance: action("smartDiagnoseInstance", "智能诊断") }
  });
  assert.equal(view.id, "verification_partial");
  assert.equal(view.tone, "warning");
  assert.deepEqual(view.secondaryActions, []);
});

test("scenario treats available node links as ready evidence", () => {
  const view = toOperationScenario({
    route: "resources",
    contextReady: true,
    selectedVm: { name: "vm-a", nodeResult: { links: [{ url: "vless://secret" }, { url: "hysteria2://secret" }] } },
    actionReadiness: { smartDiagnoseInstance: action("smartDiagnoseInstance", "智能诊断"), openTasks: action("openTasks", "查看任务") }
  });
  assert.equal(view.id, "nodes_ready");
  assert.equal(view.tone, "pass");
  assert.equal(view.primaryActionId, "smartDiagnoseInstance");
  assert.equal(view.evidence[0].value, "2 条节点链接");
});

test("selected overview guidance names the next action instead of repeating selection state", () => {
  const view = toOperationScenario({
    route: "workbench",
    contextReady: true,
    selectedVm: { name: "vm-a" },
    actionReadiness: { smartDiagnoseInstance: action("smartDiagnoseInstance", "重新探测") }
  });

  assert.equal(view.id, "instance_ready");
  assert.equal(view.headline, "检查当前实例状态");
  assert.doesNotMatch(view.headline, /已选中/);
  assert.match(view.detail, /SSH、BBR、防火墙和服务状态/);
});
