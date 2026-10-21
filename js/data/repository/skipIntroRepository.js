import { INTRODB_API_URL } from "../../config.js";

const CACHE = new Map();

function normalizeImdbId(value = "") {
  const candidate = String(value || "")
    .trim()
    .split(":")[0];
  return /^tt\d+$/i.test(candidate) ? candidate : "";
}

function normalizeBaseUrl(value = "") {
  const normalized = String(value || "").trim();
  if (!normalized) {
    return "";
  }
  return normalized.endsWith("/") ? normalized : `${normalized}/`;
}

/**
 * Where the segment endpoint lives.
 *
 * The upstream answers with `Access-Control-Allow-Origin: https://introdb.app`, so
 * a browser on any other origin cannot read it. A deployment therefore mounts a
 * relay on its own origin and configures a path instead of an absolute URL — the
 * request is then same-origin and CORS does not apply at all. Both forms are
 * accepted here for that reason.
 */
export function resolveBaseUrl(value = "", origin = globalThis.location?.origin) {
  const normalized = normalizeBaseUrl(value);
  if (!normalized) return null;
  try {
    return new URL(normalized);
  } catch {
    if (!origin) return null;
    try {
      return new URL(normalized, origin);
    } catch {
      return null;
    }
  }
}

function toSkipInterval(segment, type) {
  if (!segment || typeof segment !== "object") {
    return null;
  }
  const start = Number.isFinite(Number(segment.start_sec))
    ? Number(segment.start_sec)
    : Number.isFinite(Number(segment.start_ms))
      ? Number(segment.start_ms) / 1000
      : NaN;
  const end = Number.isFinite(Number(segment.end_sec))
    ? Number(segment.end_sec)
    : Number.isFinite(Number(segment.end_ms))
      ? Number(segment.end_ms) / 1000
      : NaN;
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
    return null;
  }
  return {
    startTime: start,
    endTime: end,
    type,
    provider: "introdb"
  };
}

/**
 * One request, with "the endpoint said no" and "there is nothing to say" kept
 * apart.
 *
 * They used to collapse into the same empty array, which is how a CORS refusal
 * (Access-Control-Allow-Origin on this API is limited to introdb.app) came to look
 * exactly like an episode nobody has submitted timestamps for. It also meant a
 * single failed attempt was cached for the whole session.
 */
async function fetchJson(url, timeoutMs = 3500) {
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const response = await fetch(url, {
      method: "GET",
      mode: "cors",
      cache: "no-store",
      signal: controller?.signal
    });
    if (!response.ok) {
      return { ok: false, reason: `http-${response.status}` };
    }
    return { ok: true, data: await response.json() };
  } catch (error) {
    // A CORS refusal arrives here as a TypeError with no status.
    return { ok: false, reason: `unreachable: ${error?.message || error}` };
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

export const skipIntroRepository = {
  async getSkipIntervals(imdbId, season, episode) {
    const baseUrl = resolveBaseUrl(INTRODB_API_URL);
    const normalizedImdbId = normalizeImdbId(imdbId);
    const seasonNumber = Number(season || 0);
    const episodeNumber = Number(episode || 0);
    if (!baseUrl || !normalizedImdbId || seasonNumber <= 0 || episodeNumber <= 0) {
      return [];
    }

    const cacheKey = `${normalizedImdbId}:${seasonNumber}:${episodeNumber}`;
    if (CACHE.has(cacheKey)) {
      return CACHE.get(cacheKey);
    }

    const url = new URL("segments", baseUrl);
    url.searchParams.set("imdb_id", normalizedImdbId);
    url.searchParams.set("season", String(seasonNumber));
    url.searchParams.set("episode", String(episodeNumber));

    const result = await fetchJson(url.toString());
    const intervals = result.ok
      ? [
          toSkipInterval(result.data?.intro, "intro"),
          toSkipInterval(result.data?.recap, "recap"),
          toSkipInterval(result.data?.outro, "outro")
        ]
          .filter(Boolean)
          .sort((left, right) => left.startTime - right.startTime)
      : [];

    if (!result.ok) {
      // Not cached: a refusal is about the network or CORS, and the next attempt
      // deserves a fresh chance. Only "the endpoint answered and had nothing" is
      // worth remembering.
      console.warn(`skip intro: request failed (${result.reason})`);
      return intervals;
    }

    CACHE.set(cacheKey, intervals);
    return intervals;
  }
};
