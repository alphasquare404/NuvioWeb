import { reportProbeCacheHit } from "./probeDiagnostics.js";
import { probeInBrowser, isBrowserProbeParallelReady } from "./ffprobeClient.js";
import { normalizeProbeMode } from "./probeMode.js";
import {
  probeMetadataCache,
  probeMetadataCacheGeneration,
  PROBE_METADATA_TTL_MS,
  PROBE_METADATA_MAX_ENTRIES
} from "./probeMetadataCache.js";
// Probing the gaps, not the whole list.
//
// The estimate from the addon's own text is good when the text says something: an
// extension, a codec tag, a resolution. It is blind when the card says nothing, and
// that is exactly the case where a server-side ffprobe earns its request. Probing
// rows the estimate already answers would spend the user's tokens and the
// deployment's bandwidth to learn what the card already said.

import { PLAYBACK_METHODS, classifyPlayback } from "./playbackMethod.js";

// Deterministic byte-limit failures are not file metadata. Keep them briefly in
// page memory across screens, so the same failed read is not downloaded again.
export const PROBE_BYTE_FAILURE_TTL_MS = 10 * 60 * 1000;
const byteFailures = new Map();

/**
 * Is this the shape where a probe decides whether the file plays at all?
 *
 * `Unknown` is the original case: the text said too little, so one request turns a
 * grey label into a real one. The other case is narrower and more valuable: HEVC
 * inside an MP4 the text calls playable, where Apple opens the file only when the
 * track is tagged `hvc1` and an x265 webrip is tagged `hev1`. The text never says
 * which, so without a probe the card promises "Direct" and the player then refuses
 * with no message.
 */
/**
 * Does a probe decide whether this row will be *heard*, not just played?
 *
 * A multichannel track on a device that plays only stereo is silent, and the text cannot
 * say whether the file also carries a stereo track. That is worth one probe: the answer
 * turns "convert the audio" into "play the track that is already there", or confirms the
 * conversion really is needed.
 */
export function isAudioCriticalVerdict(verdict, capabilities = {}) {
  if (capabilities.requiresStereoAac !== true) return false;
  // Only a Direct row needs the answer. A row that is remuxed anyway passes through the
  // relay, and the relay can downmix in the same job -- probing it would add cost and
  // change nothing. So: direct play, multichannel stated, ask once.
  if (verdict?.method !== PLAYBACK_METHODS.DIRECT) return false;
  const channels = Number(verdict?.audioChannels) || 0;
  return channels > 2;
}
export function isTagCriticalVerdict(verdict, capabilities = {}) {
  return (
    verdict?.method === PLAYBACK_METHODS.DIRECT &&
    verdict?.videoCodec === "hevc" &&
    verdict?.container === "mp4" &&
    capabilities.hevcHvc1Required === true
  );
}

/**
 * Which rows are worth one request, and in what order.
 *
 * Two classes, deliberately not equal. A tag-critical row decides whether playback
 * works at all, so those go first and may use the whole batch. An `Unknown` row only
 * turns a grey label into a certain one -- useful, cosmetic -- so it gets its own
 * small budget and cannot crowd out the rows that matter. Before this split every
 * candidate was one undifferentiated list, which is why one visit to a long list
 * spent most of its ffprobe runs on files whose only gain was a nicer label.
 */
export function selectRowsToProbe(
  rows = [],
  { capabilities = {}, limit = 5, certaintyLimit = 2 } = {}
) {
  const important = [];
  const certainty = [];
  for (const row of Array.isArray(rows) ? rows : []) {
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
    if (isTagCriticalVerdict(verdict, capabilities)) {
      if (important.length < limit) important.push({ ...row, reason: "tag" });
      continue;
    }
    if (isAudioCriticalVerdict(verdict, capabilities)) {
      if (important.length < limit) important.push({ ...row, reason: "audio" });
      continue;
    }
    if (verdict?.method === PLAYBACK_METHODS.UNKNOWN && certainty.length < certaintyLimit) {
      certainty.push({ ...row, reason: "unknown" });
    }
  }
  return [...important, ...certainty];
}

/** The single answer both callers share: a tag to settle, or no conclusion at all. */
export function shouldProbeVerdict(verdict, capabilities = {}) {
  if (verdict?.method === PLAYBACK_METHODS.UNKNOWN) return true;
  return isTagCriticalVerdict(verdict, capabilities);
}

