import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

export function createFakeSpawn(responses = []) {
  const calls = [];
  let index = 0;

  function spawn(binary, args, options) {
    const response = responses[index] || {};
    index += 1;
    calls.push({ binary, args, options });

    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => {};

    queueMicrotask(() => {
      if (response.spawnError) {
        child.emit("error", response.spawnError);
        return;
      }
      child.stdout.end(response.stdout || "");
      child.stderr.end(response.stderr || "");
      child.emit("close", response.exitCode ?? 0, null);
    });

    return child;
  }

  return { calls, spawn };
}
