function checksById(verification = {}) {
  const map = new Map();
  for (const check of Array.isArray(verification.checks) ? verification.checks : []) {
    map.set(String(check.id || ""), {
      id: String(check.id || ""),
      label: String(check.label || check.id || "检查项"),
      status: String(check.status || "unknown"),
      detail: String(check.detail || "")
    });
  }
  return map;
}

function action(id, label, kind, targetAction, detail) {
  return { id, label, kind, targetAction, detail };
}

const METHOD_LABELS = {
  vm_only: "只开实例",
  singbox_plus: "Sing-Box-Plus",
  three_x_ui: "3X-UI",
  custom_startup: "自定义脚本",
  external_custom: "外部自定义",
  unmanaged_unknown: "未识别"
};

const FIREWALL_STATUS_LABELS = {
  matched: "已匹配",
  synced: "已同步",
  passed: "已验证",
  partial: "部分开放",
  missing: "未开放",
  mismatch: "规则不匹配",
  failed: "探测失败",
  overexposed: "过度开放",
  not_required: "无需检查",
  unknown: "状态未知"
};

function evidenceFrom(verification = {}) {
  const rows = [];
  if (verification.method) rows.push({ label: "部署方式", value: METHOD_LABELS[verification.method] || String(verification.method) });
  if (verification.ssh?.label) rows.push({ label: "SSH", value: String(verification.ssh.label) });
  if (verification.firewall?.status) {
    rows.push({
      label: "防火墙",
      value: FIREWALL_STATUS_LABELS[verification.firewall.status] || String(verification.firewall.status)
    });
  }
  for (const port of Array.isArray(verification.ports) ? verification.ports : []) {
    rows.push({
      label: `${String(port.protocol || "").toUpperCase()} 端口`,
      value: `${port.port} ${port.listening ? "已监听" : "未监听"}`
    });
  }
  for (const warning of Array.isArray(verification.warnings) ? verification.warnings : []) {
    rows.push({ label: "提示", value: String(warning) });
  }
  return rows.slice(0, 8);
}

