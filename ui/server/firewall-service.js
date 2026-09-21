import { normalizeVmIdentity } from "./vm-identity.js";
import { createSingleFlight } from "./single-flight.js";

const OWNER_MARKER = "managed-by=gcp-vm-console";

function required(value, label) {
  const normalized = String(value || "").trim();
  if (!normalized) throw new Error(`${label} is required.`);
  return normalized;
}

function normalizeList(values, label) {
  const list = Array.isArray(values) ? values : String(values || "").split(",");
  const normalized = [...new Set(list.map((value) => String(value || "").trim()).filter(Boolean))];
  if (!normalized.length) throw new Error(`${label} is required.`);
  return normalized;
}

function normalizePorts(ports) {
  return normalizeList(ports, "ports").sort((a, b) => Number(a) - Number(b));
}

function normalizePriority(value, requiredValue = false) {
  if (value === undefined || value === null || value === "") {
    if (requiredValue) throw new Error("priority is required.");
    return null;
  }
  const priority = Number(value);
  if (!Number.isInteger(priority) || priority < 0 || priority > 65535) throw new Error("priority must be between 0 and 65535.");
  return priority;
}

function isNotFound(error) {
  return /not found|404|was not found/i.test(error?.message || "");
}

function isOwned(rule, identity) {
  const description = String(rule?.description || "");
  return description.includes(OWNER_MARKER) &&
    description.includes(`vm=${identity.name}`) &&
    description.includes(`project=${identity.projectId}`);
}

function allowFlag(protocol, ports) {
  const normalizedProtocol = required(protocol, "protocol");
  return `--allow=${normalizePorts(ports).map((port) => `${normalizedProtocol}:${port}`).join(",")}`;
}

function descriptionFlag(identity) {
  return `--description=${OWNER_MARKER};vm=${identity.name};project=${identity.projectId}`;
}

function projectOptions(identity) {
  return {
    context: {
      configuration: identity.configuration,
      account: identity.account,
      projectId: identity.projectId
    },
    allowGlobal: true
  };
}

function instanceOptions(identity) {
  return {
    context: {
      configuration: identity.configuration,
      account: identity.account,
      projectId: identity.projectId
    },
    location: { zone: identity.zone },
    operationClass: "write"
  };
}

function basename(value) {
  return String(value || "").split("/").filter(Boolean).at(-1) || "";
}

function sourceRangeScope(sourceRanges = []) {
  const ranges = Array.isArray(sourceRanges) && sourceRanges.length ? sourceRanges : ["0.0.0.0/0"];
  if (ranges.some((range) => ["0.0.0.0/0", "::/0"].includes(String(range || "").toLowerCase()))) return "open";
  const internalOnly = ranges.every((range) => {
    const value = String(range || "").toLowerCase();
    const first = Number(value.split(".")[0]);
    const second = Number(value.split(".")[1]);
    return first === 10 ||
      first === 127 ||
      (first === 169 && second === 254) ||
      (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && second === 168) ||
      value === "::1/128" ||
      value.startsWith("fc") ||
      value.startsWith("fd") ||
      /^fe[89ab]/.test(value);
  });
  return internalOnly ? "internal" : "restricted";
}

function ruleSourceScope(rule = {}) {
  if ((rule.sourceTags || []).length || (rule.sourceServiceAccounts || []).length) return "restricted";
  return sourceRangeScope(rule.sourceRanges);
}

function sameRule(rule, desired) {
  const existingPorts = normalizePorts((rule.allowed || [])
    .filter((item) => item.IPProtocol === desired.protocol)
    .flatMap((item) => item.ports || []));
  return JSON.stringify(existingPorts) === JSON.stringify(normalizePorts(desired.ports)) &&
    JSON.stringify(normalizeList(rule.sourceRanges || [], "sourceRanges").sort()) === JSON.stringify(normalizeList(desired.sourceRanges, "sourceRanges").sort()) &&
    JSON.stringify(normalizeList(rule.targetTags || [], "targetTags").sort()) === JSON.stringify(normalizeList(desired.targetTags, "targetTags").sort()) &&
    (desired.priority == null || Number(rule.priority ?? 1000) === desired.priority);
}

function sameDenyRule(rule, desired) {
  const deniesAll = (rule.denied || []).some((item) => String(item.IPProtocol || item.ipProtocol || "").toLowerCase() === "all");
  return deniesAll &&
    JSON.stringify(normalizeList(rule.sourceRanges || [], "sourceRanges").sort()) === JSON.stringify(normalizeList(desired.sourceRanges, "sourceRanges").sort()) &&
    JSON.stringify(normalizeList(rule.targetTags || [], "targetTags").sort()) === JSON.stringify(normalizeList(desired.targetTags, "targetTags").sort()) &&
    Number(rule.priority ?? 1000) === desired.priority &&
    Boolean(rule.disabled) === desired.disabled;
}

