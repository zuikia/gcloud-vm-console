import { recognizeDeployment } from "./deployment-recognition.js";
import { normalizeVmIdentity } from "./vm-identity.js";

const SECRET = /(?:vless|vmess|hy2|hysteria2|tuic|ss):\/\/|password|passwd|token|secret|private[_ -]?key|credential/i;
const safeText = (value, max = 240) => {
  const text = String(value || "").replace(/[\r\n\t]+/g, " ").trim();
  if (!text || SECRET.test(text)) return "";
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
};

function safeCloud(value, identity) {
  if (!value || typeof value !== "object") return null;
  const metadata = {};
  for (const key of ["gvcDeployMethod", "gvc-deploy-method"]) {
    const safe = safeText(value.metadata?.[key]);
    if (safe) metadata[key] = safe;
  }
  const labels = {};
  for (const [key, item] of Object.entries(value.labels || {})) {
    if (!/^(?:gvc[_-]|deploy[_-])/i.test(key)) continue;
    const safe = safeText(item, 80);
    if (safe) labels[key] = safe;
  }
  return {
    ...identity, exists: value.exists !== false, status: safeText(value.status, 40), machineType: safeText(value.machineType, 120),
    labels, metadata,
    tags: (Array.isArray(value.tags) ? value.tags : []).map((item) => safeText(item, 80)).filter(Boolean).slice(0, 32),
    network: {
      name: safeText(value.network?.name, 120), subnet: safeText(value.network?.subnet, 120),
      internalIp: safeText(value.network?.internalIp, 80), externalIp: safeText(value.network?.externalIp, 80),
      externalIpMode: safeText(value.network?.externalIpMode, 40), networkTier: safeText(value.network?.networkTier, 20)
    }
  };
}

function safeGuest(value) {
  const values = {};
  for (const [key, item] of Object.entries(value?.values || {})) {
    if (SECRET.test(key)) continue;
    const safe = safeText(item);
    if (safe) values[key] = safe;
  }
  return {
    available: Boolean(value?.available && Object.keys(values).length), namespace: safeText(value?.namespace, 80), values,
    warnings: (Array.isArray(value?.warnings) ? value.warnings : []).map((item) => safeText(item)).filter(Boolean).slice(0, 16)
  };
}

function safeSshProbe(value) {
  const stringList = (items, max = 24) => (Array.isArray(items) ? items : [])
    .map((item) => safeText(typeof item === "string" ? item : JSON.stringify(item), 160)).filter(Boolean).slice(0, max);
  return {
    ssh: value?.ssh ? {
      desiredPort: Number(value.ssh.desiredPort) || null, actualPort: Number(value.ssh.actualPort) || null,
      verified: Boolean(value.ssh.verified), fallback: Boolean(value.ssh.fallback), label: safeText(value.ssh.label)
    } : null,
    services: (Array.isArray(value?.services) ? value.services : []).map((item) => ({
      name: safeText(item?.name, 80), status: safeText(item?.status, 40)
    })).filter((item) => item.name).slice(0, 24),
    ports: (Array.isArray(value?.ports) ? value.ports : []).map((item) => ({
      protocol: safeText(item?.protocol, 12), port: safeText(item?.port, 12), process: safeText(item?.process, 100),
      listening: item?.listening !== false, exposureScope: safeText(item?.exposureScope, 24)
    })).filter((item) => item.protocol && item.port).slice(0, 48),
    units: stringList(value?.units), processes: stringList(value?.processes), files: stringList(value?.files),
    containers: stringList(value?.containers), versions: stringList(value?.versions), configSummary: stringList(value?.configSummary),
    bbr: value?.bbr && typeof value.bbr === "object" ? {
      enabled: Boolean(value.bbr.enabled), congestionControl: safeText(value.bbr.congestionControl, 40), qdisc: safeText(value.bbr.qdisc, 40)
    } : { enabled: Boolean(value?.bbr), congestionControl: "", qdisc: "" },
    warnings: stringList(value?.warnings, 16), checkedAt: safeText(value?.checkedAt, 40)
  };
}

function safeFirewall(value) {
  const ports = (items) => (Array.isArray(items) ? items : []).map((item) => ({
    protocol: safeText(item?.protocol, 12), port: safeText(item?.port, 12), rule: safeText(item?.rule, 100)
  })).filter((item) => item.protocol && item.port).slice(0, 48);
  return {
    status: safeText(value?.status, 40) || "unknown", matchedPorts: ports(value?.matchedPorts),
    missingPorts: ports(value?.missingPorts), exposedPorts: ports(value?.exposedPorts),
    broadRuleNames: [
      ...(Array.isArray(value?.broadRuleNames) ? value.broadRuleNames : []),
      ...(Array.isArray(value?.broadRules) ? value.broadRules.map((rule) => rule?.name) : [])
    ].map((item) => safeText(item, 100)).filter(Boolean).slice(0, 24),
    error: safeText(value?.error || value?.warning)
  };
}

function expectedPortsFromProbe(sshProbe = {}) {
  const sshPorts = new Set([sshProbe?.ssh?.desiredPort, sshProbe?.ssh?.actualPort].filter(Boolean).map(String));
  const seen = new Set();
  return (sshProbe.ports || []).filter((port) => {
    if (port?.listening === false || port?.exposureScope === "loopback" || !port?.protocol || !port?.port) return false;
    if (/(sing-box|x-ui|xray|v2ray|hysteria|tuic)/i.test(String(port.process || ""))) return true;
    return /sshd/i.test(String(port.process || "")) && sshPorts.has(String(port.port));
  }).map((port) => ({ protocol: String(port.protocol).toLowerCase(), port: String(port.port) })).filter((port) => {
    const number = Number(port.port);
    if (!["tcp", "udp"].includes(port.protocol) || !/^\d{1,5}$/.test(port.port) || !Number.isInteger(number) || number < 1 || number > 65535) return false;
    const key = `${port.protocol}/${port.port}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function createRecognitionProbeService({ inventory, guestAttributesService, deploymentProbeService, firewallService, now = () => new Date().toISOString() } = {}) {
  if (!inventory?.readObserved) throw new Error("inventory with readObserved() is required.");
  if (!guestAttributesService?.readConsoleAttributes) throw new Error("guestAttributesService with readConsoleAttributes() is required.");
  if (!deploymentProbeService?.probe) throw new Error("deploymentProbeService with probe() is required.");
  if (!firewallService?.inspectInstanceExposure) throw new Error("firewallService with inspectInstanceExposure() is required.");
  return {
    async probe({ identity: rawIdentity, ssh = {}, localRecord = null, readCache = null } = {}) {
      const identity = normalizeVmIdentity(rawIdentity);
      const [rawCloud, rawGuest, rawSsh] = await Promise.all([
        inventory.readObserved(identity), guestAttributesService.readConsoleAttributes(identity), deploymentProbeService.probe(identity, ssh)
      ]);
      const cloudInstance = safeCloud(rawCloud, identity);
      const guestAttributes = safeGuest(rawGuest);
      const sshProbe = safeSshProbe(rawSsh);
      const firewallProbe = safeFirewall(await firewallService.inspectInstanceExposure({
        identity, cloudInstance: cloudInstance || {}, expectedPorts: expectedPortsFromProbe(sshProbe), readCache
      }));
      const recognition = recognizeDeployment({ localRecord, cloudInstance, guestAttributes, sshProbe, firewallProbe });
      return { cloudInstance, guestAttributes, sshProbe, firewallProbe, recognition, checkedAt: now() };
    }
  };
}
