import { AuthManager } from "../auth/authManager.js";
import { SupabaseApi } from "../../data/remote/supabase/supabaseApi.js";
import { watchedItemsRepository } from "../../data/repository/watchedItemsRepository.js";
import { isNuvioSyncOwnedProgress } from "../../data/repository/watchProgressProvenance.js";
import { ProfileManager } from "./profileManager.js";
import { LocalStore } from "../storage/localStore.js";
import { TraktAuthStore } from "../../data/local/traktAuthStore.js";
import { SimklAuthStore } from "../../data/local/simklAuthStore.js";
import { TraktSettingsStore, WatchProgressSource } from "../../data/local/traktSettingsStore.js";

const PULL_RPC = "sync_pull_watched_items";
const PUSH_RPC = "sync_push_watched_items";
const DELETE_RPC = "sync_delete_watched_items";
const SYNC_STATE_KEY = "watchedItemsSyncState";
const WATCHED_ITEMS_PAGE_SIZE = 900;

function resolveProfileId() {
  const raw = Number(ProfileManager.getActiveProfileId() || 1);
  return Number.isFinite(raw) && raw > 0 ? Math.trunc(raw) : 1;
}

function shouldUseSupabaseWatchProgressSync() {
  const source = TraktSettingsStore.get().watchProgressSource || WatchProgressSource.TRAKT;
  const providerSelected =
    (TraktAuthStore.isAuthenticated() && source === WatchProgressSource.TRAKT) ||
    (SimklAuthStore.isAuthenticated() && source === WatchProgressSource.SIMKL);
  return !providerSelected;
}

function mapRemoteItem(row = {}) {
  const watchedAtRaw = row.watched_at || row.watchedAt || null;
  const numeric = Number(watchedAtRaw);
  const parsedDate = Number.isFinite(numeric) ? numeric : new Date(watchedAtRaw).getTime();
  return {
    contentId: row.content_id || row.contentId || "",
    contentType: row.content_type || row.contentType || "movie",
    title: row.title || row.name || "",
    season: row.season == null ? null : Number(row.season),
    episode: row.episode == null ? null : Number(row.episode),
    watchedAt: Number.isFinite(parsedDate) ? parsedDate : Date.now()
  };
}

function watchedItemKey(item = {}) {
  const contentId = String(item.contentId || "").trim();
  const season = item.season == null ? "" : String(Number(item.season));
  const episode = item.episode == null ? "" : String(Number(item.episode));
  return `${contentId}:${season}:${episode}`;
}

function watchedStateForProfile(profileId = resolveProfileId()) {
  const state = LocalStore.get(SYNC_STATE_KEY, {});
  const profileState = state && typeof state === "object" ? state[String(profileId)] : null;
  return profileState && typeof profileState === "object" ? profileState : {};
}

function writeWatchedStateForProfile(profileId = resolveProfileId(), patch = {}) {
  const state = LocalStore.get(SYNC_STATE_KEY, {});
  const next = state && typeof state === "object" ? state : {};
  next[String(profileId)] = {
    ...(next[String(profileId)] || {}),
    ...patch,
    updatedAt: Date.now()
  };
  LocalStore.set(SYNC_STATE_KEY, next);
}

