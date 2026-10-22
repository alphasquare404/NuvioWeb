import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";

// Probe bridge: what is actually inside the stream?
//
// The stream list can only estimate from the addon's own text, and addons format
// that text however they like. One ffprobe answers the question exactly: which
// container, which codecs, what resolution. From that the app decides between
// playing directly, remuxing the container, transcoding the audio only, or
// re-encoding the picture — a cost ladder rather than a guess.
//
// Deliberately narrow: one source parameter, http(s) only, a cached answer per
// source, and a short timeout so one slow host cannot hold the bridge.

// Six hours. The answer is immutable -- a file's container, codec and tag never
// change -- so the only reason to expire it early was that the key carried the link's
// token, and that lives about an hour. The key is now the file's identity when the
// caller can name it, so the window follows the fact that the answer cannot change.
const DEFAULT_TTL_MS = 6 * 60 * 60 * 1000;
// A ceiling as well as an age: with hundreds of distinct callers a day an
// age-only policy still lets the map grow without bound between visits.
const DEFAULT_MAX_ENTRIES = 2000;
const DEFAULT_TIMEOUT_MS = 20_000;
const PROBE_PATH = "/api/probe";
const HEALTH_PATH = "/api/probe/health";

function json(response, status, payload) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Access-Control-Allow-Origin": "*"
  });
  response.end(JSON.stringify(payload));
}

export function parseProbeSource(raw) {
  const value = String(raw || "").trim();
  if (!value) return { ok: false, reason: "missing-source" };
  let url;
  try {
    url = new URL(value);
  } catch {
    return { ok: false, reason: "invalid-url" };
  }
  if (!/^https?:$/.test(url.protocol)) return { ok: false, reason: "unsupported-scheme" };
  if (url.username || url.password) return { ok: false, reason: "credentials-not-allowed" };
  return {
    ok: true,
    url: url.toString(),
    key: createHash("sha256").update(url.toString()).digest("hex").slice(0, 32)
  };
}

/** ffprobe's JSON, reduced to the few facts the decision needs. */
export function normalizeProbe(probeJson) {
  const streams = Array.isArray(probeJson?.streams) ? probeJson.streams : [];
  const video = streams.find((stream) => stream?.codec_type === "video") || null;
  const audio = streams.find((stream) => stream?.codec_type === "audio") || null;
  const formatName = String(probeJson?.format?.format_name || "");

  const container = /matroska|webm/i.test(formatName)
    ? "mkv"
    : /mp4|mov/i.test(formatName)
      ? "mp4"
      : formatName
          .split(",")
          .map((entry) => entry.trim())
          .filter(Boolean)[0] || "unknown";

  return {
    container,
    videoCodec: String(video?.codec_name || "unknown").toLowerCase(),
    // The MP4 tag on the video track, which is the difference between an HEVC file
    // Safari plays (`hvc1`, parameter sets in the sample description) and one it
    // refuses with no explanation (`hev1`, parameter sets in band). Codec alone
    // cannot answer that, and every x265 webrip is tagged the second way.
    // The MP4 tag on the video track, and only when it really is one. Matroska has
    // no four-character code and ffprobe reports `[0][0][0][0]`, which is not a tag
    // and would only confuse whatever reads this.
    videoTag: /^[a-z0-9]{4}$/.test(String(video?.codec_tag_string || "").toLowerCase())
      ? String(video.codec_tag_string).toLowerCase()
      : "",
    audioCodec: String(audio?.codec_name || "unknown").toLowerCase(),
    width: Number(video?.width) || 0,
    height: Number(video?.height) || 0,
    durationSeconds: Number(probeJson?.format?.duration) || 0
  };
}

/**
 * Keep the answer cache bounded in both directions.
 *
 * Age alone was not enough: an entry past its expiry was skipped when read but never
 * removed, so the map only ever grew. With a handful of users that was invisible;
 * with hundreds it is a slow leak that ends in a restart.
 */
export function pruneProbeCache(cache, { at = Date.now(), maxEntries = DEFAULT_MAX_ENTRIES } = {}) {
  for (const [key, entry] of cache) {
    if (!entry || Number(entry.expiresAt || 0) <= at) cache.delete(key);
  }
  // Map keeps insertion order, so the oldest answer is the first key.
  while (cache.size > maxEntries) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
  return cache.size;
}