function listRulePorts(rule = {}) {
  const output = [];
  const sourceScope = ruleSourceScope(rule);
  for (const allowed of rule.allowed || []) {
    const protocol = String(allowed.IPProtocol || allowed.ipProtocol || "").toLowerCase();
    const ports = allowed.ports?.length ? allowed.ports : ["all"];
    for (const port of ports) {
      output.push({
        protocol,
        port: String(port),
        rule: rule.name || "",
        sourceRanges: rule.sourceRanges || [],
        sourceTags: rule.sourceTags || [],
        sourceServiceAccounts: rule.sourceServiceAccounts || [],
        sourceScope,
        targetTags: rule.targetTags || [],
        targetServiceAccounts: rule.targetServiceAccounts || []
      });
    }
  }
  return output;
}

function portSpecMatches(spec = "", port = "") {
  if (!spec || spec === "all") return true;
  const [start, end = start] = String(spec).split("-").map(Number);
  const expected = Number(port);
  return Number.isFinite(start) && Number.isFinite(end) && Number.isFinite(expected) && expected >= start && expected <= end;
}

function matchingRulePort(rules = [], expected = {}, scopes = []) {
  for (const rule of rules) {
    const sourceScope = ruleSourceScope(rule);
    if (!scopes.includes(sourceScope)) continue;
    for (const allowed of rule.allowed || []) {
      const protocol = String(allowed.IPProtocol || allowed.ipProtocol || "").toLowerCase();
      if (protocol !== "all" && protocol !== expected.protocol) continue;
      if (!allowed.ports?.length || allowed.ports.some((spec) => portSpecMatches(spec, expected.port))) {
        return {
          ...expected,
          rule: rule.name || "",
          sourceRanges: rule.sourceRanges || [],
          sourceTags: rule.sourceTags || [],
          sourceServiceAccounts: rule.sourceServiceAccounts || [],
          sourceScope,
          targetTags: rule.targetTags || [],
          targetServiceAccounts: rule.targetServiceAccounts || []
        };
      }
    }
  }
  return null;
}

function ruleAllowsAllPublicPorts(rule = {}) {
  if (ruleSourceScope(rule) !== "open") return false;
  const fullProtocols = new Set((rule.allowed || [])
    .filter((allowed) => (
      !allowed.ports?.length ||
      allowed.ports.some((spec) => portSpecMatches(spec, "1") && portSpecMatches(spec, "65535"))
    ))
    .map((allowed) => String(allowed.IPProtocol || allowed.ipProtocol || "").toLowerCase()));
  return fullProtocols.has("all") || (fullProtocols.has("tcp") && fullProtocols.has("udp"));
}

function ruleMatchesInstance(rule = {}, cloudInstance = {}) {
  if (String(rule.direction || "INGRESS").toUpperCase() !== "INGRESS") return false;
  if (rule.disabled === true) return false;
  const networkName = cloudInstance.network?.name || "";
  if (networkName && basename(rule.network) && basename(rule.network) !== networkName) return false;
  const instanceTags = new Set(cloudInstance.tags || []);
  const ruleTags = rule.targetTags || [];
  if (ruleTags.length && !ruleTags.some((tag) => instanceTags.has(tag))) return false;
  const targetServiceAccounts = rule.targetServiceAccounts || [];
  if (targetServiceAccounts.length && !targetServiceAccounts.includes(cloudInstance.serviceAccount || "")) return false;
  return true;
}

function normalizeExpectedPorts(expectedPorts = []) {
  return (expectedPorts || [])
    .map((item) => ({ protocol: required(item.protocol, "protocol").toLowerCase(), port: required(item.port, "port") }))
    .filter((item) => ["tcp", "udp"].includes(item.protocol) && /^\d{1,5}$/.test(item.port) && Number(item.port) >= 1 && Number(item.port) <= 65535)
    .sort((a, b) => a.protocol.localeCompare(b.protocol) || Number(a.port) - Number(b.port));
}

function portKey(port) {
  return `${port.protocol}/${port.port}`;
}

function syncResult(action, name, desired) {
  return {
    status: "synced",
    action,
    name,
    protocol: desired.protocol,
    ports: desired.ports,
    targetTags: desired.targetTags,
    sourceRanges: desired.sourceRanges,
    ...(desired.priority == null ? {} : { priority: desired.priority })
  };
}

