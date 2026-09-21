import assert from "node:assert/strict";
import test from "node:test";

import { toOperationGuidance } from "../public/lib/operation-guidance-view-model.js";

function action(id, enabled = true, reason = "") {
  return { id, label: id, enabled, reason, kind: "read", confirmation: "none" };
}

test("guidance asks for context before any VM operation", () => {
  const view = toOperationGuidance({
    route: "overview",
    contextReady: false,
    doctorView: null,
    actionReadiness: { useContext: action("useContext", false, "需要选择 gcloud 配置。") }
  });

  assert.equal(view.tone, "blocked");
  assert.equal(view.primaryActionId, "useContext");
  assert.match(view.headline, /先选择账号与项目/);
});

test("guidance prioritizes doctor issues before write actions without disabling them", () => {
  const view = toOperationGuidance({
    route: "config",
    contextReady: true,
    previewExecutable: true,
    actionReadiness: { executePreview: { ...action("executePreview"), kind: "write" } },
    doctorView: {
      status: "warning",
      title: "环境体检有 2 项需要注意",
      issues: [{ id: "api_services", label: "所需 API", status: "warning", actionRef: "doctorRunBtn", actionLabel: "运行体检" }]
    }
  });

  assert.equal(view.tone, "warning");
  assert.equal(view.primaryActionId, "executePreview");
  assert.match(view.detail, /执行前建议先查看体检/);
  assert.equal(view.issues[0].actionLabel, "运行体检");
});

test("guidance handles ready context with no selected instance", () => {
  const view = toOperationGuidance({
    route: "overview",
    contextReady: true,
    selectedVm: null,
    actionReadiness: { switchVm: action("switchVm"), openConfig: action("openConfig") },
    doctorView: null
  });

  assert.equal(view.primaryActionId, "switchVm");
  assert.match(view.headline, /选择或创建实例/);
});

test("guidance sends verified node users to copy links instead of redeploying", () => {
  const view = toOperationGuidance({
    route: "resources",
    contextReady: true,
    selectedVm: { name: "vm-a", nodeResult: { links: [{ name: "hy2", url: "hysteria2://example" }] } },
    actionReadiness: { smartDiagnoseInstance: action("smartDiagnoseInstance"), deployNodes: { ...action("deployNodes"), kind: "write" } },
    doctorView: { status: "pass", title: "环境体检通过", issues: [] }
  });

  assert.equal(view.tone, "pass");
  assert.equal(view.primaryActionId, "smartDiagnoseInstance");
  assert.match(view.headline, /节点链接可用/);
});

test("guidance exposes scenario evidence without raw node links", () => {
  const view = toOperationGuidance({
    route: "resources",
    contextReady: true,
    selectedVm: {
      name: "vm-a",
      nodeResult: { links: [{ url: "vless://secret@example" }, { url: "hysteria2://secret@example" }] }
    },
    actionReadiness: {
      smartDiagnoseInstance: { id: "smartDiagnoseInstance", label: "智能诊断", enabled: true },
      openTasks: { id: "openTasks", label: "查看任务", enabled: true }
    }
  });

  assert.equal(view.tone, "pass");
  assert.equal(view.primaryActionId, "smartDiagnoseInstance");
  assert.deepEqual(view.evidence, [{ label: "节点", value: "2 条节点链接" }]);
  assert.doesNotMatch(JSON.stringify(view), /vless:\/\/secret|hysteria2:\/\/secret/);
});

test("guidance removes runtime issue chips when the primary action already owns diagnosis", () => {
  const view = toOperationGuidance({
    route: "resources",
    contextReady: true,
    selectedVm: { name: "vm-a" },
    actionReadiness: { smartDiagnoseInstance: action("smartDiagnoseInstance") },
    doctorView: {
      status: "warning",
      issues: [
        { id: "verification_state", label: "验证状态", status: "warning", actionRef: "smartDiagnoseInstance", actionLabel: "智能诊断" },
        { id: "ssh_state", label: "SSH", status: "warning", actionRef: "smartDiagnoseInstance", actionLabel: "智能诊断" },
        { id: "firewall_state", label: "防火墙", status: "warning", actionRef: "smartDiagnoseInstance", actionLabel: "智能诊断" },
        { id: "bbr_state", label: "BBR", status: "warning", actionRef: "smartDiagnoseInstance", actionLabel: "智能诊断" }
      ]
    }
  });
  assert.equal(view.primaryActionId, "smartDiagnoseInstance");
  assert.equal(view.issues.length, 0);
});

test("guidance hides runtime diagnosis issues until an instance is selected", () => {
  const view = toOperationGuidance({
    route: "overview",
    contextReady: true,
    selectedVm: null,
    actionReadiness: { switchVm: action("switchVm"), openConfig: action("openConfig") },
    doctorView: {
      status: "warning",
      issues: [
        { id: "ssh_state", label: "SSH", status: "warning", actionRef: "smartDiagnoseInstance", actionLabel: "智能诊断" },
        { id: "free_rules", label: "免费规则", status: "warning", actionRef: "auditFreeRules", actionLabel: "更新规则提示" }
      ]
    }
  });

  assert.equal(view.primaryActionId, "switchVm");
  assert.deepEqual(view.issues.map((issue) => issue.id), ["free_rules"]);
});
