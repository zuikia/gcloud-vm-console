import assert from "node:assert/strict";
import test from "node:test";

import { createMaintenanceService } from "../server/maintenance-service.js";

const identity = {
  configuration: "acct-a",
  account: "user@example.com",
  projectId: "project-a",
  zone: "us-west1-b",
  name: "vm-a"
};

function createFakeRunner(responses = []) {
  const calls = [];
  return {
    calls,
    runner: {
      async run(command, options) {
        calls.push({ command, options });
        const response = responses.shift() || {};
        if (response.error) throw response.error;
        return { exitCode: 0, stdout: "", stderr: "" };
      }
    }
  };
}

test("maintenance service checks VM status through inventory without a cloud write", async () => {
  const inventoryCalls = [];
  const service = createMaintenanceService({
    runner: createFakeRunner().runner,
    inventory: {
      async readObserved(input) {
        inventoryCalls.push(input);
        return { exists: true, status: "RUNNING", network: { externalIp: "203.0.113.10", externalIpMode: "ephemeral" } };
      }
    }
  });

  const status = await service.checkStatus(identity);

  assert.deepEqual(status, {
    exists: true,
    status: "RUNNING",
    externalIp: "203.0.113.10",
    externalIpMode: "ephemeral"
  });
  assert.deepEqual(inventoryCalls, [identity]);
});

test("maintenance service restarts a VM with explicit gcloud context", async () => {
  const fake = createFakeRunner();
  const service = createMaintenanceService({ runner: fake.runner });

  const result = await service.restartVm(identity);

  assert.deepEqual(result, { status: "succeeded", interruption: "stop_start" });
  assert.deepEqual(fake.calls.map((call) => call.command), [
    ["compute", "instances", "stop", "vm-a"],
    ["compute", "instances", "start", "vm-a"]
  ]);
  assert.deepEqual(fake.calls[0].options, {
    context: { configuration: "acct-a", account: "user@example.com", projectId: "project-a" },
    location: { zone: "us-west1-b" }
  });
});

test("maintenance service runs system update as staged SSH commands without forcing reboot", async () => {
  const fake = createFakeRunner();
  const service = createMaintenanceService({ runner: fake.runner });

  const result = await service.systemUpdate(identity, {
    sshUser: "y",
    sshKeyFile: "/tmp/gcp-key",
    sshPort: 45400
  });

  assert.deepEqual(result.stages, ["precheck", "update", "postcheck"]);
  assert.deepEqual(result.ssh, {
    desiredPort: 45400,
    actualPort: 45400,
    fallback: false,
    verified: true,
    label: "SSH 实际连接 45400"
  });
  assert.equal(fake.calls.length, 3);
  assert.deepEqual(fake.calls[0].command.slice(0, 3), ["compute", "ssh", "y@vm-a"]);
  assert.ok(fake.calls[1].command.some((part) => part.includes("apt-get update")));
  assert.ok(fake.calls[1].command.some((part) => part.includes("DEBIAN_FRONTEND=noninteractive")));
  assert.equal(fake.calls.some((call) => call.command.some((part) => /reboot/i.test(part))), false);
  assert.ok(fake.calls.every((call) => call.command.includes("--tunnel-through-iap")));
  assert.ok(fake.calls.every((call) => call.command.includes("--ssh-key-file=/tmp/gcp-key")));
  assert.ok(fake.calls.every((call) => call.command.includes("--ssh-flag=-p 45400")));
});

test("maintenance service retries system update over default SSH port when a custom port is not ready", async () => {
  const fake = createFakeRunner([
    { error: new Error("ssh: connect to host port 45400: Connection refused") },
    {},
    {},
    {}
  ]);
  const service = createMaintenanceService({ runner: fake.runner });

  const result = await service.systemUpdate(identity, {
    sshUser: "y",
    sshKeyFile: "/tmp/gcp-key",
    sshPort: 45400
  });

  assert.deepEqual(result.stages, ["precheck", "update", "postcheck"]);
  assert.deepEqual(result.ssh, {
    desiredPort: 45400,
    actualPort: 22,
    fallback: true,
    verified: true,
    label: "SSH 实际连接 22（已从 45400 回退）"
  });
  assert.equal(fake.calls.length, 4);
  assert.ok(fake.calls[0].command.includes("--ssh-flag=-p 45400"));
  assert.equal(fake.calls[1].command.some((part) => part.includes("--ssh-flag=-p 45400")), false);
  assert.ok(fake.calls.slice(1).every((call) => call.command.includes("--tunnel-through-iap")));
});

test("maintenance service waits through transient SSH readiness failures", async () => {
  const waits = [];
  const fake = createFakeRunner([
    { error: new Error("ssh: connect to host port 45400: Connection refused") },
    { error: new Error("Permission denied (publickey)") },
    {},
    {},
    {}
  ]);
  const service = createMaintenanceService({
    runner: fake.runner,
    wait: async (ms) => waits.push(ms),
    sshRetryDelayMs: 5,
    sshMaxAttempts: 3
  });

  const result = await service.systemUpdate(identity, {
    sshUser: "y",
    sshKeyFile: "/tmp/gcp-key",
    sshPort: 45400
  });

  assert.deepEqual(result.stages, ["precheck", "update", "postcheck"]);
  assert.deepEqual(waits, [5]);
  assert.equal(fake.calls.length, 5);
  assert.equal(fake.calls[2].command.some((part) => part.includes("--ssh-flag=-p 45400")), false);
});
