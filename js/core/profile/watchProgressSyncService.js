import { AuthManager } from "../auth/authManager.js";
import { watchProgressRepository } from "../../data/repository/watchProgressRepository.js";
import { isNuvioSyncOwnedProgress } from "../../data/repository/watchProgressProvenance.js";
import { SupabaseApi } from "../../data/remote/supabase/supabaseApi.js";
import { ProfileManager } from "./profileManager.js";
import { LocalStore } from "../storage/localStore.js";
import { TraktAuthStore } from "../../data/local/traktAuthStore.js";
import { SimklAuthStore } from "../../data/local/simklAuthStore.js";
import { TraktSettingsStore, WatchProgressSource } from "../../data/local/traktSettingsStore.js";
import { getSyncClientId } from "../sync/syncClientIdentity.js";
import {
  buildWatchedAtByKey,
  itemsByProgressKey,
  mergeProgressItems,
  normalizeProgressItems,
  progressKey
} from "./watchProgressMerge.js";
import { WatchedItemsStore } from "../../data/local/watchedItemsStore.js";
import { WatchedItemsSyncService } from "./watchedItemsSyncService.js";

const PULL_RPC = "sync_pull_watch_progress";
const PUSH_RPC = "sync_push_watch_progress";
const DELETE_RPC = "sync_delete_watch_progress";
const SYNTHETIC_EPISODE_VIDEO_PREFIX = "__nuvio_episode__:";
const PUSH_RETRY_BACKOFF_MS = 120000;
// Long enough for a session to come back after the network does, short enough
// that the viewer is still there when it lands.
const AUTH_RECOVERY_RETRY_MS = 4000;
// iOS reports `online` as soon as the interface comes up, which is before the
// network can actually carry a request: the first attempt after a reconnect
// lands in a window where everything fails with "Load failed". One attempt was
// all there was, and its failure re-armed the push backoff for two minutes.
const RECONNECT_RETRY_DELAYS_MS = [0, 3000, 9000, 25000];
const SYNC_STATE_KEY = "watchProgressSyncState";
const MIN_PROGRESS_SYNC_DURATION_MS = 60000;
const MAX_AMBIGUOUS_SECONDS_PROGRESS_VALUE = 8 * 60 * 60;
const MAX_REASONABLE_PROGRESS_DURATION_MS = 24 * 60 * 60 * 1000;

let activePushPromise = null;
let pushAgainRequested = false;
let lastSuccessfulPushSignature = "";
let lastFailedPushSignature = "";
let lastFailedPushAt = 0;
// This device has been away and has not reconciled yet.
//
// A push publishes local state wholesale, against a baseline that was current
// when this device last spoke to the cloud. After an outage that baseline is
// stale by definition: another device may have watched the same title further
// in the meantime. Playback queues its push on a short debounce, so the push
// owed from an offline session fires the moment the network returns -- before
// anything has pulled -- and overwrites the further position with the shorter
// one. The cloud then agrees with this device, so nothing here looks wrong, and
// the viewing is only restored when some other device happens to push again.
//
// So a return from an outage owes a pull, and until it is paid no push leaves.
let reconnectPullOwed = false;

export function noteWatchProgressReconnectPullOwed() {
  reconnectPullOwed = true;
}

function readSyncState() {
  const state = LocalStore.get(SYNC_STATE_KEY, {});
  return state && typeof state === "object" ? state : {};
}

function readBaselineItems(profileId) {
  const state = readSyncState();
  const profileState = state[String(profileId)] || {};
  return normalizeProgressItems(profileState.remoteSnapshot || []);
}

function writeBaselineItems(profileId, items = []) {
  const state = readSyncState();
  state[String(profileId)] = {
    remoteSnapshot: normalizeProgressItems(items),
    updatedAt: Date.now()
  };
  LocalStore.set(SYNC_STATE_KEY, state);
}

