import assert from "node:assert/strict";
import test from "node:test";

import {
  WARP_RECONNECT_COMMAND,
  WARP_STATUS_COMMAND,
  contractForWarpOperation
} from "../server/warp-command-contract.js";
import {
  createWarpSshRunner,
  iapWarpSshArgs,
  publicWarpSshArgs
} from "../server/warp-ssh-runner.js";
import { createFakeSpawn } from "./helpers/fake-gcloud-process.mjs";

const identity = {
  configuration: "acct-a",
  account: "user@example.com",
  projectId: "project-a",
  zone: "asia-northeast2-b",
  name: "jp-osaka-singbox-01"
};

const ssh = { user: "y", keyFile: "/private/gcp-key", port: 45400 };

test("WARP command contract exposes only status and guarded single reconnect", () => {
  assert.equal(contractForWarpOperation("status"), WARP_STATUS_COMMAND);
  assert.equal(contractForWarpOperation("reconnect"), WARP_RECONNECT_COMMAND);
  assert.throws(() => contractForWarpOperation("sudo rm -rf /"), /不支持/);
  assert.match(WARP_RECONNECT_COMMAND, /warp-cli disconnect/);
  assert.match(WARP_RECONNECT_COMMAND, /sleep 5/);
  assert.match(WARP_RECONNECT_COMMAND, /warp-cli connect/);
  assert.match(WARP_RECONNECT_COMMAND, /trap/);
  assert.doesNotMatch(WARP_RECONNECT_COMMAND, /systemctl restart|tunnel rotate-keys|tunnel protocol|registration delete/);
});

test("WARP status resolves the trace target locally so curl can enforce each IP family", () => {
  assert.match(WARP_STATUS_COMMAND, /--proxy \"socks5:\/\/127\.0\.0\.1:\$proxy_port\"/);
  assert.doesNotMatch(WARP_STATUS_COMMAND, /socks5h:\/\//);
});

test("public WARP SSH uses the verified key port and exact fixed command", () => {
  const args = publicWarpSshArgs({ identity, ssh, externalIp: "203.0.113.12", operation: "status" });
  assert.equal(args.includes("/private/gcp-key"), true);
  assert.equal(args.includes("45400"), true);
  assert.equal(args.includes("y@203.0.113.12"), true);
  assert.equal(args.at(-1), WARP_STATUS_COMMAND);
  assert.equal(args.some((arg) => /compute ssh/.test(arg)), false);
});

test("IAP WARP SSH targets the same verified port without gcloud compute ssh", () => {
  const args = iapWarpSshArgs({ identity, ssh, operation: "status" });
  const proxy = args.find((arg) => arg.startsWith("ProxyCommand="));
  assert.match(proxy, /compute start-iap-tunnel/);
  assert.match(proxy, /%p/);
  assert.equal(args.includes("45400"), true);
  assert.equal(args.at(-1), WARP_STATUS_COMMAND);
  assert.doesNotMatch(proxy, /compute ssh/);
});

test("WARP SSH arguments reject unverified ports users and addresses", () => {
  assert.throws(() => publicWarpSshArgs({ identity, ssh: { ...ssh, port: 0 }, externalIp: "203.0.113.12", operation: "status" }), /端口/);
  assert.throws(() => publicWarpSshArgs({ identity, ssh: { ...ssh, user: "root user" }, externalIp: "203.0.113.12", operation: "status" }), /用户/);
  assert.throws(() => publicWarpSshArgs({ identity, ssh, externalIp: "not-an-ip", operation: "status" }), /IPv4/);
});

test("read-only WARP status may fall back from public 45400 to IAP on the same port", async () => {
  const fake = createFakeSpawn([
    { exitCode: 255, stderr: "ssh: connect to host 203.0.113.12 port 45400: Connection refused\n" },
    { stdout: "__GVC_WARP_STATUS__\nservice=active\n__GVC_WARP_END__\n" }
  ]);
  const runner = createWarpSshRunner({ spawnImpl: fake.spawn });

  const result = await runner.run({ operation: "status", identity, ssh, externalIp: "203.0.113.12" });

  assert.equal(result.transport, "iap");
  assert.equal(fake.calls.length, 2);
  assert.equal(fake.calls[0].args.includes("y@203.0.113.12"), true);
  assert.match(fake.calls[1].args.find((arg) => arg.startsWith("ProxyCommand=")), /start-iap-tunnel/);
  assert.equal(fake.calls[1].args.includes("45400"), true);
});

test("read-only WARP status treats an empty SSH 255 exit as an uncertain transport and falls back to IAP", async () => {
  const fake = createFakeSpawn([
    { exitCode: 255, stderr: "" },
    { stdout: "__GVC_WARP_STATUS__\nservice=active\n__GVC_WARP_END__\n" }
  ]);
  const runner = createWarpSshRunner({ spawnImpl: fake.spawn });

  const result = await runner.run({ operation: "status", identity, ssh, externalIp: "203.0.113.12" });

  assert.equal(result.transport, "iap");
  assert.equal(fake.calls.length, 2);
});

test("WARP reconnect never changes transport or replays after an ambiguous write failure", async () => {
  const fake = createFakeSpawn([
    { exitCode: 255, stderr: "Connection reset by peer /private/gcp-key\n" },
    { stdout: "must-not-run" }
  ]);
  const runner = createWarpSshRunner({ spawnImpl: fake.spawn });

  await assert.rejects(
    runner.run({ operation: "reconnect", identity, ssh, externalIp: "203.0.113.12", transport: "public" }),
    (error) => {
      assert.doesNotMatch(error.message, /private\/gcp-key/);
      return true;
    }
  );
  assert.equal(fake.calls.length, 1);
});
