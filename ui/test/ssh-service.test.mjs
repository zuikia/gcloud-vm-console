import assert from "node:assert/strict";
import test from "node:test";

import {
  sshCommand,
  runSshCommand,
  unverifiedSshConnection,
  verifiedSshConnection
} from "../server/ssh-service.js";

const identity = {
  configuration: "acct-a",
  account: "user@example.com",
  projectId: "project-a",
  zone: "us-west1-b",
  name: "vm-a"
};

const ssh = { sshUser: "y", sshKeyFile: "/tmp/gcp-key", sshPort: 45400 };

test("ssh service builds explicit gcloud IAP SSH commands", () => {
  assert.deepEqual(
    sshCommand(identity, ssh, "echo ok"),
    [
      "compute",
      "ssh",
      "y@vm-a",
      "--tunnel-through-iap",
      "--ssh-key-file=/tmp/gcp-key",
      "--ssh-flag=-p 45400",
      "--command=echo ok"
    ]
  );
});

test("ssh service falls back to default port and records actual connection", async () => {
  const calls = [];
  const runner = {
    async run(command, options) {
      calls.push({ command, options });
      if (calls.length === 1) throw new Error("ssh: connect to host port 45400: Connection refused");
      return { stdout: "ok", stderr: "", exitCode: 0 };
    }
  };

  const result = await runSshCommand(runner, identity, ssh, "echo ok", {
    wait: async () => {},
    retryDelayMs: 1,
    maxAttempts: 2,
    requestedSsh: ssh
  });

  assert.equal(result.sshConnection.actualPort, 22);
  assert.equal(result.sshConnection.fallback, true);
  assert.match(result.sshConnection.label, /已从 45400 回退/);
  assert.ok(calls[0].command.includes("--ssh-flag=-p 45400"));
  assert.equal(calls[1].command.some((part) => part.includes("--ssh-flag=-p 45400")), false);
});

test("ssh service can verify a custom port without silently falling back to 22", async () => {
  const calls = [];
  const runner = {
    async run(command, options) {
      calls.push({ command, options });
      throw new Error("ssh: connect to host port 45400: Connection refused");
    }
  };

  await assert.rejects(
    runSshCommand(runner, identity, ssh, "echo ok", {
      wait: async () => {},
      retryDelayMs: 1,
      maxAttempts: 1,
      requestedSsh: ssh,
      allowDefaultPortFallback: false
    }),
    /Connection refused/
  );

  assert.equal(calls.length, 1);
  assert.ok(calls[0].command.includes("--ssh-flag=-p 45400"));
});

test("ssh service exposes stable unverified and verified metadata", () => {
  assert.deepEqual(unverifiedSshConnection(ssh), {
    desiredPort: 45400,
    actualPort: null,
    fallback: false,
    verified: false,
    label: "SSH 未连接"
  });
  assert.deepEqual(verifiedSshConnection(ssh, { ...ssh, sshPort: "" }, true), {
    desiredPort: 45400,
    actualPort: 22,
    fallback: true,
    verified: true,
    label: "SSH 实际连接 22（已从 45400 回退）"
  });
});
