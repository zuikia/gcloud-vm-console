import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import test from "node:test";

import { createGcloudRunner, GcloudCommandError, timeoutForCommand } from "../server/gcloud-runner.js";
import { createFakeSpawn } from "./helpers/fake-gcloud-process.mjs";

const context = {
  configuration: "acct-a",
  account: "user@example.com",
  projectId: "project-a"
};

test("gcloud runner uses argument arrays and explicit account project and zone", async () => {
  const fake = createFakeSpawn([{ stdout: "instance details\n" }]);
  const runner = createGcloudRunner({ spawnImpl: fake.spawn, binary: "/mock/gcloud" });

  const result = await runner.run(["compute", "instances", "describe", "vm-a"], {
    context,
    location: { zone: "us-west1-b" }
  });

  assert.equal(result.stdout, "instance details\n");
  assert.equal(fake.calls.length, 1);
  assert.deepEqual(fake.calls[0].args, [
    "compute",
    "instances",
    "describe",
    "vm-a",
    "--configuration=acct-a",
    "--account=user@example.com",
    "--project=project-a",
    "--zone=us-west1-b",
    "--quiet"
  ]);
  assert.equal(fake.calls[0].binary, "/mock/gcloud");
  assert.equal(fake.calls[0].options.shell, false);
  assert.deepEqual(fake.calls[0].options.stdio, ["ignore", "pipe", "pipe"]);
});

test("gcloud runner requires explicit context and location unless global scope is declared", async () => {
  const fake = createFakeSpawn();
  const runner = createGcloudRunner({ spawnImpl: fake.spawn });

  await assert.rejects(() => runner.run(["compute", "instances", "list"], { context }), /zone or region is required/);
  await assert.rejects(
    () => runner.run(["projects", "list"], { context: { ...context, account: "" }, allowGlobal: true }),
    /account is required/
  );
  assert.equal(fake.calls.length, 0);
});

test("gcloud runner parses deterministic JSON output for global commands", async () => {
  const fake = createFakeSpawn([{ stdout: '[{"projectId":"project-a"}]\n' }]);
  const runner = createGcloudRunner({ spawnImpl: fake.spawn });

  const result = await runner.runJson(["projects", "list"], { context, allowGlobal: true });

  assert.deepEqual(result.data, [{ projectId: "project-a" }]);
  assert.ok(fake.calls[0].args.includes("--format=json"));
  assert.equal(fake.calls[0].args.some((arg) => arg.startsWith("--zone=")), false);
});

test("gcloud runner supports explicit local and account-scoped discovery", async () => {
  const fake = createFakeSpawn([
    { stdout: '[{"name":"acct-a"}]\n' },
    { stdout: '[{"projectId":"project-a"}]\n' }
  ]);
  const runner = createGcloudRunner({ spawnImpl: fake.spawn });

  await runner.runJson(["config", "configurations", "list"], {
    contextScope: "local",
    allowGlobal: true
  });
  await runner.runJson(["projects", "list"], {
    context: { configuration: "acct-a", account: "user@example.com" },
    contextScope: "account",
    allowGlobal: true
  });

  assert.deepEqual(fake.calls[0].args, [
    "config",
    "configurations",
    "list",
    "--format=json",
    "--quiet"
  ]);
  assert.deepEqual(fake.calls[1].args, [
    "projects",
    "list",
    "--configuration=acct-a",
    "--account=user@example.com",
    "--format=json",
    "--quiet"
  ]);
  assert.equal(fake.calls.some((call) => call.args.includes("activate")), false);
});

test("gcloud runner returns structured redacted command failures", async () => {
  const fake = createFakeSpawn([{
    exitCode: 1,
    stderr: "ERROR token-secret permission denied\n"
  }]);
  const runner = createGcloudRunner({ spawnImpl: fake.spawn });

  await assert.rejects(
    () => runner.run(["compute", "instances", "describe", "vm-a"], {
      context,
      location: { zone: "us-west1-b" },
      redactValues: ["token-secret"]
    }),
    (error) => {
      assert.ok(error instanceof GcloudCommandError);
      assert.equal(error.exitCode, 1);
      assert.match(error.message, /permission denied/);
      assert.doesNotMatch(error.message, /token-secret/);
      assert.match(error.stderr, /\[REDACTED\]/);
      assert.deepEqual(error.command.slice(0, 4), ["compute", "instances", "describe", "vm-a"]);
      return true;
    }
  );
});

test("gcloud runner sends sensitive stdin without placing it in argv or results", async () => {
  const stdin = [];
  const spawnImpl = (binary, args, options) => {
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.stdin = new PassThrough();
    child.stdin.on("data", (chunk) => stdin.push(String(chunk)));
    child.kill = () => {};
    queueMicrotask(() => {
      child.stdout.end("done\n");
      child.stderr.end("");
      child.emit("close", 0);
    });
    assert.equal(args.some((arg) => arg.includes("ValidPass9")), false);
    assert.deepEqual(options.stdio, ["pipe", "pipe", "pipe"]);
    return child;
  };
  const runner = createGcloudRunner({ spawnImpl });

  const result = await runner.run(["compute", "ssh", "y@vm-a", "--command=sudo chpasswd"], {
    context,
    location: { zone: "us-west1-b" },
    operationClass: "write",
    stdinText: "y:ValidPass9\n",
    redactValues: ["ValidPass9"]
  });

  assert.equal(stdin.join(""), "y:ValidPass9\n");
  assert.equal(JSON.stringify(result).includes("ValidPass9"), false);
});