/**
 * Which key an answer is stored under.
 *
 * The URL is the safe default: it can never mix up two files. But it also carries
 * whatever credential a provider chose to put there -- TorBox in the query, AllDebrid
 * in a path segment, signed CDN links under parameters of their own -- and a re-issued
 * token then looks like a new file. When the caller supplies a stable identity (which
 * service, which torrent, which file), that is the better key; the host is mixed in so
 * the same file served from two CDNs does not collide.
 */
export function probeCacheKey({ host = "", identity = "", urlKey = "" } = {}) {
  const cleanHost = String(host || "")
    .trim()
    .toLowerCase();
  const cleanIdentity = String(identity || "").trim();
  if (!cleanHost || !cleanIdentity) return urlKey;
  return createHash("sha256").update(`id|${cleanHost}|${cleanIdentity}`).digest("hex").slice(0, 32);
}

export function createProbeBridgeHandler({
  ffprobePath = process.env.FFPROBE_PATH || "ffprobe",
  ttlMs = Number(process.env.PROBE_TTL_MS) || DEFAULT_TTL_MS,
  maxEntries = Number(process.env.PROBE_MAX_ENTRIES) || DEFAULT_MAX_ENTRIES,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  spawnImpl = spawn,
  log = console,
  now = () => Date.now()
} = {}) {
  const cache = new Map();
  // One ffprobe per URL at a time. The app retries a row whose probe timed out, and
  // without this a retry started a second ffprobe while the first was still reading:
  // measured on a real list, 32 requests produced 14 ffprobe runs of which several
  // were the same file asked again.
  const pending = new Map();
  // A probe that failed is remembered briefly, so a dead or unauthorised row does not
  // cost a fresh timeout on every visit to the list. Short on purpose: a link that
  // expired a minute ago deserves another chance, not a permanent verdict.
  const failed = new Map();
  const FAILURE_TTL_MS = 2 * 60 * 1000;
  // What this bridge costs, countable: one request per row the screen decided to ask
  // about, and a hit whenever the same URL is asked twice inside the TTL.
  const stats = { requests: 0, hits: 0, hitsByIdentity: 0, joined: 0, misses: 0, failures: 0 };
  // Two different costs, counted apart: a probe that decides whether a file plays
  // (`tag`) and one that only sharpens a label (`unknown`). The server cannot tell
  // them apart by itself, so the caller says which budget it came from.
  const emptyReason = () => ({ requests: 0, misses: 0, failures: 0, totalMs: 0 });
  const byReason = { tag: emptyReason(), unknown: emptyReason(), other: emptyReason() };
  /** Nothing but these three shapes reaches the counters. */
  const reasonOf = (value) => {
    const normalized = String(value || "")
      .trim()
      .toLowerCase();
    return byReason[normalized] ? normalized : "other";
  };
  const hostOf = (url) => {
    try {
      return new URL(url).host;
    } catch {
      return "?";
    }
  };

  function probe(source) {
    return new Promise((resolve, reject) => {
      const args = [
        "-v",
        "error",
        "-show_entries",
        "stream=codec_type,codec_name,codec_tag_string,width,height",
        "-show_entries",
        "format=format_name,duration",
        "-of",
        "json",
        source
      ];
      let output = "";
      let settled = false;
      const child = spawnImpl(ffprobePath, args, { stdio: ["ignore", "pipe", "ignore"] });
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        try {
          child.kill("SIGKILL");
        } catch {
          // already gone
        }
        reject(new Error("probe-timeout"));
      }, timeoutMs);
      child.stdout?.on?.("data", (chunk) => {
        if (output.length < 256 * 1024) output += String(chunk);
      });
      child.on("error", () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(new Error("probe-failed"));
      });
      child.on("close", (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (code !== 0) {
          reject(new Error("probe-failed"));
          return;
        }
        try {
          resolve(normalizeProbe(JSON.parse(output)));
        } catch {
          reject(new Error("probe-unreadable"));
        }
      });
    });
  }

  return async function handleProbeBridge(request, response) {
    const requestUrl = new URL(
      request.url || "/",
      `http://${request.headers?.host || "localhost"}`
    );
    if (requestUrl.pathname === HEALTH_PATH) {
      // Counters, because "how many probes did that cost?" was a question nobody
      // could answer: the bridge answered requests and kept no record of them.
      json(response, 200, {
        ok: true,
        cacheSize: cache.size,
        ttlMs,
        maxEntries,
        negativeSize: failed.size,
        requests: stats.requests,
        hits: stats.hits,
        hitsByIdentity: stats.hitsByIdentity,
        joined: stats.joined,
        misses: stats.misses,
        failures: stats.failures,
        byReason: Object.fromEntries(
          Object.entries(byReason).map(([name, entry]) => [
            name,
            {
              ...entry,
              avgMs:
                entry.misses + entry.failures
                  ? Math.round(entry.totalMs / (entry.misses + entry.failures))
                  : 0
            }
          ])
        )
      });
      return;
    }
    if (requestUrl.pathname !== PROBE_PATH) {
      json(response, 404, { ok: false, error: "unknown_path" });
      return;
    }
    if (request.method !== "GET") {
      json(response, 405, { ok: false, error: "method_not_allowed" });
      return;
    }

    const parsed = parseProbeSource(requestUrl.searchParams.get("u"));
    if (!parsed.ok) {
      json(response, 400, { ok: false, error: parsed.reason });
      return;
    }

    // The identity, when the caller sent one, becomes the key; otherwise the URL hash
    // stands, which is what every caller did before identities existed.
    const identity = String(requestUrl.searchParams.get("id") || "").trim();
    const key = probeCacheKey({ host: hostOf(parsed.url), identity, urlKey: parsed.key });
    const keyedByIdentity = Boolean(identity) && key !== parsed.key;

    stats.requests += 1;
    const cached = cache.get(key);
    if (cached && cached.expiresAt > now()) {
      stats.hits += 1;
      // How many answers came back only because the file was recognised behind a
      // different link. Without this number the identity key is a claim, not a result.
      if (keyedByIdentity) stats.hitsByIdentity += 1;
      json(response, 200, { ok: true, cached: true, byIdentity: keyedByIdentity, ...cached.value });
      return;
    }
    const knownFailure = failed.get(key);
    if (knownFailure && knownFailure > now()) {
      stats.failures += 1;
      json(response, 502, { ok: false, error: "probe-failed", cached: true });
      return;
    }
    const alreadyRunning = pending.get(key);
    if (alreadyRunning) {
      stats.joined += 1;
      try {
        const value = await alreadyRunning;
        json(response, 200, { ok: true, cached: true, joined: true, ...value });
      } catch {
        json(response, 502, { ok: false, error: "probe-failed", joined: true });
      }
      return;
    }

    const job = probe(parsed.url)
      .then((value) => {
        cache.set(key, { value, expiresAt: now() + ttlMs });
        pruneProbeCache(cache, { at: now(), maxEntries });
        failed.delete(key);
        return value;
      })
      .catch((error) => {
        failed.set(key, now() + FAILURE_TTL_MS);
        throw error;
      })
      .finally(() => pending.delete(key));
    pending.set(key, job);

    const reason = reasonOf(requestUrl.searchParams.get("why"));
    byReason[reason].requests += 1;
    const startedAt = now();
    try {
      const value = await job;
      const elapsedMs = now() - startedAt;
      stats.misses += 1;
      byReason[reason].misses += 1;
      byReason[reason].totalMs += elapsedMs;
      // One line per real ffprobe run: cheap enough to leave on, and it is the only
      // way to see what a screen actually asked for, how long it took, and which
      // budget paid for it.
      log.log(
        `[probe] fresh ${reason} ${elapsedMs}ms ${hostOf(parsed.url)} ${value.container}/${value.videoCodec}${value.videoTag ? "/" + value.videoTag : ""}`
      );
      json(response, 200, { ok: true, cached: false, ...value });
    } catch (error) {
      const elapsedMs = now() - startedAt;
      stats.failures += 1;
      byReason[reason].failures += 1;
      byReason[reason].totalMs += elapsedMs;
      log.warn(
        `[probe] failed ${reason} ${elapsedMs}ms ${hostOf(parsed.url)} ${String(error?.message || "probe-failed")}`
      );
      json(response, 502, { ok: false, error: String(error?.message || "probe-failed") });
    }
  };
}

export function createProbeBridgeServer(options = {}) {
  return createServer(createProbeBridgeHandler(options));
}
