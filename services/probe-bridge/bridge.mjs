import { normalizeProbe } from "../../js/core/player/probeMetadata.js";
export { normalizeProbe, probeCodecString } from "../../js/core/player/probeMetadata.js";
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

function json(response, status, payload, extraHeaders = null) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Access-Control-Allow-Origin": "*",
    ...(extraHeaders || {})
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

// ffprobe JSON can contain megabytes of font/attachment hex dumps. Only video
// extradata feeds codec identification. Strip the other strings while streaming,
// preserving valid JSON and keeping the retained metadata under the original cap.
export function createProbeOutputCollector(maxChars = 256 * 1024) {
  const parts = [];
  let line = "",
    retained = 0,
    codecType = "",
    skipping = false,
    escaped = false;
  const flush = () => {
    const type = /^\s*"codec_type"\s*:\s*"([^"\n]+)"/.exec(line);
    if (type) codecType = type[1];
    retained += line.length;
    if (retained > maxChars) throw Error("probe-output-limit");
    parts.push(line);
    line = "";
  };
  return {
    write(chunk) {
      for (const char of String(chunk)) {
        if (skipping) {
          if (escaped) escaped = false;
          else if (char === "\\") escaped = true;
          else if (char === '"') {
            skipping = false;
            line += char;
          }
          continue;
        }
        line += char;
        if (line.length + retained > maxChars) throw Error("probe-output-limit");
        if (char === '"' && codecType !== "video" && /^\s*"extradata"\s*:\s*"$/.test(line))
          skipping = true;
        if (char === "\n") flush();
      }
    },
    finish() {
      if (skipping) throw Error("probe-unreadable");
      if (line) flush();
      return parts.join("");
    },
    get retainedChars() {
      return retained + line.length;
    }
  };
}