test("gcloud runner applies read, write, SSH, and long-running timeout classes", () => {
  assert.equal(timeoutForCommand(["compute", "instances", "list"], {}), 60_000);
  assert.equal(timeoutForCommand(["compute", "instances", "start", "vm-a"], {}), 180_000);
  assert.equal(timeoutForCommand(["compute", "ssh", "user@vm-a"], {}), 120_000);
  assert.equal(timeoutForCommand(["compute", "ssh", "user@vm-a"], { operationClass: "long-running" }), 1_800_000);
  assert.equal(timeoutForCommand(["compute", "instances", "list"], { timeoutMs: 1234 }), 1234);
});

test("gcloud runner terminates timed out commands with a classified error", async () => {
  const signals = [];
  const spawnImpl = () => {
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = (signal) => signals.push(signal);
    return child;
  };
  const runner = createGcloudRunner({ spawnImpl, defaultTimeoutMs: 5, killGraceMs: 1 });

  await assert.rejects(
    () => runner.run(["compute", "instances", "list"], { context, allowGlobal: true }),
    (error) => error instanceof GcloudCommandError && error.code === "timeout"
  );
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.deepEqual(signals, ["SIGTERM", "SIGKILL"]);
});

test("gcloud runner bounds output before returning an error", async () => {
  const signals = [];
  const spawnImpl = () => {
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = (signal) => signals.push(signal);
    queueMicrotask(() => child.stdout.write("sensitive-output-".repeat(16)));
    return child;
  };
  const runner = createGcloudRunner({ spawnImpl, maxOutputBytes: 32, killGraceMs: 1 });

  await assert.rejects(
    () => runner.run(["compute", "instances", "list"], { context, allowGlobal: true }),
    (error) => {
      assert.ok(error instanceof GcloudCommandError);
      assert.equal(error.code, "output_limit");
      assert.ok(Buffer.byteLength(error.stdout) <= 32);
      return true;
    }
  );
  assert.equal(signals[0], "SIGTERM");
});

test("gcloud runner retries only transient ordinary read failures with fixed delays", async () => {
  const fake = createFakeSpawn([
    { exitCode: 1, stderr: "Tunnel connection failed: 503 Service Unavailable" },
    { exitCode: 1, stderr: "Tunnel connection failed: 503 Service Unavailable" },
    { stdout: "[]\n" }
  ]);
  const delays = [];
  const runner = createGcloudRunner({
    spawnImpl: fake.spawn,
    wait: async (ms) => delays.push(ms)
  });

  const result = await runner.runJson(["compute", "instances", "list"], { context, allowGlobal: true });

  assert.deepEqual(result.data, []);
  assert.equal(result.retryAttempts, 3);
  assert.deepEqual(delays, [500, 1500]);
  assert.equal(fake.calls.length, 3);
});

test("gcloud runner never retries writes SSH permission errors or process timeouts", async () => {
  const scenarios = [
    { command: ["compute", "instances", "start", "vm-a"], options: { context, location: { zone: "us-west1-b" } }, stderr: "503 Service Unavailable" },
    { command: ["compute", "ssh", "user@vm-a"], options: { context, location: { zone: "us-west1-b" } }, stderr: "503 Service Unavailable" },
    { command: ["services", "enable", "compute.googleapis.com"], options: { context, allowGlobal: true, operationClass: "read" }, stderr: "503 Service Unavailable" },
    { command: ["compute", "instances", "list"], options: { context, allowGlobal: true }, stderr: "PERMISSION_DENIED" }
  ];

  for (const scenario of scenarios) {
    const fake = createFakeSpawn([{ exitCode: 1, stderr: scenario.stderr }]);
    const runner = createGcloudRunner({ spawnImpl: fake.spawn, wait: async () => assert.fail("must not wait") });
    await assert.rejects(() => runner.run(scenario.command, scenario.options));
    assert.equal(fake.calls.length, 1);
  }
});

test("gcloud runner caps transient reads at three attempts even when extra delays are configured", async () => {
  const fake = createFakeSpawn([
    { exitCode: 1, stderr: "Tunnel connection failed: 503 Service Unavailable" },
    { exitCode: 1, stderr: "Tunnel connection failed: 503 Service Unavailable" },
    { exitCode: 1, stderr: "Tunnel connection failed: 503 Service Unavailable" },
    { stdout: "[]\n" }
  ]);
  const delays = [];
  const runner = createGcloudRunner({
    spawnImpl: fake.spawn,
    retryDelays: [1, 2, 3, 4],
    wait: async (ms) => delays.push(ms)
  });

  await assert.rejects(() => runner.runJson(["compute", "instances", "list"], { context, allowGlobal: true }));
  assert.equal(fake.calls.length, 3);
  assert.deepEqual(delays, [1, 2]);
});
