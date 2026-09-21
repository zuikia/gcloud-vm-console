import { toVerificationRecoveryView } from "./verification-recovery-view-model.js";

const TYPE_LABELS = {
  "execute-change": "执行变更",
  "maintenance-status": "检查状态",
  "maintenance-restart": "重启实例",
  "maintenance-system-update": "系统更新",
  "node-deploy": "部署方式未确认",
  "firewall-owned-repair": "补齐自有规则",
  "network-exposure-apply": "应用端口策略",
  "warp-reconnect": "重连 WARP 出口",
  verification: "重新验证实例",
  verify: "重新验证实例",
  preview: "生成预览"
};

const DEPLOY_TYPE_LABELS = {
  singbox_plus: "部署 Sing-Box-Plus",
  three_x_ui: "部署 3X-UI",
  custom_startup: "运行自定义脚本",
  vm_only: "只开实例",
  external_custom: "外部自定义",
  unmanaged_unknown: "未识别"
};

const METHOD_LABELS = {
  singbox_plus: "Sing-Box-Plus",
  three_x_ui: "3X-UI",
  custom_startup: "自定义脚本",
  vm_only: "只开实例",
  external_custom: "外部自定义",
  unmanaged_unknown: "未识别"
};

const STATUS_LABELS = {
  queued: "排队中",
  running: "运行中",
  succeeded: "成功",
  partial: "部分完成",
  failed: "失败",
  interrupted: "服务中断",
  PREVIEW: "预览已生成"
};

const STAGE_LABELS = {
  fingerprint_check: "校验指纹",
  create_vm: "创建实例",
  status_check: "检查状态",
  restart: "重启实例",
  system_update: "系统更新",
  node_pipeline: "执行部署管线",
  verification: "重新验证实例",
  firewall_sync: "同步防火墙",
  preview_recheck: "复核治理预览",
  ensure_owned_rules: "补齐自有规则",
  post_verify: "复核防火墙结果",
  exposure_recheck: "复核端口预览",
  ssh_preflight: "检查 SSH 环境",
  ssh_key_entry: "验证 45400 密钥入口",
  ssh_password_policy: "收紧 22 认证",
  exposure_allow: "建立允许规则",
  exposure_isolation_prepare: "准备实例隔离",
  exposure_pre_enable: "启用前连通检查",
  exposure_enable: "启用实例隔离",
  exposure_post_verify: "复核管理路径",
  exposure_rollback: "回滚实例隔离",
  ssh_port: "配置 SSH 端口",
  install: "安装组件",
  bbr_check: "检查 BBR",
  collect: "收集结果",
  restart_recovery: "服务重启恢复"
};

const WARP_STAGE_LABELS = {
  precheck: "操作前检查",
  disconnect: "断开 WARP",
  hold: "保持断开",
  connect: "连接 WARP",
  verify: "验证出口",
  persist: "保存结果"
};

const STAGE_DETAILS = {
  fingerprint_check: "执行前复核已保存的预览指纹",
  create_vm: "创建预览中确认的 Compute Engine 实例",
  status_check: "通过 gcloud describe 读取实例状态",
  restart: "停止后重新启动所选实例",
  system_update: "通过 IAP SSH 分阶段执行系统更新",
  node_pipeline: "执行所选部署管线并同步端口",
  verification: "只读核验 SSH、服务、端口、BBR 和防火墙",
  firewall_sync: "同步部署所需的防火墙端口",
  preview_recheck: "写入前重新核对防火墙治理预览",
  exposure_recheck: "写入前重新核对监听、密码版本与防火墙指纹",
  ssh_preflight: "检查非 root 用户、sudo 和 OpenSSH 双入口支持",
  ssh_key_entry: "先验证 45400 密钥入口，避免收紧 22 后失去控制路径",
  ssh_password_policy: "将 22 收紧为密钥加密码，45400 保持密钥认证",
  exposure_allow: "建立 IAP 与所选公网端口的自有 allow 规则",
  exposure_isolation_prepare: "准备唯一标签和禁用状态 deny 规则",
  exposure_pre_enable: "启用 deny 前验证公网 45400",
  exposure_enable: "启用只作用于所选实例的隔离 deny",
  exposure_post_verify: "复核公网 45400 和 IAP 22 网络路径",
  exposure_rollback: "最终验证失败后禁用本任务拥有的 deny",
  install: "安装所选节点组件",
  bbr_check: "核验 BBR 与队列调度状态",
  collect: "收集并保存本地部署结果"
};