export function createProbeBridgeHandler({
  ffprobePath = process.env.FFPROBE_PATH || "ffprobe",
  ttlMs = Number(process.env.PROBE_TTL_MS) || DEFAULT_TTL_MS,
  maxEntries = Number(process.env.PROBE_MAX_ENTRIES) || DEFAULT_MAX_ENTRIES,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  spawnImpl = spawn,
  log = console,
  // Requests per caller per minute. The probe is cheap, but it is public: one client
  // looping a list should not be able to occupy the bridge. 0 disables the limit.
  rateLimitPerMinute = Number(process.env.PROBE_RATE_LIMIT_PER_MINUTE ?? 120) || 0,
  // How many ffprobe may run at once. Without this a burst of users opens that many
  // processes, sockets and CDN connections at the same moment; the work is the same, only
  // the spike is gone. 0 disables the limit.
  maxConcurrent = Number(process.env.PROBE_MAX_CONCURRENT ?? 8) || 0,
  // Bytes this bridge may download per day. A probe reads a few MB from the source, and
  // with 300 users that adds up; this is the ceiling that keeps it inside a hosting quota.
  dailyByteBudget = Number(process.env.PROBE_DAILY_BYTES ?? 0) || 0,
  // What one probe is charged against that budget. Measured reads ranged 2-20 MB; 10 MB is
  // the middle and keeps the ceiling honest rather than optimistic.
  probeCostBytes = Number(process.env.PROBE_COST_BYTES ?? 10 * 1024 * 1024) || 0,
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
  const FAILURE_TTL_MS = 15 * 1000;
  // What this bridge costs, countable: one request per row the screen decided to ask
  // about, and a hit whenever the same URL is asked twice inside the TTL.
  const stats = { requests: 0, hits: 0, hitsByIdentity: 0, joined: 0, misses: 0, failures: 0 };
  // Running now, and what has been consumed today. Both reset by themselves.
  let running = 0;
  const waiters = [];
  const dayStamp = () => new Date(now()).toISOString().slice(0, 10);
  let budget = { day: dayStamp(), bytes: 0 };
  const bytesUsedToday = () => {
    if (budget.day !== dayStamp()) budget = { day: dayStamp(), bytes: 0 };
    return budget.bytes;
  };
  const acquireSlot = () =>
    new Promise((resolve) => {
      if (!(maxConcurrent > 0) || running < maxConcurrent) {
        running += 1;
        resolve();
        return;
      }
      waiters.push(resolve);
    });
  const releaseSlot = () => {
    const next = waiters.shift();
    if (next) next();
    else running = Math.max(0, running - 1);
  };
  // Caller -> timestamps inside the current minute window.
  const rateWindows = new Map();
  const callerOf = (request) => {
    const forwarded = String(request?.headers?.["x-forwarded-for"] || "")
      .split(",")[0]
      .trim();
    if (forwarded) return forwarded;
    const real = String(request?.headers?.["x-real-ip"] || "").trim();
    if (real) return real;
    return String(request?.socket?.remoteAddress || "unknown");
  };
  /** True when this caller is over its allowance for the last minute. */
  const rateLimited = (caller) => {
    if (!(rateLimitPerMinute > 0)) return false;
    const nowMs = now();
    const windowStart = nowMs - 60_000;
    const hits = (rateWindows.get(caller) || []).filter((at) => at > windowStart);
    if (hits.length >= rateLimitPerMinute) {
      rateWindows.set(caller, hits);
      return true;
    }
    hits.push(nowMs);
    rateWindows.set(caller, hits);
    // Keep the map from growing with every caller ever seen.
    if (rateWindows.size > 5000) {
      for (const [key, value] of rateWindows) {
        if (!value.some((at) => at > windowStart)) rateWindows.delete(key);
      }
    }
    return false;
  };
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
        "-user_agent",
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
        "-show_data",
        "-show_entries",
        "stream=extradata,codec_type,codec_name,codec_tag_string,profile,level,pix_fmt,bits_per_raw_sample,width,height,avg_frame_rate,r_frame_rate,bit_rate,color_transfer,color_primaries,channels,sample_rate:stream_tags=language:stream_disposition=default,attached_pic",
        "-show_entries",
        "format=format_name,duration",
        "-of",
        "json",
        source
      ];
      const output = createProbeOutputCollector();
      let settled = false;
      const child = spawnImpl(ffprobePath, args, {
        windowsHide: true,
        stdio: ["ignore", "pipe", "ignore"]
      });
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
        if (settled) return;
        try {
          output.write(chunk);
        } catch (error) {
          settled = true;
          clearTimeout(timer);
          child.kill("SIGKILL");
          reject(error);
        }
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
          resolve(normalizeProbe(JSON.parse(output.finish())));
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
        rateLimitPerMinute,
        maxConcurrent,
        dailyByteBudget,
        usedBytesToday: bytesUsedToday(),
        busy: maxConcurrent > 0 && running >= maxConcurrent,
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

    if (rateLimited(callerOf(request))) {
      log.warn("[probe] refused rate-limit");
      json(
        response,
        429,
        { ok: false, error: "rate-limited", perMinute: rateLimitPerMinute },
        { "Retry-After": "10" }
      );
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
    if (knownFailure && knownFailure.expiresAt > now()) {
      stats.failures += 1;
      json(response, 502, { ok: false, error: knownFailure.reason, cached: true });
      return;
    }
    const alreadyRunning = pending.get(key);
    if (alreadyRunning) {
      stats.joined += 1;
      try {
        const value = await alreadyRunning;
        json(response, 200, { ok: true, cached: true, joined: true, ...value });
      } catch (error) {
        json(response, 502, { ok: false, error: error?.message || "probe-failed", joined: true });
      }
      return;
    }

    if (dailyByteBudget > 0 && bytesUsedToday() >= dailyByteBudget) {
      stats.failures += 1;
      log.warn("[probe] refused budget");
      json(
        response,
        503,
        {
          ok: false,
          error: "probe-budget-exhausted",
          usedBytesToday: bytesUsedToday(),
          dailyByteBudget
        },
        { "Retry-After": "3600" }
      );
      return;
    }

    // One ffprobe at a time per slot, and each run is charged a fixed size. ffprobe does
    // not report how many bytes it read, so the budget counts probes against an assumed
    // cost -- predictable, and it is what actually bounds the monthly traffic.
    const job = (async () => {
      await acquireSlot();
      try {
        return await probe(parsed.url);
      } finally {
        releaseSlot();
      }
    })()
      .then((value) => {
        cache.set(key, { value, expiresAt: now() + ttlMs });
        budget.bytes += Math.max(0, Number(probeCostBytes) || 0);
        pruneProbeCache(cache, { at: now(), maxEntries });
        failed.delete(key);
        return value;
      })
      .catch((error) => {
        failed.set(key, {
          expiresAt: now() + FAILURE_TTL_MS,
          reason: error?.message || "probe-failed"
        });
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
