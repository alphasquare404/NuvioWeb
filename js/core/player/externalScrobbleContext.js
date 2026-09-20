/**
 * Map a player progress context plus a reported position into the shape the
 * scrobble services expect.
 *
 * An external player (Outplayer/Infuse/Lenna) reports where the user actually
 * got to, but the built-in player never ran a scrobble session for it, so that
 * position only ever reached the local store. A tracking provider records a
 * partial position from a scrobble stop below its watched threshold, which is
 * exactly what a terminal external report is.
 */
export function buildExternalScrobbleContext(context, positionMs, durationMs) {
  const contentId = String(context?.itemId || "").trim();
  const position = Math.max(0, Number(positionMs) || 0);
  const duration = Math.max(0, Number(durationMs) || 0);
  if (!contentId || position <= 0 || duration <= 0) {
    return null;
  }
  const itemType = String(context?.itemType || "movie")
    .trim()
    .toLowerCase();
  const isSeries = itemType === "series" || itemType === "tv";
  const episodeNumber = Number.isFinite(context?.episode) ? Number(context.episode) : null;
  // A series with no episode number has nothing a provider can record against,
  // and the services would drop it anyway.
  if (isSeries && !episodeNumber) {
    return null;
  }
  return {
    contentId,
    videoId: String(context?.videoId || ""),
    contentType: isSeries ? "series" : "movie",
    imdbId: contentId.startsWith("tt") ? contentId : null,
    tmdbId: null,
    traktId: null,
    title: String(context?.title || ""),
    year: null,
    seasonNumber: isSeries && Number.isFinite(context?.season) ? Number(context.season) : null,
    episodeNumber: isSeries ? episodeNumber : null,
    episodeTitle: String(context?.episodeTitle || ""),
    positionMs: Math.round(position),
    durationMs: Math.round(duration),
    progressPercent: Math.min(100, (position / duration) * 100)
  };
}
