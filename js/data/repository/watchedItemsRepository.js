import { WatchedItemsStore } from "../local/watchedItemsStore.js";
import { ProfileManager } from "../../core/profile/profileManager.js";
import { TraktSettingsStore, WatchProgressSource } from "../local/traktSettingsStore.js";
import { SimklAuthStore } from "../local/simklAuthStore.js";
import { SimklSyncService } from "./simklSyncService.js";
import { TraktAuthService, requestJson as traktRequestJson } from "./traktAuthService.js";

function activeProfileId() {
  return String(ProfileManager.getActiveProfileId() || "1");
}

function shouldUseSimkl() {
  return (
    TraktSettingsStore.get().watchProgressSource === WatchProgressSource.SIMKL &&
    SimklAuthStore.isAuthenticated()
  );
}

function shouldUseTrakt() {
  return (
    TraktSettingsStore.get().watchProgressSource === WatchProgressSource.TRAKT &&
    TraktAuthService.isAuthenticated()
  );
}

function traktIds(item = {}) {
  const rawId = String(item.contentId || item.itemId || item.id || "").trim();
  const prefixed = rawId.match(/^(imdb|tmdb|trakt):(.+)$/i);
  const ids = {
    imdb: item.imdbId || (prefixed?.[1]?.toLowerCase() === "imdb" ? prefixed[2] : null),
    tmdb: item.tmdbId ?? (prefixed?.[1]?.toLowerCase() === "tmdb" ? Number(prefixed[2]) : null),
    trakt: item.traktId ?? (prefixed?.[1]?.toLowerCase() === "trakt" ? Number(prefixed[2]) : null)
  };
  if (!ids.imdb && /^tt\d+$/i.test(rawId)) ids.imdb = rawId;
  return Object.fromEntries(
    Object.entries(ids).filter(([, value]) => value != null && value !== "")
  );
}

function traktHistoryBody(item = {}) {
  const ids = traktIds(item);
  if (!Object.keys(ids).length) {
    throw new Error("This item has no Trakt-compatible ID");
  }
  const media = {
    title: item.title || item.name || undefined,
    year: item.year == null ? undefined : Number(item.year),
    ids
  };
  const isEpisode = item.season != null && item.episode != null;
  if (isEpisode) {
    media.seasons = [
      { number: Number(item.season), episodes: [{ number: Number(item.episode) }] }
    ];
  }
  const type = String(item.contentType || item.itemType || item.type || "movie").toLowerCase();
  return ["series", "show", "tv", "anime"].includes(type)
    ? { shows: [media] }
    : { movies: [media] };
}

async function writeTraktHistory(item, remove = false) {
  const token = await TraktAuthService.getValidAccessToken();
  if (!token) throw new Error("Trakt is not connected");
  const { response, payload } = await traktRequestJson(
    remove ? "/sync/history/remove" : "/sync/history",
    {
      method: "POST",
      body: traktHistoryBody(item),
      authorization: `Bearer ${token}`
    }
  );
  if (!response.ok) {
    throw new Error(payload?.message || `Could not update Trakt watched history (${response.status})`);
  }
}

function watchedKey(item = {}) {
  return `${String(item.contentId || "").toLowerCase()}:${item.season ?? ""}:${item.episode ?? ""}`;
}

let watchedItemsSyncTimer = null;
let watchedItemsSyncInFlight = null;

function queueWatchedItemsCloudSync(delayMs = 250) {
  if (watchedItemsSyncTimer) {
    clearTimeout(watchedItemsSyncTimer);
  }
  watchedItemsSyncTimer = setTimeout(() => {
    watchedItemsSyncTimer = null;
    const runPush = async () => {
      if (watchedItemsSyncInFlight) {
        await watchedItemsSyncInFlight.catch(() => false);
      }
      watchedItemsSyncInFlight = import("../../core/profile/watchedItemsSyncService.js")
        .then(({ WatchedItemsSyncService }) => WatchedItemsSyncService.push())
        .catch((error) => {
          console.warn("Watched items cloud sync enqueue failed", error);
          return false;
        })
        .finally(() => {
          watchedItemsSyncInFlight = null;
        });
      await watchedItemsSyncInFlight;
    };
    void runPush();
  }, delayMs);
}

