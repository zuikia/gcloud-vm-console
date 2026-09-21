import * as nodeFs from "node:fs";
import path from "node:path";

const ACTIVE_STATUSES = new Set(["queued", "running"]);
const TERMINAL_STATUSES = new Set(["succeeded", "partial", "failed", "interrupted"]);
const ALLOWED_STATUSES = new Set([...ACTIVE_STATUSES, ...TERMINAL_STATUSES]);
const JOB_ID_PATTERN = /^job-(\d{6,})$/;
const JOB_FILE_PATTERN = /^job-(\d{6,})\.json$/;
const RESTART_STAGE_DETAIL = "本地服务重启，任务未自动续跑；请先运行只读探测确认云端实际状态。";
const STORAGE_WARNING = "本地任务历史保存失败；当前结果仅保留在本次会话，重启后可能无法恢复。";

export class JobStorePersistenceError extends Error {
  constructor(message, { operation = "write", cause = null } = {}) {
    super(message, { cause });
    this.name = "JobStorePersistenceError";
    this.code = "JOB_HISTORY_PERSISTENCE_FAILED";
    this.operation = operation;
  }
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function required(value, label) {
  const normalized = String(value || "").trim();
  if (!normalized) throw new Error(`${label} is required.`);
  return normalized;
}

function validTimestamp(value, label) {
  const normalized = required(value, label);
  if (Number.isNaN(new Date(normalized).getTime())) throw new Error(`${label} must be a valid timestamp.`);
  return normalized;
}

function normalizeLimits(maxJobs, maxAgeDays) {
  const normalizedMaxJobs = Number(maxJobs);
  const normalizedMaxAgeDays = Number(maxAgeDays);
  if (!Number.isInteger(normalizedMaxJobs) || normalizedMaxJobs < 1) {
    throw new Error("maxJobs must be a positive integer.");
  }
  if (!Number.isFinite(normalizedMaxAgeDays) || normalizedMaxAgeDays <= 0) {
    throw new Error("maxAgeDays must be a positive number.");
  }
  return { maxJobs: normalizedMaxJobs, maxAgeDays: normalizedMaxAgeDays };
}

function normalizeStage(stage = {}) {
  return {
    name: required(stage.name, "stage.name"),
    status: required(stage.status, "stage.status"),
    detail: String(stage.detail || ""),
    at: validTimestamp(stage.at, "stage.at")
  };
}

function normalizeInterruption(value) {
  if (value == null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("interruption must be an object or null.");
  }
  return {
    reason: required(value.reason, "interruption.reason"),
    previousStatus: required(value.previousStatus, "interruption.previousStatus"),
    detectedAt: validTimestamp(value.detectedAt, "interruption.detectedAt")
  };
}

function normalizeStoredJob(input, expectedId = "") {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("job must be an object.");
  if (input.schemaVersion !== 1) throw new Error("job schemaVersion is unsupported.");
  const id = required(input.id, "job.id");
  if (!JOB_ID_PATTERN.test(id)) throw new Error("job.id is invalid.");
  if (expectedId && id !== expectedId) throw new Error("job.id does not match its file name.");
  const status = required(input.status, "job.status");
  if (!ALLOWED_STATUSES.has(status)) throw new Error("job.status is invalid.");
  if (!Array.isArray(input.stages)) throw new Error("job.stages must be an array.");
  if (input.error != null && typeof input.error !== "string") throw new Error("job.error must be a string or null.");

  return {
    schemaVersion: 1,
    id,
    type: required(input.type, "job.type"),
    recordId: String(input.recordId || ""),
    lockKey: String(input.lockKey || ""),
    status,
    stages: input.stages.map(normalizeStage),
    result: input.result == null ? null : clone(input.result),
    error: input.error == null ? null : String(input.error),
    interruption: normalizeInterruption(input.interruption),
    createdAt: validTimestamp(input.createdAt, "job.createdAt"),
    updatedAt: validTimestamp(input.updatedAt, "job.updatedAt")
  };
}

function persistedJob(job) {
  const normalized = { ...job };
  delete normalized.storageStatus;
  delete normalized.storageWarning;
  return normalizeStoredJob(normalized, normalized.id);
}

function terminalizeStages(stages = [], status) {
  const terminalStatus = status === "succeeded"
    ? "succeeded"
    : status === "partial"
      ? "partial"
      : status === "interrupted"
        ? "interrupted"
        : "failed";
  return stages.map((stage) => ACTIVE_STATUSES.has(stage.status)
    ? { ...stage, status: terminalStatus }
    : stage);
}

export function createJobStore({
  rootDir,
  now = () => new Date().toISOString(),
  maxJobs = 200,
  maxAgeDays = 30,
  fileSystem = nodeFs
} = {}) {
  if (!rootDir) throw new Error("rootDir is required.");
  const limits = normalizeLimits(maxJobs, maxAgeDays);
  const absoluteRoot = path.resolve(rootDir);
  const quarantineRoot = path.join(absoluteRoot, "quarantine");
  const jobs = new Map();
  const diagnostics = {
    storage: "persistent",
    recoveredInterrupted: 0,
    quarantined: 0,
    quarantineFailures: 0,
    pruned: 0,
    pruneFailures: 0,
    degradedWrites: 0,
    maxJobs: limits.maxJobs,
    maxAgeDays: limits.maxAgeDays
  };
  let counter = 0;
  let temporaryCounter = 0;
  let quarantineCounter = 0;

  function ensureDirectory(directory) {
    fileSystem.mkdirSync(directory, { recursive: true, mode: 0o700 });
    fileSystem.chmodSync(directory, 0o700);
  }

  ensureDirectory(absoluteRoot);

  function jobPath(id) {
    return path.join(absoluteRoot, `${id}.json`);
  }

  function safeFailure(operation, cause) {
    return new JobStorePersistenceError("Unable to persist local task history.", { operation, cause });
  }

  function writeJob(job, operation = "write") {
    const record = persistedJob(job);
    temporaryCounter += 1;
    const temporaryPath = path.join(
      absoluteRoot,
      `.${record.id}-${process.pid}-${Date.now()}-${temporaryCounter}.tmp`
    );
    try {
      fileSystem.writeFileSync(temporaryPath, `${JSON.stringify(record, null, 2)}\n`, {
        encoding: "utf8",
        mode: 0o600,
        flag: "wx"
      });
      fileSystem.chmodSync(temporaryPath, 0o600);
      fileSystem.renameSync(temporaryPath, jobPath(record.id));
    } catch (error) {
      try {
        fileSystem.rmSync(temporaryPath, { force: true });
      } catch {
        // A leftover temp file is ignored and quarantined on the next startup.
      }
      throw safeFailure(operation, error);
    }
  }

  function quarantine(fileName) {
    try {
      ensureDirectory(quarantineRoot);
      quarantineCounter += 1;
      const safeName = path.basename(fileName).replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120) || "invalid-job";
      const destination = path.join(quarantineRoot, `${Date.now()}-${quarantineCounter}-${safeName}`);
      fileSystem.renameSync(path.join(absoluteRoot, fileName), destination);
      const entry = fileSystem.lstatSync(destination);
      if (entry.isFile()) fileSystem.chmodSync(destination, 0o600);
      diagnostics.quarantined += 1;
    } catch {
      diagnostics.quarantineFailures += 1;
    }
  }

