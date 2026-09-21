export function createShutdownController({
  server,
  timeoutMs = 15_000,
  exitImpl = process.exit,
  setTimeoutImpl = setTimeout,
  clearTimeoutImpl = clearTimeout
} = {}) {
  if (!server?.close) throw new Error("server with close() is required.");

  let draining = false;
  let pending = null;

  function shutdown() {
    if (pending) return pending;
    draining = true;
    pending = new Promise((resolve) => {
      let finished = false;
      let timer = null;
      const finish = (code) => {
        if (finished) return;
        finished = true;
        if (timer) clearTimeoutImpl(timer);
        exitImpl(code);
        resolve(code);
      };
      timer = setTimeoutImpl(() => finish(1), timeoutMs);
      timer?.unref?.();
      try {
        server.close(() => finish(0));
      } catch {
        finish(1);
      }
    });
    return pending;
  }

  return {
    shutdown,
    isDraining: () => draining
  };
}
