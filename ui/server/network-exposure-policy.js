import { createHash } from "node:crypto";

import { evidenceFreshness } from "../public/lib/instance-evidence-freshness-view-model.js";
import { normalizeVmIdentity } from "./vm-identity.js";

const IAP_SOURCE_RANGE = "35.235.240.0/20";
const PUBLIC_SOURCE_RANGE = "0.0.0.0/0";
const KNOWN_PROCESS = /(sing-box|x-ui|xray|v2ray|hysteria|tuic)/i;

function strings(value) {
  return [...new Set((Array.isArray(value) ? value : []).map((item) => String(item || "").trim()).filter(Boolean))].sort();
}

function basename(value) {
  return String(value || "").split("/").filter(Boolean).at(-1) || "";
}

function validPort(value) {
  const text = String(value || "");
  const number = Number(text);
  return /^\d{1,5}$/.test(text) && Number.isInteger(number) && number >= 1 && number <= 65535;
}

function normalizePort(input) {
  const protocol = String(input?.protocol || "").toLowerCase();
  const port = String(input?.port || "");
  if (!["tcp", "udp"].includes(protocol) || !validPort(port)) return null;
  return { protocol, port };
}

function portKey(input) {
  return `${input.protocol}/${input.port}`;
}

function sortPorts(value) {
  return [...new Map((value || []).map(normalizePort).filter(Boolean).map((port) => [portKey(port), port])).values()]
    .sort((a, b) => a.protocol.localeCompare(b.protocol) || Number(a.port) - Number(b.port));
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
}

function fingerprintFor(value) {
  return createHash("sha256").update(JSON.stringify(stableValue(value))).digest("hex");
}

function appliesToInstance(rule, instance) {
  if (rule?.disabled || String(rule?.direction || "INGRESS").toUpperCase() !== "INGRESS") return false;
  const network = basename(instance?.network?.name || instance?.network);
  if (basename(rule?.network) && network && basename(rule.network) !== network) return false;
  const tags = new Set(strings(instance?.tags));
  const targetTags = strings(rule?.targetTags);
  if (targetTags.length && !targetTags.some((tag) => tags.has(tag))) return false;
  const serviceAccounts = strings(rule?.targetServiceAccounts);
  if (serviceAccounts.length && !serviceAccounts.includes(String(instance?.serviceAccount || ""))) return false;
  return true;
}

function hasAllow(rule) {
  return Array.isArray(rule?.allowed) && rule.allowed.length > 0;
}

function hasDeny(rule) {
  return Array.isArray(rule?.denied) && rule.denied.length > 0;
}

function safePriority(value) {
  const number = Number(value ?? 1000);
  return Number.isInteger(number) && number >= 0 && number <= 65535 ? number : 1000;
}

function priorityIsKnown(value) {
  if (value === null || value === undefined || String(value).trim() === "") return false;
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 && number <= 65535;
}

function choosePriorities(rules, selected) {
  const applicableAllows = rules.filter((rule) => appliesToInstance(rule, selected) && hasAllow(rule));
  const ceiling = applicableAllows.length
    ? Math.min(...applicableAllows.map((rule) => safePriority(rule.priority)))
    : 1000;
  const used = new Set(rules.map((rule) => safePriority(rule.priority)));
  for (let denyPriority = ceiling - 1; denyPriority >= 1; denyPriority -= 1) {
    const allowPriority = denyPriority - 1;
    if (!used.has(allowPriority) && !used.has(denyPriority)) return { allowPriority, denyPriority, ceiling };
  }
  return null;
}

function isolationTag(identity) {
  const hash = createHash("sha256")
    .update(`${identity.projectId}:${identity.zone}:${identity.name}`)
    .digest("hex")
    .slice(0, 12);
  return `gvc-isolate-${hash}`;
}

function safeRuleName(identity, suffix) {
  const slug = String(identity.name || "vm").toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "") || "vm";
  const hash = createHash("sha256").update(`${identity.projectId}:${identity.zone}:${identity.name}:${suffix}`).digest("hex").slice(0, 8);
  return `gvc-${slug.slice(0, 38).replace(/-+$/g, "")}-${suffix}-${hash}`.slice(0, 63).replace(/-+$/g, "");
}

function isPolicyOwnedRule(rule, identity, expectedNames) {
  const description = String(rule?.description || "");
  return expectedNames.has(String(rule?.name || ""))
    && description.includes("managed-by=gcp-vm-console")
    && description.includes(`vm=${identity.name}`)
    && description.includes(`project=${identity.projectId}`);
}

