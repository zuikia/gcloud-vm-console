import { spawn } from "node:child_process";

import { READ_ONLY_PROBE_COMMAND } from "./read-only-probe-contract.js";
import { verifiedSshConnection } from "./ssh-service.js";
import { normalizeVmIdentity } from "./vm-identity.js";

const DEFAULT_MAX_OUTPUT_BYTES = 4 * 1024 * 1024;

function required(value, label) {
  const normalized = String(value || "").trim();
  if (!normalized) throw new Error(`${label} is required.`);
  return normalized;
}

function validPort(value) {
  const port = Number(value || 22);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("sshPort must be between 1 and 65535.");
  return port;
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'"'"'`)}'`;
}

function proxyCommand(identity, gcloudBinary) {
  return [
    shellQuote(gcloudBinary),
    "compute",
    "start-iap-tunnel",
    shellQuote(identity.name),
    "%p",
    "--listen-on-stdin",
    `--configuration=${shellQuote(identity.configuration)}`,
    `--account=${shellQuote(identity.account)}`,
    `--project=${shellQuote(identity.projectId)}`,
    `--zone=${shellQuote(identity.zone)}`,
    "--quiet",
    "--verbosity=warning"
  ].join(" ");
}

export function readOnlySshArgs(identityInput, ssh = {}, remoteCommand, { gcloudBinary = "gcloud" } = {}) {
  const identity = normalizeVmIdentity(identityInput);
  if (remoteCommand !== READ_ONLY_PROBE_COMMAND) {
    throw new Error("SSH command must match the fixed read-only probe contract.");
  }
  const sshUser = required(ssh.sshUser || ssh.user, "sshUser");
  if (/[@\s]/.test(sshUser)) throw new Error("sshUser must be a valid local SSH user.");
  const sshKeyFile = required(ssh.sshKeyFile || ssh.keyFile, "sshKeyFile");
  const sshPort = validPort(ssh.sshPort ?? ssh.port);
  return {
    identity,
    ssh: { sshUser, sshKeyFile, sshPort },
    args: [
      "-T",
      "-i", sshKeyFile,
      "-o", "BatchMode=yes",
      "-o", "IdentitiesOnly=yes",
      "-o", "StrictHostKeyChecking=no",
      "-o", "UserKnownHostsFile=/dev/null",
      "-o", "LogLevel=ERROR",
      "-o", "ConnectTimeout=20",
      "-o", "ServerAliveInterval=15",
      "-o", "ServerAliveCountMax=2",
      "-o", `ProxyCommand=${proxyCommand(identity, required(gcloudBinary, "gcloudBinary"))}`,
      "-p", String(sshPort),
      `${sshUser}@${identity.name}`,
      remoteCommand
    ]
  };
}

