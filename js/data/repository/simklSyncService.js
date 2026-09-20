import { LocalStore } from "../../core/storage/localStore.js";
import { ProfileManager } from "../../core/profile/profileManager.js";
import { SimklAnimeIdPreference, TraktSettingsStore } from "../local/traktSettingsStore.js";
import { SimklAuthService } from "./simklAuthService.js";
import { simklRequest } from "./simklAuthService.js";

const STORE_KEY = "simklSyncState";
const AUTOMATIC_REFRESH_INTERVAL_MS = 15 * 60 * 1000;
const EXTENDED_QUERY =
  "extended=full_anime_seasons&episode_watched_at=yes&episode_tvdb_id=yes&include_all_episodes=yes&language=en";
const STATUS_DEFINITIONS = [
  { status: "watching", key: "simkl:status:watching", title: "Watching", types: ["series"] },
  {
    status: "plantowatch",
    key: "simkl:status:plantowatch",
    title: "Plan to Watch",
    types: ["movie", "series"]
  },
  { status: "hold", key: "simkl:status:hold", title: "On Hold", types: ["series"] },
  {
    status: "completed",
    key: "simkl:status:completed",
    title: "Completed",
    types: ["movie", "series"],
    membershipDestination: false
  },
  {
    status: "dropped",
    key: "simkl:status:dropped",
    title: "Dropped",
    types: ["movie", "series"]
  }
];

let refreshInFlight = null;

function activeProfileId() {
  return String(ProfileManager.getActiveProfileId() || "1");
}

function emptySnapshot() {
  return {
    schemaVersion: 1,
    initialized: false,
    watermark: null,
    activities: null,
    entries: [],
    playback: [],
    lastSyncedAt: 0,
    lastCheckedAt: 0
  };
}

function readEnvelope() {
  const stored = LocalStore.get(STORE_KEY, null);
  return stored && typeof stored === "object" && stored.profiles
    ? stored
    : { version: 1, profiles: {} };
}

function getSnapshot(profileId = activeProfileId()) {
  const stored = readEnvelope().profiles[String(profileId)];
  return stored && typeof stored === "object"
    ? {
        ...emptySnapshot(),
        ...stored,
        entries: stored.entries || [],
        playback: stored.playback || []
      }
    : emptySnapshot();
}

function saveSnapshot(snapshot, profileId = activeProfileId()) {
  const envelope = readEnvelope();
  envelope.profiles[String(profileId)] = snapshot;
  LocalStore.set(STORE_KEY, envelope);
  return snapshot;
}

function clearSnapshot(profileId = activeProfileId()) {
  const envelope = readEnvelope();
  delete envelope.profiles[String(profileId)];
  LocalStore.set(STORE_KEY, envelope);
}

function mediaForEntry(entry = {}) {
  return entry.movie || entry.show || null;
}

function idValue(ids = {}, key) {
  const value = ids?.[key];
  if (value == null || value === "") return null;
  return String(value);
}

function simklId(ids = {}) {
  return idValue(ids, "simkl") || idValue(ids, "simkl_id");
}

function canonicalContentId(media = {}, mediaType = "shows") {
  const ids = media.ids || {};
  const preference = TraktSettingsStore.get().simklAnimeIdPreference;
  if (mediaType === "anime") {
    if (preference === SimklAnimeIdPreference.MAL) {
      if (idValue(ids, "mal")) return `mal:${idValue(ids, "mal")}`;
      if (idValue(ids, "kitsu")) return `kitsu:${idValue(ids, "kitsu")}`;
      if (idValue(ids, "anidb")) return `anidb:${idValue(ids, "anidb")}`;
    }
    if (preference === SimklAnimeIdPreference.KITSU) {
      if (idValue(ids, "kitsu")) return `kitsu:${idValue(ids, "kitsu")}`;
      if (idValue(ids, "mal")) return `mal:${idValue(ids, "mal")}`;
      if (idValue(ids, "anidb")) return `anidb:${idValue(ids, "anidb")}`;
    }
  }
  if (idValue(ids, "imdb")) return idValue(ids, "imdb");
  for (const key of ["tmdb", "tvdb", "mal", "anidb", "anilist", "kitsu", "simkl"]) {
    const value = key === "simkl" ? simklId(ids) : idValue(ids, key);
    if (value) return `${key}:${value}`;
  }
  return null;
}

