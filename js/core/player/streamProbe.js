// Probing the gaps, not the whole list.
//
// The estimate from the addon's own text is good when the text says something: an
// extension, a codec tag, a resolution. It is blind when the card says nothing, and
// that is exactly the case where a server-side ffprobe earns its request. Probing
// rows the estimate already answers would spend the user's tokens and the
// deployment's bandwidth to learn what the card already said.

import { PLAYBACK_METHODS, classifyPlayback } from "./playbackMethod.js";

/** Rows the estimate could not decide, and so the only ones worth probing. */
export function selectRowsToProbe(rows = [], { capabilities = {}, limit = 5 } = {}) {
  const picked = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    if (picked.length >= limit) break;
    // A row whose URL has not been resolved yet cannot be probed. Asking about an
    // empty string spends the whole batch and returns nothing — which is exactly how
    // the first version silently did nothing on a list where most URLs were pending.
    const url = String(row?.url || "").trim();
    if (!url) continue;
    const verdict = classifyPlayback({
      url,
      label: row?.label || "",
      capabilities
    });
    if (verdict.method === PLAYBACK_METHODS.UNKNOWN) picked.push(row);
  }
  return picked;
}

/**
 * Ask the deployment's probe endpoint what a source contains.
 *
 * Never throws: a missing endpoint, a timeout, a 502 and a malformed answer all
 * collapse to `null`, and the caller keeps the estimate it already had.
 */
export function createStreamProber({
  endpoint = "",
  fetchImpl = globalThis.fetch,
  timeoutMs = 8000
} = {}) {
  const cache = new Map();
  const pending = new Map();
  const base = String(endpoint || "").trim();

  async function request(url) {
    const separator = base.includes("?") ? "&" : "?";
    const target = `${base}${separator}u=${encodeURIComponent(url)}`;
    const controller = typeof AbortController === "function" ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
    try {
      const response = await fetchImpl(target, { signal: controller?.signal });
      if (!response?.ok) return null;
      const data = await response.json();
      if (!data?.ok) return null;
      return {
        container: String(data.container || "unknown"),
        videoCodec: String(data.videoCodec || "unknown"),
        audioCodec: String(data.audioCodec || "unknown")
      };
    } catch {
      return null;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  return {
    get enabled() {
      return base.length > 0;
    },

    /** Cached by URL; concurrent callers share one request. */
    async probe(url) {
      const key = String(url || "").trim();
      if (!base || !key) return null;
      if (cache.has(key)) return cache.get(key);
      if (pending.has(key)) return pending.get(key);
      const promise = request(key).then((result) => {
        pending.delete(key);
        if (result) cache.set(key, result);
        return result;
      });
      pending.set(key, promise);
      return promise;
    },

    /** One batch, already filtered to the rows worth asking about. */
    async probeUnknown(rows, { capabilities = {}, limit = 5 } = {}) {
      const results = new Map();
      const targets = selectRowsToProbe(rows, { capabilities, limit });
      await Promise.all(
        targets.map(async (row) => {
          const result = await this.probe(row?.url || "");
          if (result) results.set(String(row?.url || ""), result);
        })
      );
      return results;
    }
  };
}