function mapProgressRow(row = {}) {
  const contentId = row.content_id || row.contentId || "";
  const contentType = row.content_type || row.contentType || "movie";
  const source = String(row.source || "").trim();
  const updatedAtRaw = row.updated_at ?? row.last_watched ?? row.lastWatched ?? null;
  const updatedAt = (() => {
    if (updatedAtRaw == null) {
      return Date.now();
    }
    const numeric = Number(updatedAtRaw);
    if (Number.isFinite(numeric)) {
      return numeric > 1_000_000_000_000 ? numeric : Math.trunc(numeric * 1000);
    }
    const parsed = new Date(updatedAtRaw).getTime();
    return Number.isFinite(parsed) ? parsed : Date.now();
  })();
  const hasPositionMs = row.position_ms != null || row.positionMs != null;
  const hasDurationMs = row.duration_ms != null || row.durationMs != null;
  const positionMsRaw = row.position_ms ?? row.positionMs ?? row.position ?? 0;
  const durationMsRaw = row.duration_ms ?? row.durationMs ?? row.duration ?? 0;
  const progressPercentRaw = row.progress_percent ?? row.progressPercent ?? null;
  const progressPercent = Number(progressPercentRaw);
  const seasonRaw = row.season ?? row.season_number ?? null;
  const episodeRaw = row.episode ?? row.episode_number ?? null;
  const seasonNum = Number(seasonRaw);
  const episodeNum = Number(episodeRaw);
  const rawVideoId = row.video_id || row.videoId || null;
  const normalizedVideoId =
    typeof rawVideoId === "string" && rawVideoId.trim() === contentId ? null : rawVideoId;
  const toMilliseconds = (value) => {
    const n = Number(value || 0);
    if (!Number.isFinite(n) || n <= 0) {
      return 0;
    }
    return Math.trunc(n);
  };
  const normalizeAmbiguousRemoteTime = (value) => {
    const n = Number(value || 0);
    if (!Number.isFinite(n) || n <= 0) {
      return 0;
    }
    return Math.trunc(n > MAX_AMBIGUOUS_SECONDS_PROGRESS_VALUE ? n : n * 1000);
  };
  const positionMs = hasPositionMs
    ? toMilliseconds(positionMsRaw)
    : normalizeAmbiguousRemoteTime(positionMsRaw);
  const durationMs = hasDurationMs
    ? toMilliseconds(durationMsRaw)
    : normalizeAmbiguousRemoteTime(durationMsRaw);
  const normalizedTimes = normalizeInflatedProgressTimes(positionMs, durationMs);
  const normalizedProgressPercent = Number.isFinite(progressPercent)
    ? Math.max(0, Math.min(100, progressPercent))
    : null;
  const completedProgressPercent =
    source === "trakt_history" &&
    normalizedProgressPercent != null &&
    normalizedProgressPercent < 100
      ? 100
      : normalizedProgressPercent;
  return {
    contentId,
    contentType,
    videoId:
      typeof normalizedVideoId === "string" &&
      normalizedVideoId.startsWith(SYNTHETIC_EPISODE_VIDEO_PREFIX)
        ? null
        : normalizedVideoId,
    season: seasonRaw != null && Number.isFinite(seasonNum) && seasonNum >= 0 ? seasonNum : null,
    episode: Number.isFinite(episodeNum) && episodeNum > 0 ? episodeNum : null,
    positionMs: normalizedTimes.positionMs,
    durationMs: normalizedTimes.durationMs,
    progressPercent: completedProgressPercent,
    source: source || "local",
    updatedAt: Number.isFinite(updatedAt) ? updatedAt : Date.now()
  };
}

function normalizeInflatedProgressTimes(positionMs = 0, durationMs = 0) {
  const position = Number(positionMs || 0);
  const duration = Number(durationMs || 0);
  if (
    Number.isFinite(duration) &&
    duration > MAX_REASONABLE_PROGRESS_DURATION_MS &&
    duration / 1000 <= MAX_REASONABLE_PROGRESS_DURATION_MS
  ) {
    return {
      positionMs: Number.isFinite(position) && position > 0 ? Math.trunc(position / 1000) : 0,
      durationMs: Math.trunc(duration / 1000)
    };
  }
  return {
    positionMs: Number.isFinite(position) && position > 0 ? Math.trunc(position) : 0,
    durationMs: Number.isFinite(duration) && duration > 0 ? Math.trunc(duration) : 0
  };
}

