import { createHash } from "node:crypto";

import { evidenceFreshness } from "../public/lib/instance-evidence-freshness-view-model.js";
import { normalizeVmIdentity } from "./vm-identity.js";

const OWNER_MARKER = "managed-by=gcp-vm-console";
const IAP_SOURCE_RANGE = "35.235.240.0/20";
const PUBLIC_RANGES = new Set(["0.0.0.0/0", "::/0"]);
const SENSITIVE_PORTS = new Set(["22", "23", "3389", "5900", "8443", "9443"]);

function basename(value) {
  return String(value || "").split("/").filter(Boolean).at(-1) || "";
}

function strings(value) {
  return [...new Set((Array.isArray(value) ? value : []).map((item) => String(item || "").trim()).filter(Boolean))].sort();
}

function normalizeAllowed(value = []) {
  return (Array.isArray(value) ? value : []).map((item) => ({
    protocol: String(item?.IPProtocol || item?.ipProtocol || "").toLowerCase() || "all",
    ports: strings(item?.ports?.length ? item.ports : ["all"])
  })).sort((a, b) => a.protocol.localeCompare(b.protocol) || a.ports.join(",").localeCompare(b.ports.join(",")));
}

function sourceScope(sourceRanges = []) {
  const ranges = strings(sourceRanges);
  if (!ranges.length || ranges.some((range) => PUBLIC_RANGES.has(range.toLowerCase()))) return "open";
  const internal = ranges.every((range) => {
    const value = range.toLowerCase();
    const [first, second] = value.split(".").map(Number);
    return first === 10 || first === 127 ||
      (first === 169 && second === 254) ||
      (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && second === 168) ||
      value === "::1/128" || value.startsWith("fc") || value.startsWith("fd") || /^fe[89ab]/.test(value);
  });
  return internal ? "internal" : "restricted";
}

function ruleSourceScope(rule = {}) {
  if ((rule.sourceTags || []).length || (rule.sourceServiceAccounts || []).length) return "restricted";
  return sourceScope(rule.sourceRanges);
}

function portSpecContains(spec, expected) {
  if (!spec || spec === "all") return true;
  const [start, end = start] = String(spec).split("-").map(Number);
  const port = Number(expected);
  return Number.isFinite(start) && Number.isFinite(end) && Number.isFinite(port) && port >= start && port <= end;
}

function allowsAll(rule) {
  return normalizeAllowed(rule.allowed).some((allowed) => {
    if (allowed.protocol === "all") return true;
    if (!["tcp", "udp"].includes(allowed.protocol)) return false;
    return allowed.ports.some((port) => port === "all" || (portSpecContains(port, "1") && portSpecContains(port, "65535")));
  });
}

function allowedSensitivePorts(rule) {
  const ports = [];
  for (const allowed of normalizeAllowed(rule.allowed)) {
    for (const port of SENSITIVE_PORTS) {
      if ((allowed.protocol === "all" || allowed.protocol === "tcp") && allowed.ports.some((spec) => portSpecContains(spec, port))) ports.push(port);
    }
  }
  return strings(ports);
}

function severityFor(rule) {
  if (rule.disabled || String(rule.direction || "INGRESS").toUpperCase() !== "INGRESS") return "safe";
  if (!normalizeAllowed(rule.allowed).length) return "safe";
  if (ruleSourceScope(rule) !== "open") return "safe";
  if (allowsAll(rule)) return "critical";
  if (allowedSensitivePorts(rule).length) return "high";
  return "warning";
}

function isConsoleOwned(rule, identity) {
  const description = String(rule?.description || "");
  return description.includes(OWNER_MARKER) &&
    description.includes(`project=${identity.projectId}`);
}

function isOwnedByIdentity(rule, identity) {
  const description = String(rule?.description || "");
  return isConsoleOwned(rule, identity) && description.includes(`vm=${identity.name}`);
}

function appliesToInstance(rule, instance) {
  if (rule.disabled || String(rule.direction || "INGRESS").toUpperCase() !== "INGRESS") return false;
  const ruleNetwork = basename(rule.network);
  const instanceNetwork = basename(instance.network?.name || instance.network);
  if (ruleNetwork && instanceNetwork && ruleNetwork !== instanceNetwork) return false;
  const targetTags = strings(rule.targetTags);
  const instanceTags = new Set(strings(instance.tags));
  if (targetTags.length && !targetTags.some((tag) => instanceTags.has(tag))) return false;
  const targetServiceAccounts = strings(rule.targetServiceAccounts);
  if (targetServiceAccounts.length && !targetServiceAccounts.includes(String(instance.serviceAccount || ""))) return false;
  return true;
}

