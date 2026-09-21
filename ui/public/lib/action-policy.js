const POLICY = {
  reloadAccounts: {
    kind: "read",
    confirmation: "none",
    title: "重新读取账号与项目",
    impact: "只读取本机 gcloud 配置和项目列表，不会修改云端资源。",
    risk: "不会产生费用，也不会中断实例。"
  },
  refreshAll: {
    kind: "read",
    confirmation: "none",
    title: "刷新数据",
    impact: "重新读取当前上下文和资源状态，不会修改云端资源。",
    risk: "不会产生费用，也不会中断实例。"
  },
  refreshResources: {
    kind: "read",
    confirmation: "none",
    title: "刷新实例清单",
    impact: "重新读取当前项目下的实例和本地记录，不会修改云端资源。",
    risk: "不会产生费用，也不会中断实例。"
  },
  smartDiagnoseInstance: {
    kind: "read",
    confirmation: "none",
    title: "智能诊断",
    impact: "根据所选实例状态自动执行只读部署识别、运行验证或轻量状态检查，只写入本地任务/验证结果，不会修改云端资源。",
    risk: "不会创建、重启、停止、删除或部署实例；SSH 或证据读取可能失败，失败原因会显示在任务日志。"
  },
  doctorRunBtn: {
    kind: "read",
    confirmation: "none",
    title: "运行环境体检",
    impact: "只读检查本机账号、项目、API、规则缓存、实例清单和本地验证证据，不会修改云端资源。",
    risk: "不会产生费用，也不会中断实例；失败项只作为操作前提示。"
  },
  copyDiagnosticSummary: {
    kind: "read",
    confirmation: "none",
    title: "复制诊断摘要",
    impact: "只复制当前页面生成的脱敏诊断摘要，不会读取或修改云端资源。",
    risk: "不会产生费用，也不会中断实例；摘要会隐藏密码、令牌和原始节点链接。"
  },
  auditFreeRules: {
    kind: "read",
    confirmation: "none",
    title: "校对免费规则提示",
    impact: "更新本地费用与安全提示，不会访问或修改云端实例。",
    risk: "不会产生费用，也不会中断实例。"
  },
  clearLog: {
    kind: "read",
    confirmation: "none",
    title: "清空本地日志视图",
    impact: "只清空当前浏览器会话中的日志显示，不会删除任务记录或云端资源。",
    risk: "不会产生费用，也不会中断实例。"
  },
  refreshWarpStatus: {
    kind: "read",
    confirmation: "none",
    title: "重新检测 WARP 出口",
    impact: "通过固定只读 SSH 契约检查 WARP 服务、代理监听、Sing-box 路由和出口地址，只保存脱敏本地状态。",
    risk: "不会断开 WARP，不会修改节点、服务、端口、防火墙或云端资源。"
  },
  saveNetworkExposurePreview: {
    kind: "local-write",
    confirmation: "none",
    title: "生成端口与 SSH 预览",
    impact: "首次使用会把用户输入的 SSH 密码保存到本机受限 Secret Store，并读取实时实例与防火墙状态生成预览。",
    risk: "此步骤不会修改 VM、标签或防火墙；密码不会回显，也不会进入任务、日志或云端字段。"
  },
  executePreview: {
    kind: "write",
    confirmation: "confirm",
    title: "执行有效预览",
    impact: "将按当前预览指纹对「所选实例」执行变更，可能创建实例、调整网络或更新公网 IP。",
    risk: "可能影响费用、网络连通性和公网 IP。执行前请确认账号、项目、区域和实例名称正确。"
  },
  restartVm: {
    kind: "write",
    confirmation: "confirm",
    title: "重启实例",
    impact: "将停止并启动所选实例，期间 SSH、节点服务和公网访问会短暂中断。",
    risk: "可能导致临时断连；临时公网 IP 可能变化，费用按 GCP 当前规则计算。"
  },
  systemUpdate: {
    kind: "write",
    confirmation: "confirm",
    title: "系统更新",
    impact: "将通过 IAP SSH 在所选实例上执行系统包更新。",
    risk: "可能占用 CPU、网络和磁盘 IO；部分服务可能重启或短暂不可用。"
  },
  deployNodes: {
    kind: "write",
    confirmation: "confirm",
    title: "部署方式未确认",
    impact: "将通过 IAP SSH 在所选实例上安装所选节点方式，并同步防火墙端口。",
    risk: "会修改实例内部服务和防火墙端口，可能影响网络暴露面、连通性和流量费用。"
  },
  adoptLocalInstance: {
    kind: "write",
    confirmation: "confirm",
    title: "接管为本地记录",
    impact: "只写入本地记录，把所选云端实例的部署识别结果保存到本机控制台。",
    risk: "不会修改云端 labels、metadata、Guest Attributes、实例服务或防火墙；低可信或未识别时需要手动确认部署方式。"
  },
  reconnectWarpEgress: {
    kind: "write",
    confirmation: "confirm",
    title: "重连 WARP 出口",
    impact: "将对所选实例执行一次 WARP 断开与连接，并比较重连前后的 IPv4 和 IPv6。",
    risk: "WARP 节点预计中断 10–60 秒；直连节点、SSH 和节点链接不受影响。不会自动连续尝试。"
  },
  applyNetworkExposure: {
    kind: "write",
    confirmation: "typed",
    title: "应用端口与 SSH 策略",
    impact: "将为所选实例配置 SSH 双入口、唯一隔离标签和精确端口规则。",
    risk: "会修改实例 SSH、网络标签和控制台自有 allow/deny 规则；不会修改外部共享规则，最终连通性失败时只禁用本任务的 deny。",
    verificationPrefix: "APPLY"
  },
  deleteLocalRecord: {
    kind: "danger",
    confirmation: "typed",
    title: "移除本地记录",
    impact: "只移除控制台保存的本地记录，不会删除云端实例。",
    risk: "移除后需要重新从云端读取或手动配置，才能继续管理这条本地记录。",
    verificationPrefix: "ALLOW"
  },
  deleteCloudResource: {
    kind: "danger",
    confirmation: "typed",
    title: "删除云端资源",
    impact: "云端删除流程当前未开放，此策略仅用于按钮审计和失败关闭。",
    risk: "不会由当前 UI 执行云端删除；后续若开放，必须重新设计确认、验证和回滚边界。",
    verificationPrefix: "ALLOW"
  }
};

