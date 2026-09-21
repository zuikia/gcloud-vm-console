import assert from "node:assert/strict";
import test from "node:test";

import { createTaskLock } from "../server/task-lock.js";

test("task lock rejects concurrent writes to the same VM and releases after completion", async () => {
  const lock = createTaskLock();
  let release;
  const pending = lock.run("account::project::zone::vm", async () => new Promise((resolve) => { release = resolve; }));

  await assert.rejects(
    () => lock.run("account::project::zone::vm", async () => "duplicate"),
    /already has a running task/
  );
  assert.equal(lock.isLocked("account::project::zone::vm"), true);

  release("done");
  assert.equal(await pending, "done");
  assert.equal(lock.isLocked("account::project::zone::vm"), false);
  assert.equal(await lock.run("account::project::zone::vm", async () => "next"), "next");
});

test("task lock allows different VM identities to run independently", async () => {
  const lock = createTaskLock();
  const results = await Promise.all([
    lock.run("vm-a", async () => "a"),
    lock.run("vm-b", async () => "b")
  ]);

  assert.deepEqual(results, ["a", "b"]);
});
