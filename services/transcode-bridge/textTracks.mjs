import { MkvTextSubtitles } from "../../js/core/player/clientRemux/mkvTextSubtitles.mjs";

// Text sidecar for the existing HLS job. The video producer and timeline are unchanged.
export function createRelayTextReader({
  makeReader = (url) =>
    new MkvTextSubtitles({
      url,
      fetcher: (target, options) => fetch(target, { ...options, redirect: "error" })
    }),
  now = () => Date.now(),
  maxReaders = 4,
  ttlMs = 15 * 60 * 1000
} = {}) {
  const readers = new Map();
  return async function read(url, params, signal) {
    const action = params.get("text");
    const time = Number(params.get("time"));
    const id = Number(params.get("track"));
    if (
      !["tracks", "cues"].includes(action) ||
      (action === "cues" &&
        (!params.has("time") ||
          !Number.isFinite(time) ||
          time < 0 ||
          time > 7 * 86400 ||
          !params.has("track") ||
          !Number.isSafeInteger(id) ||
          id < 1))
    ) {
      throw Error("subtitle-request-invalid");
    }
    for (const [key, entry] of readers) {
      if (!entry.busy && now() - entry.used > ttlMs) readers.delete(key);
    }
    let entry = readers.get(url);
    if (!entry) {
      if (readers.size >= maxReaders) {
        const oldest = [...readers]
          .filter(([, value]) => !value.busy)
          .sort((a, b) => a[1].used - b[1].used)[0];
        if (!oldest) throw Error("subtitle-reader-busy");
        readers.delete(oldest[0]);
      }
      entry = { reader: makeReader(url), used: now(), busy: false, opened: false };
      readers.set(url, entry);
    }
    if (entry.busy) throw Error("subtitle-reader-busy");
    entry.busy = true;
    entry.used = now();
    try {
      signal?.throwIfAborted();
      if (!entry.opened) {
        entry.tracks = await entry.reader.open(signal);
        entry.opened = true;
      }
      if (action === "tracks") return { tracks: entry.tracks };
      return { result: await entry.reader.window(id, time, { signal }) };
    } catch (error) {
      // An aborted/partial index cannot be reused as a valid subtitle window.
      readers.delete(url);
      throw error;
    } finally {
      entry.busy = false;
      entry.used = now();
    }
  };
}