const WARP_STAGE_DETAILS = {
  precheck: "复核 WARP 服务、代理监听、Sing-box 路由和 SSH 路径",
  disconnect: "执行一次 WARP 断开",
  hold: "保持短暂断开以尝试获得新出口",
  connect: "恢复 WARP 连接",
  verify: "独立验证 IPv4、IPv6、colo 和 WARP 状态",
  persist: "保存脱敏 WARP 结果到本地任务与实例记录"
};

const RETRYABLE_TYPES = new Set(["maintenance-status", "maintenance-system-update", "node-deploy", "verification"]);

function asDate(value) {
  const date = new Date(value || "");
  return Number.isNaN(date.getTime()) ? null : date;
}

function deploymentMethodForJob(job = {}, record = null) {
  return job.result?.method || job.result?.nodeResult?.type || record?.desired?.deploy?.method || record?.nodeResult?.type || "";
}

export function taskTypeLabel(jobOrType, record = null) {
  if (typeof jobOrType === "object" && jobOrType) {
    if (jobOrType.type === "node-deploy") {
      const deployLabel = DEPLOY_TYPE_LABELS[deploymentMethodForJob(jobOrType, record)];
      if (deployLabel) return deployLabel;
    }
    return TYPE_LABELS[jobOrType.type] || String(jobOrType.type || "任务");
  }
  return TYPE_LABELS[jobOrType] || String(jobOrType || "任务");
}

export function taskStatusLabel(status) {
  return STATUS_LABELS[status] || String(status || "未知");
}

export function taskTimelineHint(job = null) {
  if (!job) return "预览指纹失效后必须重新生成。";
  if (job.status === "interrupted") {
    return "任务因服务重启中断，系统未自动续跑；请用只读探测确认实际状态。";
  }
  if (["verification", "verify", "maintenance-status"].includes(job.type)) {
    return "只读任务不会修改云端；阶段与结果来自本地任务历史。";
  }
  return "阶段与结果来自本地任务历史；再次执行仍需原有确认。";
}

export function verificationStatusLabel(status) {
  return {
    passed: "通过",
    partial: "部分通过",
    failed: "失败",
    unknown: "未确认"
  }[status] || String(status || "未确认");
}

function statusTone(status) {
  if (status === "succeeded" || status === "PREVIEW") return "running";
  if (status === "failed") return "error";
  if (status === "interrupted") return "warning";
  if (status === "queued" || status === "running" || status === "partial") return "cloud";
  return "draft";
}

function recordFor(job, records = []) {
  return records.find((record) => record.id === job?.recordId) || null;
}

function stageLabel(name, type = "") {
  if (type === "warp-reconnect") return WARP_STAGE_LABELS[name] || String(name || "阶段");
  return STAGE_LABELS[name] || String(name || "阶段");
}

function stageDetail(stage = {}, type = "") {
  if (stage.name === "ssh_port") {
    const port = String(stage.detail || "").match(/\b([1-9]\d{1,4})\b/)?.[1] || "";
    return `配置并验证 SSH 端口${port ? ` ${port}` : ""}`;
  }
  if (type === "warp-reconnect") return WARP_STAGE_DETAILS[stage.name] || String(stage.detail || "");
  return STAGE_DETAILS[stage.name] || String(stage.detail || "");
}

function safeRecognition(input = null) {
  if (!input) return null;
  const method = input.method || "unmanaged_unknown";
  return {
    method,
    methodLabel: METHOD_LABELS[method] || method,
    confidence: input.confidence || "none",
    source: input.source || "none",
    managedState: input.managedState || "unknown",
    warningCount: Array.isArray(input.warnings) ? input.warnings.length : 0
  };
}

function interruptedRecovery(job = {}, nodeLinks = []) {
  const detectedAt = job.interruption?.detectedAt || job.updatedAt || "";
  return {
    severity: "warning",
    headline: "任务因服务重启中断",
    explanation: "本地服务在任务结束前重启，云端最终状态未确认；系统没有自动续跑或重试。",
    actions: [{
      id: "diagnose-after-interruption",
      label: job.type === "warp-reconnect" ? "重新检测 WARP" : "智能诊断",
      kind: "read",
      targetAction: job.type === "warp-reconnect" ? "refreshWarpStatus" : "smartDiagnoseInstance",
      detail: job.type === "warp-reconnect"
        ? "到实例页重新检测 WARP，确认连接与出口实际状态。"
        : "到实例页运行现有只读探测，确认 SSH、服务、端口、BBR 和防火墙实际状态。"
    }],
    evidence: detectedAt ? [{ label: "中断时间", value: String(detectedAt) }] : [],
    nodeLinksStillUsable: nodeLinks.length > 0
  };
}

