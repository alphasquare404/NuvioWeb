import { MDBLIST_API_BASE_URL } from "../../config.js";
import { MdbListSettingsStore } from "../local/mdbListSettingsStore.js";
import { TmdbService } from "../../core/tmdb/tmdbService.js";

const CACHE_TTL_MS = 30 * 60 * 1000;
const API_BASE_URL = String(MDBLIST_API_BASE_URL || "https://api.mdblist.com/").replace(/\/+$/, "");

const PROVIDERS = {
  TRAKT: { key: "trakt", apiValue: "trakt", settingsKey: "showTrakt" },
  IMDB: { key: "imdb", apiValue: "imdb", settingsKey: "showImdb" },
  TMDB: { key: "tmdb", apiValue: "tmdb", settingsKey: "showTmdb" },
  LETTERBOXD: { key: "letterboxd", apiValue: "letterboxd", settingsKey: "showLetterboxd" },
  TOMATOES: { key: "tomatoes", apiValue: "tomatoes", settingsKey: "showTomatoes" },
  AUDIENCE: { key: "audience", apiValue: "audience", settingsKey: "showAudience" },
  METACRITIC: { key: "metacritic", apiValue: "metacritic", settingsKey: "showMetacritic" },
  MAL: { key: "mal", apiValue: "mal", settingsKey: "showMal" }
};

const cache = new Map();
const inFlight = new Map();

function javaStringHash(value) {
  let hash = 0;
  const text = String(value || "");
  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 31 + text.charCodeAt(index)) | 0;
  }
  return hash;
}

function normalizeMediaType(rawType) {
  switch (
    String(rawType || "")
      .trim()
      .toLowerCase()
  ) {
    case "movie":
    case "film":
      return "movie";
    case "series":
    case "tv":
    case "show":
    case "tvshow":
      return "show";
    default:
      return "movie";
  }
}

function extractImdbId(rawId) {
  const match = String(rawId || "").match(/tt\d+/i);
  return match?.[0] || null;
}

function extractTmdbId(rawId) {
  const trimmed = String(rawId || "").trim();
  if (/^tmdb:/i.test(trimmed)) {
    const value = trimmed.replace(/^tmdb:/i, "").split(":")[0];
    return /^\d+$/.test(value) ? value : null;
  }
  return null;
}

function firstNonEmpty(...values) {
  return values.map((value) => String(value || "").trim()).find(Boolean) || "";
}

function enabledProviders(settings = {}) {
  return Object.values(PROVIDERS).filter((provider) => settings[provider.settingsKey] !== false);
}

function cacheGet(cacheKey) {
  const entry = cache.get(cacheKey);
  if (!entry) {
    return undefined;
  }
  if (entry.expiresAtMs > Date.now()) {
    return entry.result;
  }
  cache.delete(cacheKey);
  return undefined;
}

function cacheSet(cacheKey, result) {
  cache.set(cacheKey, {
    result,
    expiresAtMs: Date.now() + CACHE_TTL_MS
  });
}

// MDBList's per-provider endpoint is a POST carrying a JSON body, so a browser
// sends a CORS preflight first -- and that preflight is answered 405, so the
// request never leaves. An installed iOS PWA does not enforce this the same
// way, which is the whole reason ratings appeared there and nowhere else.
//
// The media endpoint is a plain GET, so it is a simple request with no
// preflight, and it answers with every source at once rather than one request
// per provider.
const MDBLIST_SOURCE_BY_PROVIDER = {
  trakt: "trakt",
  imdb: "imdb",
  tmdb: "tmdb",
  letterboxd: "letterboxd",
  tomatoes: "tomatoes",
  // MDBList names the Rotten Tomatoes audience score "popcorn", so matching on
  // this app's own provider key would drop it without a word.
  audience: "popcorn",
  metacritic: "metacritic",
  // Carried for the same reason, though Detail does not surface a MyAnimeList
  // rating today: the selector below has no `mal` field, exactly as before.
  mal: "myanimelist"
};

export function selectMdbListRatings(payload, providers = []) {
  const valueBySource = new Map(
    (Array.isArray(payload?.ratings) ? payload.ratings : [])
      .filter((entry) => entry?.source)
      .map((entry) => [String(entry.source), entry.value])
  );
  const enabledKeys = new Set(providers.map((provider) => provider?.key));
  const ratingFor = (providerKey) => {
    if (!enabledKeys.has(providerKey)) {
      return null;
    }
    // `value` is the source's own scale -- IMDb out of 10, Letterboxd out of 5.
    // `score` rescales every source to 100, which would change both on screen.
    const raw = valueBySource.get(MDBLIST_SOURCE_BY_PROVIDER[providerKey]);
    // This endpoint states an unrated source as an explicit null, and Number()
    // turns that into a perfectly finite 0 -- which would render as a rating.
    if (raw === null || raw === undefined || raw === "") {
      return null;
    }
    const numeric = Number(raw);
    return Number.isFinite(numeric) ? numeric : null;
  };
  return {
    trakt: ratingFor(PROVIDERS.TRAKT.key),
    imdb: ratingFor(PROVIDERS.IMDB.key),
    tmdb: ratingFor(PROVIDERS.TMDB.key),
    letterboxd: ratingFor(PROVIDERS.LETTERBOXD.key),
    tomatoes: ratingFor(PROVIDERS.TOMATOES.key),
    audience: ratingFor(PROVIDERS.AUDIENCE.key),
    metacritic: ratingFor(PROVIDERS.METACRITIC.key)
  };
}

