function text(value) {
  return String(value || "").trim();
}

function list(value) {
  return Array.isArray(value) ? value.map(text).filter(Boolean).slice(0, 12) : [];
}

function first(...values) {
  return values.map(text).find(Boolean) || "";
}

export function createOfflineDisplaySnapshot(input = {}) {
  const episode = input.episode || null;
  return {
    title: first(input.name, input.title, input.seriesTitle, input.itemTitle),
    originalTitle: first(input.originalTitle, input.original_name, input.original_title),
    overview: first(input.description, input.overview),
    year: first(input.releaseInfo, input.year, input.releaseYear),
    yearRange: first(input.yearRange, input.releaseInfo),
    genres: list(input.genres),
    writers: list(input.writers || input.writer),
    directors: list(input.directors || input.director),
    rating: input.imdbRating ?? input.rating ?? null,
    runtimeMinutes: Number(input.runtimeMinutes || input.runtime || 0) || 0,
    country: first(input.country, input.countryCode),
    language: first(input.language, input.originalLanguage),
    poster: first(input.poster, input.posterUrl),
    backdrop: first(input.background, input.backdrop, input.backdropUrl),
    logo: first(input.logo, input.logoUrl),
    episode: episode
      ? {
          title: first(episode.title, episode.name),
          overview: first(episode.overview, episode.description),
          runtimeMinutes: Number(episode.runtimeMinutes || episode.runtime || 0) || 0,
          released: first(episode.released, episode.releaseDate, episode.airDate),
          still: first(episode.thumbnail, episode.still, episode.poster)
        }
      : null
  };
}

export function mergeOfflineDisplaySnapshot(local = {}, remote = {}) {
  const localEpisode = local?.episode || {};
  const remoteEpisode = remote?.episode || {};
  return {
    ...local,
    ...Object.fromEntries(Object.entries(remote || {}).filter(([, value]) => value != null && value !== "" && (!Array.isArray(value) || value.length))),
    genres: list(remote.genres).length ? list(remote.genres) : list(local.genres),
    writers: list(remote.writers).length ? list(remote.writers) : list(local.writers),
    directors: list(remote.directors).length ? list(remote.directors) : list(local.directors),
    episode: {
      ...localEpisode,
      ...Object.fromEntries(Object.entries(remoteEpisode).filter(([, value]) => value != null && value !== ""))
    }
  };
}

export function applyOfflineDisplaySnapshot(meta = {}, snapshot = {}) {
  return {
    ...meta,
    name: first(meta.name, snapshot.title),
    originalTitle: first(meta.originalTitle, snapshot.originalTitle),
    description: first(meta.description, snapshot.overview),
    releaseInfo: first(meta.releaseInfo, snapshot.yearRange, snapshot.year),
    genres: list(meta.genres).length ? meta.genres : list(snapshot.genres),
    writers: list(meta.writers).length ? meta.writers : list(snapshot.writers),
    directors: list(meta.directors).length ? meta.directors : list(snapshot.directors),
    imdbRating: meta.imdbRating ?? snapshot.rating ?? null,
    runtime: meta.runtime || "",
    runtimeMinutes: Number(meta.runtimeMinutes || snapshot.runtimeMinutes || 0) || 0,
    country: first(meta.country, snapshot.country),
    language: first(meta.language, snapshot.language),
    logo: first(meta.logo, snapshot.logo)
  };
}
