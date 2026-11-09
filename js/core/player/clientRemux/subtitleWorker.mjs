/* global __NUVIO_REMUX_ASSET_ID__ */
import { MkvTextSubtitles, SUBTITLE_LIMITS } from "./mkvTextSubtitles.mjs";
import { createRangeFetcher } from "./range.mjs";
let reader,
  sourceId,
  abort,
  serial = Promise.resolve(),
  latest = 0;
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
      fetcher: createRangeFetcher(data.url, data.requestHeaders)
    });
    abort = new AbortController();
    serial = reader
      .open(abort.signal)
      .then((tracks) => postMessage({ type: "tracks", sourceId, tracks, limits: SUBTITLE_LIMITS }))
      .catch((error) => postMessage({ type: "error", sourceId, reason: reason(error) }));
    return;
  }
  if (data.sourceId !== sourceId) return;
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