/**
 * A name for the file that does not depend on how a provider shapes its links.
 * TorBox puts a token in the query, AllDebrid puts it in a path segment, Real-Debrid
 * often has none at all, and signed CDN links carry their own parameter names. Parsing
 * those would be a new rule per provider and would never cover a token inside the
 * path. The identity is taken from what the app already knows instead: which service,
 * which torrent, which file inside it. `url` is deliberately absent -- the whole point
 * is that a re-issued link is the same file.
 *
 * Empty when nothing identifies the file, which leaves the bridge on its URL key.
 */
function torrentFileIdentity(hash, index) {
  const h = String(hash || "").toLowerCase();
  const i = String(index ?? "");
  if (!/^[a-f0-9]{40}$/.test(h) || !/^\d+$/.test(i) || !Number.isSafeInteger(Number(i))) return "";
  return `torrent-file:${h}:${Number(i)}`;
}

function probeUrlIdentity(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) return "";
    const parts = url.pathname.split("/");
    if (
      url.host === "torrentio.strem.fun" &&
      parts[1] === "resolve" &&
      parts[2] === "torbox" &&
      [7, 8].includes(parts.length)
    ) {
      return torrentFileIdentity(parts[4], parts[6]);
    }
    // Torz exposes torrent hash/index; Store links use different identifiers.
    const match = url.pathname.match(
      /^\/stremio\/torz\/[^/]+\/_\/strem\/[^/]+\/tb\/([a-f0-9]{40})\/(\d+)\/[^/]+$/i
    );
    return match ? torrentFileIdentity(match[1], match[2]) : "";
  } catch {
    return "";
  }
}

export function streamProbeIdentity(stream = {}) {
  const resolve = stream?.clientResolve || stream?.raw?.clientResolve || null;
  const stable =
    torrentFileIdentity(
      resolve?.infoHash ?? stream?.infoHash,
      resolve?.fileIdx ?? stream?.fileIdx
    ) || probeUrlIdentity(stream?.url);
  if (stable) return stable;
  const parts = resolve
    ? [resolve.service, resolve.infoHash, resolve.fileIdx, resolve.filename]
    : [stream?.addonName, stream?.infoHash, stream?.fileIdx, stream?.name || stream?.title];
  const identity = parts
    .map((value) => String(value ?? "").trim())
    .filter(Boolean)
    .join("|");
  // Without a hash or a file index there is nothing stable to key on: a name alone
  // would collide across addons that happen to word a release the same way.
  const hasIdentity = Boolean(
    String(resolve?.infoHash || stream?.infoHash || "").trim() ||
    String(resolve?.fileIdx ?? stream?.fileIdx ?? "").trim()
  );
  return hasIdentity ? identity : "";
}

/**
 * Ask the deployment's probe endpoint what a source contains.
 *
 * Never throws: a missing endpoint, a timeout, a 502 and a malformed answer all
 * collapse to `null`, and the caller keeps the estimate it already had.
 */
