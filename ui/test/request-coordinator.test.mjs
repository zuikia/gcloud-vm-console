import assert from "node:assert/strict";
import test from "node:test";

import { createRequestCoordinator } from "../public/lib/request-coordinator.js";

function deferred() {
  let resolve;
  const promise = new Promise((resolvePromise) => { resolve = resolvePromise; });
  return { promise, resolve };
}

test("request coordinator reuses the active promise for the same context", async () => {
  const pending = deferred();
  const coordinator = createRequestCoordinator();
  let calls = 0;

  const first = coordinator.run("account/project-a", async () => {
    calls += 1;
    return pending.promise;
  });
  const second = coordinator.run("account/project-a", async () => {
    calls += 1;
    return "unexpected";
  });

  assert.equal(calls, 1);
  pending.resolve("snapshot-a");
  assert.deepEqual(await first, { value: "snapshot-a", stale: false, generation: 1 });
  assert.deepEqual(await second, { value: "snapshot-a", stale: false, generation: 1 });
});

test("request coordinator aborts the previous context and marks late results stale", async () => {
  const firstPending = deferred();
  const coordinator = createRequestCoordinator();
  let firstSignal;

  const first = coordinator.run("account/project-a", async ({ signal }) => {
    firstSignal = signal;
    return firstPending.promise;
  });
  const second = coordinator.run("account/project-b", async ({ signal }) => {
    assert.equal(signal.aborted, false);
    return "snapshot-b";
  });

  assert.equal(firstSignal.aborted, true);
  assert.deepEqual(await second, { value: "snapshot-b", stale: false, generation: 2 });
  firstPending.resolve("snapshot-a");
  assert.deepEqual(await first, { value: "snapshot-a", stale: true, generation: 1 });
});

test("request coordinator clears failures and supports explicit cancellation", async () => {
  const coordinator = createRequestCoordinator();
  await assert.rejects(() => coordinator.run("project-a", async () => {
    throw new Error("failed refresh");
  }), /failed refresh/);

  const pending = deferred();
  let signal;
  const active = coordinator.run("project-a", async (context) => {
    signal = context.signal;
    return pending.promise;
  });
  coordinator.cancel();
  assert.equal(signal.aborted, true);
  pending.resolve("ignored");
  assert.equal((await active).stale, true);
});