  function removeJob(id) {
    try {
      fileSystem.rmSync(jobPath(id), { force: false });
      jobs.delete(id);
      diagnostics.pruned += 1;
      return true;
    } catch {
      diagnostics.pruneFailures += 1;
      return false;
    }
  }

  function prune(referenceTimestamp) {
    const referenceTime = new Date(referenceTimestamp).getTime();
    const cutoff = referenceTime - limits.maxAgeDays * 24 * 60 * 60 * 1000;
    const terminal = [...jobs.values()].filter((job) => TERMINAL_STATUSES.has(job.status));
    const expired = terminal.filter((job) => new Date(job.updatedAt).getTime() < cutoff);
    const current = terminal
      .filter((job) => !expired.includes(job))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    const excess = current.slice(limits.maxJobs);
    const ids = new Set([...expired, ...excess].map((job) => job.id));
    for (const id of ids) removeJob(id);
  }

  function loadFromDisk() {
    const entries = fileSystem.readdirSync(absoluteRoot, { withFileTypes: true });
    for (const entry of entries) {
      const numericMatch = entry.name.match(JOB_FILE_PATTERN);
      if (numericMatch) counter = Math.max(counter, Number(numericMatch[1]));
    }

    const loaded = [];
    for (const entry of entries) {
      if (entry.name === "quarantine") continue;
      if (entry.name.endsWith(".tmp")) {
        quarantine(entry.name);
        continue;
      }
      if (!entry.name.endsWith(".json")) continue;
      const match = entry.name.match(JOB_FILE_PATTERN);
      if (!match || !entry.isFile()) {
        quarantine(entry.name);
        continue;
      }
      const expectedId = entry.name.slice(0, -".json".length);
      try {
        const parsed = JSON.parse(fileSystem.readFileSync(path.join(absoluteRoot, entry.name), "utf8"));
        loaded.push(normalizeStoredJob(parsed, expectedId));
      } catch {
        quarantine(entry.name);
      }
    }

    loaded.sort((a, b) => a.id.localeCompare(b.id));
    for (const job of loaded) jobs.set(job.id, job);
    if (!loaded.length) return;

    const startupTimestamp = validTimestamp(now(), "now");
    for (const job of loaded) {
      if (!ACTIVE_STATUSES.has(job.status)) {
        if (!job.stages.some((stage) => ACTIVE_STATUSES.has(stage.status))) continue;
        const repaired = {
          ...job,
          stages: terminalizeStages(job.stages, job.status)
        };
        jobs.set(job.id, repaired);
        try {
          writeJob(repaired, "legacy_terminal_stage_repair");
        } catch {
          diagnostics.degradedWrites += 1;
          jobs.set(job.id, {
            ...repaired,
            storageStatus: "degraded",
            storageWarning: STORAGE_WARNING
          });
        }
        continue;
      }
      const recovered = {
        ...job,
        status: "interrupted",
        stages: [
          ...terminalizeStages(job.stages, "interrupted"),
          {
            name: "restart_recovery",
            status: "interrupted",
            detail: RESTART_STAGE_DETAIL,
            at: startupTimestamp
          }
        ],
        interruption: {
          reason: "server_restart",
          previousStatus: job.status,
          detectedAt: startupTimestamp
        },
        updatedAt: startupTimestamp
      };
      diagnostics.recoveredInterrupted += 1;
      jobs.set(job.id, recovered);
      try {
        writeJob(recovered, "restart_recovery");
      } catch {
        diagnostics.degradedWrites += 1;
        jobs.set(job.id, {
          ...recovered,
          storageStatus: "degraded",
          storageWarning: STORAGE_WARNING
        });
      }
    }
    prune(startupTimestamp);
  }