// Exported for the tests that pin the pull-race rule; the service is the only
// caller.
export function mergeWatchedItems(localItems = [], remoteItems = [], reconciledAt = 0) {
  if (!remoteItems.length) {
    return [...localItems];
  }
  const byKey = new Map();
  const upsert = (item, preferIncomingOnTie = false) => {
    const key = watchedItemKey(item);
    if (key.startsWith(":")) {
      return;
    }
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, item);
      return;
    }
    const existingWatchedAt = Number(existing.watchedAt || 0);
    const incomingWatchedAt = Number(item.watchedAt || 0);
    if (
      incomingWatchedAt > existingWatchedAt ||
      (incomingWatchedAt === existingWatchedAt && preferIncomingOnTie)
    ) {
      byKey.set(key, item);
    }
  };

  remoteItems.forEach((item) => upsert(item, true));
  // A local record the cloud does not have is either something un-watched on
  // another device -- which must disappear here too -- or something this device
  // recorded and the cloud has not been told about. What tells them apart is
  // the last time this device and the cloud agreed: older than that, the cloud
  // knew about it and no longer does; newer, the cloud has never seen it.
  //
  // That moment is a pull as much as a push. Asking only about pushes read a row
  // this device had *received* from the cloud as one of its own: its watchedAt
  // is whenever the episode was originally watched, which on the receiving
  // device is newer than its own last push. So an episode un-marked on the first
  // device survived the second device's pull and was pushed straight back up,
  // and the two never settled.
  //
  // With nothing on record there has been no agreement, so nothing local can be
  // read as a deletion made elsewhere. Skipping the whole pass there dropped
  // every local record instead, which on a device that had just finished an
  // episode is the completion itself.
  localItems.forEach((item) => {
    const key = watchedItemKey(item);
    if (!byKey.has(key) && Number(item.watchedAt || 0) > reconciledAt) {
      byKey.set(key, item);
    }
  });
  return Array.from(byKey.values()).sort(
    (left, right) => Number(right.watchedAt || 0) - Number(left.watchedAt || 0)
  );
}

function toRemoteItem(item = {}) {
  return {
    content_id: item.contentId,
    content_type: item.contentType || "movie",
    title: item.title || "",
    season: item.season == null ? null : Number(item.season),
    episode: item.episode == null ? null : Number(item.episode),
    watched_at: Number(item.watchedAt || Date.now())
  };
}

function toDeleteKey(item = {}) {
  const key = {
    content_id: item.contentId
  };
  if (item.season != null) {
    key.season = Number(item.season);
  }
  if (item.episode != null) {
    key.episode = Number(item.episode);
  }
  return key;
}

async function pullRemoteWatchedItems(profileId) {
  const allRows = [];
  let page = 1;
  while (true) {
    const rows = await SupabaseApi.rpc(
      PULL_RPC,
      {
        p_profile_id: profileId,
        p_page: page,
        p_page_size: WATCHED_ITEMS_PAGE_SIZE
      },
      true
    );
    const pageRows = Array.isArray(rows) ? rows : [];
    allRows.push(...pageRows);
    if (pageRows.length < WATCHED_ITEMS_PAGE_SIZE) {
      return allRows;
    }
    page += 1;
  }
}

