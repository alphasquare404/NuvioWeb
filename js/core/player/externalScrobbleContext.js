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
function providerIds(context = {}) {
  const raw = String(context?.contentId || context?.itemId || "").trim();
  const prefixed = raw.match(/^(imdb|tmdb|trakt):(.+)$/i);
  const rawImdb = String(context?.imdbId || "").trim();
  const imdb = rawImdb || (/^tt\d+$/i.test(raw) ? raw : "");
  const tmdb =
    Number(context?.tmdbId) > 0
      ? Number(context.tmdbId)
      : prefixed?.[1]?.toLowerCase() === "tmdb"
        ? Number(prefixed[2])
        : 0;
  const trakt =
    Number(context?.traktId) > 0
      ? Number(context.traktId)
      : prefixed?.[1]?.toLowerCase() === "trakt"
        ? Number(prefixed[2])
        : 0;
  return {
    imdbId: /^tt\d+$/i.test(imdb) ? imdb : null,
    tmdbId: Number.isFinite(tmdb) && tmdb > 0 ? tmdb : null,
    traktId: Number.isFinite(trakt) && trakt > 0 ? trakt : null
  };
}

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
  // A title identified only as `tmdb:123` or `trakt:45` used to reach the
  // services with every id field null, so the provider dropped the event while
  // the completion path had already skipped its history fallback. The content
  // id is parsed here, and the handoff context's own ids are honoured when it
  // carries them.
  const ids = providerIds(context);
  return {
    contentId,
    videoId: String(context?.videoId || ""),
    contentType: isSeries ? "series" : "movie",
    imdbId: ids.imdbId,
    tmdbId: ids.tmdbId,
    traktId: ids.traktId,
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
