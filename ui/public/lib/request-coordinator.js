export function createRequestCoordinator({ AbortControllerImpl = globalThis.AbortController } = {}) {
  if (typeof AbortControllerImpl !== "function") throw new Error("AbortController is required.");

  let generation = 0;
  let active = null;

  function run(rawKey, task) {
    const key = String(rawKey || "").trim();
    if (!key) throw new Error("request coordinator key is required.");
    if (typeof task !== "function") throw new Error("request coordinator task is required.");
    if (active?.key === key) return active.promise;

    active?.controller.abort();
    const controller = new AbortControllerImpl();
    const currentGeneration = ++generation;
    const entry = { key, generation: currentGeneration, controller, promise: null };

    let result;
    try {
      result = task({ signal: controller.signal, generation: currentGeneration, key });
    } catch (error) {
      result = Promise.reject(error);
    }
    entry.promise = Promise.resolve(result)
      .then((value) => ({
        value,
        stale: currentGeneration !== generation,
        generation: currentGeneration
      }))
      .finally(() => {
        if (active === entry) active = null;
      });
    active = entry;
    return entry.promise;
  }

  function cancel() {
    generation += 1;
    active?.controller.abort();
    active = null;
  }

  return {
    run,
    cancel,
    generation: () => generation
  };
}
