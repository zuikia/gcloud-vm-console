import { spawn } from "node:child_process";

import { normalizeVmIdentity } from "./vm-identity.js";

const PUBLIC_COMMAND = "printf 'gvc-public-45400-ready\\n'";

function required(value, label) {
  const text = String(value || "").trim();
  if (!text) throw new Error(`${label} is required.`);
  return text;
}

function validIpv4(value) {
  const text = String(value || "").trim();
  const parts = text.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part) || Number(part) > 255)) {
    throw new Error("A valid external IPv4 address is required.");
  }
  return text;
}

function sshUser(value) {
  const user = required(value, "sshUser");
  if (/[@\s]/.test(user)) throw new Error("sshUser is invalid.");
  return user;
}

function sanitize(value, keyPath = "") {
  return String(value || "")
    .split(String(keyPath || "")).join("[REDACTED_KEY_PATH]")
    .replace(/(?:vless|vmess|hy2|hysteria2|tuic|ss|trojan):\/\/\S+/gi, "[REDACTED_LINK]")
    .replace(/\b(?:password|passwd|token|secret|credential)=\S+/gi, "[REDACTED_SECRET]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 800);
}

export function publicSshArgs(identityInput, ssh = {}, externalIp) {
  normalizeVmIdentity(identityInput);
  const user = sshUser(ssh.sshUser || ssh.user);
  const keyFile = required(ssh.sshKeyFile || ssh.keyFile, "sshKeyFile");
  const ip = validIpv4(externalIp);
  return [
    "-T",
    "-i", keyFile,
    "-o", "BatchMode=yes",
    "-o", "IdentitiesOnly=yes",
    "-o", "StrictHostKeyChecking=no",
    "-o", "UserKnownHostsFile=/dev/null",
    "-o", "LogLevel=ERROR",
    "-o", "ConnectTimeout=20",
    "-p", "45400",
    `${user}@${ip}`,
    PUBLIC_COMMAND
  ];
}

export function iapTunnelArgs(identityInput, port = 22) {
  const identity = normalizeVmIdentity(identityInput);
  const targetPort = Number(port);
  if (!Number.isInteger(targetPort) || targetPort < 1 || targetPort > 65535) throw new Error("port is invalid.");
  return [
    "compute",
    "start-iap-tunnel",
    identity.name,
    String(targetPort),
    "--listen-on-stdin",
    `--configuration=${identity.configuration}`,
    `--account=${identity.account}`,
    `--project=${identity.projectId}`,
    `--zone=${identity.zone}`,
    "--quiet",
    "--verbosity=warning"
  ];
}

export function createSshConnectivityVerifier({
  spawnImpl = spawn,
  sshBinary = "ssh",
  gcloudBinary = "gcloud",
  timeoutMs = 30_000,
  maxOutputBytes = 64 * 1024,
  setTimeoutImpl = setTimeout,
  clearTimeoutImpl = clearTimeout
} = {}) {
  function runProcess(binary, args, { keyPath = "", expectBanner = false } = {}) {
    return new Promise((resolve, reject) => {
      let child;
      let stdout = "";
      let stderr = "";
      let settled = false;
      let timer;

      const finishError = (message, terminate = false) => {
        if (settled) return;
        settled = true;
        clearTimeoutImpl(timer);
        if (terminate) child?.kill?.("SIGTERM");
        reject(new Error(sanitize(message, keyPath) || "SSH connectivity verification failed."));
      };
      const finishSuccess = (result) => {
        if (settled) return;
        settled = true;
        clearTimeoutImpl(timer);
        if (expectBanner) child?.kill?.("SIGTERM");
        resolve(result);
      };
      const append = (current, chunk) => {
        const next = `${current}${String(chunk || "")}`;
        if (Buffer.byteLength(next) > maxOutputBytes) {
          finishError("SSH connectivity verification output exceeded its limit.", true);
          return current;
        }
        return next;
      };

      try {
        child = spawnImpl(binary, args, { shell: false, stdio: [expectBanner ? "pipe" : "ignore", "pipe", "pipe"] });
      } catch (error) {
        finishError(error?.message || "Unable to start SSH connectivity verification.");
        return;
      }
      child.stdout?.setEncoding?.("utf8");
      child.stderr?.setEncoding?.("utf8");
      child.stdout?.on("data", (chunk) => {
        stdout = append(stdout, chunk);
        if (expectBanner && /SSH-2\.0-/.test(stdout)) finishSuccess({ stdout: "", stderr: "", exitCode: 0 });
      });
      child.stderr?.on("data", (chunk) => { stderr = append(stderr, chunk); });
      child.on("error", (error) => finishError(error?.message || "Unable to start SSH connectivity verification."));
      child.on("close", (exitCode) => {
        if (settled) return;
        if (exitCode === 0 && !expectBanner) finishSuccess({ stdout: "", stderr: "", exitCode });
        else finishError(stderr || stdout || `SSH connectivity verification exited with ${exitCode}.`);
      });
      timer = setTimeoutImpl(() => finishError(`SSH connectivity verification timed out after ${timeoutMs}ms.`, true), timeoutMs);
      timer?.unref?.();
    });
  }

  async function verifyPublic45400({ identity, ssh, externalIp } = {}) {
    const keyPath = ssh?.sshKeyFile || ssh?.keyFile || "";
    await runProcess(sshBinary, publicSshArgs(identity, ssh, externalIp), { keyPath });
    return { verified: true, path: "public", port: 45400 };
  }

  async function verifyIap22Path({ identity } = {}) {
    await runProcess(gcloudBinary, iapTunnelArgs(identity, 22), { expectBanner: true });
    return { verified: true, path: "iap", port: 22 };
  }

  return { verifyIap22Path, verifyPublic45400 };
}
