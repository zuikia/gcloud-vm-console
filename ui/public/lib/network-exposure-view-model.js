import { evidenceFreshness } from "./instance-evidence-freshness-view-model.js";

const KNOWN_NODE_PROCESS = /(sing-box|x-ui|xray|v2ray|hysteria|tuic)/i;

function safeText(value, fallback = "") {
  return String(value || fallback)
    .replace(/[\r\n\t]+/g, " ")
    .trim()
    .slice(0, 120);
}

function validPort(value) {
  const text = String(value || "");
  const number = Number(text);
  return /^\d{1,5}$/.test(text) && Number.isInteger(number) && number >= 1 && number <= 65535;
}

function normalizePort(value) {
  const protocol = String(value?.protocol || "").toLowerCase();
  const port = String(value?.port || "");
  if (!["tcp", "udp"].includes(protocol) || !validPort(port)) return null;
  return { protocol, port };
}

function portKey(value) {
  return `${value.protocol}/${value.port}`;
}

function sortPorts(values = []) {
  return [...new Map(values.map(normalizePort).filter(Boolean).map((port) => [portKey(port), port])).values()]
    .sort((a, b) => a.protocol.localeCompare(b.protocol) || Number(a.port) - Number(b.port));
}

function concisePortList(values = [], limit = 4) {
  const ports = sortPorts(values).map(portKey);
  if (!ports.length) return "无";
  const hidden = Math.max(0, ports.length - limit);
  return `${ports.slice(0, limit).join("、")}${hidden ? `，另 ${hidden} 个` : ""}`;
}

function previewRows({ changes = {}, isolation = {}, vmName = "所选实例" } = {}) {
  const sources = [...new Set((isolation.ruleActions || [])
    .flatMap((action) => Array.isArray(action?.sourceRanges) ? action.sourceRanges : [])
    .map((value) => safeText(value))
    .filter(Boolean))];
  const priorities = isolation.allowPriority != null && isolation.denyPriority != null
    ? `${isolation.allowPriority}/${isolation.denyPriority}`
    : "待确认";
  const targetTag = safeText(isolation.targetTag, "待确认");

  return [
    {
      label: "端口变化",
      value: `新增 ${concisePortList(changes.open)} · 保留 ${concisePortList(changes.retain)} · 关闭 ${concisePortList(changes.close)}`
    },
    {
      label: "规则来源",
      value: sources.length ? sources.slice(0, 4).join("、") : "来源范围待确认"
    },
    {
      label: "影响范围",
      value: `实例 ${safeText(vmName, "所选实例")} · 标签 ${targetTag} · 优先级 ${priorities}`
    },
    {
      label: "失败回滚",
      value: "验证失败时仅禁用本任务拥有的 deny 规则"
    }
  ];
}

