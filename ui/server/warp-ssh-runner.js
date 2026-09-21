import { spawn } from "node:child_process";
import { isIP } from "node:net";

import { contractForWarpOperation } from "./warp-command-contract.js";
import { normalizeVmIdentity } from "./vm-identity.js";

const MAX_OUTPUT_BYTES = 64 * 1024;

function required(value, label) {
  const text = String(value || "").trim();
  if (!text) throw new Error(`${label}不能为空。`);
  return text;
}

function normalizedSsh(input = {}) {
  const user = required(input.user || input.sshUser, "SSH 用户");
  if (!/^[a-z_][a-z0-9_-]{0,31}$/i.test(user) || user.toLowerCase() === "root") {
    throw new Error("SSH 用户无效。");
  }
  const keyFile = required(input.keyFile || input.sshKeyFile, "SSH 密钥");
  const port = Number(input.port ?? input.sshPort);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("SSH 端口必须在 1 到 65535 之间。");
  return { user, keyFile, port };
}

function shellSingle(value) {
  return `'${String(value).replaceAll("'", `'"'"'`)}'`;
}

function commonArgs(ssh) {
  return [
    "-T",
    "-i", ssh.keyFile,
    "-o", "BatchMode=yes",
    "-o", "IdentitiesOnly=yes",
    "-o", "StrictHostKeyChecking=accept-new",
    "-o", "UserKnownHostsFile=/dev/null",
    "-o", "LogLevel=ERROR",
    "-o", "ConnectTimeout=20",
    "-o", "ServerAliveInterval=15",
    "-o", "ServerAliveCountMax=2"
  ];
}

function proxyCommand(identity, gcloudBinary = "gcloud") {
  return [
    shellSingle(gcloudBinary),
    "compute", "start-iap-tunnel", shellSingle(identity.name), "%p",
    "--listen-on-stdin",
    `--configuration=${shellSingle(identity.configuration)}`,
    `--account=${shellSingle(identity.account)}`,
    `--project=${shellSingle(identity.projectId)}`,
    `--zone=${shellSingle(identity.zone)}`,
    "--quiet",
    "--verbosity=warning"
  ].join(" ");
}

export function publicWarpSshArgs({ identity: rawIdentity, ssh: rawSsh, externalIp, operation } = {}) {
  normalizeVmIdentity(rawIdentity);
  const ssh = normalizedSsh(rawSsh);
  const ip = required(externalIp, "公网 IPv4");
  if (isIP(ip) !== 4) throw new Error("公网 IPv4 无效。");
  return [
    ...commonArgs(ssh),
    "-p", String(ssh.port),
    `${ssh.user}@${ip}`,
    contractForWarpOperation(operation)
  ];
}

export function iapWarpSshArgs({ identity: rawIdentity, ssh: rawSsh, operation, gcloudBinary = "gcloud" } = {}) {
  const identity = normalizeVmIdentity(rawIdentity);
  const ssh = normalizedSsh(rawSsh);
  return [
    ...commonArgs(ssh),
    "-o", `ProxyCommand=${proxyCommand(identity, required(gcloudBinary, "gcloud"))}`,
    "-p", String(ssh.port),
    `${ssh.user}@${identity.name}`,
    contractForWarpOperation(operation)
  ];
}

