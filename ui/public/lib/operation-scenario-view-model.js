function actionLabel(actions = {}, id, fallback) {
  return actions[id]?.label || fallback;
}

function firstBlockedIssue(doctorView = {}) {
  return (doctorView?.issues || []).find((issue) => issue.status === "blocked");
}

function hasDoctorIssues(doctorView = {}) {
  return Array.isArray(doctorView?.issues) && doctorView.issues.length > 0;
}

function linkCount(vm = {}) {
  return Array.isArray(vm?.nodeResult?.links) ? vm.nodeResult.links.length : 0;
}

function verificationStatus(vm = {}) {
  return vm?.verification?.status || vm?.nodeResult?.verification?.status || "";
}

function scenario(base) {
  return {
    secondaryActions: [],
    evidence: [],
    ...base
  };
}

export function toOperationScenario(input = {}) {
  const actions = input.actionReadiness || {};

  if (!input.contextReady) {
    return scenario({
      id: "no_context",
      tone: "blocked",
      headline: "先选择账号与项目",
      detail: "切换上下文后，实例清单、部署预览和诊断结果才会绑定到正确项目。",
      primaryActionId: "useContext",
      primaryLabel: actionLabel(actions, "useContext", "切换到此项目")
    });
  }

  const blocked = firstBlockedIssue(input.doctorView);
  if (blocked) {
    return scenario({
      id: "project_blocked",
      tone: "blocked",
      headline: "当前上下文需要修复",
      detail: blocked.reason || "体检发现阻断项，先处理后再执行写操作。",
      primaryActionId: blocked.actionRef || "doctorRunBtn",
      primaryLabel: blocked.actionLabel || actionLabel(actions, blocked.actionRef || "doctorRunBtn", "运行体检"),
      secondaryActions: ["doctorRunBtn"].filter((id) => actions[id]),
      evidence: [{ label: blocked.label || "阻断项", value: blocked.status || "blocked" }]
    });
  }

  if (input.recentJob?.status === "running") {
    return scenario({
      id: "task_running",
      tone: "busy",
      headline: "任务正在运行",
      detail: "先查看任务日志，避免重复发起同一实例的写操作。",
      primaryActionId: "openTasks",
      primaryLabel: actionLabel(actions, "openTasks", "查看任务"),
      secondaryActions: ["refreshAll"].filter((id) => actions[id]),
      evidence: [{ label: "任务", value: input.recentJob.type || "running" }]
    });
  }

  if (input.route === "config" && input.previewExecutable) {
    const hasIssues = hasDoctorIssues(input.doctorView);
    return scenario({
      id: "preview_ready",
      tone: hasIssues ? "warning" : "ready",
      headline: "预览已准备执行",
      detail: hasIssues ? "执行前建议先查看体检提示；执行仍必须经过现有确认。" : "可以执行有效预览；执行前仍会经过原有确认和指纹复核。",
      primaryActionId: "executePreview",
      primaryLabel: actionLabel(actions, "executePreview", "执行有效预览"),
      secondaryActions: ["savePreview", "doctorRunBtn"].filter((id) => actions[id]),
      evidence: [{ label: "预览", value: "fingerprint ready" }]
    });
  }

  const links = linkCount(input.selectedVm);
  if (links > 0) {
    return scenario({
      id: "nodes_ready",
      tone: "pass",
      headline: "节点链接可用",
      detail: "先用智能诊断复核状态，再复制节点或面板信息使用。",
      primaryActionId: "smartDiagnoseInstance",
      primaryLabel: actionLabel(actions, "smartDiagnoseInstance", "智能诊断"),
      secondaryActions: ["openTasks"].filter((id) => actions[id]),
      evidence: [{ label: "节点", value: `${links} 条节点链接` }]
    });
  }

  const verification = verificationStatus(input.selectedVm);
  if (verification === "failed" || verification === "partial") {
    return scenario({
      id: verification === "failed" ? "verification_failed" : "verification_partial",
      tone: verification === "failed" ? "blocked" : "warning",
      headline: verification === "failed" ? "验证失败，需要先排查" : "验证部分通过",
      detail: verification === "failed" ? "先看任务证据和恢复建议，再执行维护或部署。" : "保留已有证据，先用智能诊断复核状态。",
      primaryActionId: "smartDiagnoseInstance",
      primaryLabel: actionLabel(actions, "smartDiagnoseInstance", "智能诊断"),
      evidence: [{ label: "验证", value: verification }]
    });
  }

  if (input.selectedVm) {
    return scenario({
      id: "instance_ready",
      tone: "ready",
      headline: "检查当前实例状态",
      detail: "进入实例页查看 SSH、BBR、防火墙和服务状态，需要时运行只读探测。",
      primaryActionId: "smartDiagnoseInstance",
      primaryLabel: actionLabel(actions, "smartDiagnoseInstance", "智能诊断"),
      secondaryActions: ["detailPrimary"].filter((id) => actions[id]),
      evidence: [{ label: "实例", value: input.selectedVm.name || "已选中" }]
    });
  }

  return scenario({
    id: "ready_no_instance",
    tone: "ready",
    headline: "选择或创建实例",
    detail: "从实例清单选择现有实例，或进入部署页创建新实例。",
    primaryActionId: "switchVm",
    primaryLabel: actionLabel(actions, "switchVm", "打开实例清单"),
    secondaryActions: ["openConfig", "doctorRunBtn"].filter((id) => actions[id])
  });
}