function resolveProfileId() {
  const raw = Number(ProfileManager.getActiveProfileId() || 1);
  if (Number.isFinite(raw) && raw > 0) {
    return Math.trunc(raw);
  }
  return 1;
}

function shouldUseSupabaseWatchProgressSync() {
  const source = TraktSettingsStore.get().watchProgressSource || WatchProgressSource.TRAKT;
  const providerSelected =
    (TraktAuthStore.isAuthenticated() && source === WatchProgressSource.TRAKT) ||
    (SimklAuthStore.isAuthenticated() && source === WatchProgressSource.SIMKL);
  return !providerSelected;
}

function toPositiveIntegerOrNull(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) {
    return null;
  }
  return Math.trunc(n);
}

function toNonNegativeIntegerOrNull(value) {
  if (value == null || value === "") {
    return null;
  }
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) {
    return null;
  }
  return Math.trunc(n);
}

function toRemoteVideoId(item = {}) {
  const explicitVideoId = String(item.videoId || "").trim();
  const contentId = String(item.contentId || "").trim();
  if (explicitVideoId && explicitVideoId !== "main" && explicitVideoId !== contentId) {
    return explicitVideoId;
  }
  const season = toNonNegativeIntegerOrNull(item.season);
  const episode = toPositiveIntegerOrNull(item.episode);
  if (season != null || episode != null) {
    return `${SYNTHETIC_EPISODE_VIDEO_PREFIX}${season || 0}:${episode || 0}`;
  }
  if (contentId) {
    return contentId;
  }
  return "main";
}

function toProgressKey(item = {}) {
  const contentId = String(item.contentId || "").trim();
  const season = toNonNegativeIntegerOrNull(item.season);
  const episode = toPositiveIntegerOrNull(item.episode);
  if (contentId && season != null && episode != null) {
    return `${contentId}_s${season}e${episode}`;
  }
  return contentId;
}

function syncIdentityKey(item = {}) {
  const contentId = String(item.contentId || "").trim();
  const season = toNonNegativeIntegerOrNull(item.season);
  const episode = toPositiveIntegerOrNull(item.episode);
  if (contentId && season != null && episode != null) {
    return `${contentId}:episode:${season}:${episode}`;
  }
  return `${contentId}:video:${toRemoteVideoId(item)}`;
}

function dedupeSyncItems(items = []) {
  const byKey = new Map();
  (Array.isArray(items) ? items : []).forEach((item) => {
    const contentId = String(item?.contentId || "").trim();
    if (!contentId) {
      return;
    }
    const key = toProgressKey(item);
    const existing = byKey.get(key);
    if (!existing || Number(item?.updatedAt || 0) > Number(existing?.updatedAt || 0)) {
      byKey.set(key, item);
    }
  });
  return Array.from(byKey.values()).sort(
    (left, right) => Number(right?.updatedAt || 0) - Number(left?.updatedAt || 0)
  );
}

function coalesceSyncItems(items = []) {
  const byIdentity = new Map();
  dedupeSyncItems(items).forEach((item) => {
    const key = syncIdentityKey(item);
    const existing = byIdentity.get(key);
    if (!existing || Number(item?.updatedAt || 0) > Number(existing?.updatedAt || 0)) {
      byIdentity.set(key, item);
    }
  });
  return Array.from(byIdentity.values()).sort(
    (left, right) => Number(right?.updatedAt || 0) - Number(left?.updatedAt || 0)
  );
}

function isSyncableProgressItem(item = {}) {
  const durationMs = Number(item?.durationMs || 0);
  return (
    !Number.isFinite(durationMs) || durationMs <= 0 || durationMs >= MIN_PROGRESS_SYNC_DURATION_MS
  );
}

function rowFreshness(row = {}) {
  const candidates = [row?.updated_at, row?.last_watched, row?.updatedAt];
  for (const value of candidates) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      return numeric;
    }
    const parsed = Date.parse(String(value || ""));
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return 0;
}

