import { normalizeVmIdentity } from "./vm-identity.js";
import { runSshCommand } from "./ssh-service.js";

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

export function createMaintenanceService({
  runner,
  inventory,
  wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  sshRetryDelayMs = 10000,
  sshMaxAttempts = 6
} = {}) {
  if (!runner?.run) throw new Error("runner with run() is required.");
  const sshRetry = {
    wait,
    retryDelayMs: sshRetryDelayMs,
    maxAttempts: sshMaxAttempts,
    operationClass: "long-running"
  };

  async function checkStatus(input) {
    if (!inventory?.readObserved) throw new Error("inventory with readObserved() is required for status checks.");
    const observed = await inventory.readObserved(input);
    return {
      exists: Boolean(observed?.exists),
      status: observed?.status || "MISSING",
      externalIp: observed?.network?.externalIp || "",
      externalIpMode: observed?.network?.externalIpMode || "none"
    };
  }

  async function restartVm(input) {
    const identity = normalizeVmIdentity(input);
    await runner.run(["compute", "instances", "stop", identity.name], gcloudOptions(identity));
    await runner.run(["compute", "instances", "start", identity.name], gcloudOptions(identity));
    return { status: "succeeded", interruption: "stop_start" };
  }

  async function systemUpdate(input, ssh = {}) {
    const identity = normalizeVmIdentity(input);
    const stages = [
      {
        name: "precheck",
        command: "sudo bash -lc 'systemctl is-active sing-box || true; systemctl is-active x-ui || true; ss -lunpt || true'"
      },
      {
        name: "update",
        command: "sudo bash -lc 'apt-get update && DEBIAN_FRONTEND=noninteractive apt-get upgrade -y'"
      },
      {
        name: "postcheck",
        command: "sudo bash -lc 'systemctl is-active sing-box || true; systemctl is-active x-ui || true; ss -lunpt || true'"
      }
    ];
    let activeSsh = ssh;
    let sshConnection = null;
    for (const stage of stages) {
      const run = await runSshCommand(runner, identity, activeSsh, stage.command, { ...sshRetry, requestedSsh: ssh });
      activeSsh = run.ssh;
      sshConnection = run.sshConnection;
    }
    return { status: "succeeded", stages: stages.map((stage) => stage.name), ssh: sshConnection };
  }

  return { checkStatus, restartVm, systemUpdate };
}