function normalizeRule(rule, identity, instances) {
  const affectedInstances = instances.filter((instance) => appliesToInstance(rule, instance)).map((instance) => instance.name).sort();
  return {
    name: String(rule.name || ""),
    network: basename(rule.network),
    direction: String(rule.direction || "INGRESS").toUpperCase(),
    priority: Number(rule.priority ?? 1000),
    disabled: Boolean(rule.disabled),
    sourceRanges: strings(rule.sourceRanges),
    sourceTags: strings(rule.sourceTags),
    sourceServiceAccountCount: strings(rule.sourceServiceAccounts).length,
    sourceScope: ruleSourceScope(rule),
    targetTags: strings(rule.targetTags),
    targetServiceAccountCount: strings(rule.targetServiceAccounts).length,
    targetScope: strings(rule.targetTags).length
      ? "tags"
      : strings(rule.targetServiceAccounts).length
        ? "service_accounts"
        : "all_instances",
    allowed: normalizeAllowed(rule.allowed),
    sensitivePorts: allowedSensitivePorts(rule),
    severity: severityFor(rule),
    ownership: isConsoleOwned(rule, identity) ? "console_owned" : "external",
    affectedInstances
  };
}

function uniqueTagFor(instance, instances) {
  const otherTags = new Set(instances.filter((candidate) => candidate.name !== instance.name).flatMap((candidate) => strings(candidate.tags)));
  const unique = strings(instance.tags).filter((tag) => !otherTags.has(tag));
  return unique.find((tag) => tag === instance.name) || unique.find((tag) => tag.startsWith(`${instance.name}-`)) || unique[0] || "";
}

function normalizedPorts(ports) {
  return strings(ports).sort((a, b) => Number(a) - Number(b));
}

function validPort(value) {
  const text = String(value || "");
  const number = Number(text);
  return /^\d{1,5}$/.test(text) && Number.isInteger(number) && number >= 1 && number <= 65535;
}

function ruleCovers(rule, desired, instance) {
  if (!appliesToInstance(rule, instance)) return false;
  if (ruleSourceScope(rule) !== sourceScope(desired.sourceRanges)) return false;
  const ruleRanges = strings(rule.sourceRanges);
  if (JSON.stringify(ruleRanges) !== JSON.stringify(strings(desired.sourceRanges))) return false;
  const allowed = normalizeAllowed(rule.allowed);
  return desired.ports.every((port) => allowed.some((item) => (
    (item.protocol === "all" || item.protocol === desired.protocol) && item.ports.some((spec) => portSpecContains(spec, port))
  )));
}

function safeSlug(value) {
  const slug = String(value || "").toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "") || "vm";
  return slug.slice(0, 28).replace(/-+$/g, "") || "vm";
}

function ownedRuleName(identity, purpose, protocol, collisionSeed = "") {
  const base = `gvc-${safeSlug(identity.name)}-${purpose}-${protocol}`;
  if (!collisionSeed && base.length <= 63) return base;
  const hash = createHash("sha256").update(`${identity.projectId}:${identity.name}:${purpose}:${protocol}:${collisionSeed}`).digest("hex").slice(0, 8);
  return `${base.slice(0, Math.max(1, 54 - hash.length)).replace(/-+$/g, "")}-${hash}`.slice(0, 63);
}

function availableOwnedRule({ identity, purpose, protocol, rules }) {
  let collisionSeed = "";
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const name = ownedRuleName(identity, purpose, protocol, collisionSeed);
    const existing = rules.find((rule) => rule.name === name) || null;
    if (!existing || isOwnedByIdentity(existing, identity)) return { name, existing };
    collisionSeed = `${name}:${existing.description || "external"}:${attempt + 1}`;
  }
  return null;
}

function desiredAction({ identity, instance, instances, rules, purpose, protocol, ports, sourceRanges }) {
  const targetTag = uniqueTagFor(instance, instances);
  const safePorts = normalizedPorts(ports).filter(validPort);
  if (!targetTag || !safePorts.length) return null;
  const desired = { protocol, ports: safePorts, sourceRanges: strings(sourceRanges), targetTags: [targetTag] };
  if (rules.some((rule) => ruleCovers(rule, desired, instance) && strings(rule.targetTags).length > 0)) return null;

  const available = availableOwnedRule({ identity, purpose, protocol, rules });
  if (!available) return null;
  const { name, existing } = available;
  return {
    action: existing ? "update" : "create",
    name,
    purpose,
    network: instance.network?.name || "default",
    protocol,
    ports: desired.ports,
    sourceRanges: desired.sourceRanges,
    targetTags: desired.targetTags
  };
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
}

function fingerprintFor(value) {
  return createHash("sha256").update(JSON.stringify(stableValue(value))).digest("hex");
}

