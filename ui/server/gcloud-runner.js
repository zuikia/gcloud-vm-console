import { spawn } from "node:child_process";

import { classifyNetworkError } from "./network-error-classifier.js";

const DEFAULT_TIMEOUTS = Object.freeze({
  defaultTimeoutMs: 60_000,
  writeTimeoutMs: 180_000,
  sshTimeoutMs: 120_000,
  longRunningTimeoutMs: 1_800_000
});
const WRITE_ACTIONS = new Set([
  "activate",
  "add-iam-policy-binding",
  "create",
  "delete",
  "disable",
  "enable",
  "remove-iam-policy-binding",
  "start",
  "stop",
  "reset",
  "set",
  "set-iam-policy",
  "update",
  "set-metadata",
  "add-tags",
  "remove-tags"
]);

function required(value, label) {
  const normalized = String(value || "").trim();
  if (!normalized) throw new Error(`${label} is required.`);
  return normalized;
}

function explicitContextArgs(context = {}, contextScope = "project") {
  if (contextScope === "local") return [];
  if (contextScope === "account") {
    return [
      `--configuration=${required(context.configuration, "configuration")}`,
      `--account=${required(context.account, "account")}`
    ];
  }
  if (contextScope !== "project") throw new Error("contextScope must be local, account, or project.");
  return [
    `--configuration=${required(context.configuration, "configuration")}`,
    `--account=${required(context.account, "account")}`,
    `--project=${required(context.projectId, "projectId")}`
  ];
}

function locationArgs(location = {}, allowGlobal = false) {
  const zone = String(location.zone || "").trim();
  const region = String(location.region || "").trim();
  if (zone && region) throw new Error("Specify a zone or region, not both.");
  if (zone) return [`--zone=${zone}`];
  if (region) return [`--region=${region}`];
  if (allowGlobal) return [];
  throw new Error("A zone or region is required for this gcloud command.");
}

function redact(text, values = []) {
  let output = String(text || "");
  for (const value of values) {
    const secret = String(value || "");
    if (secret) output = output.split(secret).join("[REDACTED]");
  }
  return output;
}