function dedupeRowsForConflict(rows = [], onConflict = "") {
  const columns = String(onConflict || "")
    .split(",")
    .map((column) => String(column || "").trim())
    .filter(Boolean);
  if (!columns.length) {
    return Array.isArray(rows) ? rows : [];
  }
  const byKey = new Map();
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    const key = columns
      .map((column) => {
        const value = row?.[column];
        return value == null ? "" : String(value);
      })
      .join("::");
    const existing = byKey.get(key);
    if (!existing || rowFreshness(row) >= rowFreshness(existing)) {
      byKey.set(key, row);
    }
  });
  return Array.from(byKey.values());
}

function dedupeRemoteProgressEntries(rows = []) {
  return dedupeRowsForConflict(
    dedupeRowsForConflict(rows, "progress_key"),
    "content_id,video_id,season,episode"
  );
}

function buildRemoteProgressEntries(items = []) {
  return dedupeRemoteProgressEntries(
    items.map((item) => ({
      content_id: item.contentId,
      content_type: item.contentType || "movie",
      video_id: toRemoteVideoId(item),
      season: item.season == null ? null : Number(item.season),
      episode: item.episode == null ? null : Number(item.episode),
      position: Math.max(0, Math.trunc(Number(item.positionMs || 0))),
      duration: Math.max(0, Math.trunc(Number(item.durationMs || 0))),
      last_watched: Number(item.updatedAt || Date.now()),
      progress_key: toProgressKey(item)
    }))
  );
}

function buildDeleteKeys(items = []) {
  const keys = new Set();
  (Array.isArray(items) ? items : []).forEach((item) => {
    const key = toProgressKey(item);
    if (key) {
      keys.add(key);
    }
  });
  return Array.from(keys);
}

function buildPushSignature(rows = []) {
  return JSON.stringify(
    (Array.isArray(rows) ? rows : []).map((row) => [
      String(row.progress_key || ""),
      String(row.video_id || ""),
      Number(row.season || 0),
      Number(row.episode || 0),
      Number(row.position || 0),
      Number(row.duration || 0),
      Number(row.last_watched || 0)
    ])
  );
}

async function pushOnce() {
  let pushSignature = "";
  try {
    if (!AuthManager.isAuthenticated) {
      return false;
    }
    if (reconnectPullOwed) {
      // The reconnect sequence pulls and then pushes, so nothing is lost by
      // waiting -- this only stops the debounced push from getting there first.
      return false;
    }
    const sessionGeneration = AuthManager.getSessionGeneration();
    const items = coalesceSyncItems(await watchProgressRepository.getAll()).filter(
      (item) => isSyncableProgressItem(item) && isNuvioSyncOwnedProgress(item)
    );
    if (!AuthManager.isSessionCurrent(sessionGeneration)) return false;
    const profileId = resolveProfileId();

    // Rows the baseline still carries but this device no longer has: viewing it
    // finished or removed. Deleting from the cloud is its own call, and when it
    // was made offline it simply failed and nothing ever retried it -- while the
    // push that followed rewrote the baseline from local, dropping the very
    // record of the deletion. The cloud's surviving row then looked like a new
    // one from another device and was adopted straight back, so a title
    // finished offline returned to Continue Watching part-watched.
    //
    // Derived from the baseline rather than queued anywhere: the baseline is
    // already persisted and already says what the cloud last held.
    const localKeys = new Set(items.map((item) => progressKey(item)));
    const retired = readBaselineItems(profileId).filter(
      (item) => !localKeys.has(progressKey(item))
    );
    if (retired.length) {
      await WatchProgressSyncService.deleteItems(retired);
      if (!AuthManager.isSessionCurrent(sessionGeneration)) return false;
    }

    const rows = buildRemoteProgressEntries(items);
    pushSignature = buildPushSignature(rows);
    if (pushSignature && pushSignature === lastSuccessfulPushSignature) {
      return true;
    }
    if (
      pushSignature &&
      pushSignature === lastFailedPushSignature &&
      Date.now() - Number(lastFailedPushAt || 0) < PUSH_RETRY_BACKOFF_MS
    ) {
      return false;
    }
    await SupabaseApi.rpc(
      PUSH_RPC,
      {
        p_profile_id: profileId,
        p_entries: rows,
        p_origin_client_id: getSyncClientId()
      },
      true
    );
    if (!AuthManager.isSessionCurrent(sessionGeneration)) return false;
    lastSuccessfulPushSignature = pushSignature;
    writeBaselineItems(profileId, items);
    lastFailedPushSignature = "";
    lastFailedPushAt = 0;
    return true;
  } catch (error) {
    if (typeof pushSignature === "string" && pushSignature) {
      lastFailedPushSignature = pushSignature;
    }
    lastFailedPushAt = Date.now();
    console.warn("Watch progress sync push failed", error);
    return false;
  }
}

