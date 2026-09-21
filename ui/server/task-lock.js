export function createTaskLock() {
  const active = new Set();

  async function run(key, task) {
    const lockKey = String(key || "");
    if (!lockKey) throw new Error("A task lock key is required.");
    if (active.has(lockKey)) throw new Error(`${lockKey} already has a running task.`);
    active.add(lockKey);
    try {
      return await task();
    } finally {
      active.delete(lockKey);
    }
  }

  return {
    isLocked: (key) => active.has(String(key || "")),
    run
  };
}
