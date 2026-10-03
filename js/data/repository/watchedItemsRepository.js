import { WatchedItemsStore } from "../local/watchedItemsStore.js";
import { ProfileManager } from "../../core/profile/profileManager.js";
import { LocalStore } from "../../core/storage/localStore.js";
import { WatchProgressSource } from "../local/traktSettingsStore.js";
import { SimklAuthStore } from "../local/simklAuthStore.js";
import { SimklSyncService } from "./simklSyncService.js";
import { TraktAuthService, requestJson as traktRequestJson } from "./traktAuthService.js";
import { ownsWatchProgress } from "./trackingWriteScope.js";

function activeProfileId() {
  return String(ProfileManager.getActiveProfileId() || "1");
}

// Mirrors the progress rows' tag: which source owned Continue Watching when
// this completion was recorded, so Nuvio's cloud only ever receives its own.
// A provider only owns a completion it can actually receive. The setting
// defaults to Trakt whether or not an account is connected, and this read only
// the setting -- so on a profile that never linked one, every completion was
// tagged `trakt_local`, filtered out of the push to Nuvio's own cloud, and never
// left the device. Progress written at the same moment did go, because that side
// checks the connection as well as the setting, which is why one device could
// follow another's viewing but never learn it had finished.
function selectedLocalWatchedSource() {
  if (shouldUseTrakt()) return "trakt_local";
  if (shouldUseSimkl()) return "simkl_local";
  return WatchProgressSource.NUVIO_SYNC;
}

function shouldUseSimkl() {
  return ownsWatchProgress(WatchProgressSource.SIMKL) && SimklAuthStore.isAuthenticated();
}

function shouldUseTrakt() {
  return ownsWatchProgress(WatchProgressSource.TRAKT) && TraktAuthService.isAuthenticated();
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
    media.seasons = [{ number: Number(item.season), episodes: [{ number: Number(item.episode) }] }];
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
    throw new Error(
      payload?.message || `Could not update Trakt watched history (${response.status})`
    );
  }
}

function watchedKey(item = {}) {
  return `${String(item.contentId || "").toLowerCase()}:${item.season ?? ""}:${item.episode ?? ""}`;
}

// Un-marking something a provider owns.
//
// Under a provider, a tick means "the provider has this one", so it comes from
// the provider's own list rather than from the local row. Deleting the local row
// therefore cannot clear it: the tick stands until the provider has been told
// and its list has been read again, which is a round trip the person is watching
// the screen through.
//
// So the intent is recorded here the moment they press it, and the provider's
// row is held back until the provider agrees. It clears itself: once the
// provider's list no longer carries the row, the record has done its job. The
// expiry is the other way out -- a provider that refused the write should not
// leave a tick hidden forever, because the provider really does still have it.
const UNMARK_TOMBSTONE_KEY = "watchedUnmarkTombstones";
const UNMARK_TOMBSTONE_TTL_MS = 15 * 60 * 1000;

function readTombstones(profileId) {
  const stored = LocalStore.get(UNMARK_TOMBSTONE_KEY, {});
  const forProfile = stored && typeof stored === "object" ? stored[String(profileId)] : null;
  return forProfile && typeof forProfile === "object" ? forProfile : {};
}

function writeTombstones(profileId, entries) {
  const stored = LocalStore.get(UNMARK_TOMBSTONE_KEY, {});
  const next = stored && typeof stored === "object" ? stored : {};
  if (Object.keys(entries).length) {
    next[String(profileId)] = entries;
  } else {
    delete next[String(profileId)];
  }
  LocalStore.set(UNMARK_TOMBSTONE_KEY, next);
}

function addTombstones(profileId, items) {
  const keys = (Array.isArray(items) ? items : [])
    .filter((item) => item?.contentId)
    .map(watchedKey);
  if (!keys.length) return;
  const entries = readTombstones(profileId);
  const now = Date.now();
  keys.forEach((key) => {
    entries[key] = now;
  });
  writeTombstones(profileId, entries);
}

function clearTombstones(profileId, items) {
  const keys = (Array.isArray(items) ? items : [])
    .filter((item) => item?.contentId)
    .map(watchedKey);
  if (!keys.length) return;
  const entries = readTombstones(profileId);
  let changed = false;
  keys.forEach((key) => {
    if (key in entries) {
      delete entries[key];
      changed = true;
    }
  });
  if (changed) writeTombstones(profileId, entries);
}

/**
 * Drop the provider rows this device has just un-marked, and forget the records
 * the provider has caught up with.
 */
