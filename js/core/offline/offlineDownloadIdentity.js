function text(value) {
  return String(value || "").trim();
}

function safeIdentityPart(value) {
  return text(value).replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
}

function normalizeContentType(value) {
  const type = text(value).toLowerCase();
  return type === "series" || type === "tv" || type === "episode" ? "episode" : "movie";
}

export function createOfflineMediaId(input = {}) {
  const contentType = normalizeContentType(input.contentType || input.itemType);
  if (contentType === "episode") {
    const seriesId = safeIdentityPart(input.seriesId || input.itemId || input.mediaId);
    const season = Number(input.seasonNumber ?? input.season);
    const episode = Number(input.episodeNumber ?? input.episode);
    if (!seriesId || !Number.isFinite(season) || !Number.isFinite(episode)) return "";
    return `episode-${seriesId}-s${season}-e${episode}`;
  }
  const movieId = safeIdentityPart(input.movieId || input.mediaId || input.itemId || input.tmdbId || input.imdbId);
  return movieId ? `movie-${movieId}` : "";
}

function fingerprintHash(value) {
  let hash = 2166136261;
  for (const character of String(value || "")) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function createOfflineSourceFingerprint(input = {}) {
  const stream = input.stream || input;
  const resolve = stream.clientResolve || stream.raw?.clientResolve || {};
  const hints = stream.behaviorHints || stream.raw?.behaviorHints || {};
  const stableId = stream.infoHash || resolve.infoHash || stream.fileId || resolve.fileId || "";
  const filename = hints.filename || resolve.filename || stream.filename || "";
  const size = hints.videoSize || stream.videoSize || "";
  // Provider alone (or provider + quality) is not a source identity. Require a
  // real stable ID/hash, or a filename-and-size pair, before matching a live row.
  if (!text(stableId) && !(text(filename) && text(size))) return "";
  const fields = [
    stream.addonId || stream.streamOrigin?.addonId || stream.addonName || "",
    stableId,
    resolve.fileIdx ?? stream.fileIdx ?? "",
    filename,
    size,
    stream.quality || stream.qualityValue || ""
  ].map((value) => text(value).toLowerCase().replace(/\s+/g, " "));
  return fields.some(Boolean) ? fields.join("|") : "";
}

export function createOfflineDownloadId(input = {}) {
  const mediaId = createOfflineMediaId(input);
  const fingerprint = text(input.sourceFingerprint || createOfflineSourceFingerprint(input));
  return mediaId && fingerprint ? `offline-${mediaId}-${fingerprintHash(fingerprint)}` : "";
}

export function groupDownloadedSeries(downloads = []) {
  const groups = new Map();
  (downloads || [])
    .filter((download) => download.status === "completed" && download.contentType === "episode")
    .forEach((download) => {
      const key = text(download.seriesId);
      if (!key) return;
      const group = groups.get(key) || {
        seriesId: key,
        title: text(download.seriesTitle || download.title),
        poster: text(download.poster),
        backdrop: text(download.backdrop),
        episodes: []
      };
      group.episodes.push(download);
      groups.set(key, group);
    });
  return Array.from(groups.values()).map((group) => {
    const episodesByIdentity = new Map();
    group.episodes.forEach((episode) => {
      const key = text(
        episode.mediaIdentity ||
          (episode.seasonNumber != null &&
          episode.episodeNumber != null &&
          Number.isFinite(Number(episode.seasonNumber)) &&
          Number.isFinite(Number(episode.episodeNumber))
            ? `${group.seriesId}-s${episode.seasonNumber}-e${episode.episodeNumber}`
            : episode.downloadId)
      );
      if (!key) return;
      const current = episodesByIdentity.get(key);
      if (!current || Number(episode.completedAt || 0) > Number(current.completedAt || 0)) {
        episodesByIdentity.set(key, episode);
      }
    });
    return {
      ...group,
      episodes: Array.from(episodesByIdentity.values()).sort(
        (left, right) =>
          Number(left.seasonNumber || 0) - Number(right.seasonNumber || 0) ||
          Number(left.episodeNumber || 0) - Number(right.episodeNumber || 0)
      )
    };
  });
}

export function groupDownloadedMovies(downloads = []) {
  const movies = new Map();
  (downloads || [])
    .filter((download) => download.status === "completed" && download.contentType === "movie")
    .forEach((download) => {
      const key = text(download.mediaIdentity || download.mediaId || download.movieId || download.downloadId);
      if (!key) return;
      const current = movies.get(key);
      if (!current || Number(download.completedAt || 0) > Number(current.completedAt || 0)) {
        movies.set(key, download);
      }
    });
  return Array.from(movies.values());
}
