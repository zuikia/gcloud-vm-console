import { createHash } from "node:crypto";
import * as nodeFs from "node:fs/promises";
import path from "node:path";

const SNAPSHOT_FILE_PATTERN = /^inventory-[a-f0-9]{24}\.json$/;
const SAFE_LABELS = new Set([
  "managed_by",
  "gvc_managed",
  "gvc_deploy_method",
  "gcp_vm_console_image"
]);

function required(value, label) {
  const normalized = String(value || "").trim();
  if (!normalized) throw new Error(`${label} is required.`);
  return normalized;
}

function timestamp(value, label) {
  const normalized = required(value, label);
  if (Number.isNaN(new Date(normalized).getTime())) throw new Error(`${label} must be a valid timestamp.`);
  return normalized;
}

function normalizeScope(scope = {}) {
  return {
    configuration: required(scope.configuration, "configuration"),
    account: required(scope.account, "account").toLowerCase(),
    projectId: required(scope.projectId, "projectId")
  };
}

function scopeKey(scope) {
  const normalized = normalizeScope(scope);
  return `${normalized.configuration}\n${normalized.account}\n${normalized.projectId}`;
}

function snapshotName(scope) {
  return `inventory-${createHash("sha256").update(scopeKey(scope)).digest("hex").slice(0, 24)}.json`;
}

function stringList(value) {
  return [...new Set((Array.isArray(value) ? value : []).map((item) => String(item || "").trim()).filter(Boolean))];
}

function safeLabels(labels = {}) {
  return Object.fromEntries(Object.entries(labels || {})
    .filter(([key]) => SAFE_LABELS.has(key))
    .map(([key, value]) => [key, String(value || "").slice(0, 128)]));
}

function normalizeInstance(instance = {}) {
  const disk = instance.disk || {};
  const network = instance.network || {};
  const metadata = instance.metadata || {};
  return {
    exists: true,
    name: required(instance.name, "instance.name"),
    zone: String(instance.zone || ""),
    region: String(instance.region || ""),
    status: String(instance.status || "UNKNOWN"),
    machineType: String(instance.machineType || ""),
    disk: {
      sizeGb: Number(disk.sizeGb || 0),
      type: String(disk.type || "")
    },
    network: {
      name: String(network.name || ""),
      subnet: String(network.subnet || ""),
      externalIpMode: String(network.externalIpMode || ""),
      externalIp: String(network.externalIp || ""),
      networkTier: String(network.networkTier || ""),
      nicType: String(network.nicType || "")
    },
    labels: safeLabels(instance.labels),
    tags: stringList(instance.tags),
    metadata: {
      startupScriptHash: String(metadata.startupScriptHash || "").slice(0, 128),
      gvcRecordSchema: String(metadata.gvcRecordSchema || "").slice(0, 32),
      gvcDeployMethod: String(metadata.gvcDeployMethod || "").slice(0, 64)
    }
  };
}

function normalizeSnapshot(input, expectedScope = null) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("inventory snapshot must be an object.");
  if (input.schemaVersion !== 1) throw new Error("inventory snapshot schemaVersion is unsupported.");
  if (!Array.isArray(input.instances)) throw new Error("inventory snapshot instances must be an array.");
  const scope = normalizeScope(input.scope);
  if (expectedScope && scopeKey(scope) !== scopeKey(expectedScope)) throw new Error("inventory snapshot scope does not match its file.");
  return {
    schemaVersion: 1,
    scope,
    checkedAt: timestamp(input.checkedAt, "checkedAt"),
    instances: input.instances.map(normalizeInstance)
  };
}

function limits(maxSnapshots, maxAgeDays) {
  const count = Number(maxSnapshots);
  const days = Number(maxAgeDays);
  if (!Number.isInteger(count) || count < 1) throw new Error("maxSnapshots must be a positive integer.");
  if (!Number.isFinite(days) || days <= 0) throw new Error("maxAgeDays must be positive.");
  return { maxSnapshots: count, maxAgeDays: days };
}