function warpFailureRecovery(nodeLinks = []) {
  return {
    severity: "warning",
    headline: "WARP 结果未确认",
    explanation: "任务没有取得可确认的重连结果；系统未自动重试，也未推断当前出口状态。",
    actions: [{
      id: "diagnose-after-warp-failure",
      label: "重新检测 WARP",
      kind: "read",
      targetAction: "refreshWarpStatus",
      detail: "回到实例页执行现有只读检测，确认连接、IPv4、IPv6 和 colo。"
    }],
    evidence: [],
    nodeLinksStillUsable: nodeLinks.length > 0
  };
}

function firewallRepairSummary(result = {}) {
  const changes = Array.isArray(result.changes) ? result.changes : [];
  const count = (action) => changes.filter((item) => item?.action === action).length;
  const parts = [
    count("created") ? `新增 ${count("created")}` : "",
    count("updated") ? `更新 ${count("updated")}` : "",
    count("unchanged") ? `未变 ${count("unchanged")}` : "",
    count("skipped") ? `跳过 ${count("skipped")}` : ""
  ].filter(Boolean);
  const externalCount = Array.isArray(result.governance?.externalActions) ? result.governance.externalActions.length : 0;
  const actionSummary = parts.length ? `自有规则：${parts.join("，")}` : "自有规则无需变更";
  return `${actionSummary}${externalCount ? `；${externalCount} 条外部规则仍需人工处理` : ""}`;
}

function networkExposureSummary(result = {}) {
  const publicPorts = Array.isArray(result.exposure?.public) ? result.exposure.public.length : 0;
  const iapPorts = Array.isArray(result.exposure?.iap) ? result.exposure.iap.length : 0;
  const sshReady = result.sshPolicy?.mode === "dual_entry";
  const isolated = result.firewall?.effectiveStatus === "isolated";
  return `公网 ${publicPorts} 个端口，IAP ${iapPorts} 个端口；SSH 双入口${sshReady ? "已生效" : "待确认"}；实例隔离${isolated ? "已生效" : "待确认"}`;
}

function warpReconnectSummary(result = {}) {
  const outcome = String(result.outcome || "");
  const before = String(result.before?.ipv4 || "未获取");
  const after = String(result.after?.ipv4 || "未获取");
  if (outcome === "changed") return `WARP IPv4 已更换：${before} → ${after}`;
  if (outcome === "unchanged") return `WARP 已恢复连接，IPv4 未变化（${after}）`;
  if (outcome === "restored") return "WARP 连接已恢复；未自动执行第二轮换 IP";
  if (outcome === "partial") return "WARP 已执行重连，但 IPv4 仍需重新检测确认";
  return "WARP 重连未返回可确认的出口结果";
}

export function formatDuration(job = {}) {
  if (job.status === "running" || job.status === "queued") return "进行中";
  const start = asDate(job.createdAt);
  const end = asDate(job.updatedAt);
  if (!start || !end) return "未知";
  const seconds = Math.max(0, Math.round((end.getTime() - start.getTime()) / 1000));
  if (seconds < 1) return "<1 秒";
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return minutes ? `${minutes} 分 ${rest} 秒` : `${rest} 秒`;
}

export function toTaskRow(job = {}, records = []) {
  const record = recordFor(job, records);
  const createdAt = asDate(job.createdAt);
  return {
    id: String(job.id || ""),
    type: String(job.type || ""),
    typeLabel: taskTypeLabel(job, record),
    vmName: record?.identity?.name || job.identity?.name || job.recordId || "未绑定实例",
    projectId: record?.identity?.projectId || job.identity?.projectId || "",
    zone: record?.identity?.zone || job.identity?.zone || "",
    time: createdAt ? createdAt.toLocaleString("zh-CN", { hour12: false }) : "未知",
    status: String(job.status || ""),
    statusLabel: taskStatusLabel(job.status),
    statusTone: statusTone(job.status),
    duration: formatDuration(job),
    active: job.status === "running" || job.status === "queued"
  };
}

