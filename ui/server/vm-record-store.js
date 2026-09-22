import { chmod, mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { normalizeVmIdentity, recordIdForIdentity } from "./vm-identity.js";
import { createSingleFlight } from "./single-flight.js";
import { sanitizeNodeResult } from "./sensitive-data.js";

const RECORD_ID_PATTERN = /^[a-z][a-z0-9-]{0,62}$/;
const RECORD_STATUSES = new Set(["draft", "cloud", "managed", "conflict", "replacing"]);

function assertRecordId(id) {
  const value = String(id || "");
  if (!RECORD_ID_PATTERN.test(value)) throw new Error("record id must be a valid record id for a local VM record.");
  return value;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeRecord(input, existing, now) {
  const identity = normalizeVmIdentity(input.identity);
  const expectedId = recordIdForIdentity(identity);
  if (input.id && assertRecordId(input.id) !== expectedId) {
    throw new Error("record id does not match its cloud identity.");
  }
  if (!RECORD_STATUSES.has(input.status)) {
    throw new Error("status must be a valid record status.");
  }
  if (input.history !== undefined && !Array.isArray(input.history)) {
    throw new Error("history must be an array.");
  }

  return {
    schemaVersion: 1,
    id: expectedId,
    status: input.status,
    identity,
    desired: clone(input.desired || {}),
    observed: input.observed == null ? null : clone(input.observed),
    preview: input.preview == null ? null : clone(input.preview),
    nodeResult: input.nodeResult == null ? null : sanitizeNodeResult(input.nodeResult),
    verification: input.verification == null ? null : clone(input.verification),
    migration: input.migration == null ? null : clone(input.migration),
    history: clone(input.history || []),
    createdAt: existing?.createdAt || input.createdAt || now,
    updatedAt: now
  };
}

export function createVmRecordStore({ rootDir, now = () => new Date().toISOString() } = {}) {
  if (!rootDir) throw new Error("rootDir is required.");
  const absoluteRoot = path.resolve(rootDir);
  const reads = createSingleFlight();

  function recordDirectory(id) {
    return path.join(absoluteRoot, assertRecordId(id));
  }

  function recordPath(id) {
    return path.join(recordDirectory(id), "record.json");
  }

  async function hardenExistingDirectory(directory) {
    try {
      await chmod(directory, 0o700);
      return true;
    } catch (error) {
      if (error?.code === "ENOENT") return false;
      throw error;
    }
  }

  async function hardenExistingFile(filePath) {
    try {
      await chmod(filePath, 0o600);
      return true;
    } catch (error) {
      if (error?.code === "ENOENT") return false;
      throw error;
    }
  }

  async function get(id) {
    const safeId = assertRecordId(id);
    await hardenExistingDirectory(absoluteRoot);
    await hardenExistingDirectory(recordDirectory(safeId));
    await hardenExistingFile(recordPath(safeId));
    try {
      const parsed = JSON.parse(await readFile(recordPath(safeId), "utf8"));
      return normalizeRecord(parsed, parsed, parsed.updatedAt || now());
    } catch (error) {
      if (error?.code === "ENOENT") return null;
      throw error;
    }
  }

  async function save(input) {
    const identity = normalizeVmIdentity(input?.identity);
    const id = recordIdForIdentity(identity);
    const existing = await get(id);
    const record = normalizeRecord({ ...input, identity, id }, existing, now());
    const directory = recordDirectory(id);
    await mkdir(absoluteRoot, { recursive: true, mode: 0o700 });
    await chmod(absoluteRoot, 0o700);
    await mkdir(directory, { recursive: true });
    await chmod(directory, 0o700);
    const temporaryPath = path.join(directory, `.record-${process.pid}-${Date.now()}.tmp`);
    await writeFile(temporaryPath, `${JSON.stringify(record, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
    await chmod(temporaryPath, 0o600);
    await rename(temporaryPath, recordPath(id));
    await chmod(recordPath(id), 0o600);
    return record;
  }

  function list(scope = {}) {
    const account = String(scope.account || "").toLowerCase();
    const projectId = String(scope.projectId || "").toLowerCase();
    return reads.run(`list:${account}:${projectId}`, async () => {
    await hardenExistingDirectory(absoluteRoot);
    let entries;
    try {
      entries = await readdir(absoluteRoot, { withFileTypes: true });
    } catch (error) {
      if (error?.code === "ENOENT") return [];
      throw error;
    }

    const records = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || !RECORD_ID_PATTERN.test(entry.name)) continue;
      await hardenExistingDirectory(path.join(absoluteRoot, entry.name));
      const record = await get(entry.name);
      if (!record) continue;
      if (account && record.identity.account !== account) continue;
      if (projectId && record.identity.projectId !== projectId) continue;
      records.push(record);
    }
    return records.sort((a, b) => a.identity.name.localeCompare(b.identity.name));
    });
  }

  async function remove(id) {
    const safeId = assertRecordId(id);
    await hardenExistingDirectory(absoluteRoot);
    const existing = await get(safeId);
    if (!existing) return false;
    await rm(recordDirectory(safeId), { recursive: true, force: false });
    return true;
  }

  return { get, list, remove, save };
}