function applyUnmarkTombstones(remoteItems, profileId) {
  const entries = readTombstones(profileId);
  const keys = Object.keys(entries);
  if (!keys.length) return remoteItems;

  const now = Date.now();
  const remoteKeys = new Set(remoteItems.map(watchedKey));
  const held = new Set();
  const surviving = {};
  keys.forEach((key) => {
    const recordedAt = Number(entries[key] || 0);
    if (now - recordedAt > UNMARK_TOMBSTONE_TTL_MS) return;
    // The provider agreed, so there is nothing left to hold back.
    if (!remoteKeys.has(key)) return;
    surviving[key] = recordedAt;
    held.add(key);
  });
  if (Object.keys(surviving).length !== keys.length) writeTombstones(profileId, surviving);
  if (!held.size) return remoteItems;
  return remoteItems.filter((item) => !held.has(watchedKey(item)));
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
  /**
   * Watched items this device recorded, without a provider's history merged in.
   *
   * getAll() deliberately folds the selected provider's records into the list
   * so screens can ask one question. Nuvio's own cloud sync must not use that
   * view: pushing it republishes SIMKL's entire watch history as Nuvio Sync's
   * own, and pulling against it writes those records into the local store, so
   * they survive switching the source and reach the PWA and the official app.
   */
  // No cap by default.
  //
  // It used to stop at 2000, and a library of 2206 records simply lost the tail:
  // six episodes of a series showed as unwatched on the Detail page although the
  // records were right there, because they sat past the cut. Nothing paged
  // through this -- every caller wants the whole set -- and the store has the
  // whole list in memory anyway, so the limit only ever hid rows.
  async listLocal(limit = Infinity) {
    return WatchedItemsStore.listForProfile(activeProfileId()).slice(0, limit);
  }

  /**
   * Everything this profile has watched, local rows and the selected provider's.
   *
   * `allowStale` is for a screen that has just changed something and has to
   * redraw now: the provider's snapshot answers as it stands and its refresh runs
   * behind the call. Anything deciding what to send a provider asks without it.
   */
  async getAll(limit = Infinity, { allowStale = false } = {}) {
    const profileId = activeProfileId();
    const local = WatchedItemsStore.listForProfile(profileId);
    if (!shouldUseSimkl()) return local.slice(0, limit);
    const fetched = await SimklSyncService.getWatchedItems({ allowStale }).catch(() => []);
    const remote = applyUnmarkTombstones(fetched, profileId);
    const remoteKeys = new Set(remote.map(watchedKey));
    return [...remote, ...local.filter((item) => !remoteKeys.has(watchedKey(item)))].slice(
      0,
      limit
    );
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
    // Local watched state is the completion boundary for Player and Continue
    // Watching. A tracking provider can be offline or reject a history write;
    // it must not prevent the local completion from being recorded.
    clearTombstones(activeProfileId(), [item]);
    WatchedItemsStore.upsert(
      {
        ...item,
        source: String(item?.source || "").trim() || selectedLocalWatchedSource(),
        watchedAt: item.watchedAt || Date.now()
      },
      activeProfileId(),
      // A completion is never one of playback's periodic writes: every caller
      // is a finish, a scrobble stop, a reconciliation sweep or the user
      // marking something watched. Announcing them like a tick left Home
      // ignoring the change, so a title marked watched elsewhere kept its
      // Continue Watching card. Callers may still opt out.
      { authoritative: options.authoritative !== false }
    );
    queueWatchedItemsCloudSync();
    if (shouldUseSimkl() && options.skipTrackingWrite !== true) {
      void SimklSyncService.markWatched(item).catch((error) => {
        console.warn("SIMKL watched history update failed", error);
      });
    }
    if (shouldUseTrakt() && options.skipTrackingWrite !== true) {
      void writeTraktHistory(item, false).catch((error) => {
        console.warn("Trakt watched history update failed", error);
      });
    }
  }

  // The local removal happens first and nothing waits on a network for it.
  //
  // This used to send every provider call, then every cloud delete, and only
  // then remove the row. Un-watching one episode meant one round trip before
  // the tick went; un-watching a season meant twenty-three, in sequence, and the
  // page sat there looking like the menu had not registered the press. `mark`
  // has always announced its provider write and moved on, which is why marking a
  // season watched felt immediate and un-marking it did not.
  //
  // Nothing is dropped: the provider and the cloud still get the same calls with
  // the same targets, computed from the rows as they were before the removal.
  // They are just no longer in front of the person.
  async unmark(contentId, options = null) {
    const pid = activeProfileId();
    const removedItems = WatchedItemsStore.listForProfile(pid).filter((item) =>
      matchesWatchedTarget(item, contentId, options)
    );
    WatchedItemsStore.remove(contentId, pid, options);
    // What the provider is about to be told, recorded now so the screen can act
    // on it before the provider answers.
    addTombstones(
      pid,
      removedItems.length
        ? removedItems
        : [{ contentId, season: options?.season ?? null, episode: options?.episode ?? null }]
    );
    queueWatchedItemsCloudSync();
    void deleteWatchedItemsFromCloud(removedItems).catch((error) => {
      console.warn("Watched items cloud delete failed", error);
    });

    if (options?.skipTrackingWrite === true) return;

    if (shouldUseSimkl()) {
      void (async () => {
        // With no local row to name, the provider's own list is the only place
        // the identity can come from -- and that lookup is exactly why this
        // cannot be in front of the removal.
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
                  // Callers that reach here with a season and episode are
                  // un-watching an episode, whatever the absent contentType
                  // would otherwise default to.
                  contentType:
                    options?.contentType ||
                    (options?.season != null || options?.episode != null ? "series" : "movie"),
                  season: options?.season ?? null,
                  episode: options?.episode ?? null,
                  videoId: options?.videoId || null
                }
              ];
        for (const item of targets) {
          await SimklSyncService.unmarkWatched(item);
        }
      })().catch((error) => {
        console.warn("SIMKL watched history removal failed", error);
      });
    }

    if (shouldUseTrakt()) {
      const targets = removedItems.length
        ? removedItems
        : [
            {
              contentId,
              contentType:
                options?.contentType ||
                (options?.season != null || options?.episode != null ? "series" : "movie"),
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
      void (async () => {
        for (const item of targets) {
          await writeTraktHistory(item, true);
        }
      })().catch((error) => {
        console.warn("Trakt watched history removal failed", error);
      });
    }
  }

  async replaceAll(items, profileId = activeProfileId()) {
    const before = WatchedItemsStore.listForProfile(profileId).length;
    WatchedItemsStore.replaceForProfile(profileId, items || []);
    console.warn(`[CW] watched replaceAll ${before} -> ${(items || []).length}`);
  }
}

export const watchedItemsRepository = new WatchedItemsRepository();