function entryMediaType(entry = {}) {
  if (entry.mediaType === "movies") return "movie";
  if (
    entry.mediaType === "anime" &&
    String(entry.anime_type || entry.animeType || "") === "movie"
  ) {
    return "movie";
  }
  return "series";
}

function entryStableKey(entry = {}) {
  const media = mediaForEntry(entry);
  if (!media) return null;
  const stableId = simklId(media.ids) || canonicalContentId(media, entry.mediaType);
  return stableId ? `${entry.mediaType || "shows"}:${stableId}` : null;
}

function flattenAllItems(payload = {}) {
  const entries = [];
  for (const type of ["shows", "movies", "anime"]) {
    const values = Array.isArray(payload?.[type]) ? payload[type] : [];
    values.forEach((entry) => entries.push({ ...entry, mediaType: type }));
  }
  return entries;
}

function mergeDelta(current = [], payload = {}) {
  const byKey = new Map();
  current.forEach((entry) => {
    const key = entryStableKey(entry);
    if (key) byKey.set(key, entry);
  });
  flattenAllItems(payload).forEach((entry) => {
    const key = entryStableKey(entry);
    if (key) byKey.set(key, entry);
  });
  return Array.from(byKey.values());
}

function reconcileCurrentIds(current = [], payload = {}) {
  const allowed = new Set(flattenAllItems(payload).map(entryStableKey).filter(Boolean));
  return current.filter((entry) => allowed.has(entryStableKey(entry)));
}

function domain(activities = {}, type) {
  return type === "shows" ? activities?.tv_shows || {} : activities?.[type] || {};
}

function anyDomainChanged(before, after, fields) {
  return ["shows", "movies", "anime"].some((type) =>
    fields.some((field) => domain(before, type)?.[field] !== domain(after, type)?.[field])
  );
}

async function fetchAllItems(path, profileId) {
  const { payload } = await simklRequest(path, { profileId });
  return payload && typeof payload === "object" && !Array.isArray(payload) ? payload : {};
}

async function initialSync(profileId) {
  const entries = [];
  for (const type of ["shows", "movies", "anime"]) {
    const payload = await fetchAllItems(`/sync/all-items/${type}?${EXTENDED_QUERY}`, profileId);
    entries.push(...flattenAllItems(payload).filter((entry) => entry.mediaType === type));
  }
  const { payload: playback } = await simklRequest("/sync/playback", { profileId });
  const { payload: activities } = await simklRequest("/sync/activities", { profileId });
  const now = Date.now();
  return {
    schemaVersion: 1,
    initialized: true,
    watermark: activities?.all || null,
    activities: activities || null,
    entries: Array.from(
      new Map(
        entries.map((entry) => [entryStableKey(entry), entry]).filter(([key]) => Boolean(key))
      ).values()
    ),
    playback: Array.isArray(playback) ? playback : [],
    lastSyncedAt: now,
    lastCheckedAt: now
  };
}

async function incrementalSync(current, profileId) {
  const { payload: activities } = await simklRequest("/sync/activities", { profileId });
  if (activities?.settings?.all && activities.settings.all !== current.activities?.settings?.all) {
    await SimklAuthService.fetchUserSettings(profileId).catch(() => null);
  }
  if (activities?.all && activities.all === current.watermark) {
    return { ...current, activities, lastCheckedAt: Date.now() };
  }
  if (!current.watermark) return initialSync(profileId);
  let entries = current.entries || [];
  if (
    anyDomainChanged(current.activities, activities, [
      "rated_at",
      "plantowatch",
      "watching",
      "completed",
      "hold",
      "dropped"
    ])
  ) {
    const payload = await fetchAllItems(
      `/sync/all-items?date_from=${encodeURIComponent(current.watermark)}&${EXTENDED_QUERY}`,
      profileId
    );
    entries = mergeDelta(entries, payload);
  }
  if (anyDomainChanged(current.activities, activities, ["removed_from_list"])) {
    entries = reconcileCurrentIds(
      entries,
      await fetchAllItems("/sync/all-items?extended=simkl_ids_only", profileId)
    );
  }
  let playback = current.playback || [];
  if (anyDomainChanged(current.activities, activities, ["playback"])) {
    const result = await simklRequest("/sync/playback", { profileId });
    playback = Array.isArray(result.payload) ? result.payload : [];
  }
  const now = Date.now();
  return {
    ...current,
    watermark: activities?.all || current.watermark,
    activities: activities || current.activities,
    entries,
    playback,
    lastSyncedAt: now,
    lastCheckedAt: now
  };
}