export function createStreamProber({
  endpoint = "",
  mode = "server",
  clientConcurrency = 1,
  clientProbe = probeInBrowser,
  fetchImpl = globalThis.fetch,
  timeoutMs = 8000,
  assess = null,
  metadataCache = probeMetadataCache
} = {}) {
  const cache = new Map();
  const pending = new Map();
  const controllers = new Set();
  const failures = new Map();
  let cacheGeneration = probeMetadataCacheGeneration();
  const base = String(endpoint || "").trim();
  const selectedMode = normalizeProbeMode(mode);
  const enabled = selectedMode === "client" || (selectedMode === "server" && base.length > 0);

  async function request(
    url,
    reason = "",
    identity = "",
    requestTimeoutMs = timeoutMs,
    resolveTimeoutMs = 0,
    signal
  ) {
    if (selectedMode === "client") {
      try {
        return await clientProbe(url, {
          timeoutMs: requestTimeoutMs,
          resolveTimeoutMs,
          concurrency: clientConcurrency,
          allowHostHead: reason === "selected-playback" || reason === "audio-fallback",
          signal,
          onFailure: (reason) => failures.set(url, reason)
        });
      } catch {
        return null;
      }
    }
    const separator = base.includes("?") ? "&" : "?";
    // `why` is the client saying which budget this request came from. The server
    // cannot work that out by itself, and without it the two costs -- the check that
    // decides whether a file plays, and the one that only sharpens a label -- are
    // indistinguishable in the totals.
    const why = reason ? `&why=${encodeURIComponent(reason)}` : "";
    // `id` is the file's identity, not the link's: the bridge keys its answer on this
    // when present, so a re-issued token does not buy a second ffprobe. The URL still
    // travels -- it is what gets probed.
    const ref = identity ? `&id=${encodeURIComponent(identity)}` : "";
    const target = `${base}${separator}u=${encodeURIComponent(url)}${why}${ref}`;
    const controller = typeof AbortController === "function" ? new AbortController() : null;
    const abort = () => controller?.abort();
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    const timer =
      controller && Number.isFinite(requestTimeoutMs)
        ? setTimeout(() => controller.abort(), Math.max(1, requestTimeoutMs))
        : null;
    try {
      const response = await fetchImpl(target, { signal: controller?.signal });
      if (!response?.ok) {
        let reason = `HTTP ${response?.status || "error"}`;
        try {
          const data = await response.json();
          if (
            [
              "probe-failed",
              "probe-unreadable",
              "probe-timeout",
              "probe-output-limit",
              "rate-limited"
            ].includes(data?.error)
          )
            reason = data.error;
        } catch {
          /* Only fixed, known server error categories reach the UI. */
        }
        failures.set(url, reason);
        return null;
      }
      const data = await response.json();
      if (!data?.ok) return null;
      const result = {
        container: String(data.container || "unknown"),
        videoCodec: String(data.videoCodec || "unknown"),
        // The tag decides whether Apple will open an HEVC file at all, and it is the
        // one thing the addon's text never says. Dropping it here made the whole
        // classification blind to it.
        videoTag: String(data.videoTag || ""),
        audioCodec: String(data.audioCodec || "unknown"),
        audioChannels: Number(data.audioChannels) || 0,
        audioStreams: Array.isArray(data.audioStreams)
          ? data.audioStreams.map((track) => ({
              index: Number(track?.index) || 0,
              codec: String(track?.codec || "unknown").toLowerCase(),
              channels: Number(track?.channels) || 0
            }))
          : []
      };
      // Preserve file facts. Browser-specific predictions are added outside the cache.
      for (const key of [
        "codecString",
        "videoProfile",
        "videoLevel",
        "pixelFormat",
        "bitDepth",
        "frameRate",
        "videoBitrate",
        "colorTransfer",
        "colorPrimaries",
        "hasAudio",
        "width",
        "height",
        "durationSeconds"
      ]) {
        if (data[key] != null) result[key] = data[key];
      }
      if (Array.isArray(data.audioStreams)) result.audioStreams = data.audioStreams;
      return result;
    } catch {
      failures.set(
        url,
        signal?.aborted ? "cancelled" : controller?.signal.aborted ? "timeout" : "network-or-cors"
      );
      return null;
    } finally {
      signal?.removeEventListener("abort", abort);
      if (timer) clearTimeout(timer);
    }
  }

  return {
    cancelAll() {
      for (const controller of controllers) controller.abort();
      controllers.clear();
      pending.clear();
    },
    failureReason(url) {
      return failures.get(String(url)) || "metadata-unavailable";
    },
    get enabled() {
      return enabled;
    },
    get clientParallelReady() {
      return selectedMode === "client" && isBrowserProbeParallelReady();
    },

    /** Cached by URL; concurrent callers share one request. */
    async probe(
      url,
      {
        reason = "",
        identity = "",
        timeoutMs: requestTimeoutMs = timeoutMs,
        resolveTimeoutMs = 0
      } = {}
    ) {
      const source = String(url || "").trim();
      const strongIdentity = /^torrent-file:[a-f0-9]{40}:\d+$/.test(identity) ? identity : "";
      // A file's cached facts do not require a freshly resolved signed URL.
      // An empty source with a strong identity is a strictly cache-only lookup.
      if (!enabled || (!source && !(selectedMode === "client" && strongIdentity))) return null;
      const key =
        selectedMode === "client" ? probeUrlIdentity(source) || strongIdentity || source : source;
      const assessResult = async (result) => {
        if (!result || !assess) return result;
        try {
          return { ...result, playbackCapabilities: await assess(result) };
        } catch {
          return { ...result, playbackCapabilities: { video: null, audio: [], container: null } };
        }
      };
      if (cacheGeneration !== probeMetadataCacheGeneration()) {
        cache.clear();
        cacheGeneration = probeMetadataCacheGeneration();
      }
      const remembered = cache.get(key);
      if (remembered?.expiresAt > Date.now()) {
        if (selectedMode === "client") reportProbeCacheHit(source || key, "memory");
        return assessResult(remembered.facts);
      }
      cache.delete(key);
      if (pending.has(key)) {
        const shared = pending.get(key);
        let timer;
        const started = Date.now();
        const budget = Math.max(
          1,
          requestTimeoutMs + resolveTimeoutMs + (resolveTimeoutMs ? 20000 : 0)
        );
        const timedOut = Symbol("timeout");
        const result = Number.isFinite(budget)
          ? await Promise.race([
              shared.promise,
              new Promise((resolve) => {
                timer = setTimeout(() => resolve(timedOut), budget);
              })
            ])
          : await shared.promise;
        clearTimeout(timer);
        if (result === timedOut) return null;
        if (result || shared.source === source) return assessResult(result);
        // A failed URL does not invalidate the file's alternative source.
        requestTimeoutMs = Math.max(0, requestTimeoutMs - (Date.now() - started));
        if (!requestTimeoutMs) return null;
        return this.probe(source, {
          reason,
          identity,
          timeoutMs: requestTimeoutMs,
          resolveTimeoutMs
        });
      }
      failures.delete(source);
      if (failures.size > PROBE_METADATA_MAX_ENTRIES) failures.delete(failures.keys().next().value);
      const jobGeneration = probeMetadataCacheGeneration();
      const controller = new AbortController();
      controllers.add(controller);
      const promise = (async () => {
        if (selectedMode === "client" && key.startsWith("torrent-file:")) {
          const started = Date.now();
          let timer;
          let saved = null;
          try {
            saved = await Promise.race([
              metadataCache.get(key),
              new Promise((resolve) => {
                timer = setTimeout(
                  () => resolve(null),
                  Math.min(150, Math.max(1, requestTimeoutMs))
                );
              })
            ]);
          } catch {
            /* Storage failure must not prevent a live probe. */
          } finally {
            clearTimeout(timer);
          }
          requestTimeoutMs = Math.max(0, requestTimeoutMs - (Date.now() - started));
          if (controller.signal.aborted) return null;
          if (saved && jobGeneration === probeMetadataCacheGeneration()) {
            byteFailures.delete(key);
            reportProbeCacheHit(source || key, "persistent");
            return saved;
          }
          if (!requestTimeoutMs) return null;
        }
        if (controller.signal.aborted || !source) return null;
        const previousFailure = byteFailures.get(key);
        if (
          selectedMode === "client" &&
          previousFailure?.generation === jobGeneration &&
          previousFailure.expiresAt > Date.now()
        ) {
          failures.set(source, "probe-byte-budget");
          reportProbeCacheHit(source, "byte-limit-failure");
          return null;
        }
        byteFailures.delete(key);
        const result = await request(
          source,
          reason,
          identity,
          requestTimeoutMs,
          resolveTimeoutMs,
          controller.signal
        );
        if (controller.signal.aborted) return null;
        if (!result && !failures.has(source)) failures.set(source, "metadata-unavailable");
        if (!result && selectedMode === "client" && failures.get(source) === "probe-byte-budget") {
          byteFailures.set(key, {
            expiresAt: Date.now() + PROBE_BYTE_FAILURE_TTL_MS,
            generation: jobGeneration
          });
          if (byteFailures.size > PROBE_METADATA_MAX_ENTRIES)
            byteFailures.delete(byteFailures.keys().next().value);
        }
        if (result) byteFailures.delete(key);

        if (
          result &&
          selectedMode === "client" &&
          jobGeneration === probeMetadataCacheGeneration()
        ) {
          void Promise.resolve(metadataCache.set(key, result, jobGeneration)).catch(() => {});
        }
        return result;
      })().then((result) => {
        controllers.delete(controller);
        if (pending.get(key)?.promise === promise) pending.delete(key);
        if (result && jobGeneration === probeMetadataCacheGeneration()) {
          cache.set(key, { facts: result, expiresAt: Date.now() + PROBE_METADATA_TTL_MS });
          if (cache.size > PROBE_METADATA_MAX_ENTRIES) cache.delete(cache.keys().next().value);
        }
        return result;
      });
      pending.set(key, { source, promise });
      return assessResult(await promise);
    },

    /** One batch, already filtered to the rows worth asking about. */
    async probeUnknown(rows, { capabilities = {}, limit = 5 } = {}) {
      const results = new Map();
      const targets = selectRowsToProbe(rows, { capabilities, limit });
      await Promise.all(
        targets.map(async (row) => {
          const result = await this.probe(row?.url || "", {
            reason: row?.reason || "",
            identity: row?.identity || ""
          });
          if (result) results.set(String(row?.url || ""), result);
        })
      );
      return results;
    }
  };
}
