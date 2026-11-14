import { getEffectiveTmdbApiKey, TmdbSettingsStore } from "../../data/local/tmdbSettingsStore.js";

const TMDB_BASE_URL = "https://api.themoviedb.org/3";

function getContentType(type) {
  const normalized = String(type || "").toLowerCase();
  if (normalized === "series" || normalized === "tv" || normalized === "show") {
    return "tv";
  }
  return "movie";
}

export const TmdbService = {
  async ensureTmdbId(id, type = "movie", options = {}) {
    const settings = TmdbSettingsStore.get();
    const requireEnabled = options?.requireEnabled !== false;
    const apiKey = getEffectiveTmdbApiKey();
    if (requireEnabled && !settings.enabled) {
      return null;
    }

    const rawId = String(id || "").trim();
    if (!rawId) {
      return null;
    }

    const idPart = rawId
      .replace(/^tmdb:/i, "")
      .replace(/^movie:/i, "")
      .replace(/^series:/i, "")
      .trim();
    const normalizedIdPart = idPart.split(":")[0]?.split("/")[0]?.trim() || "";

    if (/^\d+$/.test(normalizedIdPart)) {
      return normalizedIdPart;
    }

    const tvdb = /^tvdb:(\d+)(?::|$)/i.exec(rawId)?.[1];
    if ((!tvdb && !/^tt\d+$/i.test(normalizedIdPart)) || !apiKey) {
      return null;
    }

    const contentType = getContentType(type);
    const url = `${TMDB_BASE_URL}/find/${encodeURIComponent(tvdb || normalizedIdPart)}?external_source=${tvdb ? "tvdb_id" : "imdb_id"}&api_key=${encodeURIComponent(apiKey)}`;
    const response = await fetch(url, { signal: options.signal });
    if (!response.ok) {
      return null;
    }

    const data = await response.json();
    const list = contentType === "tv" ? data.tv_results : data.movie_results;
    const first = Array.isArray(list) ? list[0] : null;
    if (!first?.id) {
      return null;
    }

    return String(first.id);
  },

  async tmdbToImdb(tmdbId, type = "movie") {
    return (await TmdbService.externalIds(tmdbId, type))?.imdbId || null;
  },

  async externalIds(tmdbId, type = "movie", { signal } = {}) {
    const apiKey = getEffectiveTmdbApiKey();
    const numericId = String(tmdbId || "").trim();
    if (!apiKey || !/^\d+$/.test(numericId)) {
      return null;
    }

    const contentType = getContentType(type);
    const url = `${TMDB_BASE_URL}/${contentType}/${encodeURIComponent(numericId)}/external_ids?api_key=${encodeURIComponent(apiKey)}`;
    const response = await fetch(url, { signal });
    if (!response.ok) {
      return null;
    }

    const data = await response.json();
    const imdbId = String(data?.imdb_id || "").trim();
    const tvdbId = String(data?.tvdb_id || "").trim();
    return {
      imdbId: /^tt\d+$/i.test(imdbId) ? imdbId : null,
      tvdbId: /^\d+$/.test(tvdbId) ? tvdbId : null
    };
  }
};