export function createFirewallService({ runner } = {}) {
  if (!runner?.run || !runner?.runJson) throw new Error("runner with run() and runJson() is required.");
  const reads = createSingleFlight();

  function listRules(rawIdentity, { readCache = null } = {}) {
    const identity = normalizeVmIdentity(rawIdentity);
    const key = `firewall-rules:${identity.configuration}:${identity.account}:${identity.projectId}`;
    if (readCache?.has?.(key)) return readCache.get(key);
    const read = reads.run(key, async () => {
      const result = await runner.runJson(["compute", "firewall-rules", "list"], projectOptions(identity));
      return Array.isArray(result.data) ? result.data : [];
    });
    readCache?.set?.(key, read);
    read.catch(() => readCache?.delete?.(key));
    return read;
  }

  async function describeRule(identity, name) {
    try {
      const result = await runner.runJson(["compute", "firewall-rules", "describe", name], projectOptions(identity));
      return result.data;
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  async function ensureOwnedRule({ identity: rawIdentity, name, network, protocol, ports, targetTags, sourceRanges, priority = null } = {}) {
    const identity = normalizeVmIdentity(rawIdentity);
    const ruleName = required(name, "name");
    const desired = {
      network: required(network, "network"),
      protocol: required(protocol, "protocol"),
      ports: normalizePorts(ports),
      targetTags: normalizeList(targetTags, "targetTags"),
      sourceRanges: normalizeList(sourceRanges, "sourceRanges"),
      priority: normalizePriority(priority)
    };
    const existing = await describeRule(identity, ruleName);
    const commonFlags = [
      allowFlag(desired.protocol, desired.ports),
      `--source-ranges=${desired.sourceRanges.join(",")}`,
      `--target-tags=${desired.targetTags.join(",")}`,
      descriptionFlag(identity),
      ...(desired.priority == null ? [] : [`--priority=${desired.priority}`])
    ];

    if (!existing) {
      await runner.run([
        "compute",
        "firewall-rules",
        "create",
        ruleName,
        `--network=${desired.network}`,
        ...commonFlags
      ], projectOptions(identity));
      return syncResult("created", ruleName, desired);
    }

    if (!isOwned(existing, identity)) {
      throw new Error(`Refusing to mutate shared firewall rule ${ruleName}.`);
    }
    if (sameRule(existing, desired)) return syncResult("unchanged", ruleName, desired);

    await runner.run([
      "compute",
      "firewall-rules",
      "update",
      ruleName,
      ...commonFlags
    ], projectOptions(identity));
    return syncResult("updated", ruleName, desired);
  }

  async function ensureOwnedDenyRule({
    identity: rawIdentity,
    name,
    network,
    targetTags,
    sourceRanges,
    priority,
    disabled = true
  } = {}) {
    const identity = normalizeVmIdentity(rawIdentity);
    const ruleName = required(name, "name");
    const desired = {
      network: required(network, "network"),
      targetTags: normalizeList(targetTags, "targetTags"),
      sourceRanges: normalizeList(sourceRanges, "sourceRanges"),
      priority: normalizePriority(priority, true),
      disabled: Boolean(disabled)
    };
    const existing = await describeRule(identity, ruleName);
    const commonFlags = [
      "--rules=all",
      `--source-ranges=${desired.sourceRanges.join(",")}`,
      `--target-tags=${desired.targetTags.join(",")}`,
      `--priority=${desired.priority}`,
      descriptionFlag(identity),
      desired.disabled ? "--disabled" : "--no-disabled"
    ];

    if (!existing) {
      await runner.run([
        "compute",
        "firewall-rules",
        "create",
        ruleName,
        `--network=${desired.network}`,
        "--action=DENY",
        ...commonFlags
      ], projectOptions(identity));
      return { action: "created", status: "synced", name: ruleName, ...desired };
    }
    if (!isOwned(existing, identity) || !(existing.denied || []).length) {
      throw new Error(`Refusing to mutate shared firewall rule ${ruleName}.`);
    }
    if (sameDenyRule(existing, desired)) return { action: "unchanged", status: "synced", name: ruleName, ...desired };
    await runner.run([
      "compute",
      "firewall-rules",
      "update",
      ruleName,
      ...commonFlags
    ], projectOptions(identity));
    return { action: "updated", status: "synced", name: ruleName, ...desired };
  }

  async function setOwnedRuleDisabled({ identity: rawIdentity, name, disabled } = {}) {
    const identity = normalizeVmIdentity(rawIdentity);
    const ruleName = required(name, "name");
    const existing = await describeRule(identity, ruleName);
    if (!existing || !isOwned(existing, identity) || !(existing.denied || []).length) {
      throw new Error(`Refusing to mutate shared firewall rule ${ruleName}.`);
    }
    const requested = Boolean(disabled);
    if (Boolean(existing.disabled) === requested) return { action: "unchanged", name: ruleName, disabled: requested };
    await runner.run([
      "compute",
      "firewall-rules",
      "update",
      ruleName,
      requested ? "--disabled" : "--no-disabled"
    ], projectOptions(identity));
    return { action: "updated", name: ruleName, disabled: requested };
  }

  async function ensureInstanceTag({ identity: rawIdentity, tag } = {}) {
    const identity = normalizeVmIdentity(rawIdentity);
    const normalizedTag = required(tag, "tag").toLowerCase();
    if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(normalizedTag)) throw new Error("tag is invalid.");
    await runner.run([
      "compute",
      "instances",
      "add-tags",
      identity.name,
      `--tags=${normalizedTag}`
    ], instanceOptions(identity));
    return { action: "added", tag: normalizedTag };
  }

  async function inspectOwnedRule({ identity: rawIdentity, name, protocol, ports, targetTags, sourceRanges } = {}) {
    const identity = normalizeVmIdentity(rawIdentity);
    const ruleName = required(name, "name");
    const desired = {
      protocol: required(protocol, "protocol"),
      ports: normalizePorts(ports),
      targetTags: normalizeList(targetTags, "targetTags"),
      sourceRanges: normalizeList(sourceRanges, "sourceRanges")
    };
    const existing = await describeRule(identity, ruleName);
    if (!existing) return { ...syncResult("missing", ruleName, desired), status: "missing" };
    if (!isOwned(existing, identity)) return { ...syncResult("mismatch", ruleName, desired), status: "mismatch", error: `Firewall rule ${ruleName} is not owned by this VM.` };
    if (!sameRule(existing, desired)) return { ...syncResult("mismatch", ruleName, desired), status: "mismatch" };
    return { ...syncResult("matched", ruleName, desired), status: "matched" };
  }

  async function inspectInstanceExposure({ identity: rawIdentity, cloudInstance = {}, expectedPorts = [], rules = null, readCache = null } = {}) {
    const identity = normalizeVmIdentity(rawIdentity);
    const expected = normalizeExpectedPorts(expectedPorts);
    try {
      const projectRules = Array.isArray(rules) ? rules : await listRules(identity, { readCache });
      const instanceRules = projectRules
        .filter((rule) => ruleMatchesInstance(rule, cloudInstance));
      const exposedPorts = instanceRules.flatMap(listRulePorts)
        .filter((port) => ["open", "restricted"].includes(port.sourceScope))
        .sort((a, b) => a.protocol.localeCompare(b.protocol) || Number(a.port) - Number(b.port));
      const matchedPorts = expected
        .map((port) => matchingRulePort(instanceRules, port, ["open", "restricted"]))
        .filter(Boolean);
      const matchedKeys = new Set(matchedPorts.map(portKey));
      const missingPorts = expected.filter((port) => !matchedKeys.has(portKey(port)));
      const internalPorts = expected
        .map((port) => matchingRulePort(instanceRules, port, ["internal"]))
        .filter(Boolean);
      const broadRules = instanceRules
        .filter(ruleAllowsAllPublicPorts)
        .map((rule) => ({
          name: rule.name || "",
          sourceRanges: rule.sourceRanges || [],
          targetTags: rule.targetTags || []
        }));
      const status = broadRules.length
        ? "overexposed"
        : !expected.length
          ? (exposedPorts.length ? "partial" : "unknown")
          : missingPorts.length === 0
            ? "matched"
            : matchedPorts.length > 0
              ? "partial"
              : "missing";
      return {
        status,
        matchedPorts,
        missingPorts,
        internalPorts,
        broadRules,
        exposedPorts,
        warning: broadRules.length ? `规则 ${broadRules.map((rule) => rule.name).join(", ")} 存在公网全端口开放` : "",
        rules: instanceRules.map((rule) => ({
          name: rule.name || "",
          network: basename(rule.network),
          sourceRanges: rule.sourceRanges || [],
          sourceTags: rule.sourceTags || [],
          sourceServiceAccounts: rule.sourceServiceAccounts || [],
          sourceScope: ruleSourceScope(rule),
          targetTags: rule.targetTags || [],
          targetServiceAccounts: rule.targetServiceAccounts || [],
          allowed: rule.allowed || []
        }))
      };
    } catch (error) {
      return {
        status: "unknown",
        matchedPorts: [],
        missingPorts: expected,
        internalPorts: [],
        broadRules: [],
        exposedPorts: [],
        rules: [],
        warning: error?.message || String(error)
      };
    }
  }

  return {
    ensureInstanceTag,
    ensureOwnedDenyRule,
    ensureOwnedRule,
    inspectOwnedRule,
    inspectInstanceExposure,
    listRules,
    setOwnedRuleDisabled
  };
}
