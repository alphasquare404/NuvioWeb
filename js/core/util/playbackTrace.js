/**
 * A recording of what the app decided, from the tap to the player.
 *
 * Written because "the player ended in two seconds" and "the relay was never asked" look
 * identical from the outside, and every guess in between cost a round trip to a phone.
 * Entries are warnings so they appear in the app's debug console, and they are kept in
 * one array so the whole story can be copied at once instead of read line by line.
 */
const MAX_ENTRIES = 120;
const entries = [];

export function tracePlayback(event, data = {}) {
  const entry = { at: new Date().toISOString(), event, ...data };
  entries.push(entry);
  if (entries.length > MAX_ENTRIES) entries.shift();
  if (typeof globalThis !== "undefined") {
    globalThis.__NUVIO_PLAYBACK_TRACE__ = entries;
  }
  if (typeof console !== "undefined" && typeof console.warn === "function") {
    // One line per event, with the data flattened: long JSON is unreadable in a phone
    // console, and the fields are simple values on purpose.
    const detail = Object.entries(data)
      .map(([key, value]) => `${key}=${formatValue(value)}`)
      .join(" ");
    console.warn(`[Trace] ${event} ${detail}`.trim());
  }
  return entry;
}

function formatValue(value) {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (typeof value === "boolean" || typeof value === "number") return String(value);
  const text = String(value);
  return text.length > 90 ? `${text.slice(0, 87)}…` : text;
}

export function playbackTraceEntries() {
  return entries.slice();
}

export function clearPlaybackTrace() {
  entries.length = 0;
  if (typeof globalThis !== "undefined") {
    globalThis.__NUVIO_PLAYBACK_TRACE__ = entries;
  }
}

/** Short host for a url, without the path that carries tokens. */
export function traceHost(url = "") {
  try {
    return new URL(
      String(url || ""),
      typeof location !== "undefined" ? location.href : "http://localhost"
    ).host;
  } catch {
    return "-";
  }
}

/** What a url *is*, in the terms this investigation keeps confusing. */
export function traceUrlKind(url = "") {
  const text = String(url || "");
  if (!text) return "none";
  if (text.includes("/hls/index.m3u8")) return "hls-playlist";
  if (text.includes("/api/transcode")) return "transcode-file";
  if (text.includes("/api/remux")) return "remux-file";
  if (text.startsWith("blob:")) return "blob";
  if (/\.mkv(?:$|\?)/i.test(text)) return "mkv";
  if (/\.mp4(?:$|\?)/i.test(text)) return "mp4";
  return "other";
}
