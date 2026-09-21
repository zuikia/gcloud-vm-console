import assert from "node:assert/strict";
import test from "node:test";

import { createSingleFlight } from "../server/single-flight.js";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

test("single-flight reuses one in-flight read for the same key", async () => {
  const pending = deferred();
  const flight = createSingleFlight();
  let calls = 0;

  const first = flight.run("instances/project-a", async () => {
    calls += 1;
    return pending.promise;
  });
  const second = flight.run("instances/project-a", async () => {
    calls += 1;
    return "unexpected";
  });

  assert.equal(calls, 1);
  assert.equal(flight.size(), 1);
  pending.resolve(["vm-a"]);
  assert.deepEqual(await first, ["vm-a"]);
  assert.deepEqual(await second, ["vm-a"]);
  assert.equal(flight.size(), 0);
});

test("single-flight keeps different read keys independent", async () => {
  const flight = createSingleFlight();
  const values = await Promise.all([
    flight.run("project-a", async () => "a"),
    flight.run("project-b", async () => "b")
  ]);
  assert.deepEqual(values, ["a", "b"]);
});

test("single-flight releases a failed read so a retry can run", async () => {
  const flight = createSingleFlight();
  let calls = 0;
  await assert.rejects(() => flight.run("projects", async () => {
    calls += 1;
    throw new Error("temporary failure");
  }), /temporary failure/);

  assert.equal(await flight.run("projects", async () => {
    calls += 1;
    return "recovered";
  }), "recovered");
  assert.equal(calls, 2);
});