function sanitize(value, keyFile = "") {
  return String(value || "")
    .split(String(keyFile || "")).join("[REDACTED_KEY_PATH]")
    .replace(/(?:vless|vmess|hy2|hysteria2|tuic|ss|trojan):\/\/\S+/gi, "[REDACTED_LINK]")
    .replace(/\b(?:password|passwd|token|secret|credential|license|device[_-]?id)=\S+/gi, "[REDACTED_SECRET]")
    .replace(/\/(?:Users|home|private|root)\/\S+/g, "[REDACTED_PATH]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 800);
}

function retryableTransport(error) {
  return error?.exitCode === 255
    || /connection refused|operation timed out|no route to host|connection reset|kex_exchange_identification|failed to connect/i.test(error?.message || "");
}

export class WarpSshError extends Error {
  constructor(message, { code = "ssh_failure", transport = "", exitCode = null } = {}) {
    super(message);
    this.name = "WarpSshError";
    this.code = code;
    this.transport = transport;
    this.exitCode = exitCode;
  }
}

export function createWarpSshRunner({
  spawnImpl = spawn,
  sshBinary = "ssh",
  gcloudBinary = "gcloud",
  statusTimeoutMs = 60_000,
  reconnectTimeoutMs = 90_000,
  maxOutputBytes = MAX_OUTPUT_BYTES,
  setTimeoutImpl = setTimeout,
  clearTimeoutImpl = clearTimeout
} = {}) {
  function runOnce({ operation, identity, ssh: rawSsh, externalIp, transport }) {
    const ssh = normalizedSsh(rawSsh);
    const args = transport === "public"
      ? publicWarpSshArgs({ identity, ssh, externalIp, operation })
      : iapWarpSshArgs({ identity, ssh, operation, gcloudBinary });
    const timeoutMs = operation === "reconnect" ? reconnectTimeoutMs : statusTimeoutMs;

    return new Promise((resolve, reject) => {
      let child;
      let stdout = "";
      let stderr = "";
      let settled = false;
      let timer;

      const fail = (message, details = {}, terminate = false) => {
        if (settled) return;
        settled = true;
        clearTimeoutImpl(timer);
        if (terminate) child?.kill?.("SIGTERM");
        reject(new WarpSshError(sanitize(message, ssh.keyFile) || "WARP SSH 操作失败。", { transport, ...details }));
      };
      const append = (current, chunk, stream) => {
        const next = `${current}${String(chunk || "")}`;
        if (Buffer.byteLength(next) > maxOutputBytes) {
          fail(`WARP SSH ${stream} 输出超过限制。`, { code: "output_limit" }, true);
          return current;
        }
        return next;
      };

      try {
        child = spawnImpl(sshBinary, args, { shell: false, stdio: ["ignore", "pipe", "pipe"] });
      } catch (error) {
        fail(error?.message || "无法启动 SSH。", { code: "spawn_failure" });
        return;
      }
      child.stdout?.setEncoding?.("utf8");
      child.stderr?.setEncoding?.("utf8");
      child.stdout?.on("data", (chunk) => { stdout = append(stdout, chunk, "stdout"); });
      child.stderr?.on("data", (chunk) => { stderr = append(stderr, chunk, "stderr"); });
      child.on("error", (error) => fail(error?.message || "无法启动 SSH。", { code: "spawn_failure" }));
      child.on("close", (exitCode) => {
        if (settled) return;
        settled = true;
        clearTimeoutImpl(timer);
        if (exitCode !== 0) {
          reject(new WarpSshError(sanitize(stderr || stdout, ssh.keyFile) || "WARP SSH 命令执行失败。", {
            code: "exit_nonzero",
            transport,
            exitCode
          }));
          return;
        }
        resolve({ stdout, stderr: "", exitCode, transport, sshPort: ssh.port });
      });
      timer = setTimeoutImpl(() => fail(`WARP SSH 操作在 ${timeoutMs}ms 后超时。`, { code: "timeout" }, true), timeoutMs);
      timer?.unref?.();
    });
  }

  async function run(input = {}) {
    const operation = String(input.operation || "");
    contractForWarpOperation(operation);
    const preferred = input.transport || (isIP(String(input.externalIp || "")) === 4 ? "public" : "iap");
    try {
      return await runOnce({ ...input, operation, transport: preferred });
    } catch (error) {
      if (operation === "status" && preferred === "public" && retryableTransport(error)) {
        return runOnce({ ...input, operation, transport: "iap" });
      }
      throw error;
    }
  }

  return { run };
}
