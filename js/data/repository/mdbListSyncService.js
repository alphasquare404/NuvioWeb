import { MdbListAuthService } from "./mdbListAuthService.js";
import { ProfileManager } from "../../core/profile/profileManager.js";
import { WATCH_PROGRESS_COMPLETED_THRESHOLD } from "../../domain/model/watchProgress.js";

const SNAPSHOT_TTL_MS = 30_000;
const WATCHED_LIMIT = 1000;

let snapshotCache = null;
let snapshotInFlight = null;

function activeProfileId() {
  return String(ProfileManager.getActiveProfileId() || "1");
}

function parseTimestamp(value) {
  if (value == null || value === "") return 0;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function numberOrNull(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function firstNonEmpty(...values) {
  for (const value of values) {
    const normalized = String(value ?? "").trim();
    if (normalized) return normalized;
  }
  return "";
}

function canonicalContentId(ids = {}) {
  const imdb = firstNonEmpty(ids.imdb, ids.imdbid);
  if (/^tt\d+$/i.test(imdb)) return imdb;
  const tmdb = numberOrNull(ids.tmdb ?? ids.tmdbid);
  if (tmdb > 0) return `tmdb:${tmdb}`;
  const tvdb = numberOrNull(ids.tvdb ?? ids.tvdbid);
  if (tvdb > 0) return `tvdb:${tvdb}`;
  const trakt = numberOrNull(ids.trakt);
  if (trakt > 0) return `trakt:${trakt}`;
  const mdblist = firstNonEmpty(ids.mdblist);
  if (mdblist) return `mdblist:${mdblist}`;
  return "";
}

function mediaFields(media = {}, fallbackTitle = "") {
  const ids = media?.ids && typeof media.ids === "object" ? media.ids : {};
  return {
    contentId: canonicalContentId(ids),
    title: firstNonEmpty(media?.title, media?.name, fallbackTitle),
    year: numberOrNull(media?.year ?? media?.release_year),
    imdbId: firstNonEmpty(ids.imdb, ids.imdbid) || null,
    tmdbId: numberOrNull(ids.tmdb ?? ids.tmdbid),
    traktId: numberOrNull(ids.trakt),
    ids
  };
}

function episodeFields(episode = {}, show = {}) {
  const season = numberOrNull(episode?.season ?? episode?.season_number);
  const number = numberOrNull(episode?.number ?? episode?.episode ?? episode?.episode_number);
  if (season == null || season < 0 || number == null || number < 1) {
    return null;
  }
  const showFields = mediaFields(show);
  if (!showFields.contentId) return null;
  const episodeIds = episode?.ids && typeof episode.ids === "object" ? episode.ids : {};
  return {
    ...showFields,
    contentType: "series",
    season,
    episode: number,
    seasonNumber: season,
    episodeNumber: number,
    episodeTitle: firstNonEmpty(episode?.title, episode?.name),
    episodeTmdbId: numberOrNull(episodeIds.tmdb ?? episodeIds.tmdbid),
    episodeTvdbId: numberOrNull(episodeIds.tvdb ?? episodeIds.tvdbid),
    videoId:
      numberOrNull(episodeIds.tmdb ?? episodeIds.tmdbid) > 0
        ? `tmdb:${numberOrNull(episodeIds.tmdb ?? episodeIds.tmdbid)}`
        : `${showFields.contentId}:s${season}e${number}`
  };
}

function baseProgressItem(fields, source) {
  return {
    ...fields,
    contentType: fields.contentType || "movie",
    videoId: fields.videoId || fields.contentId,
    source,
    profileId: activeProfileId()
  };
}

export function parseMdbListPlayback(payload) {
  const rows = Array.isArray(payload) ? payload : [];
  return rows
    .map((row) => {
      if (!row || typeof row !== "object") return null;
      const type = String(row.type || "").toLowerCase();
      const progress = Number(row.progress);
      if (!Number.isFinite(progress) || progress <= 0 || progress > 100) return null;
      // MDBList keeps a session from its first nonzero position. Applying the
      // app's 2% "started" threshold here discarded real 1% sessions that
      // MDBList already showed as Continue Watching.
      if (progress / 100 >= WATCH_PROGRESS_COMPLETED_THRESHOLD) return null;
      const updatedAt = parseTimestamp(row.paused_at ?? row.updated_at);
      if (!updatedAt) return null;
      let fields;
      let scrobbleBody;
      if (type === "episode") {
        const episode = row.episode || {};
        const show = row.show || episode.show || {};
        const episodeIdentity = episodeFields(episode, show);
        if (!episodeIdentity) return null;
        fields = episodeIdentity;
        scrobbleBody = {
          show: {
            ids: episodeIdentity.ids,
            season: episodeIdentity.season,
            episode: episodeIdentity.episode
          }
        };
      } else {
        const movie = row.movie || {};
        const movieFields = mediaFields(movie);
        if (!movieFields.contentId) return null;
        fields = movieFields;
        scrobbleBody = { movie: { ids: movieFields.ids } };
      }
      const runtimeMinutes = numberOrNull(row.runtime);
      const durationMs = runtimeMinutes != null && runtimeMinutes > 0 ? runtimeMinutes * 60_000 : 0;
      const positionMs = durationMs > 0 ? Math.round((durationMs * progress) / 100) : 0;
      return {
        ...baseProgressItem(fields, "mdblist_playback"),
        mdbListPlaybackId: numberOrNull(row.id),
        mdbListScrobbleBody: scrobbleBody,
        updatedAt,
        positionMs,
        durationMs,
        progressPercent: progress
      };
    })
    .filter(Boolean);
}

function watchedItem(fields, watchedAt, source = "mdblist_history") {
  if (!fields?.contentId) return null;
  return {
    ...baseProgressItem(fields, source),
    updatedAt: watchedAt || Date.now(),
    positionMs: 0,
    durationMs: 0,
    progressPercent: 100
  };
}

export function parseMdbListWatched(payload) {
  const root = payload && typeof payload === "object" ? payload : {};
  const historyItems = [];
  const watchedShowSeedItems = [];

  (Array.isArray(root.movies) ? root.movies : []).forEach((row) => {
    const fields = mediaFields(row?.movie);
    const item = watchedItem(fields, parseTimestamp(row?.watched_at ?? row?.last_watched_at));
    if (item) historyItems.push(item);
  });

  (Array.isArray(root.episodes) ? root.episodes : []).forEach((row) => {
    const episode = row?.episode || {};
    const fields = episodeFields(episode, episode.show || row?.show || {});
    const item = watchedItem(
      fields,
      parseTimestamp(row?.watched_at ?? row?.last_watched_at ?? episode?.watched_at)
    );
    if (item) historyItems.push(item);
  });

  (Array.isArray(root.shows) ? root.shows : []).forEach((row) => {
    const show = row?.show || {};
    const showFields = mediaFields(show);
    if (!showFields.contentId) return;
    const showWatchedAt = parseTimestamp(row?.watched_at ?? row?.last_watched_at);
    (Array.isArray(row?.seasons) ? row.seasons : []).forEach((season) => {
      const seasonNumber = numberOrNull(season?.number ?? season?.season);
      if (seasonNumber == null || seasonNumber < 0) return;
      (Array.isArray(season?.episodes) ? season.episodes : []).forEach((episode) => {
        const episodeNumber = numberOrNull(episode?.number ?? episode?.episode);
        if (episodeNumber == null || episodeNumber < 1) return;
        const fields = {
          ...showFields,
          contentType: "series",
          season: seasonNumber,
          episode: episodeNumber,
          seasonNumber,
          episodeNumber,
          episodeTitle: firstNonEmpty(episode?.title, episode?.name),
          videoId: `${showFields.contentId}:s${seasonNumber}e${episodeNumber}`
        };
        const updatedAt =
          parseTimestamp(episode?.watched_at ?? episode?.last_watched_at) ||
          showWatchedAt ||
          Date.now();
        const seed = watchedItem(fields, updatedAt, "mdblist_show_progress");
        if (seed) watchedShowSeedItems.push(seed);
      });
    });
  });

  const seen = new Set();
  const dedupe = (items) =>
    items
      .filter((item) => {
        const key = `${item.source}:${item.contentId}:${item.season ?? -1}:${item.episode ?? -1}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((left, right) => Number(right.updatedAt || 0) - Number(left.updatedAt || 0));

  return {
    historyItems: dedupe(historyItems),
    watchedShowSeedItems: dedupe(watchedShowSeedItems)
  };
}

function requestIds(item = {}) {
  const ids = {};
  const imdb = firstNonEmpty(item.imdbId, item.imdb_id);
  if (/^tt\d+$/i.test(imdb)) ids.imdb = imdb;
  const tmdb = numberOrNull(item.tmdbId ?? item.tmdb_id);
  if (tmdb > 0) ids.tmdb = tmdb;
  const trakt = numberOrNull(item.traktId ?? item.trakt_id);
  if (trakt > 0) ids.trakt = trakt;
  const raw = String(item.contentId || item.id || "").trim();
  const prefixed = raw.match(/^(imdb|tmdb|trakt|mdblist):(.+)$/i);
  if (!ids.imdb && prefixed?.[1]?.toLowerCase() === "imdb" && /^tt\d+$/i.test(prefixed[2])) {
    ids.imdb = prefixed[2];
  }
  if (!ids.tmdb && prefixed?.[1]?.toLowerCase() === "tmdb" && Number(prefixed[2]) > 0) {
    ids.tmdb = Number(prefixed[2]);
  }
  if (!ids.trakt && prefixed?.[1]?.toLowerCase() === "trakt" && Number(prefixed[2]) > 0) {
    ids.trakt = Number(prefixed[2]);
  }
  if (!Object.keys(ids).length && prefixed?.[1]?.toLowerCase() === "mdblist") {
    ids.mdblist = prefixed[2];
  }
  if (!Object.keys(ids).length && /^tt\d+$/i.test(raw)) ids.imdb = raw;
  return Object.keys(ids).length ? ids : null;
}

export function buildMdbListHistoryPayload(item = {}, { remove = false } = {}) {
  const ids = requestIds(item);
  if (!ids) return null;
  const isSeries =
    String(item.contentType || item.itemType || item.type || "").toLowerCase() === "series";
  const season = numberOrNull(item.season ?? item.seasonNumber);
  const episode = numberOrNull(item.episode ?? item.episodeNumber);
  const watchedAt = remove
    ? null
    : new Date(Number(item.watchedAt || Date.now()) || Date.now()).toISOString();
  if (!isSeries) {
    return {
      movies: [
        {
          ids,
          ...(item.title || item.name ? { title: item.title || item.name } : {}),
          ...(numberOrNull(item.year) ? { year: numberOrNull(item.year) } : {}),
          ...(watchedAt ? { watched_at: watchedAt } : {})
        }
      ]
    };
  }
  const episodeTmdb = numberOrNull(item.episodeTmdbId);
  const episodeTvdb = numberOrNull(item.episodeTvdbId);
  if (episodeTmdb > 0 || episodeTvdb > 0) {
    return {
      episodes: [
        {
          ids: {
            ...(episodeTmdb > 0 ? { tmdb: episodeTmdb } : {}),
            ...(episodeTvdb > 0 ? { tvdb: episodeTvdb } : {})
          },
          ...(watchedAt ? { watched_at: watchedAt } : {})
        }
      ]
    };
  }
  if (season == null || season < 0 || episode == null || episode < 1) return null;
  return {
    shows: [
      {
        ids,
        ...(item.title || item.name ? { title: item.title || item.name } : {}),
        ...(numberOrNull(item.year) ? { year: numberOrNull(item.year) } : {}),
        seasons: [
          {
            number: season,
            episodes: [
              {
                number: episode,
                ...(watchedAt ? { watched_at: watchedAt } : {})
              }
            ]
          }
        ]
      }
    ]
  };
}

async function fetchSnapshot() {
  if (!MdbListAuthService.isAuthenticated()) {
    return { historyItems: [], playbackItems: [], watchedShowSeedItems: [] };
  }
  const [playbackResult, watchedResult] = await Promise.all([
    MdbListAuthService.apiRequest("/sync/playback").catch((error) => {
      console.warn("[CW] MDBList playback fetch failed", error);
      return null;
    }),
    MdbListAuthService.apiRequest("/sync/watched", {
      query: { limit: WATCHED_LIMIT }
    }).catch((error) => {
      console.warn("[CW] MDBList watched fetch failed", error);
      return null;
    })
  ]);
  if (playbackResult && !playbackResult.response?.ok) {
    console.warn("[CW] MDBList playback request failed", playbackResult.response?.status);
  }
  if (watchedResult && !watchedResult.response?.ok) {
    console.warn("[CW] MDBList watched request failed", watchedResult.response?.status);
  }
  const playbackItems = playbackResult?.response?.ok
    ? parseMdbListPlayback(playbackResult.payload)
    : [];
  const watched = watchedResult?.response?.ok
    ? parseMdbListWatched(watchedResult.payload)
    : { historyItems: [], watchedShowSeedItems: [] };
  return {
    playbackItems,
    historyItems: watched.historyItems,
    watchedShowSeedItems: watched.watchedShowSeedItems
  };
}

export const MdbListSyncService = {
  async getProgressSnapshot({ maxAgeMs = SNAPSHOT_TTL_MS } = {}) {
    if (!MdbListAuthService.isAuthenticated()) {
      return { historyItems: [], playbackItems: [], watchedShowSeedItems: [] };
    }
    const now = Date.now();
    if (
      snapshotCache &&
      snapshotCache.profileId === activeProfileId() &&
      now - Number(snapshotCache.fetchedAt || 0) < maxAgeMs
    ) {
      return snapshotCache.snapshot;
    }
    if (snapshotInFlight) return snapshotInFlight;
    snapshotInFlight = fetchSnapshot()
      .then((snapshot) => {
        snapshotCache = {
          profileId: activeProfileId(),
          fetchedAt: Date.now(),
          snapshot
        };
        return snapshot;
      })
      .finally(() => {
        snapshotInFlight = null;
      });
    return snapshotInFlight;
  },

  async refresh({ force = true } = {}) {
    if (force) snapshotCache = null;
    return this.getProgressSnapshot({ maxAgeMs: 0 });
  },

  clearCache() {
    snapshotCache = null;
  },

  async getWatchedItems({ allowStale = false } = {}) {
    const snapshot = await this.getProgressSnapshot({ maxAgeMs: allowStale ? SNAPSHOT_TTL_MS : 0 });
    return (snapshot.historyItems || []).map((item) => ({
      ...item,
      watchedAt: Number(item.updatedAt || item.watchedAt || 0) || Date.now()
    }));
  },

  async markWatched(item = {}) {
    const body = buildMdbListHistoryPayload(item, { remove: false });
    if (!body) return false;
    const { response } = await MdbListAuthService.apiRequest("/sync/watched", {
      method: "POST",
      query: { report_added: "true" },
      body
    });
    snapshotCache = null;
    return response.ok;
  },

  async unmarkWatched(item = {}) {
    const body = buildMdbListHistoryPayload(item, { remove: true });
    if (!body) return false;
    const { response } = await MdbListAuthService.apiRequest("/sync/watched/remove", {
      method: "POST",
      body
    });
    snapshotCache = null;
    return response.ok;
  },

  async removePlaybackForContent(contentId) {
    const snapshot = await this.getProgressSnapshot({ maxAgeMs: 0 });
    const matches = (snapshot.playbackItems || []).filter(
      (item) => String(item?.contentId || "") === String(contentId || "")
    );
    let deleted = 0;
    let failed = 0;
    for (const item of matches) {
      if (!item.mdbListScrobbleBody) {
        failed += 1;
        continue;
      }
      try {
        const { response } = await MdbListAuthService.apiRequest("/scrobble/clear", {
          method: "POST",
          body: item.mdbListScrobbleBody
        });
        if (response.ok) deleted += 1;
        else failed += 1;
      } catch {
        failed += 1;
      }
    }
    snapshotCache = null;
    return { attempted: matches.length, deleted, failed };
  }
};
