export function createSingleFlight() {
  const inFlight = new Map();

  function run(rawKey, factory) {
    const key = String(rawKey || "").trim();
    if (!key) throw new Error("single-flight key is required.");
    if (typeof factory !== "function") throw new Error("single-flight factory is required.");
    if (inFlight.has(key)) return inFlight.get(key);

    let result;
    try {
      result = factory();
    } catch (error) {
      result = Promise.reject(error);
    }
    const promise = Promise.resolve(result).finally(() => {
      if (inFlight.get(key) === promise) inFlight.delete(key);
    });
    inFlight.set(key, promise);
    return promise;
  }

  return {
    run,
    size: () => inFlight.size
  };
}