function normalizeCandidate(port) {
  const normalized = normalizePort(port);
  const scope = String(port?.scope || port?.exposureScope || "").toLowerCase();
  if (!normalized || port?.listening === false || !["network", "wildcard"].includes(scope)) return null;
  if (normalized.protocol === "tcp" && ["22", "45400"].includes(normalized.port)) return null;
  const process = String(port?.process || "").slice(0, 80);
  return {
    ...normalized,
    process,
    scope,
    selectedByDefault: KNOWN_PROCESS.test(process),
    eligible: true
  };
}

function currentExplicitPublicPorts(rules, selected) {
  const ports = [];
  for (const rule of rules.filter((candidate) => appliesToInstance(candidate, selected) && hasAllow(candidate))) {
    const ranges = strings(rule.sourceRanges);
    if (ranges.length && !ranges.includes(PUBLIC_SOURCE_RANGE)) continue;
    for (const allowed of rule.allowed || []) {
      const protocol = String(allowed.IPProtocol || allowed.ipProtocol || "").toLowerCase();
      if (!["tcp", "udp"].includes(protocol)) continue;
      for (const port of allowed.ports || []) {
        if (validPort(port)) ports.push({ protocol, port: String(port) });
      }
    }
  }
  return sortPorts(ports);
}

function portDiff(current, desired) {
  const currentMap = new Map(current.map((port) => [portKey(port), port]));
  const desiredMap = new Map(desired.map((port) => [portKey(port), port]));
  return {
    open: desired.filter((port) => !currentMap.has(portKey(port))),
    retain: desired.filter((port) => currentMap.has(portKey(port))),
    close: current.filter((port) => !desiredMap.has(portKey(port)))
  };
}