export function buildFirewallGovernancePreview({ record, instances = [], rules = [], now = new Date().toISOString() } = {}) {
  const identity = normalizeVmIdentity(record?.identity || {});
  const checkedAt = new Date(now).toISOString();
  const cloudInstances = [...instances].map((instance) => ({
    ...instance,
    name: String(instance.name || ""),
    network: { ...(instance.network || {}), name: basename(instance.network?.name || instance.network) },
    tags: strings(instance.tags)
  })).filter((instance) => instance.name);
  const selected = cloudInstances.find((instance) => instance.name === identity.name && instance.zone === identity.zone) ||
    cloudInstances.find((instance) => instance.name === identity.name) || null;
  const normalizedRules = rules.map((rule) => normalizeRule(rule, identity, cloudInstances));
  const findings = normalizedRules;
  const riskyExternal = findings.filter((rule) => rule.ownership === "external" && ["critical", "high", "warning"].includes(rule.severity));
  const externalActions = riskyExternal.map((rule) => ({
    type: "manual-review",
    ruleName: rule.name,
    severity: rule.severity,
    reason: "外部共享规则不由控制台自动修改"
  }));
  const verification = record?.verification || {};
  const freshness = evidenceFreshness(verification.checkedAt, { now: checkedAt });
  const fresh = freshness === "fresh";
  const uniqueTag = selected ? uniqueTagFor(selected, cloudInstances) : "";
  const blocked = [];
  if (!selected) blocked.push("未在实时清单中找到所选实例");
  if (selected && !uniqueTag) blocked.push("缺少实例唯一标签");
  if (!fresh) blocked.push("验证证据已过期");

  const ownedActions = [];
  if (selected && uniqueTag && fresh) {
    const ssh = verification.ssh || {};
    const verifiedSshPort = String(ssh.actualPort || "");
    const sshPorts = ssh.verified && validPort(verifiedSshPort)
      ? normalizedPorts(["22", verifiedSshPort]).filter(validPort)
      : [];
    const sshAction = desiredAction({
      identity,
      instance: selected,
      instances: cloudInstances,
      rules,
      purpose: "ssh-iap",
      protocol: "tcp",
      ports: sshPorts,
      sourceRanges: [IAP_SOURCE_RANGE]
    });
    if (sshAction) ownedActions.push(sshAction);

    const publicPorts = new Map();
    for (const port of verification.ports || []) {
      const protocol = String(port?.protocol || "").toLowerCase();
      const number = String(port?.port || "");
      const scope = String(port?.scope || "").toLowerCase();
      if (!port?.listening || !["network", "wildcard"].includes(scope) || !["tcp", "udp"].includes(protocol) || !validPort(number)) continue;
      publicPorts.set(protocol, [...(publicPorts.get(protocol) || []), number]);
    }
    for (const [protocol, ports] of publicPorts) {
      const serviceAction = desiredAction({
        identity,
        instance: selected,
        instances: cloudInstances,
        rules,
        purpose: "public-service",
        protocol,
        ports,
        sourceRanges: ["0.0.0.0/0"]
      });
      if (serviceAction) ownedActions.push(serviceAction);
    }
  }

  const severityOrder = { safe: 0, warning: 1, high: 2, critical: 3 };
  const severity = findings.reduce((current, finding) => (
    severityOrder[finding.severity] > severityOrder[current] ? finding.severity : current
  ), "safe");
  const fingerprintInput = {
    identity,
    selected,
    instances: cloudInstances.map((instance) => ({ name: instance.name, zone: instance.zone, network: instance.network?.name, tags: instance.tags, status: instance.status })),
    rules: normalizedRules,
    verification: {
      checkedAt: verification.checkedAt || "",
      ssh: verification.ssh || null,
      ports: verification.ports || []
    },
    ownedActions,
    externalActions
  };

  return {
    schemaVersion: 1,
    checkedAt,
    expiresAt: new Date(new Date(checkedAt).getTime() + 15 * 60 * 1000).toISOString(),
    fingerprint: fingerprintFor(fingerprintInput),
    severity,
    findings,
    affectedInstances: strings(riskyExternal.flatMap((finding) => finding.affectedInstances)),
    coverage: {
      selectedInstance: identity.name,
      uniqueTag,
      freshness,
      ready: Boolean(selected && uniqueTag && fresh),
      blockedReason: blocked.join("；")
    },
    ownedActions,
    externalActions
  };
}

export function createFirewallGovernanceService({
  inventory,
  firewallService,
  now = () => new Date().toISOString()
} = {}) {
  if (!inventory?.listInstances) throw new Error("inventory with listInstances() is required.");
  if (!firewallService?.listRules) throw new Error("firewallService with listRules() is required.");

  async function preview(record, { instances = null, rules = null, readCache = null } = {}) {
    const identity = normalizeVmIdentity(record?.identity || {});
    const [projectInstances, projectRules] = await Promise.all([
      Array.isArray(instances) ? instances : inventory.listInstances(identity),
      Array.isArray(rules) ? rules : firewallService.listRules(identity, { readCache })
    ]);
    return buildFirewallGovernancePreview({ record, instances: projectInstances, rules: projectRules, now: now() });
  }

  return { preview };
}
