import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import test from "node:test";

import {
  createSshConnectivityVerifier,
  iapTunnelArgs,
  publicSshArgs
} from "../server/ssh-connectivity-verifier.js";

const identity = {
  configuration: "acct-a",
  account: "user@example.com",
  projectId: "project-a",
  zone: "us-west1-b",
  name: "vm-a"
};

test("public SSH verification targets the external IP on 45400 without an IAP proxy", () => {
  const args = publicSshArgs(identity, {
    sshUser: "y",
    sshKeyFile: "/private/key"
  }, "203.0.113.10");

  assert.ok(args.includes("45400"));
  assert.ok(args.includes("y@203.0.113.10"));
  assert.equal(args.some((arg) => /ProxyCommand|start-iap-tunnel/.test(arg)), false);
  assert.equal(args.at(-1), "printf 'gvc-public-45400-ready\\n'");
});

test("IAP path verification uses listen-on-stdin for port 22 and resolves on an SSH banner", async () => {
  const calls = [];
  const spawnImpl = (binary, args, options) => {
    calls.push({ binary, args, options });
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.stdin = new PassThrough();
    child.kill = () => child.emit("close", 0);
    queueMicrotask(() => child.stdout.write("SSH-2.0-OpenSSH_9.2\r\n"));
    return child;
  };
  const verifier = createSshConnectivityVerifier({ spawnImpl, timeoutMs: 1000 });

  const result = await verifier.verifyIap22Path({ identity });

  assert.equal(result.verified, true);
  assert.equal(result.port, 22);
  assert.deepEqual(calls[0].args, iapTunnelArgs(identity, 22));
  assert.deepEqual(calls[0].options.stdio, ["pipe", "pipe", "pipe"]);
});

test("public verification reports a sanitized blocker without the private key path", async () => {
  const spawnImpl = () => {
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.stdin = new PassThrough();
    child.kill = () => {};
    queueMicrotask(() => {
      child.stderr.end("Identity file /private/key not accessible");
      child.emit("close", 255);
    });
    return child;
  };
  const verifier = createSshConnectivityVerifier({ spawnImpl });

  await assert.rejects(
    () => verifier.verifyPublic45400({
      identity,
      ssh: { sshUser: "y", sshKeyFile: "/private/key" },
      externalIp: "203.0.113.10"
    }),
    (error) => {
      assert.doesNotMatch(error.message, /\/private\/key/);
      assert.match(error.message, /REDACTED_KEY_PATH/);
      return true;
    }
  );
});