export function createInventorySnapshotStore({
  rootDir,
  now = () => new Date().toISOString(),
  maxSnapshots = 20,
  maxAgeDays = 7,
  fileSystem = nodeFs
} = {}) {
  if (!rootDir) throw new Error("rootDir is required.");
  const root = path.resolve(rootDir);
  const quarantineRoot = path.join(root, "quarantine");
  const configuredLimits = limits(maxSnapshots, maxAgeDays);
  const diagnostics = { quarantined: 0, quarantineFailures: 0, pruned: 0, writeFailures: 0, ...configuredLimits };
  let temporaryCounter = 0;
  let quarantineCounter = 0;

  async function ensureDirectory(directory) {
    await fileSystem.mkdir(directory, { recursive: true, mode: 0o700 });
    await fileSystem.chmod(directory, 0o700);
  }

  async function quarantine(fileName) {
    try {
      await ensureDirectory(quarantineRoot);
      quarantineCounter += 1;
      const destination = path.join(quarantineRoot, `${Date.now()}-${quarantineCounter}-${path.basename(fileName)}`);
      await fileSystem.rename(path.join(root, fileName), destination);
      await fileSystem.chmod(destination, 0o600);
      diagnostics.quarantined += 1;
    } catch {
      diagnostics.quarantineFailures += 1;
    }
  }

  async function readSnapshot(fileName, expectedScope = null) {
    try {
      return normalizeSnapshot(JSON.parse(await fileSystem.readFile(path.join(root, fileName), "utf8")), expectedScope);
    } catch {
      await quarantine(fileName);
      return null;
    }
  }

  async function prune(referenceTimestamp = now()) {
    await ensureDirectory(root);
    const reference = new Date(timestamp(referenceTimestamp, "referenceTimestamp")).getTime();
    const cutoff = reference - configuredLimits.maxAgeDays * 24 * 60 * 60 * 1000;
    const entries = await fileSystem.readdir(root, { withFileTypes: true });
    const snapshots = [];
    for (const entry of entries) {
      if (entry.name === "quarantine") continue;
      if (!entry.isFile() || !SNAPSHOT_FILE_PATTERN.test(entry.name)) {
        if (entry.isFile() && (entry.name.endsWith(".json") || entry.name.endsWith(".tmp"))) await quarantine(entry.name);
        continue;
      }
      const snapshot = await readSnapshot(entry.name);
      if (!snapshot) continue;
      if (new Date(snapshot.checkedAt).getTime() < cutoff) {
        await fileSystem.rm(path.join(root, entry.name), { force: true });
        diagnostics.pruned += 1;
        continue;
      }
      snapshots.push({ fileName: entry.name, checkedAt: snapshot.checkedAt });
    }
    snapshots.sort((a, b) => b.checkedAt.localeCompare(a.checkedAt));
    for (const snapshot of snapshots.slice(configuredLimits.maxSnapshots)) {
      await fileSystem.rm(path.join(root, snapshot.fileName), { force: true });
      diagnostics.pruned += 1;
    }
  }

  async function save(rawScope, instances, checkedAt = now()) {
    const scope = normalizeScope(rawScope);
    const snapshot = normalizeSnapshot({ schemaVersion: 1, scope, checkedAt, instances });
    await ensureDirectory(root);
    temporaryCounter += 1;
    const fileName = snapshotName(scope);
    const temporaryPath = path.join(root, `.${fileName}-${process.pid}-${Date.now()}-${temporaryCounter}.tmp`);
    try {
      await fileSystem.writeFile(temporaryPath, `${JSON.stringify(snapshot, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
      await fileSystem.chmod(temporaryPath, 0o600);
      await fileSystem.rename(temporaryPath, path.join(root, fileName));
      await prune(checkedAt);
      return snapshot;
    } catch (error) {
      diagnostics.writeFailures += 1;
      await fileSystem.rm(temporaryPath, { force: true }).catch(() => {});
      throw error;
    }
  }

  async function load(rawScope, referenceTimestamp = now()) {
    const scope = normalizeScope(rawScope);
    await ensureDirectory(root);
    const fileName = snapshotName(scope);
    try {
      await fileSystem.access(path.join(root, fileName));
    } catch (error) {
      if (error?.code === "ENOENT") return null;
      throw error;
    }
    const snapshot = await readSnapshot(fileName, scope);
    if (!snapshot) return null;
    const ageMs = new Date(timestamp(referenceTimestamp, "referenceTimestamp")).getTime() - new Date(snapshot.checkedAt).getTime();
    if (ageMs > configuredLimits.maxAgeDays * 24 * 60 * 60 * 1000) {
      await fileSystem.rm(path.join(root, fileName), { force: true });
      diagnostics.pruned += 1;
      return null;
    }
    return snapshot;
  }

  function storageInfo() {
    return { ...diagnostics };
  }

  return { load, prune, save, storageInfo };
}