function matchesWatchedTarget(item = {}, contentId, options = null) {
  const targetContentId = String(contentId || "");
  if (!targetContentId || item.contentId !== targetContentId) {
    return false;
  }
  const targetSeason =
    options?.season == null || options?.season === "" ? null : Number(options.season);
  const targetEpisode =
    options?.episode == null || options?.episode === "" ? null : Number(options.episode);
  if (options?.rootOnly === true) {
    return item.season == null && item.episode == null;
  }
  const hasScopedEpisode = targetSeason != null || targetEpisode != null;
  if (!hasScopedEpisode) {
    return true;
  }
  return item.season === targetSeason && item.episode === targetEpisode;
}

async function deleteWatchedItemsFromCloud(items = []) {
  if (!items.length) {
    return false;
  }
  try {
    const { WatchedItemsSyncService } =
      await import("../../core/profile/watchedItemsSyncService.js");
    return WatchedItemsSyncService.deleteItems(items);
  } catch (error) {
    console.warn("Watched items cloud delete failed", error);
    return false;
  }
}

class WatchedItemsRepository {
  async getAll(limit = 2000) {
    const local = WatchedItemsStore.listForProfile(activeProfileId());
    if (!shouldUseSimkl()) return local.slice(0, limit);
    const remote = await SimklSyncService.getWatchedItems().catch(() => []);
    const remoteKeys = new Set(remote.map(watchedKey));
    return [...remote, ...local.filter((item) => !remoteKeys.has(watchedKey(item)))].slice(0, limit);
  }

  async isWatched(contentId, options = {}) {
    const allowEpisodeEntries = Boolean(options?.allowEpisodeEntries);
    const all = await this.getAll();
    return all.some((item) => {
      if (item.contentId !== String(contentId || "")) {
        return false;
      }
      return allowEpisodeEntries || (item.season == null && item.episode == null);
    });
  }

  async mark(item, options = {}) {
    if (!item?.contentId) {
      return;
    }
    if (shouldUseSimkl() && options.skipTrackingWrite !== true) {
      await SimklSyncService.markWatched(item);
    }
    if (shouldUseTrakt() && options.skipTrackingWrite !== true) {
      await writeTraktHistory(item, false);
    }
    WatchedItemsStore.upsert(
      {
        ...item,
        watchedAt: item.watchedAt || Date.now()
      },
      activeProfileId()
    );
    queueWatchedItemsCloudSync();
  }

  async unmark(contentId, options = null) {
    const pid = activeProfileId();
    const removedItems = WatchedItemsStore.listForProfile(pid).filter((item) =>
      matchesWatchedTarget(item, contentId, options)
    );
    if (shouldUseSimkl() && options?.skipTrackingWrite !== true) {
      const remoteMatches = removedItems.length
        ? []
        : (await SimklSyncService.getWatchedItems().catch(() => [])).filter((item) =>
            matchesWatchedTarget(item, contentId, options)
          );
      const targets = removedItems.length
        ? removedItems
        : remoteMatches.length
          ? remoteMatches
          : [
            {
              contentId,
              contentType: options?.contentType || "movie",
              season: options?.season ?? null,
              episode: options?.episode ?? null,
              videoId: options?.videoId || null
            }
            ];
      for (const item of targets) {
        await SimklSyncService.unmarkWatched(item);
      }
    }
    if (shouldUseTrakt() && options?.skipTrackingWrite !== true) {
      const targets = removedItems.length
        ? removedItems
        : [
            {
              contentId,
              contentType: options?.contentType || "movie",
              title: options?.title,
              year: options?.year,
              season: options?.season ?? null,
              episode: options?.episode ?? null,
              videoId: options?.videoId || null,
              imdbId: options?.imdbId,
              tmdbId: options?.tmdbId,
              traktId: options?.traktId
            }
          ];
      for (const item of targets) {
        await writeTraktHistory(item, true);
      }
    }
    WatchedItemsStore.remove(contentId, pid, options);
    await deleteWatchedItemsFromCloud(removedItems);
    queueWatchedItemsCloudSync();
  }

  async replaceAll(items, profileId = activeProfileId()) {
    WatchedItemsStore.replaceForProfile(profileId, items || []);
  }
}

export const watchedItemsRepository = new WatchedItemsRepository();