export function buildNetworkExposurePreview({
  record,
  instances = [],
  rules = [],
  selection = {},
  secretStatus = {},
  now = new Date().toISOString()
} = {}) {
  const identity = normalizeVmIdentity(record?.identity || {});
  const checkedAt = new Date(now).toISOString();
  const selected = instances.find((instance) => instance?.name === identity.name && (!instance.zone || instance.zone === identity.zone)) || null;
  const evidenceAt = String(record?.verification?.checkedAt || "");
  const freshness = evidenceFreshness(evidenceAt, { now: checkedAt });
  const portCandidates = (record?.verification?.ports || []).map(normalizeCandidate).filter(Boolean)
    .sort((a, b) => a.protocol.localeCompare(b.protocol) || Number(a.port) - Number(b.port));
  const candidateKeys = new Set(portCandidates.map(portKey));
  const requested = sortPorts(selection?.ports || portCandidates.filter((candidate) => candidate.selectedByDefault));
  const invalidRequested = requested.filter((port) => !candidateKeys.has(portKey(port)));
  const selectedPorts = requested.filter((port) => candidateKeys.has(portKey(port)));
  const desiredPublic = sortPorts([
    { protocol: "tcp", port: "45400" },
    ...(selection?.publicSsh22 ? [{ protocol: "tcp", port: "22" }] : []),
    ...selectedPorts
  ]);
  const desiredIap = sortPorts([
    { protocol: "tcp", port: "22" },
    { protocol: "tcp", port: "45400" }
  ]);
  const targetTag = isolationTag(identity);
  const ruleNames = {
    sshIap: safeRuleName(identity, "ssh-iap"),
    publicTcp: safeRuleName(identity, "public-tcp"),
    publicUdp: safeRuleName(identity, "public-udp"),
    isolationDeny: safeRuleName(identity, "isolation-deny")
  };
  const expectedRuleNames = new Set(Object.values(ruleNames));
  const priorityRules = rules.filter((rule) => !isPolicyOwnedRule(rule, identity, expectedRuleNames));
  const prioritiesKnown = rules.every((rule) => priorityIsKnown(rule?.priority));
  const priorities = selected && prioritiesKnown ? choosePriorities(priorityRules, selected) : null;
  const externalRuleNameCollisions = rules.filter((rule) => (
    expectedRuleNames.has(String(rule?.name || ""))
    && !isPolicyOwnedRule(rule, identity, expectedRuleNames)
  ));
  const tagCollision = instances.some((instance) => instance?.name !== identity.name && strings(instance?.tags).includes(targetTag));
  const tagsKnown = Boolean(selected && Array.isArray(selected.tags));
  const networkName = basename(selected?.network?.name || selected?.network);
  const running = String(selected?.status || "").toUpperCase() === "RUNNING";
  const targetHasTag = Boolean(selected && strings(selected.tags).includes(targetTag));
  const tagLimitReached = Boolean(selected && !targetHasTag && strings(selected.tags).length >= 64);
  const higherDeny = Boolean(selected && priorityRules.some((rule) => (
    appliesToInstance(rule, selected) && hasDeny(rule) && priorities && safePriority(rule.priority) <= priorities.allowPriority
  )));
  const blocked = [];
  if (!selected) blocked.push("未在实时清单中找到所选实例");
  if (selected && !running) blocked.push("实例实时状态不是 RUNNING 或状态不完整");
  if (selected && !tagsKnown) blocked.push("实例标签实时状态不完整");
  if (selected && !networkName) blocked.push("实例网络实时状态不完整");
  if (freshness !== "fresh") blocked.push("监听证据已过期，请重新运行只读探测");
  if (!secretStatus?.configured || !secretStatus?.versionId) blocked.push("尚未配置本地统一 SSH 密码");
  if (invalidRequested.length) blocked.push("所选端口不在当前新鲜监听证据中");
  if (!prioritiesKnown) blocked.push("防火墙规则优先级状态不完整");
  if (prioritiesKnown && !priorities) blocked.push("没有可安全使用的防火墙优先级");
  if (externalRuleNameCollisions.length) blocked.push("控制台规则名称与外部规则冲突");
  if (tagCollision) blocked.push("实例隔离标签与其他实例冲突");
  if (tagLimitReached) blocked.push("实例网络标签已达到上限");
  if (higherDeny) blocked.push("更高优先级的现有 deny 规则会阻止所选端口");

  const currentPublic = selected ? currentExplicitPublicPorts(rules, selected) : [];
  const changes = portDiff(currentPublic, desiredPublic);
  const ruleActions = priorities && externalRuleNameCollisions.length === 0 ? [
    {
      purpose: "ssh-iap",
      name: ruleNames.sshIap,
      action: "ensure-allow",
      network: networkName,
      protocol: "tcp",
      ports: desiredIap.filter((port) => port.protocol === "tcp").map((port) => port.port),
      sourceRanges: [IAP_SOURCE_RANGE],
      targetTags: [targetTag],
      priority: priorities.allowPriority
    },
    ...["tcp", "udp"].flatMap((protocol) => {
      const ports = desiredPublic.filter((port) => port.protocol === protocol).map((port) => port.port);
      return ports.length ? [{
        purpose: "public-service",
        name: protocol === "tcp" ? ruleNames.publicTcp : ruleNames.publicUdp,
        action: "ensure-allow",
        network: networkName,
        protocol,
        ports,
        sourceRanges: [PUBLIC_SOURCE_RANGE],
        targetTags: [targetTag],
        priority: priorities.allowPriority
      }] : [];
    }),
    {
      purpose: "isolation-deny",
      name: ruleNames.isolationDeny,
      action: "ensure-deny",
      network: networkName,
      sourceRanges: [PUBLIC_SOURCE_RANGE],
      targetTags: [targetTag],
      priority: priorities.denyPriority,
      disabled: true
    }
  ] : [];
  const fingerprintInput = {
    identity,
    selected: selected ? {
      name: selected.name,
      zone: selected.zone || identity.zone,
      network: basename(selected.network?.name || selected.network),
      tags: strings(selected.tags),
      status: String(selected.status || "")
    } : null,
    evidenceAt,
    portCandidates,
    desiredPublic,
    desiredIap,
    secretVersion: String(secretStatus?.versionId || ""),
    targetTag,
    priorities,
    rules: rules.map((rule) => ({
      name: String(rule.name || ""),
      priority: safePriority(rule.priority),
      disabled: Boolean(rule.disabled),
      direction: String(rule.direction || "INGRESS"),
      network: basename(rule.network),
      sourceRanges: strings(rule.sourceRanges),
      targetTags: strings(rule.targetTags),
      allowed: rule.allowed || [],
      denied: rule.denied || []
    })),
    ruleActions
  };

  return {
    schemaVersion: 2,
    checkedAt,
    expiresAt: new Date(new Date(checkedAt).getTime() + 15 * 60 * 1000).toISOString(),
    fingerprint: fingerprintFor(fingerprintInput),
    coverage: {
      ready: blocked.length === 0,
      freshness,
      blockedReason: blocked.join("；")
    },
    portCandidates,
    selection: { publicSsh22: Boolean(selection?.publicSsh22), ports: selectedPorts },
    desiredExposure: { public: desiredPublic, iap: desiredIap },
    changes,
    isolation: {
      targetTag,
      tagAction: targetHasTag ? "reuse" : "add",
      allowPriority: priorities?.allowPriority ?? null,
      denyPriority: priorities?.denyPriority ?? null,
      externalRuleNames: strings(rules.filter((rule) => selected && appliesToInstance(rule, selected) && hasAllow(rule)).map((rule) => rule.name)).slice(0, 12),
      ruleActions
    },
    sshPolicy: {
      passwordVersion: String(secretStatus?.versionId || ""),
      entries: [
        { port: 22, exposure: selection?.publicSsh22 ? "public+iap" : "iap", authentication: "publickey,password" },
        { port: 45400, exposure: "public+iap", authentication: "publickey" }
      ]
    }
  };
}
