import assert from "node:assert/strict";
import test from "node:test";

import { createShutdownController } from "../server/shutdown-controller.js";

test("shutdown controller drains once and exits cleanly when server closes", async () => {
  let closeCallback;
  let closeCalls = 0;
  const exits = [];
  const controller = createShutdownController({
    server: {
      close(callback) {
        closeCalls += 1;
        closeCallback = callback;
      }
    },
    exitImpl: (code) => exits.push(code),
    setTimeoutImpl: () => ({ unref() {} }),
    clearTimeoutImpl: () => {}
  });

  const first = controller.shutdown("SIGTERM");
  const second = controller.shutdown("SIGINT");
  assert.equal(controller.isDraining(), true);
  assert.equal(closeCalls, 1);
  assert.equal(second, first);
  closeCallback();
  await first;
  assert.deepEqual(exits, [0]);
});

test("shutdown controller exits with failure after the drain deadline", async () => {
  let timeoutCallback;
  const exits = [];
  const controller = createShutdownController({
    server: { close() {} },
    timeoutMs: 10,
    exitImpl: (code) => exits.push(code),
    setTimeoutImpl: (callback) => {
      timeoutCallback = callback;
      return { unref() {} };
    },
    clearTimeoutImpl: () => {}
  });

  const pending = controller.shutdown("SIGTERM");
  timeoutCallback();
  await pending;
  assert.deepEqual(exits, [1]);
});
