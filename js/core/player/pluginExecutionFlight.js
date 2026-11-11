function waitForCaller(promise, signal, abortedValue) {
  if (!signal || typeof signal.addEventListener !== "function") {
    return promise;
  }
  if (signal.aborted) {
    return Promise.resolve(abortedValue);
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => signal.removeEventListener?.("abort", onAbort);
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback(value);
    };
    const onAbort = () => finish(resolve, abortedValue);

    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => finish(resolve, value),
      (error) => finish(reject, error)
    );
    // Cover an abort that happened between the initial check and listener
    // registration without cancelling the shared underlying promise.
    if (signal.aborted) onAbort();
  });
}

/**
 * Shares one underlying plugin execution between callers while keeping each
 * caller's lifecycle independent. A caller that leaves the screen receives
 * the normal empty-result fallback; the shared task is aborted only after its
 * last caller has left.
 */
export class PluginExecutionFlight {
  constructor() {
    this.entries = new Map();
  }

  run(key, task, { signal = null, abortedValue = [] } = {}) {
    const normalizedKey = String(key || "");
    if (!normalizedKey || typeof task !== "function" || signal?.aborted) {
      return Promise.resolve(abortedValue);
    }

    let entry = this.entries.get(normalizedKey);
    if (!entry) {
      const controller = typeof AbortController === "function" ? new AbortController() : null;
      entry = {
        controller,
        consumers: 0,
        settled: false,
        promise: null
      };
      const executionSignal = controller?.signal || null;
      entry.promise = Promise.resolve()
        .then(() => task(executionSignal))
        .then(
          (value) => {
            this.finish(normalizedKey, entry);
            return value;
          },
          (error) => {
            this.finish(normalizedKey, entry);
            throw error;
          }
        );
      // A caller can abort before the task rejects. Keep the underlying
      // rejection observed even when no caller remains attached to it.
      entry.promise.catch(() => {});
      this.entries.set(normalizedKey, entry);
    }

    entry.consumers += 1;
    return waitForCaller(entry.promise, signal, abortedValue).finally(() => {
      this.release(normalizedKey, entry);
    });
  }

  finish(key, entry) {
    entry.settled = true;
    if (this.entries.get(key) === entry) this.entries.delete(key);
  }

  release(key, entry) {
    entry.consumers = Math.max(0, entry.consumers - 1);
    if (entry.consumers !== 0 || entry.settled) return;
    entry.controller?.abort();
    if (this.entries.get(key) === entry) this.entries.delete(key);
  }
}
