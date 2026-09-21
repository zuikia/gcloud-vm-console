import { evidenceFreshness } from "./instance-evidence-freshness-view-model.js";

function safe(value, max = 120) {
  return String(value || "").replace(/[\r\n\t]+/g, " ").trim().slice(0, max);
}

function warpNodeNames(record = {}) {
  const names = [];
  for (const link of Array.isArray(record.nodeResult?.links) ? record.nodeResult.links : []) {
    const name = safe(link?.name, 80);
    if (!name || !/(?:^|[-_\s])warp(?:$|[-_\s])/i.test(name) || names.includes(name)) continue;
    names.push(name);
  }
  return names;
}

function serviceCandidate(record = {}) {
  return (Array.isArray(record.verification?.services) ? record.verification.services : [])
    .some((service) => service?.name === "warp-svc" && service?.status === "active");
}

function ipv4(value) {
  const parts = String(value || "").split(".");
  return parts.length === 4 && parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255)
    ? parts.join(".")
    : "";
}

function ipv6(value) {
  const text = String(value || "");
  return text.includes(":") && /^[0-9a-f:.]+$/i.test(text) ? text : "";
}

function statusPresentation(status) {
  return {
    connected: { label: "已连接", tone: "running" },
    degraded: { label: "需复核", tone: "warning" },
    disconnected: { label: "已断开", tone: "warning" },
    unsupported: { label: "未就绪", tone: "warning" },
    unknown: { label: "待检测", tone: "draft" }
  }[status] || { label: "待检测", tone: "draft" };
}

function reconnectCopy(warp = {}) {
  const outcome = warp?.lastReconnect?.outcome || "";
  if (outcome === "unchanged") return "WARP 已恢复连接，但 IPv4 未变化。可再次确认后重试。";
  if (outcome === "changed") return `IPv4 已更换：${ipv4(warp.lastReconnect?.before?.ipv4) || "未获取"} → ${ipv4(warp.lastReconnect?.after?.ipv4) || "未获取"}`;
  if (outcome === "restored") return "WARP 连接已恢复，未自动执行第二轮换 IP。";
  if (outcome === "partial") return "WARP 已执行重连，但 IPv4 仍需重新检测确认。";
  if (outcome === "failed") return "WARP 未恢复连接，请先重新检测。";
  return "";
}

export function toWarpEgressView(record = {}, { now = new Date().toISOString() } = {}) {
  const warp = record.observed?.warp || null;
  const localNames = warpNodeNames(record);
  const visible = Boolean(warp || localNames.length || serviceCandidate(record));
  if (!visible) return { visible: false };

  const checkedAt = safe(warp?.checkedAt, 40);
  const freshness = evidenceFreshness(checkedAt, { now });
  const latestAttemptFailed = warp?.lastProbeAttempt?.status === "failed";
  const latestAttemptAt = safe(warp?.lastProbeAttempt?.checkedAt, 40);
  const historical = ["stale", "unknown"].includes(freshness)
    || (latestAttemptFailed && (!checkedAt || new Date(latestAttemptAt).getTime() >= new Date(checkedAt).getTime()));
  const status = warp?.status || "unknown";
  const presentation = statusPresentation(status);
  const names = Array.isArray(warp?.affectedNodes?.names)
    ? warp.affectedNodes.names.map((name) => safe(name, 80)).filter(Boolean).slice(0, 20)
    : localNames;
  const affectedCount = Number(warp?.affectedNodes?.count) || names.length || localNames.length;
  const supported = warp?.supported === true;
  const reconnectEnabled = supported && ["connected", "degraded", "disconnected"].includes(status) && !latestAttemptFailed;
  const reconnectLabel = status === "disconnected"
    ? "恢复 WARP 连接"
    : warp?.lastReconnect?.outcome === "unchanged"
      ? "再试一次"
      : "重连并尝试换 IP";
  const primaryIpv4 = ipv4(warp?.ipv4);
  const primaryIpv6 = ipv6(warp?.ipv6);
  const protocol = safe(warp?.protocol, 24).toLowerCase();
  const protocolLabel = protocol === "masque" ? "MASQUE" : protocol === "wireguard" ? "WireGuard" : "未确认";
  const coloLabel = safe(warp?.colo?.ipv4 || warp?.colo?.ipv6, 8).toUpperCase() || "未获取";
  const latestAttemptMessage = latestAttemptFailed
    ? `最近检测失败：${safe(warp?.lastProbeAttempt?.error, 160) || "连接或状态读取失败"}`
    : "";

  return {
    visible,
    supported,
    status,
    statusLabel: presentation.label,
    statusTone: historical && status === "connected" ? "warning" : presentation.tone,
    manageLabel: "管理",
    reconnectEnabled,
    reconnectLabel,
    ipv4: primaryIpv4 || "未获取",
    ipv6: primaryIpv6 || "未获取",
    protocolLabel,
    proxyPort: Number(warp?.proxyPort) || 0,
    tierLabel: safe(warp?.tier, 20) === "free" ? "Free" : safe(warp?.tier, 20) || "未确认",
    coloLabel,
    affectedCount,
    affectedNames: names.length ? names : localNames,
    checkedAt,
    freshness,
    freshnessLabel: freshness === "fresh" ? "刚刚检测" : freshness === "aging" ? "近期证据" : freshness === "stale" ? "历史证据" : "待检测",
    historical,
    latestAttemptMessage,
    resultMessage: reconnectCopy(warp),
    capabilityReason: safe(warp?.capability?.reason, 160),
    summary: primaryIpv4
      ? `${primaryIpv4} · ${protocolLabel}${coloLabel !== "未获取" ? ` · ${coloLabel}` : ""}`
      : presentation.label
  };
}
