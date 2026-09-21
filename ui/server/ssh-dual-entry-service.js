import { normalizeVmIdentity } from "./vm-identity.js";
import { runSshCommand } from "./ssh-service.js";
import { createSshConnectivityVerifier } from "./ssh-connectivity-verifier.js";

const MANAGED_CONFIG = "/etc/ssh/sshd_config.d/99-gcp-vm-console-port.conf";

function normalizeUser(value) {
  const user = String(value || "").trim();
  if (!/^[a-z_][a-z0-9_-]{0,31}$/i.test(user) || user.toLowerCase() === "root") {
    throw new Error("SSH dual-entry policy requires a valid non-root SSH user.");
  }
  return user;
}

function normalizePassword(value) {
  const password = String(value ?? "");
  if (password.length < 8 || password.length > 128 || /[\0\r\n:]/.test(password)) {
    throw new Error("SSH password is invalid.");
  }
  return password;
}

function shellSingle(value) {
  return `'${String(value).replaceAll("'", `'"'"'`)}'`;
}

function configCommand(lines, { verify = "" } = {}) {
  const quotedLines = lines.map(shellSingle).join(" ");
  const validation = `/usr/sbin/sshd -t${verify ? ` && ${verify}` : ""}`;
  return `sudo bash -lc "set -e; install -d -m 0755 /etc/ssh/sshd_config.d; tmp=$(mktemp /etc/ssh/sshd_config.d/.gvc-auth.XXXXXX); backup=$(mktemp /etc/ssh/sshd_config.d/.gvc-auth.backup.XXXXXX); had_old=0; printf '%s\\n' ${quotedLines} > \\"$tmp\\"; chmod 0600 \\"$tmp\\"; if [ -f ${MANAGED_CONFIG} ]; then cp -p ${MANAGED_CONFIG} \\"$backup\\"; had_old=1; fi; mv -f \\"$tmp\\" ${MANAGED_CONFIG}; chmod 0600 ${MANAGED_CONFIG}; if ! ( ${validation} ); then if [ \\"$had_old\\" -eq 1 ]; then mv -f \\"$backup\\" ${MANAGED_CONFIG}; else rm -f ${MANAGED_CONFIG} \\"$backup\\"; fi; exit 1; fi; rm -f \\"$backup\\"; systemctl reload ssh 2>/dev/null || systemctl reload sshd"`;
}

function baseConfig() {
  return [
    "Port 22",
    "Port 45400",
    "PermitRootLogin no",
    "PubkeyAuthentication yes",
    "PasswordAuthentication no",
    "KbdInteractiveAuthentication no",
    "AuthenticationMethods publickey",
    "Match all"
  ];
}

function hardenedConfig() {
  return [
    "Port 22",
    "Port 45400",
    "PermitRootLogin no",
    "PubkeyAuthentication yes",
    "PasswordAuthentication no",
    "KbdInteractiveAuthentication no",
    "AuthenticationMethods publickey",
    "Match LocalPort 22",
    "PasswordAuthentication yes",
    "AuthenticationMethods publickey,password",
    "MaxAuthTries 3",
    "Match LocalPort 45400",
    "PasswordAuthentication no",
    "AuthenticationMethods publickey",
    "Match all"
  ];
}

