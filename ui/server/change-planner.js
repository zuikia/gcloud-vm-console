import { createHash } from "node:crypto";

import { normalizeNetworkProfile, toNetworkProfileView } from "../public/lib/network-profile.js";
import { normalizeVmIdentity } from "./vm-identity.js";

const DELETE_RESOURCES = new Set(["vm", "disk", "address", "firewall", "serviceAccount", "subnet", "network"]);
const EXECUTABLE_ACTIONS = new Set([
  "ensure-static-address",
  "ensure-replacement-static-address",
  "create-vm",
  "create-replacement-vm"
]);
export const MAX_STARTUP_SCRIPT_BYTES = 64 * 1024;

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, canonicalize(value[key])])
    );
  }
  return value;
}

function stableJson(value) {
  return JSON.stringify(canonicalize(value));
}

function hash(value) {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

function valueAt(object, field) {
  return field.split(".").reduce((value, key) => value?.[key], object);
}

function equivalent(a, b) {
  return stableJson(a) === stableJson(b);
}

function safeReference(value, label) {
  const text = String(value || "").trim();
  if (!text || text.length > 255 || /[\s,]/.test(text) || !/^[A-Za-z0-9._/:+=-]+$/.test(text)) {
    throw new Error(`${label} contains unsupported characters.`);
  }
  return text;
}

function validateLabels(labels = {}) {
  if (!labels || typeof labels !== "object" || Array.isArray(labels)) throw new Error("desired.labels must be an object.");
  for (const [key, value] of Object.entries(labels)) {
    if (!/^[a-z][a-z0-9_-]{0,62}$/.test(key)) throw new Error(`Label key ${key} is invalid.`);
    const text = String(value ?? "");
    if (text.length > 63 || !/^[a-z0-9_-]*$/.test(text)) throw new Error(`Label value for ${key} is invalid.`);
  }
}

function validateTags(tags = []) {
  if (!Array.isArray(tags)) throw new Error("desired.tags must be an array.");
  for (const tag of tags) {
    if (!/^[a-z][a-z0-9-]{0,62}$/.test(String(tag || ""))) throw new Error(`Network tag ${tag} is invalid.`);
  }
}

export function normalizeStartupScript(value, { required = false } = {}) {
  const script = String(value ?? "");
  if (!script.trim()) {
    if (required) throw new Error("自定义脚本不能为空。请填写实例启动时要执行的脚本。");
    return "";
  }
  if (script.includes("\0")) throw new Error("自定义脚本不能包含 NUL 字符。");
  if (Buffer.byteLength(script, "utf8") > MAX_STARTUP_SCRIPT_BYTES) {
    throw new Error(`自定义脚本不能超过 ${MAX_STARTUP_SCRIPT_BYTES / 1024} KiB。`);
  }
  return script;
}

export function validateDesiredInputs(desired = {}) {
  const network = desired.network || {};
  safeReference(network.name || "default", "Network");
  safeReference(network.subnet || "default", "Subnet");
  validateLabels(desired.labels || {});
  validateTags(desired.tags || []);
  const method = String(desired.deploy?.method || "vm_only");
  const startupScript = normalizeStartupScript(desired.deploy?.startupScript, { required: method === "custom_startup" });
  if (method !== "custom_startup" && startupScript) throw new Error("只有自定义脚本部署方式可以携带 startup script。");
  return { startupScript };
}

function actionFor(field, classification, desired, observed) {
  return {
    id: `change-${field.replaceAll(".", "-")}`,
    resource: "vm",
    field,
    classification,
    before: valueAt(observed, field) ?? null,
    after: valueAt(desired, field) ?? null
  };
}

function changed(field, desired, observed) {
  return !equivalent(valueAt(desired, field), valueAt(observed, field));
}

function explicitlyChanged(field, desired, observed) {
  return valueAt(desired, field) !== undefined && changed(field, desired, observed);
}

function canonicalObserved(desired, observed) {
  if (!observed) return observed;
  const desiredNetwork = desired?.network || {};
  const observedNetwork = observed?.network || {};
  if (
    desiredNetwork.externalIpMode === "static"
    && desiredNetwork.externalIp
    && desiredNetwork.externalIp === observedNetwork.externalIp
  ) {
    return {
      ...observed,
      network: {
        ...observedNetwork,
        externalIpMode: "static",
        addressName: desiredNetwork.addressName,
        networkTier: observedNetwork.networkTier || desiredNetwork.networkTier,
        nicType: observedNetwork.nicType || desiredNetwork.nicType
      }
    };
  }
  return observed;
}

function updateActions(desired, observed) {
  const actions = [];
  const fields = [
    ["labels", "in_place"],
    ["tags", "in_place"],
    ["metadata.startupScriptHash", "in_place"],
    ["machineType", "interrupt"],
    ["network.externalIpMode", "replacement"],
    ["serviceAccount", "interrupt"],
    ["image", "replacement"],
    ["disk.type", "replacement"],
    ["network.name", "replacement"],
    ["network.subnet", "replacement"],
    ["network.networkTier", "replacement"],
    ["network.nicType", "replacement"],
    ["network.addressName", "replacement"]
  ];

  for (const [field, classification] of fields) {
    if (explicitlyChanged(field, desired, observed)) actions.push(actionFor(field, classification, desired, observed));
  }

  if (changed("disk.sizeGb", desired, observed)) {
    const desiredSize = Number(valueAt(desired, "disk.sizeGb") || 0);
    const observedSize = Number(valueAt(observed, "disk.sizeGb") || 0);
    actions.push(actionFor("disk.sizeGb", desiredSize >= observedSize ? "in_place" : "replacement", desired, observed));
  }

  if (actions.some((action) => action.classification === "replacement")) {
    if (desired.network?.externalIpMode === "static") {
      actions.push({
        id: "ensure-replacement-static-address",
        resource: "address",
        field: "network.staticAddressReservation",
        classification: "create",
        before: null,
        after: "auto"
      });
    }
    actions.push({
      id: "create-replacement-vm",
      resource: "vm",
      field: null,
      classification: "replacement",
      before: observed.name || null,
      after: null,
      strategy: "create_then_verify"
    });
  }

  return actions;
}

function summarize(actions) {
  const summary = {
    create: 0,
    inPlace: 0,
    interrupt: 0,
    replacement: 0,
    delete: 0,
    noop: actions.length === 0
  };
  for (const action of actions) {
    if (action.classification === "create") summary.create += 1;
    if (action.classification === "in_place") summary.inPlace += 1;
    if (action.classification === "interrupt") summary.interrupt += 1;
    if (action.classification === "replacement") summary.replacement += 1;
    if (action.classification === "delete") summary.delete += 1;
  }
  return summary;
}

function stateHashes(identity, desired, observed) {
  return {
    identityHash: hash(normalizeVmIdentity(identity)),
    desiredHash: hash(desired),
    observedHash: hash(observed)
  };
}

export function createChangePreview({
  identity,
  desired,
  observed = null,
  operation = "apply",
  deleteResources = [],
  now = new Date().toISOString()
} = {}) {
  const normalizedIdentity = normalizeVmIdentity(identity);
  const networkView = desired
    ? toNetworkProfileView(desired.network || {}, {
      instanceName: normalizedIdentity.name,
      deployMethod: desired.deploy?.method || "vm_only"
    })
    : null;
  if (networkView && !networkView.valid) throw new Error(networkView.reason);
  const networkProfile = desired
    ? normalizeNetworkProfile(desired.network || {}, { instanceName: normalizedIdentity.name })
    : null;
  const effectiveObserved = canonicalObserved(desired, observed);
  let actions;

  if (operation === "delete") {
    if (!observed?.exists) throw new Error("An existing VM is required for an explicit delete request.");
    const resources = [...new Set(deleteResources)];
    if (!resources.length || resources.some((resource) => !DELETE_RESOURCES.has(resource))) {
      throw new Error("An explicit delete request must list valid cloud resources.");
    }
    actions = resources.map((resource) => ({
      id: `delete-${resource}`,
      resource,
      field: null,
      classification: "delete",
      before: resource === "vm" ? normalizedIdentity.name : null,
      after: null
    }));
  } else {
    if (!desired) throw new Error("Removing desired configuration is not an explicit delete request.");
    validateDesiredInputs(desired);
    actions = !effectiveObserved?.exists
      ? [
        ...(networkProfile?.externalIpMode === "static" ? [{
          id: "ensure-static-address",
          resource: "address",
          field: "network.addressName",
          classification: "create",
          before: null,
          after: networkProfile.addressName
        }] : []),
        {
        id: "create-vm",
        resource: "vm",
        field: null,
        classification: "create",
        before: null,
        after: normalizedIdentity.name
        }
      ]
      : updateActions(desired, effectiveObserved);
  }

  const hashes = stateHashes(normalizedIdentity, desired, effectiveObserved);
  const fingerprint = hash({
    operation,
    ...hashes,
    actions
  });

  const unsupportedActions = actions
    .filter((action) => !EXECUTABLE_ACTIONS.has(action.id))
    .map((action) => action.id);

  return {
    schemaVersion: 1,
    operation,
    identity: normalizedIdentity,
    actions,
    summary: summarize(actions),
    requiresInterruption: actions.some((action) => action.classification === "interrupt"),
    requiresReplacement: actions.some((action) => action.id === "create-replacement-vm"),
    networkPlan: networkProfile ? {
      externalIpMode: networkProfile.externalIpMode,
      networkTier: networkProfile.networkTier,
      nicType: networkProfile.nicType,
      ...(networkProfile.addressName ? { addressName: networkProfile.addressName } : {})
    } : null,
    ...hashes,
    fingerprint,
    executable: unsupportedActions.length === 0,
    ...(unsupportedActions.length ? { unsupportedActions } : {}),
    createdAt: now
  };
}

export function previewMatchesCurrentState(preview, { identity, desired, observed }) {
  const current = stateHashes(identity, desired, canonicalObserved(desired, observed));
  if (preview.identityHash !== current.identityHash) return { ok: false, reason: "identity_changed" };
  if (preview.desiredHash !== current.desiredHash) return { ok: false, reason: "desired_changed" };
  if (preview.observedHash !== current.observedHash) return { ok: false, reason: "observed_changed" };
  return { ok: true };
}