export function toTaskSteps(job = {}) {
  if (
    job.type === "node-deploy"
    && ["succeeded", "partial"].includes(job.status)
    && Array.isArray(job.result?.stages)
    && job.result.stages.length
  ) {
    const partialStage = job.result?.sshPort?.status === "failed"
      ? "ssh_port"
      : job.result?.firewall?.status === "failed"
        ? "firewall_sync"
        : job.status === "partial"
          ? job.result.stages.at(-1)
          : "";
    return job.result.stages.map((name) => ({
      name: String(name || ""),
      label: stageLabel(name, job.type),
      status: name === partialStage ? "partial" : "succeeded",
      detail: name === partialStage ? "该阶段需要复核" : "阶段已完成",
      at: String(job.updatedAt || job.createdAt || "")
    }));
  }
  const stages = Array.isArray(job.stages) ? job.stages : [];
  if (!stages.length) {
    return [{
      name: "waiting",
      label: job.status === "failed" ? "任务失败" : job.status === "interrupted" ? "服务重启恢复" : "等待阶段",
      status: job.status || "queued",
      detail: job.error || "后端未返回阶段信息",
      at: job.updatedAt || job.createdAt || ""
    }];
  }
  return stages.map((stage) => ({
    name: String(stage.name || ""),
    label: stageLabel(stage.name, job.type),
    status: String(stage.status || ""),
    detail: stageDetail(stage, job.type),
    at: String(stage.at || "")
  }));
}

export function toTaskResult(job = {}, { record = null } = {}) {
  const nodeResult = job.result?.nodeResult || record?.nodeResult || null;
  const verification = job.result?.verification || (job.type === "verification" ? job.result : null);
  const recognition = safeRecognition(job.result?.recognition || null);
  const nodeLinks = Array.isArray(nodeResult?.links) ? nodeResult.links.map((link) => ({ ...link })) : [];
  const firewall = job.result?.firewall || nodeResult?.firewall || null;
  const warpFailure = job.type === "warp-reconnect" && job.status === "failed" && !job.result;
  const recovery = job.status === "interrupted"
    ? interruptedRecovery(job, nodeLinks)
    : warpFailure
      ? warpFailureRecovery(nodeLinks)
    : toVerificationRecoveryView(verification, { nodeResult });
  const verificationSummary = verification
    ? `验证${verification.status === "passed" ? "通过" : verification.status === "partial" ? "部分通过" : verification.status === "failed" ? "失败" : "未确认"}`
    : "";
  const firewallRisk = verification?.firewall?.status === "overexposed"
    || ["critical", "high"].includes(String(job.result?.firewallGovernance?.severity || "").toLowerCase());
  const recognitionSummary = recognition ? `识别为 ${recognition.methodLabel}` : "";
  const externalFirewallOnly = String(verification?.firewall?.status || "").toLowerCase() === "overexposed";
  const summary = job.status === "interrupted"
    ? "本地服务在任务结束前重启，云端最终状态未确认；未自动重试，请运行只读探测。"
    : warpFailure
      ? "WARP 重连结果未确认；系统未自动重试，请重新检测当前状态。"
    : job.type === "warp-reconnect" && job.result
      ? warpReconnectSummary(job.result)
    : job.type === "network-exposure-apply" && job.result
      ? networkExposureSummary(job.result)
    : job.type === "firewall-owned-repair" && job.result
      ? firewallRepairSummary(job.result)
    : job.result
    ? firewall?.status === "failed"
      ? `${nodeLinks.length} 个节点链接，防火墙同步失败：${firewall.error || "需重试"}`
      : nodeLinks.length
      ? `${nodeLinks.length} 个节点链接，BBR ${nodeResult?.bbr ? "已开启" : "未确认"}${verificationSummary ? `，${verificationSummary}` : ""}${firewallRisk ? "；防火墙过度开放" : ""}`
      : firewallRisk
        ? `${verificationSummary || "验证需要复核"}；防火墙过度开放`
        : verificationSummary || recognitionSummary || "任务已返回结果"
    : "没有可用结果";

  return {
    id: String(job.id || ""),
    status: String(job.status || ""),
    statusLabel: taskStatusLabel(job.status),
    summary,
    rawDetails: job.result == null ? null : JSON.parse(JSON.stringify({
      ...job.result,
      recognition
    })),
    error: warpFailure ? "请回到实例页重新检测 WARP，确认连接与出口实际状态。" : job.error ? String(job.error) : "",
    storageWarning: job.storageWarning ? String(job.storageWarning) : "",
    canRetry: (job.status === "failed" || job.status === "partial")
      && RETRYABLE_TYPES.has(job.type)
      && !externalFirewallOnly,
    nodeResult,
    verification,
    recognition,
    recovery,
    nodeLinks,
    nodePanel: nodeResult?.panel || null
  };
}
