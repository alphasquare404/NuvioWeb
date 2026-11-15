/* global __NUVIO_REMUX_ASSET_ID__ */
import { MkvTextSubtitles, SUBTITLE_LIMITS } from "./mkvTextSubtitles.mjs";
import { createRangeFetcher } from "./range.mjs";
let reader,
  sourceId,
  abort,
  serial = Promise.resolve(),
  latest = 0;
let resolveId = 0;
const requests = new Map();

function request(type, url, signal) {
  signal?.throwIfAborted();
  const id = ++resolveId;
  return new Promise((resolve, reject) => {
    const cancel = () => {
      requests.delete(id);
      reject(signal.reason);
    };
    signal?.addEventListener("abort", cancel, { once: true });
    requests.set(id, (value) => {
      signal?.removeEventListener("abort", cancel);
      resolve(value);
    });
    postMessage({ type, sourceId, id, url });
  });
}
self.onmessage = ({ data }) => {
  if (data.type === "open") {
    if (data.version !== __NUVIO_REMUX_ASSET_ID__) {
      postMessage({ type: "error", sourceId: data.sourceId, reason: "remux-version-mismatch" });
      return;
    }
    if (reader) return;
    sourceId = data.sourceId;
    reader = new MkvTextSubtitles({
      url: data.url,
      fetcher: createRangeFetcher(
        data.url,
        data.requestHeaders,
        async (url, options) => {
          try {
            return await fetch(url, options);
          } catch (error) {
            if (
              !data.canResolveHead ||
              options.method !== "HEAD" ||
              error.name !== "TypeError" ||
              options.signal?.aborted
            )
              throw error;
            const size = await request("resolve-head", url, options.signal);
            if (!size) throw error;
            return new Response(null, { headers: { "Content-Length": size } });
          }
        },
        data.canResolveSource ? (signal) => request("resolve-source", data.url, signal) : undefined
      )
    });
    abort = new AbortController();
    serial = reader
      .open(abort.signal)
      .then((tracks) => postMessage({ type: "tracks", sourceId, tracks, limits: SUBTITLE_LIMITS }))
      .catch((error) => postMessage({ type: "error", sourceId, reason: reason(error) }));
    return;
  }
  if (data.sourceId !== sourceId) return;
  if (data.type === "resolve-result") {
    requests.get(data.id)?.(data.value);
    requests.delete(data.id);
    return;
  }
  latest = data.requestId;
  abort?.abort();
  if (data.type === "window")
    serial = serial
      .catch(() => {})
      .then(async () => {
        if (data.requestId !== latest) return;
        abort = new AbortController();
        try {
          const result = await reader.window(data.trackId, data.time, { signal: abort.signal });
          if (data.requestId === latest)
            postMessage({ type: "window", sourceId, requestId: data.requestId, result });
        } catch (error) {
          if (error.name !== "AbortError" && data.requestId === latest)
            postMessage({
              type: "error",
              sourceId,
              requestId: data.requestId,
              reason: reason(error),
              stats: reader.stats
            });
        }
      });
};
function reason(error) {
  return /^[a-z0-9-]+$/.test(error.message) ? error.message : "subtitle-read-failed";
}