function posterUrl(media = {}) {
  const path = String(media.poster || "").replace(/^\/+|\/+$/g, "");
  return path
    ? `https://wsrv.nl/?url=${encodeURIComponent(`https://simkl.in/posters/${path}_ca.webp`)}&q=90`
    : null;
}

function parseDate(value, fallback = 0) {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function statusDefinitionForEntry(entry) {
  return STATUS_DEFINITIONS.find((definition) => definition.status === entry?.status) || null;
}

function toLibraryEntry(entry, snapshot) {
  const media = mediaForEntry(entry);
  const definition = statusDefinitionForEntry(entry);
  if (!media || !definition) return null;
  const contentId = canonicalContentId(media, entry.mediaType);
  if (!contentId) return null;
  const type = entryMediaType(entry);
  return {
    id: contentId,
    type,
    name: String(media.title || contentId),
    poster: posterUrl(media),
    background: null,
    description: "",
    releaseInfo: media.year == null ? "" : String(media.year),
    imdbRating: null,
    genres: [],
    addonBaseUrl: null,
    listKeys: [definition.key],
    listedAt:
      parseDate(entry.added_to_watchlist_at) ||
      parseDate(entry.last_watched_at) ||
      snapshot.lastSyncedAt ||
      0,
    traktRank: null,
    listMeta: {
      [definition.key]: {
        listedAt:
          parseDate(entry.added_to_watchlist_at) ||
          parseDate(entry.last_watched_at) ||
          snapshot.lastSyncedAt ||
          0,
        traktRank: null
      }
    },
    imdbId: idValue(media.ids, "imdb"),
    tmdbId: Number(idValue(media.ids, "tmdb")) || null,
    simklId: Number(simklId(media.ids)) || null,
    year: media.year == null ? null : Number(media.year),
    trackingProviderId: "simkl"
  };
}

function aliasesForMedia(media = {}, mediaType = "shows") {
  const aliases = new Set();
  const canonical = canonicalContentId(media, mediaType);
  if (canonical) aliases.add(canonical.toLowerCase());
  const ids = media.ids || {};
  for (const key of ["imdb", "tmdb", "tvdb", "mal", "anidb", "anilist", "kitsu", "simkl"]) {
    const value = key === "simkl" ? simklId(ids) : idValue(ids, key);
    if (!value) continue;
    aliases.add((key === "imdb" ? value : `${key}:${value}`).toLowerCase());
  }
  return aliases;
}

function parseContentId(contentId) {
  const raw = String(contentId || "").trim();
  if (!raw) return {};
  if (/^tt\d+$/i.test(raw)) return { imdb: raw };
  const match = raw.match(/^(simkl|imdb|tmdb|tvdb|mal|anidb|anilist|kitsu):(.+)$/i);
  return match ? { [match[1].toLowerCase()]: match[2] } : {};
}

function findEntry(snapshot, item = {}) {
  const candidates = [item.itemId, item.id, item.contentId, item.imdbId && String(item.imdbId)]
    .filter(Boolean)
    .map((value) => String(value).toLowerCase());
  return (snapshot.entries || []).find((entry) => {
    const media = mediaForEntry(entry);
    if (!media) return false;
    const aliases = aliasesForMedia(media, entry.mediaType);
    return candidates.some((candidate) => aliases.has(candidate));
  });
}

function externalIds(item = {}, fallbackEntry = null) {
  const parsed = parseContentId(item.itemId || item.id || item.contentId);
  const media = mediaForEntry(fallbackEntry || {}) || {};
  const values = {
    simkl: item.simklId ?? parsed.simkl ?? simklId(media.ids),
    imdb: item.imdbId || parsed.imdb || idValue(media.ids, "imdb"),
    tmdb: item.tmdbId ?? parsed.tmdb ?? idValue(media.ids, "tmdb"),
    tvdb: item.tvdbId ?? parsed.tvdb ?? idValue(media.ids, "tvdb"),
    mal: item.malId ?? parsed.mal ?? idValue(media.ids, "mal"),
    anidb: item.anidbId ?? parsed.anidb ?? idValue(media.ids, "anidb"),
    anilist: item.anilistId ?? parsed.anilist ?? idValue(media.ids, "anilist"),
    kitsu: item.kitsuId ?? parsed.kitsu ?? idValue(media.ids, "kitsu")
  };
  return Object.fromEntries(
    Object.entries(values)
      .filter(([, value]) => value != null && value !== "")
      .map(([key, value]) => [
        key,
        /^\d+$/.test(String(value)) && key !== "imdb" ? Number(value) : value
      ])
  );
}

function mutationMedia(item = {}, fallbackEntry = null) {
  const media = mediaForEntry(fallbackEntry || {}) || {};
  return {
    title: item.title || item.name || media.title || undefined,
    year: item.year == null ? media.year : Number(item.year),
    ids: externalIds(item, fallbackEntry)
  };
}

function isMovieItem(item = {}, fallbackEntry = null) {
  if (fallbackEntry) return entryMediaType(fallbackEntry) === "movie";
  return (
    String(item.itemType || item.type || item.contentType || "movie").toLowerCase() === "movie"
  );
}

function historyMutationBody(item, fallbackEntry, includeWatchedAt) {
  const animeVideo = String(item.videoId || "").match(/^(mal|anidb|anilist|kitsu):(\d+):(\d+)/i);
  const media = animeVideo
    ? {
        title: item.title || mediaForEntry(fallbackEntry || {})?.title || undefined,
        year: item.year == null ? mediaForEntry(fallbackEntry || {})?.year : Number(item.year),
        ids: { [animeVideo[1].toLowerCase()]: Number(animeVideo[2]) }
      }
    : mutationMedia(item, fallbackEntry);
  const watchedAt = includeWatchedAt ? new Date(item.watchedAt || Date.now()).toISOString() : null;
  if (isMovieItem(item, fallbackEntry)) {
    return { movies: [{ ...media, ...(watchedAt ? { watched_at: watchedAt } : {}) }], shows: [] };
  }
  const season = animeVideo ? null : item.season == null ? null : Number(item.season);
  const episode = animeVideo
    ? Number(animeVideo[3])
    : item.episode == null
      ? null
      : Number(item.episode);
  if (episode == null) {
    return {
      movies: [],
      shows: [{ ...media, ...(includeWatchedAt ? { status: "completed" } : {}) }]
    };
  }
  const episodeValue = {
    number: episode,
    ...(watchedAt ? { watched_at: watchedAt } : {})
  };
  return {
    movies: [],
    shows: [
      season == null
        ? { ...media, episodes: [episodeValue] }
        : { ...media, seasons: [{ number: season, episodes: [episodeValue] }] }
    ]
  };
}

function progressFromPlayback(session, snapshot) {
  const media = session?.movie || session?.anime || session?.show;
  if (!media) return null;
  const mediaType = session.movie ? "movies" : session.anime ? "anime" : "shows";
  const isMovie = Boolean(session.movie || (session.anime && !session.episode));
  const contentId = canonicalContentId(media, mediaType);
  if (!contentId) return null;
  const episode = session.episode || {};
  const seasonNumber = episode.tvdb_season ?? episode.season ?? null;
  const episodeNumber = episode.tvdb_number ?? episode.number ?? null;
  if (!isMovie && episodeNumber == null) return null;
  const progress = Math.max(0, Math.min(100, Number(session.progress || 0)));
  const durationMs = Math.max(0, Number(media.runtime || 0)) * 60000;
  return {
    contentId,
    videoId: isMovie ? contentId : `${contentId}:${seasonNumber || 0}:${episodeNumber}`,
    contentType: isMovie ? "movie" : "series",
    title: String(media.title || contentId),
    year: media.year == null ? null : Number(media.year),
    imdbId: idValue(media.ids, "imdb"),
    tmdbId: Number(idValue(media.ids, "tmdb")) || null,
    source: "simkl_playback",
    updatedAt: parseDate(session.paused_at || session.watched_at, snapshot.lastSyncedAt),
    positionMs: durationMs ? Math.round((durationMs * progress) / 100) : 0,
    durationMs,
    progressPercent: progress,
    profileId: activeProfileId(),
    season: seasonNumber == null ? null : Number(seasonNumber),
    episode: episodeNumber == null ? null : Number(episodeNumber),
    seasonNumber: seasonNumber == null ? null : Number(seasonNumber),
    episodeNumber: episodeNumber == null ? null : Number(episodeNumber),
    episodeTitle: episode.title || null,
    poster: posterUrl(media),
    simklPlaybackId: session.id == null ? null : Number(session.id),
    trackingProviderId: "simkl"
  };
}

function watchedProjection(snapshot) {
  const items = [];
  const historyItems = [];
  const watchedShowSeedItems = [];
  (snapshot.entries || []).forEach((entry) => {
    const media = mediaForEntry(entry);
    if (!media) return;
    const contentId = canonicalContentId(media, entry.mediaType);
    if (!contentId) return;
    const type = entryMediaType(entry);
    const base = {
      contentId,
      contentType: type,
      title: String(media.title || contentId),
      poster: posterUrl(media),
      year: media.year == null ? null : Number(media.year),
      imdbId: idValue(media.ids, "imdb"),
      tmdbId: Number(idValue(media.ids, "tmdb")) || null,
      trackingProviderId: "simkl"
    };
    if (type === "movie") {
      if (entry.last_watched_at || entry.status === "completed") {
        const watchedAt = parseDate(entry.last_watched_at, snapshot.lastSyncedAt);
        items.push({ ...base, watchedAt });
        historyItems.push({
          ...base,
          videoId: contentId,
          source: "simkl_history",
          updatedAt: watchedAt,
          positionMs: 0,
          durationMs: 0,
          progressPercent: 100,
          profileId: activeProfileId()
        });
      }
      return;
    }
    if (["hold", "dropped"].includes(entry.status)) return;
    (entry.seasons || []).forEach((season) => {
      (season?.episodes || []).forEach((episode) => {
        if (!episode?.watched_at) return;
        const seasonNumber = Number(episode.tvdb?.season ?? season.number ?? 0);
        const episodeNumber = Number(episode.tvdb?.episode ?? episode.number ?? 0);
        if (episodeNumber <= 0) return;
        const watchedAt = parseDate(episode.watched_at, snapshot.lastSyncedAt);
        const watched = {
          ...base,
          season: seasonNumber,
          episode: episodeNumber,
          watchedAt
        };
        items.push(watched);
        watchedShowSeedItems.push({
          ...base,
          videoId: `${contentId}:${seasonNumber}:${episodeNumber}`,
          source: "simkl_history",
          updatedAt: watchedAt,
          positionMs: 1,
          durationMs: 1,
          progressPercent: 100,
          profileId: activeProfileId(),
          season: seasonNumber,
          episode: episodeNumber,
          seasonNumber,
          episodeNumber
        });
      });
    });
  });
  return { items, historyItems, watchedShowSeedItems };
}

function reconciledPlaybackProgress(snapshot, watchedItems) {
  return (snapshot.playback || [])
    .map((session) => progressFromPlayback(session, snapshot))
    .filter(Boolean)
    .filter((progress) => {
      const entry = findEntry(snapshot, progress);
      if (["hold", "dropped"].includes(entry?.status)) return false;
      return !watchedItems.some(
        (watched) =>
          String(watched.contentId || "").toLowerCase() ===
            String(progress.contentId || "").toLowerCase() &&
          (watched.season ?? null) === (progress.season ?? null) &&
          (watched.episode ?? null) === (progress.episode ?? null) &&
          Number(watched.watchedAt || 0) >= Number(progress.updatedAt || 0)
      );
    });
}

export const SimklSyncService = {
  statusDefinitions: STATUS_DEFINITIONS,

  getSnapshot,

  async refresh({ force = false } = {}) {
    if (!SimklAuthService.isAuthenticated()) return false;
    const profileId = activeProfileId();
    const current = getSnapshot(profileId);
    if (
      !force &&
      current.lastCheckedAt &&
      Date.now() - current.lastCheckedAt < AUTOMATIC_REFRESH_INTERVAL_MS
    ) {
      return false;
    }
    if (refreshInFlight?.profileId === profileId) return refreshInFlight.promise;
    const promise = (
      current.initialized ? incrementalSync(current, profileId) : initialSync(profileId)
    )
      .then((snapshot) => {
        if (activeProfileId() !== profileId) return false;
        saveSnapshot(snapshot, profileId);
        return true;
      })
      .finally(() => {
        if (refreshInFlight?.promise === promise) refreshInFlight = null;
      });
    refreshInFlight = { profileId, promise };
    return promise;
  },

  clearCurrentProfile() {
    clearSnapshot();
  },

  async getLibraryTabs() {
    await this.refresh().catch(() => false);
    return STATUS_DEFINITIONS.map((definition) => ({
      key: definition.key,
      title: definition.title,
      type: definition.status === "plantowatch" ? "watchlist" : "status",
      trackingProviderId: "simkl",
      selectionGroup: "simkl:status",
      supportedContentTypes: definition.types,
      isMembershipDestination: definition.membershipDestination !== false
    }));
  },

  async getLibraryEntries() {
    await this.refresh().catch(() => false);
    const snapshot = getSnapshot();
    return snapshot.entries
      .map((entry) => toLibraryEntry(entry, snapshot))
      .filter(Boolean)
      .sort((left, right) => right.listedAt - left.listedAt);
  },

  async getMembershipSnapshot(item) {
    await this.refresh().catch(() => false);
    const entry = findEntry(getSnapshot(), item);
    const selected = statusDefinitionForEntry(entry)?.key || null;
    return {
      listMembership: Object.fromEntries(
        STATUS_DEFINITIONS.map((definition) => [definition.key, definition.key === selected])
      )
    };
  },

  async applyMembershipChanges(item, changes, { destructiveRemovalConfirmed = false } = {}) {
    const profileId = activeProfileId();
    const snapshot = getSnapshot(profileId);
    const entry = findEntry(snapshot, item);
    const desired = STATUS_DEFINITIONS.filter(
      (definition) => changes?.desiredMembership?.[definition.key] === true
    );
    if (desired.length > 1) throw new Error("A Simkl item can have only one list status");
    const destination = desired[0] || null;
    if (destination && destination.membershipDestination === false) {
      throw new Error("Completed is managed by watched history");
    }
    if (!destination) {
      const hasHistory = Boolean(
        entry &&
        (entry.last_watched_at ||
          entry.user_rating != null ||
          (entry.seasons || []).some((season) =>
            (season.episodes || []).some((episode) => episode.watched_at)
          ))
      );
      if (hasHistory && !destructiveRemovalConfirmed) {
        const error = new Error(
          "Removing this Simkl status would also clear watched history or a rating"
        );
        error.code = "SIMKL_DESTRUCTIVE_REMOVAL_REQUIRED";
        throw error;
      }
      await simklRequest("/sync/history/remove", {
        method: "POST",
        body: historyMutationBody(item, entry, false),
        profileId
      });
      snapshot.entries = snapshot.entries.filter((candidate) => candidate !== entry);
    } else {
      const media = { ...mutationMedia(item, entry), to: destination.status };
      await simklRequest("/sync/add-to-list", {
        method: "POST",
        body: isMovieItem(item, entry)
          ? { movies: [media], shows: [] }
          : { movies: [], shows: [media] },
        profileId
      });
      if (entry) entry.status = destination.status;
    }
    snapshot.lastCheckedAt = 0;
    saveSnapshot(snapshot, profileId);
    return true;
  },

  async markWatched(item) {
    const profileId = activeProfileId();
    const snapshot = getSnapshot(profileId);
    const entry = findEntry(snapshot, item);
    await simklRequest("/sync/history", {
      method: "POST",
      body: historyMutationBody(item, entry, true),
      profileId
    });
    snapshot.lastCheckedAt = 0;
    saveSnapshot(snapshot, profileId);
  },

  async unmarkWatched(item) {
    const profileId = activeProfileId();
    const snapshot = getSnapshot(profileId);
    const entry = findEntry(snapshot, item);
    await simklRequest("/sync/history/remove", {
      method: "POST",
      body: historyMutationBody(item, entry, false),
      profileId
    });
    snapshot.lastCheckedAt = 0;
    saveSnapshot(snapshot, profileId);
  },

  async getProgressSnapshot() {
    await this.refresh().catch(() => false);
    const snapshot = getSnapshot();
    const watched = watchedProjection(snapshot);
    return {
      historyItems: watched.historyItems,
      playbackItems: reconciledPlaybackProgress(snapshot, watched.items),
      watchedShowSeedItems: watched.watchedShowSeedItems
    };
  },

  async getWatchedItems() {
    await this.refresh().catch(() => false);
    return watchedProjection(getSnapshot()).items;
  },

  findEntry,
  externalIds,
  mutationMedia,
  isMovieItem
};
