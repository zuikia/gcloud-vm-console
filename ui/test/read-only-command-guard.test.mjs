import assert from "node:assert/strict";
import test from "node:test";

import { createReadOnlyCommandGuard } from "../server/read-only-command-guard.js";

function fakeRunner() {
  const calls = [];
  return {
    calls,
    runner: {
      async run(command, options) { calls.push(["run", command, options]); return { stdout: "", stderr: "", exitCode: 0 }; },
      async runJson(command, options) { calls.push(["runJson", command, options]); return { data: [], stdout: "[]", stderr: "", exitCode: 0 }; }
    }
  };
}

test("read-only guard allows only metadata-safe gcloud inventory, guest and firewall reads", async () => {
  const { calls, runner } = fakeRunner();
  const ledger = [];
  const guard = createReadOnlyCommandGuard(runner, { onCommand: (entry) => ledger.push(entry) });
  await guard.runJson(["compute", "instances", "describe", "vm-a"], {});
  await guard.runJson(["compute", "instances", "list"], {});
  await guard.runJson(["compute", "instances", "get-guest-attributes", "vm-a", "--query-path=gcp-vm-console"], {});
  await guard.runJson(["compute", "firewall-rules", "list"], {});
  await guard.runJson(["compute", "firewall-rules", "describe", "rule-a"], {});
  assert.equal(calls.length, 5);
  assert.equal(ledger.every((entry) => entry.mode === "read"), true);
  assert.equal(JSON.stringify(ledger).includes("/tmp/key"), false);
});

test("read-only guard rejects mutations before invoking the runner", async () => {
  const blocked = [
    ["compute", "instances", "create", "vm-a"],
    ["compute", "instances", "stop", "vm-a"],
    ["compute", "instances", "add-metadata", "vm-a"],
    ["compute", "firewall-rules", "update", "rule-a"],
    ["compute", "firewall-rules", "delete", "rule-a"]
  ];
  for (const command of blocked) {
    const { calls, runner } = fakeRunner();
    const guard = createReadOnlyCommandGuard(runner);
    await assert.rejects(() => guard.run(command, {}), /read-only command policy/i);
    assert.equal(calls.length, 0);
  }
});

test("read-only guard rejects any SSH command that is not the fixed probe contract", async () => {
  const { calls, runner } = fakeRunner();
  const guard = createReadOnlyCommandGuard(runner);
  await assert.rejects(() => guard.run([
    "compute", "ssh", "y@vm-a", "--tunnel-through-iap", "--ssh-key-file=/tmp/key", "--command=sudo reboot"
  ], {}), /read-only command policy/i);
  assert.equal(calls.length, 0);
});

test("read-only guard rejects gcloud compute ssh even for a read command because it can provision project metadata", async () => {
  const { calls, runner } = fakeRunner();
  const guard = createReadOnlyCommandGuard(runner);
  await assert.rejects(() => guard.run([
    "compute", "ssh", "y@vm-a", "--tunnel-through-iap", "--ssh-key-file=/tmp/key", "--command=echo ok"
  ], {}), /read-only command policy/i);
  assert.equal(calls.length, 0);
});