const DEPLOY_LABELS = {
  singbox_plus: "部署 Sing-Box-Plus",
  three_x_ui: "部署 3X-UI",
  custom_startup: "运行自定义脚本",
  vm_only: "无需部署节点"
};

export const ACTION_POLICY = Object.freeze(Object.fromEntries(
  Object.entries(POLICY).map(([key, value]) => [key, Object.freeze({ ...value })])
));

export function policyForAction(id) {
  const policy = ACTION_POLICY[id];
  if (!policy) throw new Error(`Unknown action policy: ${id}`);
  const verificationPhrase = policy.confirmation === "typed"
    ? `${policy.verificationPrefix || "ALLOW"} ${id}`
    : "";
  return { ...policy, verificationPhrase };
}

export function confirmationCopy(id, context = {}) {
  const policy = policyForAction(id);
  const vmName = context.vmName || context.name || "所选实例";
  const deployLabel = id === "deployNodes" ? DEPLOY_LABELS[context.deployMethod] : "";
  const title = deployLabel || policy.title;
  const exposure = context.networkExposurePreview;
  const publicPorts = Array.isArray(exposure?.desiredExposure?.public)
    ? exposure.desiredExposure.public.map((item) => `${item.protocol}/${item.port}`).join("、")
    : "端口未确认";
  const isolation = exposure?.isolation || {};
  const networkPlan = context.networkPlan || null;
  const networkImpact = networkPlan?.externalIpMode === "static"
    ? `将使用 ${networkPlan.networkTier === "PREMIUM" ? "Premium" : "Standard"} Tier，校验或保留静态 IPv4 ${networkPlan.addressName || "自动命名地址"}，网卡 ${networkPlan.nicType || "默认"}。`
    : "";
  const affectedCount = Math.max(0, Number(context.affectedCount) || 0);
  const impact = id === "deployNodes" && deployLabel
    ? `将通过 IAP SSH 在 ${vmName} 上执行“${deployLabel}”管线，并同步对应防火墙端口。`
    : id === "applyNetworkExposure"
      ? `将为 ${vmName} 应用公网端口 ${publicPorts}；22 保留 IAP 密钥加密码，45400 使用密钥认证。隔离标签 ${isolation.targetTag || "未确认"}，优先级 ${isolation.allowPriority ?? "-"}/${isolation.denyPriority ?? "-"}。`
    : id === "executePreview" && networkImpact
      ? `${policy.impact.replaceAll("所选实例", vmName)} ${networkImpact}`
    : id === "reconnectWarpEgress"
      ? `将对 ${vmName} 执行一次 WARP 重连，预计影响 ${affectedCount || "当前"} 个 WARP 节点，并比较重连前后的 IPv4 与 IPv6。`
    : policy.impact.replaceAll("所选实例", vmName);
  const verificationPhrase = policy.confirmation === "typed"
    ? `${policy.verificationPrefix || "ALLOW"} ${vmName}`
    : "";
  return {
    title,
    impact,
    risk: id === "executePreview" && networkPlan?.externalIpMode === "static"
      ? `${policy.risk} 静态公网 IPv4 在未挂载时也可能产生费用，失败后不会自动删除。`
      : policy.risk,
    confirmLabel: policy.kind === "danger" ? "确认移除" : id === "applyNetworkExposure" ? "确认应用" : "确认继续",
    cancelLabel: "取消",
    verificationPhrase
  };
}