  loadFromDisk();

  function nextId() {
    counter += 1;
    return `job-${String(counter).padStart(6, "0")}`;
  }

  function getMutable(id) {
    const job = jobs.get(required(id, "jobId"));
    if (!job) throw new Error("Job was not found.");
    return job;
  }

  function assertNoActiveLock(lockKey) {
    if (!lockKey) return;
    for (const job of jobs.values()) {
      if (job.lockKey === lockKey && ACTIVE_STATUSES.has(job.status)) {
        throw new Error(`${lockKey} already running.`);
      }
    }
  }

  function create({ type, recordId = "", lockKey = "" } = {}) {
    const normalizedType = required(type, "type");
    assertNoActiveLock(lockKey);
    const timestamp = validTimestamp(now(), "now");
    const job = {
      schemaVersion: 1,
      id: nextId(),
      type: normalizedType,
      recordId: String(recordId || ""),
      lockKey: String(lockKey || ""),
      status: "running",
      stages: [],
      result: null,
      error: null,
      interruption: null,
      createdAt: timestamp,
      updatedAt: timestamp
    };
    try {
      writeJob(job, "create");
    } catch (error) {
      counter -= 1;
      throw error;
    }
    jobs.set(job.id, job);
    return clone(job);
  }

  function get(id) {
    const job = jobs.get(required(id, "jobId"));
    return job ? clone(job) : null;
  }

  function setStage(id, stage) {
    const current = getMutable(id);
    const timestamp = validTimestamp(now(), "now");
    const job = {
      ...current,
      stages: [
        ...current.stages,
        {
          name: required(stage?.name, "stage.name"),
          status: required(stage?.status, "stage.status"),
          detail: String(stage?.detail || ""),
          at: timestamp
        }
      ],
      updatedAt: timestamp
    };
    writeJob(job, "set_stage");
    jobs.set(job.id, job);
    return clone(job);
  }

  function commitTerminal(job, operation) {
    jobs.set(job.id, job);
    try {
      writeJob(job, operation);
    } catch {
      diagnostics.degradedWrites += 1;
      const degraded = {
        ...job,
        storageStatus: "degraded",
        storageWarning: STORAGE_WARNING
      };
      jobs.set(job.id, degraded);
      return clone(degraded);
    }
    prune(job.updatedAt);
    return clone(job);
  }

  function finish(id, { status = "succeeded", result = null } = {}) {
    const current = getMutable(id);
    const normalizedStatus = required(status, "status");
    if (!TERMINAL_STATUSES.has(normalizedStatus)) throw new Error("status must be terminal.");
    const timestamp = validTimestamp(now(), "now");
    return commitTerminal({
      ...current,
      status: normalizedStatus,
      stages: terminalizeStages(current.stages, normalizedStatus),
      result: result == null ? null : clone(result),
      error: null,
      interruption: normalizedStatus === "interrupted" ? current.interruption : null,
      updatedAt: timestamp
    }, "finish");
  }

  function fail(id, error) {
    const current = getMutable(id);
    const timestamp = validTimestamp(now(), "now");
    return commitTerminal({
      ...current,
      status: "failed",
      stages: terminalizeStages(current.stages, "failed"),
      error: error?.message || String(error || "Job failed."),
      interruption: null,
      updatedAt: timestamp
    }, "fail");
  }

  function list() {
    return [...jobs.values()].map(clone);
  }

  function storageInfo() {
    return clone(diagnostics);
  }

  return { create, fail, finish, get, list, setStage, storageInfo };
}
