import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

import { createSshDualEntryService } from "../server/ssh-dual-entry-service.js";

const identity = {
  configuration: "acct-a",
  account: "user@example.com",
  projectId: "project-a",
  zone: "us-west1-b",
  name: "vm-a"
};

test("SSH dual-entry setup verifies 45400 before hardening 22 and passes the password only through stdin", async () => {
  const calls = [];
  const runner = {
    async run(command, options) {
      calls.push({ command, options });
      return { stdout: "ok\n", stderr: "", exitCode: 0 };
    }
  };
  const service = createSshDualEntryService({ runner, wait: async () => {} });

  const result = await service.apply({
    identity,
    ssh: { sshUser: "y", sshKeyFile: "/private/key", sshPort: 22 },
    password: "ValidPass9",
    passwordVersion: "secret-v1"
  });

  assert.equal(result.status, "succeeded");
  assert.equal(result.policy.entries[0].port, 22);
  assert.equal(result.policy.entries[0].authentication, "publickey,password");
  assert.equal(result.policy.entries[1].port, 45400);
  assert.equal(result.policy.entries[1].authentication, "publickey");
  assert.equal(result.policy.passwordVersion, "secret-v1");
  assert.equal(calls.length >= 4, true);
  const joined = calls.map((call) => call.command.join(" ")).join("\n");
  assert.doesNotMatch(joined, /ValidPass9/);
  assert.match(joined, /Port 45400/);
  assert.match(joined, /AuthenticationMethods publickey,password/);
  assert.match(joined, /sudo -n chpasswd/);
  assert.match(joined, /mv -f .*99-gcp-vm-console-port\.conf/);
  assert.match(joined, /had_old=1/);
  assert.match(joined, /if ! \( \/usr\/sbin\/sshd -t/);
  assert.match(joined, /mv -f .*backup.*99-gcp-vm-console-port\.conf/);
  const secretCall = calls.find((call) => call.options.stdinText);
  assert.equal(secretCall.options.stdinText, "y:ValidPass9\n");
  assert.deepEqual(secretCall.options.redactValues, ["ValidPass9"]);
  const finalVerification = calls.at(-1).command.join(" ");
  assert.match(finalVerification, /-p 45400/);
  for (const call of calls) {
    const remote = call.command.find((part) => part.startsWith("--command="))?.slice("--command=".length);
    if (!remote) continue;
    const syntax = spawnSync("bash", ["-n", "-c", remote], { encoding: "utf8" });
    assert.equal(syntax.status, 0, syntax.stderr);
  }
});

test("SSH dual-entry setup rejects root and never falls back to port 22 after hardening", async () => {
  const service = createSshDualEntryService({ runner: { run: async () => assert.fail("must not run") } });
  await assert.rejects(() => service.apply({
    identity,
    ssh: { sshUser: "root", sshKeyFile: "/private/key", sshPort: 22 },
    password: "ValidPass9",
    passwordVersion: "secret-v1"
  }), /non-root|root/i);
});