export const WatchProgressSyncService = {
  // `watchedItemsReady` matters because a completion reaches this device as the
  // absence of a progress row, and only the watched records say so. Those are
  // pulled by their own service, in parallel with this one -- so without waiting
  // for it, the merge reads a store that has not learned about the completion
  // yet and hands a stale partial back. The network calls still overlap; only
  // the merge waits.
  async pull({ watchedItemsReady = null } = {}) {
    try {
      if (!AuthManager.isAuthenticated) {
        return [];
      }
      const sessionGeneration = AuthManager.getSessionGeneration();
      if (!shouldUseSupabaseWatchProgressSync()) {
        return [];
      }
      const profileId = resolveProfileId();
      const localItems = await watchProgressRepository.getAll();
      if (resolveProfileId() !== profileId) {
        return localItems;
      }
      const rows = await SupabaseApi.rpc(PULL_RPC, { p_profile_id: profileId }, true);
      if (!AuthManager.isSessionCurrent(sessionGeneration)) return [];
      const filteredRows = (Array.isArray(rows) ? rows : []).filter((row) => {
        const rowProfile = row?.profile_id ?? row?.profileId ?? null;
        if (rowProfile == null || rowProfile === "") {
          return true;
        }
        return String(rowProfile) === String(profileId);
      });
      const remoteItems = filteredRows
        .map((row) => mapProgressRow(row))
        .filter((item) => Boolean(item.contentId) && isSyncableProgressItem(item));
      const snapshotItems = normalizeProgressItems(remoteItems);
      const baselineItems = readBaselineItems(profileId);
      // A failed watched pull must not hold up progress; a stale watched store
      // is the state this already handles conservatively by keeping the row.
      if (watchedItemsReady) await Promise.resolve(watchedItemsReady).catch(() => {});
      if (!AuthManager.isSessionCurrent(sessionGeneration) || resolveProfileId() !== profileId) {
        return localItems;
      }
      const watchedAtByKey = buildWatchedAtByKey(WatchedItemsStore.listForProfile(profileId));
      const mergedItems = mergeProgressItems(localItems, snapshotItems, baselineItems, {
        watchedAtByKey
      });
      if (!AuthManager.isSessionCurrent(sessionGeneration) || resolveProfileId() !== profileId) {
        return localItems;
      }
      // Stored first, and only then recorded. The baseline is this device's
      // claim about what the cloud holds and what it has taken in; recording it
      // before the rows landed meant a failure in between left it claiming a
      // cloud the device never merged. Every later pull then read as "only I
      // moved" and the device stopped following the cloud, with nothing to say
      // so. The order is the whole fix: a write that does not happen leaves the
      // old baseline, which is merely out of date, and the next pull settles it.
      await watchProgressRepository.replaceAll(mergedItems, profileId);
      writeBaselineItems(profileId, snapshotItems);
      lastSuccessfulPushSignature = buildPushSignature(
        buildRemoteProgressEntries(coalesceSyncItems(snapshotItems))
      );
      return mergedItems;
    } catch (error) {
      console.warn("Watch progress sync pull failed", error);
      return [];
    }
  },

  async push() {
    if (activePushPromise) {
      pushAgainRequested = true;
      return activePushPromise;
    }
    activePushPromise = (async () => {
      let lastResult = false;
      do {
        pushAgainRequested = false;
        lastResult = await pushOnce();
      } while (pushAgainRequested);
      return lastResult;
    })().finally(() => {
      activePushPromise = null;
    });
    return activePushPromise;
  },

  // Coming back online is the only moment worth retrying a push that failed for
  // want of a network, and nothing did: pushes ride on playback events, so
  // progress recorded offline could sit unsent until the next thing was played.
  //
  // Pull first, so anything another device did meanwhile is merged before this
  // device's own state is sent back.
  async syncAfterReconnect(trigger = "unknown") {
    if (!AuthManager.isAuthenticated) {
      // An app opened with no network has no session yet. One arrives shortly
      // after the network does, and nothing else was going to try again -- which
      // is why an offline start meant offline viewing never went up at all.
      await new Promise((resolve) => setTimeout(resolve, AUTH_RECOVERY_RETRY_MS));
      if (!AuthManager.isAuthenticated) {
        console.warn(`[ProgressSync] reconnect(${trigger}) skipped: still no session`);
        reconnectPullOwed = false;
        return false;
      }
    }
    if (!shouldUseSupabaseWatchProgressSync()) {
      reconnectPullOwed = false;
      return false;
    }
    // Completions made elsewhere have to be in hand before the merge runs, or a
    // partial left behind here outlives them and is pushed back over them.
    for (let attempt = 0; attempt < RECONNECT_RETRY_DELAYS_MS.length; attempt += 1) {
      const delay = RECONNECT_RETRY_DELAYS_MS[attempt];
      if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
      // Cleared on every attempt: the previous one failing is what arms it, and
      // an outage that has just ended is exactly when it should not apply.
      lastFailedPushSignature = "";
      lastFailedPushAt = 0;
      await this.pull({
        watchedItemsReady: WatchedItemsSyncService.pull().catch(() => null)
      });
      // Reconciled: this device's state now accounts for what the cloud holds,
      // so publishing it can no longer erase another device's viewing.
      reconnectPullOwed = false;
      const pushed = await this.push();
      if (pushed) return true;
    }
    // Which of the two this is decides everything about what to do next: a
    // dead session never recovers on its own, while a slow network does.
    reconnectPullOwed = false;
    console.warn(
      `[ProgressSync] reconnect(${trigger}) gave up after all attempts ` +
        `auth=${AuthManager.isAuthenticated} tokenExpired=${AuthManager.isAccessTokenExpired()}`
    );
    return false;
  },

  // Whether this device is holding viewing the cloud has not accepted. Asked of
  // the data rather than of a failure flag: a push that was never attempted
  // leaves no flag behind, and an offline session is exactly when one might not
  // be. Unanswerable means yes, because syncing needlessly costs a round trip
  // while skipping wrongly loses the viewing.
  async hasUnsyncedProgress() {
    try {
      if (!shouldUseSupabaseWatchProgressSync()) return false;
      if (!AuthManager.isAuthenticated) return true;
      const items = coalesceSyncItems(await watchProgressRepository.getAll()).filter(
        (item) => isSyncableProgressItem(item) && isNuvioSyncOwnedProgress(item)
      );
      return buildPushSignature(buildRemoteProgressEntries(items)) !== lastSuccessfulPushSignature;
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
      const keys = buildDeleteKeys(items);
      if (!keys.length) {
        return true;
      }
      await SupabaseApi.rpc(
        DELETE_RPC,
        {
          p_profile_id: resolveProfileId(),
          p_keys: keys,
          p_origin_client_id: getSyncClientId()
        },
        true
      );
      const profileId = resolveProfileId();
      const baselineByKey = itemsByProgressKey(readBaselineItems(profileId));
      normalizeProgressItems(items).forEach((item) => {
        baselineByKey.delete(progressKey(item));
      });
      writeBaselineItems(profileId, Array.from(baselineByKey.values()));
      lastSuccessfulPushSignature = "";
      return true;
    } catch (error) {
      console.warn("Watch progress sync delete failed", error);
      return false;
    }
  }
};