function listenerCandidates(record = {}) {
  return (Array.isArray(record?.verification?.ports) ? record.verification.ports : [])
    .map((candidate) => {
      const port = normalizePort(candidate);
      const scope = String(candidate?.scope || candidate?.exposureScope || "").toLowerCase();
      if (
        !port
        || candidate?.listening === false
        || !["network", "wildcard"].includes(scope)
        || (port.protocol === "tcp" && ["22", "45400"].includes(port.port))
      ) return null;
      const process = safeText(candidate?.process, "未识别进程");
      return {
        ...port,
        key: portKey(port),
        process,
        scope,
        selectedByDefault: KNOWN_NODE_PROCESS.test(process)
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.protocol.localeCompare(b.protocol) || Number(a.port) - Number(b.port));
}

function previewView(preview, now, vmName) {
  if (!preview || typeof preview !== "object" || !preview.fingerprint) {
    return {
      available: false,
      current: false,
      ready: false,
      tone: "muted",
      summary: "尚未生成预览",
      detail: "预览会列出新增、保留、关闭端口和实例隔离优先级。",
      isolation: "",
      rows: []
    };
  }
  const currentTime = Date.parse(String(now || ""));
  const expiresAt = Date.parse(String(preview.expiresAt || ""));
  const current = Number.isFinite(currentTime) && Number.isFinite(expiresAt) && expiresAt > currentTime;
  const ready = current && Boolean(preview.coverage?.ready);
  const desiredPublic = sortPorts(preview.desiredExposure?.public || []);
  const changes = preview.changes || {};
  const open = Array.isArray(changes.open) ? changes.open.length : 0;
  const retain = Array.isArray(changes.retain) ? changes.retain.length : 0;
  const close = Array.isArray(changes.close) ? changes.close.length : 0;
  const blockedReason = safeText(preview.coverage?.blockedReason);
  const isolation = preview.isolation || {};
  const isolationText = isolation.targetTag
    ? `隔离标签 ${safeText(isolation.targetTag)} · 优先级 ${isolation.allowPriority ?? "-"}/${isolation.denyPriority ?? "-"}`
    : "隔离标签与优先级待确认";
  return {
    available: true,
    current,
    ready,
    tone: ready ? "success" : "warning",
    summary: ready
      ? `公网 ${desiredPublic.length} 个端口，策略可应用`
      : current
        ? "预览暂不可应用"
        : "预览已过期",
    detail: blockedReason || `新增 ${open} · 保留 ${retain} · 关闭 ${close}`,
    isolation: isolationText,
    rows: previewRows({ changes, isolation, vmName })
  };
}

export function toNetworkExposureView({
  record = null,
  secretStatus = null,
  preview = null,
  now = new Date().toISOString()
} = {}) {
  const candidates = listenerCandidates(record || {});
  const checkedAt = String(record?.verification?.checkedAt || "");
  const freshness = evidenceFreshness(checkedAt, { now });
  const hasFreshPortEvidence = freshness === "fresh" && Array.isArray(record?.verification?.ports);
  const storedPreview = preview || record?.observed?.networkExposurePreview || null;
  const validKeys = new Set(candidates.map((candidate) => candidate.key));
  const previewSelection = sortPorts(storedPreview?.selection?.ports || [])
    .map(portKey)
    .filter((key) => validKeys.has(key));
  const selectedPortKeys = previewSelection.length || storedPreview?.selection
    ? previewSelection
    : candidates.filter((candidate) => candidate.selectedByDefault).map((candidate) => candidate.key);
  const secretConfigured = Boolean(secretStatus?.configured);
  const vmName = safeText(record?.identity?.name, "所选实例");
  const previewModel = previewView(storedPreview, now, vmName);
  const secretVersion = String(secretStatus?.versionId || "");
  const previewSecretVersion = String(storedPreview?.sshPolicy?.passwordVersion || "");
  const previewSecretMatches = secretConfigured
    && Boolean(secretVersion)
    && Boolean(previewSecretVersion)
    && secretVersion === previewSecretVersion;
  const effectivePreview = previewModel.available && !previewSecretMatches
    ? {
        ...previewModel,
        ready: false,
        tone: "warning",
        summary: "预览需重新生成",
        detail: "本地密码状态已变化，请重新生成预览。"
      }
    : previewModel;
  const freshnessLabels = {
    fresh: "15 分钟内",
    aging: "证据已超过 15 分钟",
    stale: "证据已过期",
    unknown: "时间未知"
  };

  return {
    recordId: String(record?.id || ""),
    vmName,
    checkedAt,
    freshness,
    freshnessLabel: freshnessLabels[freshness] || freshnessLabels.unknown,
    freshnessTone: freshness === "fresh" ? "running" : freshness === "unknown" ? "draft" : "warning",
    evidenceHint: hasFreshPortEvidence
      ? `${candidates.length} 个可选外部监听；未知进程默认不开放。`
      : "监听证据不可执行，请先重新运行只读探测。",
    hasFreshPortEvidence,
    candidates,
    selectedPortKeys,
    publicSsh22: Boolean(storedPreview?.selection?.publicSsh22),
    secret: {
      configured: secretConfigured,
      label: secretConfigured ? "本地密码已配置" : "本地密码未配置",
      hint: secretConfigured
        ? "密码只保存在本机；界面和 API 均不会回显。"
        : "首次生成预览前输入；只保存到本机受限文件。"
    },
    previewActionLabel: !secretConfigured
      ? "保存密码并生成预览"
      : effectivePreview.available
        ? "重新生成预览"
        : "生成端口预览",
    preview: effectivePreview,
    canApply: effectivePreview.ready
  };
}