async function fetchRatings({ imdbId, mediaType, apiKey, providers }) {
  let payload = null;
  try {
    const response = await fetch(
      `${API_BASE_URL}/imdb/${encodeURIComponent(mediaType)}/${encodeURIComponent(imdbId)}?apikey=${encodeURIComponent(apiKey)}`
    );
    if (!response.ok) {
      console.warn(`MDBList request failed (${response.status})`);
      return null;
    }
    payload = await response.json();
  } catch (error) {
    console.warn("MDBList request failed", error);
    return null;
  }

  const normalizedRatings = selectMdbListRatings(payload, providers || []);
  const hasAnyRating = Object.values(normalizedRatings).some((value) => value != null);
  if (!hasAnyRating) {
    return null;
  }
  return {
    ratings: normalizedRatings,
    hasImdbRating: normalizedRatings.imdb != null
  };
}

async function resolveImdbId(
  meta = {},
  fallbackItemId = "",
  fallbackItemType = "",
  mediaType = "movie"
) {
  const directImdb = firstNonEmpty(
    extractImdbId(meta?.id),
    extractImdbId(fallbackItemId),
    extractImdbId(meta?.imdbId),
    extractImdbId(meta?.imdb_id),
    extractImdbId(meta?.externalIds?.imdb),
    extractImdbId(meta?.external_ids?.imdb_id)
  );
  if (directImdb) {
    return directImdb;
  }

  const tmdbId = firstNonEmpty(
    extractTmdbId(meta?.id),
    extractTmdbId(fallbackItemId),
    meta?.tmdbId,
    meta?.tmdb_id,
    meta?.ids?.tmdb,
    meta?.externalIds?.tmdb,
    meta?.external_ids?.tmdb,
    /^\d+$/.test(String(meta?.id || "").trim()) ? meta.id : "",
    /^\d+$/.test(String(fallbackItemId || "").trim()) ? fallbackItemId : ""
  );
  if (tmdbId) {
    const mapped = await TmdbService.tmdbToImdb(tmdbId, fallbackItemType || mediaType);
    if (mapped) {
      return mapped;
    }
  }

  const lookupType = fallbackItemType || mediaType;
  const convertedTmdbId = await TmdbService.ensureTmdbId(meta?.id, lookupType, {
    requireEnabled: false
  });
  if (convertedTmdbId) {
    const mapped = await TmdbService.tmdbToImdb(convertedTmdbId, lookupType);
    if (mapped) {
      return mapped;
    }
  }

  return null;
}

async function getCachedOrFetch(cacheKey, factory) {
  const cached = cacheGet(cacheKey);
  if (cached !== undefined) {
    return cached;
  }
  if (inFlight.has(cacheKey)) {
    return inFlight.get(cacheKey);
  }
  const promise = factory()
    .then((result) => {
      cacheSet(cacheKey, result);
      return result;
    })
    .finally(() => {
      inFlight.delete(cacheKey);
    });
  inFlight.set(cacheKey, promise);
  return promise;
}

export const mdbListRepository = {
  async validateApiKey(apiKey) {
    const trimmed = String(apiKey || "").trim();
    if (!trimmed) {
      return true;
    }
    try {
      const response = await fetch(`${API_BASE_URL}/user?apikey=${encodeURIComponent(trimmed)}`);
      return response.ok;
    } catch (_error) {
      return false;
    }
  },

  async getImdbRatingForItem(itemId, itemType = "movie") {
    const settings = MdbListSettingsStore.get();
    if (!settings.enabled) {
      return null;
    }
    const apiKey = String(settings.apiKey || "").trim();
    if (!apiKey) {
      return null;
    }

    const mediaType = normalizeMediaType(itemType);
    const imdbId = await resolveImdbId(
      { id: itemId, type: mediaType === "show" ? "series" : "movie", name: itemId },
      itemId,
      itemType,
      mediaType
    );
    if (!imdbId) {
      return null;
    }

    const cacheKey = `${mediaType}:${imdbId}:imdb:${javaStringHash(apiKey)}`;
    const result = await getCachedOrFetch(cacheKey, () =>
      fetchRatings({
        imdbId,
        mediaType,
        apiKey,
        providers: [PROVIDERS.IMDB]
      })
    );
    return result?.ratings?.imdb ?? null;
  },

  async getRatingsForMeta(meta = {}, fallbackItemId = "", fallbackItemType = "movie") {
    const settings = MdbListSettingsStore.get();
    if (!settings.enabled) {
      return null;
    }
    const apiKey = String(settings.apiKey || "").trim();
    if (!apiKey) {
      return null;
    }
    const providers = enabledProviders(settings);
    if (!providers.length) {
      return null;
    }

    const mediaType = normalizeMediaType(meta?.apiType || fallbackItemType);
    const imdbId = await resolveImdbId(meta, fallbackItemId, fallbackItemType, mediaType);
    if (!imdbId) {
      return null;
    }

    const providerHash = providers
      .map((provider) => provider.apiValue)
      .sort()
      .join(",");
    const cacheKey = `${mediaType}:${imdbId}:${providerHash}:${javaStringHash(apiKey)}`;
    return getCachedOrFetch(cacheKey, () =>
      fetchRatings({
        imdbId,
        mediaType,
        apiKey,
        providers
      })
    );
  }
};