export const WatchedItemsSyncService = {
  async pull() {
    try {
      if (!AuthManager.isAuthenticated) {
        return [];
      }
      const sessionGeneration = AuthManager.getSessionGeneration();
      if (!shouldUseSupabaseWatchProgressSync()) {
        return [];
      }
      const profileId = resolveProfileId();
      // The local store only: merging in the selected provider's history here
      // would persist it as Nuvio Sync's own on the next replaceAll.
      const localItems = await watchedItemsRepository.listLocal();
      // Read before the network, because it describes the rows that are about
      // to be fetched. Read afterwards it can already have moved: a push that
      // succeeds during the round trip advances it past a completion written
      // just before, and the merge below then reads that completion as
      // something the cloud was told about and has since dropped -- so it
      // deletes it, while the very snapshot it is comparing against was taken
      // before that push and could not have contained it.
      const stateBeforeFetch = watchedStateForProfile(profileId);
      const reconciledBeforeFetchAt = Math.max(
        Number(stateBeforeFetch.lastSuccessfulPushAt || 0),
        Number(stateBeforeFetch.lastSuccessfulPullAt || 0)
      );
      const rows = await pullRemoteWatchedItems(profileId);
      if (!AuthManager.isSessionCurrent(sessionGeneration)) return [];
      const remoteItems = (rows || [])
        .map((row) => mapRemoteItem(row))
        .filter((item) => Boolean(item.contentId));
      // Read local again, after the network. The list captured before the pull
      // is a snapshot of a store that kept being written while the round trip
      // was in flight -- a couple of seconds, which is exactly long enough for
      // an external player's report to land. A completion written in that
      // window is in neither list: not in the cloud, which has not been told
      // yet, and not in the stale local copy either. replaceAll then wrote the
      // watched set from before the episode finished back over it, and
      // Continue Watching moved on to the next episode and then returned to
      // the one that had just been watched.
      //
      // The progress service already reads twice for this reason. This one is
      // the half that decides what counts as watched, which is what Next Up is
      // built from, so getting it wrong undoes the completion outright.
      const currentLocalItems = await watchedItemsRepository.listLocal();
      if (!AuthManager.isSessionCurrent(sessionGeneration) || resolveProfileId() !== profileId) {
        return localItems;
      }
      if (!remoteItems.length && currentLocalItems.length) {
        return currentLocalItems;
      }
      const mergedItems = mergeWatchedItems(
        currentLocalItems,
        remoteItems,
        reconciledBeforeFetchAt
      );
      if (!AuthManager.isSessionCurrent(sessionGeneration) || resolveProfileId() !== profileId) {
        return localItems;
      }
      await watchedItemsRepository.replaceAll(mergedItems, profileId);
      // The two have just agreed. Recorded so the next pull can tell a row that
      // arrived from the cloud from one this device wrote afterwards.
      writeWatchedStateForProfile(profileId, { lastSuccessfulPullAt: Date.now() });
      return mergedItems;
    } catch (error) {
      console.warn("Watched items sync pull failed", error);
      return [];
    }
  },

  async push() {
    try {
      if (!AuthManager.isAuthenticated) {
        return false;
      }
      const sessionGeneration = AuthManager.getSessionGeneration();
      const items = (await watchedItemsRepository.listLocal()).filter((item) =>
        isNuvioSyncOwnedProgress(item)
      );
      await SupabaseApi.rpc(
        PUSH_RPC,
        {
          p_profile_id: resolveProfileId(),
          p_items: items.map((item) => toRemoteItem(item))
        },
        true
      );
      if (!AuthManager.isSessionCurrent(sessionGeneration)) return false;
      writeWatchedStateForProfile(resolveProfileId(), { lastSuccessfulPushAt: Date.now() });
      return true;
    } catch (error) {
      console.warn("Watched items sync push failed", error);
      return false;
    }
  },

  // Whether this device is holding completions the cloud has not accepted.
  //
  // Asked of the data rather than of a failure flag, for the same reason the
  // progress side is: a push that was never attempted leaves no flag behind, and
  // an offline session is exactly when one might not be. Unanswerable means yes,
  // because asking needlessly costs a round trip while skipping wrongly loses a
  // completion -- which is what happened: a title finished with no network
  // advanced Continue Watching here and reached no other device, because nothing
  // after the failed 250ms push ever tried again.
  async hasUnsyncedItems() {
    try {
      if (!AuthManager.isAuthenticated) return true;
      const since = Number(watchedStateForProfile().lastSuccessfulPushAt || 0);
      const items = await watchedItemsRepository.listLocal();
      return items.some(
        (item) => isNuvioSyncOwnedProgress(item) && Number(item.watchedAt || 0) > since
      );
    } catch (_) {
      return true;
    }
  },

  async deleteItems(items = []) {
    try {
      if (!AuthManager.isAuthenticated) {
        return false;
      }
      if (!shouldUseSupabaseWatchProgressSync()) {
        return true;
      }
      const keys = (Array.isArray(items) ? items : [])
        .filter((item) => Boolean(item?.contentId))
        .map((item) => toDeleteKey(item));
      if (!keys.length) {
        return true;
      }
      await SupabaseApi.rpc(
        DELETE_RPC,
        {
          p_profile_id: resolveProfileId(),
          p_keys: keys
        },
        true
      );
      writeWatchedStateForProfile(resolveProfileId(), { lastSuccessfulPushAt: Date.now() });
      return true;
    } catch (error) {
      console.warn("Watched items sync delete failed", error);
      return false;
    }
  }
};
