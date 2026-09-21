import assert from "node:assert/strict";
import test from "node:test";

import { READ_ONLY_PROBE_COMMAND } from "../server/read-only-probe-contract.js";
import { createReadOnlySshProbeRunner } from "../server/read-only-ssh-probe-runner.js";
import { createFakeSpawn } from "./helpers/fake-gcloud-process.mjs";

const identity = {
  configuration: "acct-a",
  account: "user@example.com",
  projectId: "project-a",
  zone: "us-west1-b",
  name: "vm-a"
};

const ssh = { sshUser: "y", sshKeyFile: "/tmp/private-gcp-key", sshPort: 45400 };

test("read-only SSH probe uses raw ssh over an IAP tunnel without gcloud compute ssh", async () => {
  const fake = createFakeSpawn([{ stdout: "probe-ok\n" }]);
  const ledger = [];
  const runner = createReadOnlySshProbeRunner({
    spawnImpl: fake.spawn,
    binary: "/mock/ssh",
    gcloudBinary: "/mock/gcloud",
    maxAttempts: 1,
    onCommand: (entry) => ledger.push(entry)
  });

  const result = await runner.run(identity, ssh, READ_ONLY_PROBE_COMMAND);

  assert.equal(result.result.stdout, "probe-ok\n");
  assert.equal(result.sshConnection.actualPort, 45400);
  assert.equal(result.sshConnection.fallback, false);
  assert.equal(fake.calls.length, 1);
  assert.equal(fake.calls[0].binary, "/mock/ssh");
  assert.ok(fake.calls[0].args.includes("/tmp/private-gcp-key"));
  assert.ok(fake.calls[0].args.includes("45400"));
  assert.ok(fake.calls[0].args.includes("y@vm-a"));
  assert.equal(fake.calls[0].args.at(-1), READ_ONLY_PROBE_COMMAND);
  const proxyCommand = fake.calls[0].args.find((part) => part.startsWith("ProxyCommand="));
  assert.match(proxyCommand, /compute start-iap-tunnel/);
  assert.match(proxyCommand, /--listen-on-stdin/);
  assert.match(proxyCommand, /--configuration=/);
  assert.match(proxyCommand, /--account=/);
  assert.match(proxyCommand, /--project=/);
  assert.match(proxyCommand, /--zone=/);
  assert.doesNotMatch(proxyCommand, /compute ssh|metadata|add-metadata|set-metadata/);
  assert.deepEqual(ledger, [{ mode: "read", category: "ssh.fixed-probe" }]);
});

test("read-only SSH probe rejects non-contract commands before spawning", async () => {
  const fake = createFakeSpawn();
  const runner = createReadOnlySshProbeRunner({ spawnImpl: fake.spawn });

  await assert.rejects(() => runner.run(identity, ssh, "sudo reboot"), /fixed read-only probe contract/i);
  assert.equal(fake.calls.length, 0);
});

test("read-only SSH probe can fall back to port 22 without provisioning metadata", async () => {
  const fake = createFakeSpawn([
    { exitCode: 255, stderr: "ssh: connect to host vm-a port 45400: Connection refused\n" },
    { stdout: "fallback-ok\n" }
  ]);
  const runner = createReadOnlySshProbeRunner({
    spawnImpl: fake.spawn,
    maxAttempts: 2,
    retryDelayMs: 1,
    wait: async () => {}
  });

  const result = await runner.run(identity, ssh, READ_ONLY_PROBE_COMMAND);

  assert.equal(result.sshConnection.actualPort, 22);
  assert.equal(result.sshConnection.fallback, true);
  assert.ok(fake.calls[0].args.includes("45400"));
  assert.ok(fake.calls[1].args.includes("22"));
  assert.equal(fake.calls.every((call) => call.binary !== "gcloud"), true);
  assert.equal(fake.calls.every((call) => call.args.join(" ").includes("compute ssh") === false), true);
});

test("read-only SSH probe redacts private key paths from failures", async () => {
  const fake = createFakeSpawn([{ exitCode: 255, stderr: "Identity file /tmp/private-gcp-key not accessible\n" }]);
  const runner = createReadOnlySshProbeRunner({ spawnImpl: fake.spawn, maxAttempts: 1 });

  await assert.rejects(
    () => runner.run(identity, ssh, READ_ONLY_PROBE_COMMAND),
    (error) => {
      assert.doesNotMatch(error.message, /private-gcp-key/);
      assert.match(error.message, /\[REDACTED_KEY_PATH\]/);
      return true;
    }
  );
});

test("read-only SSH probe classifies a synchronous spawn failure", async () => {
  const runner = createReadOnlySshProbeRunner({
    spawnImpl() {
      throw new Error("ssh binary missing");
    },
    maxAttempts: 1
  });

  await assert.rejects(
    () => runner.run(identity, ssh, READ_ONLY_PROBE_COMMAND),
    (error) => error.code === "spawn_failure" && /ssh binary missing/.test(error.message)
  );
});