export function createSshDualEntryService({
  runner,
  wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now = () => new Date().toISOString(),
  sshRetryDelayMs = 1500,
  sshMaxAttempts = 3,
  connectivityVerifier = createSshConnectivityVerifier()
} = {}) {
  if (!runner?.run) throw new Error("runner with run() is required.");
  const retry = { wait, retryDelayMs: sshRetryDelayMs, maxAttempts: sshMaxAttempts, operationClass: "write" };

  async function apply({ identity: rawIdentity, ssh = {}, password: rawPassword, passwordVersion, onStage = null } = {}) {
    const identity = normalizeVmIdentity(rawIdentity);
    const user = normalizeUser(ssh.sshUser || ssh.user);
    const password = normalizePassword(rawPassword);
    const requestedSsh = {
      sshUser: user,
      sshKeyFile: ssh.sshKeyFile || ssh.keyFile,
      sshPort: Number(ssh.sshPort || ssh.port || 22)
    };
    if (!String(passwordVersion || "")) throw new Error("SSH password version is required.");

    await onStage?.({ name: "ssh_preflight", status: "running", detail: "检查非 root 用户、sudo 与 OpenSSH 双入口支持" });
    const preflight = await runSshCommand(
      runner,
      identity,
      requestedSsh,
      `set -e; test $(id -u) -ne 0; command -v sudo >/dev/null; sudo -n true; /usr/sbin/sshd -T -C user=${user},host=localhost,addr=127.0.0.1,laddr=127.0.0.1,lport=22 >/dev/null; printf 'gvc-ssh-preflight-ready\\n'`,
      { ...retry, requestedSsh }
    );
    await onStage?.({ name: "ssh_preflight", status: "succeeded", detail: "OpenSSH 双入口预检通过" });

    await onStage?.({ name: "ssh_key_entry", status: "running", detail: "先建立 22/45400 密钥入口" });
    await runSshCommand(
      runner,
      identity,
      preflight.ssh,
      configCommand(baseConfig()),
      { ...retry, requestedSsh, allowDefaultPortFallback: false }
    );
    const port45400 = { ...requestedSsh, sshPort: 45400 };
    await runSshCommand(
      runner,
      identity,
      port45400,
      "printf 'gvc-ssh-45400-key-ready\\n'",
      { ...retry, requestedSsh: port45400, allowDefaultPortFallback: false }
    );
    await onStage?.({ name: "ssh_key_entry", status: "succeeded", detail: "45400 密钥入口已验证" });

    await onStage?.({ name: "ssh_password_policy", status: "running", detail: "将 22 收紧为密钥加密码" });
    const verify = `/usr/sbin/sshd -T -C user=${user},host=localhost,addr=127.0.0.1,laddr=127.0.0.1,lport=22 | grep -q '^authenticationmethods publickey,password$' && /usr/sbin/sshd -T -C user=${user},host=localhost,addr=127.0.0.1,laddr=127.0.0.1,lport=45400 | grep -q '^authenticationmethods publickey$'`;
    await runSshCommand(
      runner,
      identity,
      port45400,
      `sudo -n chpasswd && ${configCommand(hardenedConfig(), { verify })}`,
      {
        ...retry,
        requestedSsh: port45400,
        allowDefaultPortFallback: false,
        stdinText: `${user}:${password}\n`,
        redactValues: [password]
      }
    );
    await runSshCommand(
      runner,
      identity,
      port45400,
      "printf 'gvc-ssh-dual-entry-ready\\n'",
      { ...retry, requestedSsh: port45400, allowDefaultPortFallback: false }
    );
    await onStage?.({ name: "ssh_password_policy", status: "succeeded", detail: "22 密钥加密码、45400 密钥认证已验证" });

    return {
      status: "succeeded",
      ssh: {
        desiredPort: 45400,
        actualPort: 45400,
        fallback: false,
        verified: true,
        label: "SSH 双入口已验证"
      },
      policy: {
        mode: "dual_entry",
        user,
        passwordVersion: String(passwordVersion),
        checkedAt: now(),
        entries: [
          { port: 22, authentication: "publickey,password", exposure: "iap" },
          { port: 45400, authentication: "publickey", exposure: "public+iap" }
        ]
      }
    };
  }

  async function verifyPublic45400(input) {
    return connectivityVerifier.verifyPublic45400(input);
  }

  async function verifyIap22Path(input) {
    return connectivityVerifier.verifyIap22Path(input);
  }

  return { apply, verifyIap22Path, verifyPublic45400 };
}