function sanitize(value, sshKeyFile) {
  return String(value || "")
    .split(String(sshKeyFile || "")).join("[REDACTED_KEY_PATH]")
    .replace(/(?:vless|vmess|hy2|hysteria2|tuic|ss|trojan):\/\/\S+/gi, "[REDACTED_LINK]")
    .replace(/\b(?:password|passwd|token|secret|credential)=\S+/gi, "[REDACTED_SECRET]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 800);
}

function retryable(error) {
  return /permission denied \(publickey\)|connection refused|connect to host|operation timed out|no route to host|connection reset|kex_exchange_identification|failed to connect to backend|failed to connect to port \d+/i.test(error?.message || "");
}

function fallbackEligible(error, port) {
  return port !== 22 && /connection refused|connect to host|operation timed out|no route to host|port \d+/i.test(error?.message || "");
}

export class ReadOnlySshProbeError extends Error {
  constructor(message, { code = "ssh_failure", exitCode = null } = {}) {
    super(message);
    this.name = "ReadOnlySshProbeError";
    this.code = code;
    this.exitCode = exitCode;
  }
}

export function createReadOnlySshProbeRunner({
  spawnImpl = spawn,
  binary = "ssh",
  gcloudBinary = "gcloud",
  timeoutMs = 120_000,
  maxOutputBytes = DEFAULT_MAX_OUTPUT_BYTES,
  maxAttempts = 6,
  retryDelayMs = 10_000,
  wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  setTimeoutImpl = setTimeout,
  clearTimeoutImpl = clearTimeout,
  onCommand = () => {}
} = {}) {
  async function runOnce(identity, ssh, remoteCommand, runOptions = {}) {
    const built = readOnlySshArgs(identity, ssh, remoteCommand, { gcloudBinary });
    const outputLimit = Number(runOptions.maxOutputBytes || maxOutputBytes);
    const runTimeoutMs = Number(runOptions.timeoutMs || timeoutMs);

    return new Promise((resolve, reject) => {
      let stdout = "";
      let stderr = "";
      let settled = false;
      let closed = false;
      let child;
      let timer = null;

      const finishError = (message, details = {}, terminate = false) => {
        if (settled) return;
        settled = true;
        clearTimeoutImpl(timer);
        if (terminate && child && !closed) child.kill?.("SIGTERM");
        reject(new ReadOnlySshProbeError(sanitize(message, built.ssh.sshKeyFile) || "Read-only SSH probe failed.", details));
      };

      const append = (current, chunk, streamName) => {
        const next = `${current}${String(chunk || "")}`;
        if (Buffer.byteLength(next) > outputLimit) {
          finishError(`Read-only SSH ${streamName} exceeded ${outputLimit} bytes.`, { code: "output_limit" }, true);
          return current;
        }
        return next;
      };

      try {
        child = spawnImpl(binary, built.args, {
          env: { ...process.env, ...(runOptions.env || {}) },
          shell: false,
          stdio: ["ignore", "pipe", "pipe"]
        });
      } catch (error) {
        finishError(error?.message || "Unable to start ssh.", { code: "spawn_failure" });
        return;
      }

      child.stdout?.setEncoding?.("utf8");
      child.stderr?.setEncoding?.("utf8");
      child.stdout?.on("data", (chunk) => { stdout = append(stdout, chunk, "stdout"); });
      child.stderr?.on("data", (chunk) => { stderr = append(stderr, chunk, "stderr"); });
      child.on("error", (error) => finishError(error?.message || "Unable to start ssh.", { code: "spawn_failure" }));
      child.on("close", (exitCode) => {
        closed = true;
        if (settled) return;
        settled = true;
        clearTimeoutImpl(timer);
        if (exitCode !== 0) {
          reject(new ReadOnlySshProbeError(sanitize(stderr || stdout, built.ssh.sshKeyFile) || "Read-only SSH probe failed.", {
            code: "exit_nonzero",
            exitCode
          }));
          return;
        }
        resolve({ stdout, stderr, exitCode });
      });

      timer = setTimeoutImpl(() => finishError(`Read-only SSH probe timed out after ${runTimeoutMs}ms.`, { code: "timeout" }, true), runTimeoutMs);
      timer?.unref?.();
    });
  }

  async function run(identityInput, sshInput = {}, remoteCommand, runOptions = {}) {
    const initial = readOnlySshArgs(identityInput, sshInput, remoteCommand, { gcloudBinary });
    const attempts = Math.max(1, Number(runOptions.maxAttempts || maxAttempts));
    const delay = Math.max(0, Number(runOptions.retryDelayMs ?? retryDelayMs));
    const allowFallback = runOptions.allowDefaultPortFallback !== false;
    let activeSsh = initial.ssh;
    let fallbackUsed = false;
    let lastError;
    onCommand({ mode: "read", category: "ssh.fixed-probe" });

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        const result = await runOnce(initial.identity, activeSsh, remoteCommand, runOptions);
        return {
          result,
          ssh: activeSsh,
          sshConnection: verifiedSshConnection(initial.ssh, activeSsh, fallbackUsed)
        };
      } catch (error) {
        lastError = error;
        if (allowFallback && !fallbackUsed && fallbackEligible(error, activeSsh.sshPort) && attempt < attempts) {
          activeSsh = { ...activeSsh, sshPort: 22 };
          fallbackUsed = true;
          continue;
        }
        if (attempt < attempts && retryable(error)) {
          await wait(delay);
          continue;
        }
        throw error;
      }
    }
    throw lastError || new ReadOnlySshProbeError("Read-only SSH probe retry exhausted.");
  }

  return { run };
}