function positiveTimeout(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function inferredOperationClass(command = []) {
  if (command[0] === "compute" && command[1] === "ssh") return "ssh-read";
  if (command.slice(1, 3).some((part) => WRITE_ACTIONS.has(part))) return "write";
  return "read";
}

export function timeoutForCommand(command, options = {}, defaults = {}) {
  const config = { ...DEFAULT_TIMEOUTS, ...defaults };
  if (Number.isFinite(Number(options.timeoutMs)) && Number(options.timeoutMs) > 0) return Number(options.timeoutMs);
  const operationClass = options.operationClass || inferredOperationClass(command);
  if (operationClass === "long-running") return positiveTimeout(config.longRunningTimeoutMs, DEFAULT_TIMEOUTS.longRunningTimeoutMs);
  if (operationClass === "ssh-read") return positiveTimeout(config.sshTimeoutMs, DEFAULT_TIMEOUTS.sshTimeoutMs);
  if (operationClass === "write") return positiveTimeout(config.writeTimeoutMs, DEFAULT_TIMEOUTS.writeTimeoutMs);
  return positiveTimeout(config.defaultTimeoutMs, DEFAULT_TIMEOUTS.defaultTimeoutMs);
}

function outputCollector(limitBytes, onOverflow) {
  const chunks = [];
  let bytes = 0;
  let overflowed = false;
  return {
    append(chunk) {
      if (overflowed) return;
      const buffer = Buffer.from(String(chunk || ""));
      const remaining = Math.max(0, limitBytes - bytes);
      if (remaining) {
        const accepted = buffer.subarray(0, remaining);
        chunks.push(accepted);
        bytes += accepted.byteLength;
      }
      if (buffer.byteLength > remaining) {
        overflowed = true;
        onOverflow();
      }
    },
    text() {
      return Buffer.concat(chunks, bytes).toString("utf8");
    }
  };
}

export class GcloudCommandError extends Error {
  constructor({ command, exitCode, stderr, stdout, cause, code = "exit_nonzero", message }) {
    const detail = message || stderr.trim() || stdout.trim() || cause?.message || "gcloud command failed";
    super(detail, cause ? { cause } : undefined);
    this.name = "GcloudCommandError";
    this.code = code;
    this.command = command;
    this.exitCode = exitCode;
    this.stderr = stderr;
    this.stdout = stdout;
  }
}

export function createGcloudRunner({
  spawnImpl = spawn,
  binary = "gcloud",
  baseEnv = process.env,
  defaultTimeoutMs = DEFAULT_TIMEOUTS.defaultTimeoutMs,
  writeTimeoutMs = DEFAULT_TIMEOUTS.writeTimeoutMs,
  sshTimeoutMs = DEFAULT_TIMEOUTS.sshTimeoutMs,
  longRunningTimeoutMs = DEFAULT_TIMEOUTS.longRunningTimeoutMs,
  maxOutputBytes = 4 * 1024 * 1024,
  killGraceMs = 2000,
  wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  retryDelays = [500, 1500],
  setTimeoutImpl = setTimeout,
  clearTimeoutImpl = clearTimeout
} = {}) {
  const timeoutDefaults = { defaultTimeoutMs, writeTimeoutMs, sshTimeoutMs, longRunningTimeoutMs };
  const boundedRetryDelays = [...retryDelays].slice(0, 2);

  async function runOnce(command, options = {}) {
    if (!Array.isArray(command) || command.length === 0 || command.some((part) => typeof part !== "string" || !part)) {
      throw new Error("gcloud command must be a non-empty string array.");
    }

    const args = [
      ...command,
      ...explicitContextArgs(options.context, options.contextScope || "project"),
      ...locationArgs(options.location, options.allowGlobal),
      ...(options.formatJson ? ["--format=json"] : []),
      "--quiet"
    ];
    const redactValues = options.redactValues || [];
    const hasStdin = options.stdinText !== undefined && options.stdinText !== null;
    const stdinText = hasStdin ? String(options.stdinText) : "";
    if (Buffer.byteLength(stdinText) > 64 * 1024) throw new Error("gcloud stdin exceeds 65536 bytes.");
    const timeoutMs = timeoutForCommand(command, options, timeoutDefaults);
    const outputLimit = positiveTimeout(options.maxOutputBytes, maxOutputBytes);

    return new Promise((resolve, reject) => {
      let settled = false;
      let closed = false;
      let timeoutHandle = null;
      let killHandle = null;
      let child;

      const outputs = {};
      const currentOutput = () => ({
        stdout: redact(outputs.stdout?.text() || "", redactValues),
        stderr: redact(outputs.stderr?.text() || "", redactValues)
      });

      const clearMainTimeout = () => {
        if (timeoutHandle) clearTimeoutImpl(timeoutHandle);
        timeoutHandle = null;
      };

      const terminateProcess = () => {
        if (!child || closed) return;
        child.kill?.("SIGTERM");
        killHandle = setTimeoutImpl(() => {
          if (!closed) child.kill?.("SIGKILL");
        }, killGraceMs);
        killHandle?.unref?.();
      };

      const fail = ({ code, exitCode = null, cause, message, terminate = false }) => {
        if (settled) return;
        settled = true;
        clearMainTimeout();
        if (terminate) terminateProcess();
        reject(new GcloudCommandError({
          command: args,
          exitCode,
          ...currentOutput(),
          cause,
          code,
          message
        }));
      };

      outputs.stdout = outputCollector(outputLimit, () => fail({
        code: "output_limit",
        message: `gcloud stdout exceeded ${outputLimit} bytes`,
        terminate: true
      }));
      outputs.stderr = outputCollector(outputLimit, () => fail({
        code: "output_limit",
        message: `gcloud stderr exceeded ${outputLimit} bytes`,
        terminate: true
      }));

      try {
        child = spawnImpl(binary, args, {
          cwd: options.cwd,
          env: { ...baseEnv, ...(options.env || {}) },
          shell: false,
          stdio: [hasStdin ? "pipe" : "ignore", "pipe", "pipe"]
        });
      } catch (cause) {
        fail({ code: "spawn_failure", cause, message: cause?.message || "Unable to start gcloud" });
        return;
      }

      child.stdout?.setEncoding?.("utf8");
      child.stderr?.setEncoding?.("utf8");
      child.stdout?.on("data", (chunk) => outputs.stdout.append(chunk));
      child.stderr?.on("data", (chunk) => outputs.stderr.append(chunk));
      if (hasStdin) {
        child.stdin?.on?.("error", (cause) => fail({
          code: "stdin_failure",
          cause,
          message: "Unable to send protected input to gcloud",
          terminate: true
        }));
        child.stdin?.end?.(stdinText);
      }

      timeoutHandle = setTimeoutImpl(() => fail({
        code: "timeout",
        message: `gcloud command timed out after ${timeoutMs}ms`,
        terminate: true
      }), timeoutMs);
      timeoutHandle?.unref?.();

      child.on("error", (cause) => {
        fail({ code: "spawn_failure", cause, message: cause?.message || "Unable to start gcloud" });
      });
      child.on("close", (exitCode) => {
        closed = true;
        if (killHandle) clearTimeoutImpl(killHandle);
        if (settled) return;
        settled = true;
        clearMainTimeout();
        const result = {
          command: args,
          exitCode,
          ...currentOutput()
        };
        if (exitCode !== 0) {
          reject(new GcloudCommandError({ ...result, code: "exit_nonzero" }));
          return;
        }
        resolve(result);
      });
    });
  }

  async function run(command, options = {}) {
    const inferredClass = inferredOperationClass(command);
    const operationClass = options.operationClass || inferredClass;
    const mayRetry = inferredClass === "read" && operationClass === "read" && options.retry !== false;
    const attempts = mayRetry ? boundedRetryDelays.length + 1 : 1;
    let lastError;

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        const result = await runOnce(command, options);
        return { ...result, retryAttempts: attempt };
      } catch (error) {
        lastError = error;
        const classified = classifyNetworkError(error, { baseEnv });
        const retryable = error instanceof GcloudCommandError &&
          error.code === "exit_nonzero" &&
          classified.retryable;
        if (!mayRetry || !retryable || attempt >= attempts) {
          error.retryAttempts = attempt;
          throw error;
        }
        await wait(boundedRetryDelays[attempt - 1]);
      }
    }
    throw lastError;
  }

  async function runJson(command, options = {}) {
    const result = await run(command, { ...options, formatJson: true });
    try {
      return { ...result, data: JSON.parse(result.stdout || "null") };
    } catch (cause) {
      throw new GcloudCommandError({
        ...result,
        exitCode: result.exitCode,
        stderr: `gcloud returned invalid JSON: ${cause.message}`,
        cause,
        code: "invalid_json"
      });
    }
  }

  return { run, runJson };
}
