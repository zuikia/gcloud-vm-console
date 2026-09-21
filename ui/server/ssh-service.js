function required(value, label) {
  const normalized = String(value || "").trim();
  if (!normalized) throw new Error(`${label} is required.`);
  return normalized;
}

function gcloudOptions(identity) {
  return {
    context: {
      configuration: identity.configuration,
      account: identity.account,
      projectId: identity.projectId
    },
    location: { zone: identity.zone }
  };
}

function shouldRetryDefaultSshPort(error, sshPort) {
  const port = Number(sshPort || 0);
  if (!port || port === 22) return false;
  const message = error?.message || String(error || "");
  return /connection refused|connect to host|operation timed out|no route to host|port \d+/i.test(message);
}

function connectionPort(ssh) {
  const port = Number(ssh?.sshPort || 0);
  return port || 22;
}

function isTransientSshError(error) {
  const message = error?.message || String(error || "");
  return /permission denied \(publickey\)|connection refused|connect to host|operation timed out|no route to host|connection reset|kex_exchange_identification|failed to connect to backend|failed to connect to port \d+/i.test(message);
}

export function sshCommand(identity, { sshUser, sshKeyFile, sshPort }, remoteCommand) {
  const command = [
    "compute",
    "ssh",
    `${required(sshUser, "sshUser")}@${identity.name}`,
    "--tunnel-through-iap",
    `--ssh-key-file=${required(sshKeyFile, "sshKeyFile")}`,
    `--command=${remoteCommand}`
  ];
  if (sshPort) command.splice(5, 0, `--ssh-flag=-p ${Number(sshPort)}`);
  return command;
}

export function unverifiedSshConnection(ssh) {
  return {
    desiredPort: connectionPort(ssh),
    actualPort: null,
    fallback: false,
    verified: false,
    label: "SSH 未连接"
  };
}

export function verifiedSshConnection(requestedSsh, activeSsh, fallbackUsed = false) {
  const desiredPort = connectionPort(requestedSsh);
  const actualPort = connectionPort(activeSsh);
  const fallback = fallbackUsed || desiredPort !== actualPort;
  return {
    desiredPort,
    actualPort,
    fallback,
    verified: true,
    label: fallback
      ? `SSH 实际连接 ${actualPort}（已从 ${desiredPort} 回退）`
      : `SSH 实际连接 ${actualPort}`
  };
}

export async function runSshCommand(runner, identity, ssh, remoteCommand, {
  wait,
  retryDelayMs,
  maxAttempts,
  requestedSsh = ssh,
  allowDefaultPortFallback = true,
  operationClass = "ssh-read",
  timeoutMs,
  stdinText,
  redactValues
}) {
  let activeSsh = ssh;
  let triedDefaultPort = false;
  let lastError = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return {
        result: await runner.run(sshCommand(identity, activeSsh, remoteCommand), {
          ...gcloudOptions(identity),
          operationClass,
          ...(timeoutMs ? { timeoutMs } : {}),
          ...(stdinText !== undefined ? { stdinText } : {}),
          ...(redactValues?.length ? { redactValues } : {})
        }),
        ssh: activeSsh,
        sshConnection: verifiedSshConnection(requestedSsh, activeSsh, triedDefaultPort)
      };
    } catch (error) {
      lastError = error;
      if (allowDefaultPortFallback && !triedDefaultPort && shouldRetryDefaultSshPort(error, activeSsh?.sshPort)) {
        activeSsh = { ...activeSsh, sshPort: "" };
        triedDefaultPort = true;
        continue;
      }
      if (attempt < maxAttempts && isTransientSshError(error)) {
        await wait(retryDelayMs);
        continue;
      }
      throw error;
    }
  }
  throw lastError || new Error("SSH command retry exhausted.");
}
