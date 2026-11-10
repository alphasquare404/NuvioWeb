export function selectedPlaybackTask(operation, { signal, timeoutMs = 15000 } = {}) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", aborted);
      callback(value);
    };
    const aborted = () => finish(reject, new DOMException("Playback cancelled", "AbortError"));
    const timer =
      timeoutMs === Infinity
        ? null
        : setTimeout(() => finish(reject, new Error("Stream preparation timed out.")), timeoutMs);
    if (signal?.aborted) {
      aborted();
      return;
    }
    signal?.addEventListener("abort", aborted, { once: true });
    Promise.resolve()
      .then(() => {
        if (!settled) return operation();
      })
      .then(
        (value) => finish(resolve, value),
        (error) => finish(reject, error)
      );
  });
}