export function toVerificationRecoveryView(verification = null, { nodeResult = null } = {}) {
  if (!verification) {
    return {
      severity: "unknown",
      headline: "尚未验证",
      explanation: "先运行智能诊断，确认 SSH、服务、端口、BBR 和防火墙是否可用。",
      actions: [action("diagnose", "智能诊断", "read", "smartDiagnoseInstance", "只读取状态并写入本地验证结果。")],
      evidence: [],
      nodeLinksStillUsable: false
    };
  }

  const checks = checksById(verification);
  const links = Array.isArray(nodeResult?.links) ? nodeResult.links : [];
  const hasLinks = links.length > 0 || checks.get("links")?.status === "passed";
  const ssh = checks.get("ssh");
  const service = checks.get("service");
  const ports = checks.get("ports");
  const firewall = checks.get("firewall");
  const bbr = checks.get("bbr");
  const panel = checks.get("panel");
  const linkCheck = checks.get("links");

  if (verification.status === "passed") {
    return {
      severity: "ok",
      headline: "验证通过",
      explanation: hasLinks ? "节点链接和关键运行状态已验证，可以复制链接使用。" : "实例基础连通性已验证。",
      actions: [action("diagnose-again", "智能诊断", "read", "smartDiagnoseInstance", "再次读取当前实例状态。")],
      evidence: evidenceFrom(verification),
      nodeLinksStillUsable: hasLinks
    };
  }

  if (ssh?.status === "failed") {
    return {
      severity: "critical",
      headline: "SSH 无法连接",
      explanation: "后台无法通过 IAP SSH 读取实例状态，后续服务、端口和防火墙判断都不可靠。",
      actions: [action("diagnose-again", "智能诊断", "read", "smartDiagnoseInstance", "确认实例状态、SSH 和运行证据。")],
      evidence: evidenceFrom(verification),
      nodeLinksStillUsable: hasLinks
    };
  }

  if (service?.status === "failed") {
    return {
      severity: "critical",
      headline: "节点服务未运行",
      explanation: "实例可连通，但目标节点服务没有处于 active 状态，已生成链接可能无法使用。",
      actions: [
        action("rerun-deploy", "重新执行当前部署方式", "guided_write", "deployNodes", "使用现有确认弹窗重新执行当前部署管线。"),
        action("diagnose-again", "智能诊断", "read", "smartDiagnoseInstance", "部署后再次读取服务状态。")
      ],
      evidence: evidenceFrom(verification),
      nodeLinksStillUsable: hasLinks
    };
  }

  if (linkCheck?.status === "failed") {
    return {
      severity: "critical",
      headline: "节点链接缺失",
      explanation: "节点服务或面板可能已安装，但没有收集到可复制的节点链接。",
      actions: [
        action("rerun-deploy", "重新执行当前部署方式", "guided_write", "deployNodes", "重新收集节点链接和面板信息。"),
        action("diagnose-again", "智能诊断", "read", "smartDiagnoseInstance", "重新读取当前实例状态。")
      ],
      evidence: evidenceFrom(verification),
      nodeLinksStillUsable: false
    };
  }

  if (String(verification.firewall?.status || "").toLowerCase() === "overexposed") {
    return {
      severity: "critical",
      headline: "防火墙过度开放",
      explanation: hasLinks
        ? "节点链接仍可使用，但外部共享规则扩大了公网暴露面；控制台不会自动修改外部规则。"
        : "外部共享规则扩大了公网暴露面；控制台不会自动修改外部规则。",
      actions: [],
      evidence: evidenceFrom(verification),
      nodeLinksStillUsable: hasLinks
    };
  }

  if (firewall && firewall.status !== "passed") {
    return {
      severity: "warning",
      headline: "防火墙未匹配",
      explanation: hasLinks ? "节点链接已生成，但防火墙规则缺失或不匹配，外部客户端可能无法连通。" : "防火墙规则缺失或不匹配，实例外部访问可能失败。",
      actions: [
        action("rerun-deploy", "重新执行当前部署方式", "guided_write", "deployNodes", "当前部署管线会重新同步由本控制台管理的防火墙规则。"),
        action("diagnose-again", "智能诊断", "read", "smartDiagnoseInstance", "同步后确认规则是否匹配。")
      ],
      evidence: evidenceFrom(verification),
      nodeLinksStillUsable: hasLinks
    };
  }

  if (ports && ports.status !== "passed") {
    return {
      severity: "warning",
      headline: "端口监听未确认",
      explanation: hasLinks ? "节点链接已生成，但实例内目标端口没有全部监听。" : "目标端口没有全部监听，客户端连接可能失败。",
      actions: [
        action("diagnose-again", "智能诊断", "read", "smartDiagnoseInstance", "先重新读取端口状态，排除服务启动延迟。"),
        action("rerun-deploy", "重新执行当前部署方式", "guided_write", "deployNodes", "如果仍未监听，重新执行当前部署管线。")
      ],
      evidence: evidenceFrom(verification),
      nodeLinksStillUsable: hasLinks
    };
  }

  if (panel && panel.status !== "passed") {
    return {
      severity: "warning",
      headline: "3X-UI 面板信息不完整",
      explanation: "3X-UI 部署缺少面板地址、用户名或密码，无法保证面板可登录。",
      actions: [
        action("rerun-deploy", "重新执行 3X-UI 部署", "guided_write", "deployNodes", "重新收集面板地址和账号密码。"),
        action("diagnose-again", "智能诊断", "read", "smartDiagnoseInstance", "重新读取面板相关状态。")
      ],
      evidence: evidenceFrom(verification),
      nodeLinksStillUsable: hasLinks
    };
  }

  if (bbr && bbr.status !== "passed") {
    return {
      severity: "warning",
      headline: "BBR 未确认",
      explanation: "BBR 状态不会单独决定节点是否可用，但可能影响吞吐和稳定性。",
      actions: [action("diagnose-again", "智能诊断", "read", "smartDiagnoseInstance", "再次读取内核拥塞控制状态。")],
      evidence: evidenceFrom(verification),
      nodeLinksStillUsable: hasLinks
    };
  }

  return {
    severity: "unknown",
    headline: "验证结果需要复核",
    explanation: "当前验证结果没有命中已知诊断规则。先智能诊断，再查看运行日志中的原始错误。",
    actions: [action("diagnose-again", "智能诊断", "read", "smartDiagnoseInstance", "重新读取当前实例状态。")],
    evidence: evidenceFrom(verification),
    nodeLinksStillUsable: hasLinks
  };
}
