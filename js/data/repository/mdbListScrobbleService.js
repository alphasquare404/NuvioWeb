import { MdbListAuthService } from "./mdbListAuthService.js";
import { MdbListSyncService } from "./mdbListSyncService.js";
import { WatchProgressSource } from "../local/traktSettingsStore.js";
import { ownsWatchProgress } from "./trackingWriteScope.js";

const START_DEBOUNCE_MS = 15_000;
const MAX_CONSECUTIVE_FAILURES = 3;
const WATCHED_THRESHOLD_PERCENT = 80;

let startTimer = null;
let failures = 0;
let lastAction = null;

function clearStartTimer() {
  if (startTimer) clearTimeout(startTimer);
  startTimer = null;
}

function normalizedIds(context = {}) {
  const ids = {};
  if (/^tt[0-9]+$/i.test(String(context.imdbId || ""))) ids.imdb = context.imdbId;
  if (Number(context.tmdbId) > 0) ids.tmdb = Number(context.tmdbId);
  if (Number(context.traktId) > 0) ids.trakt = Number(context.traktId);
  return ids;
}

function buildPayload(context = {}) {
  const ids = normalizedIds(context);
  if (!Object.keys(ids).length) return null;
  const progress = Math.max(
    0,
    Math.min(100, Math.round(Number(context.progressPercent || 0) * 100) / 100)
  );
  if (context.contentType !== "series") {
    return { movie: { ids }, progress };
  }
  const season = Number(context.seasonNumber);
  const episode = Number(context.episodeNumber);
  if (!Number.isFinite(season) || season < 0 || !Number.isFinite(episode) || episode < 1) {
    return null;
  }
  return { show: { ids, season, episode }, progress };
}

async function markAsWatchedLocally(context) {
  try {
    const { watchedItemsRepository } = await import("./watchedItemsRepository.js");
    const item = {
      contentId: context.contentId,
      watchedAt: Date.now()
    };
    if (context.contentType === "series") {
      item.season = context.seasonNumber;
      item.episode = context.episodeNumber;
    }
    await watchedItemsRepository.mark(item, { skipTrackingWrite: true });
  } catch (error) {
    console.warn("[MdbListScrobble] mark-as-watched failed", error);
  }
}

async function send(action, context) {
  if (failures >= MAX_CONSECUTIVE_FAILURES) return;
  const payload = buildPayload(context);
  if (!payload) return;
  try {
    const { response } = await MdbListAuthService.apiRequest(`/scrobble/${action}`, {
      method: "POST",
      body: payload
    });
    if (!response.ok) {
      failures += 1;
      console.warn(`[MdbListScrobble] ${action} failed`, {
        status: response.status,
        failures
      });
      return;
    }
    failures = 0;
    MdbListSyncService.clearCache();
    lastAction = action === "stop" ? null : action;
    if (action === "stop" && Number(context.progressPercent || 0) >= WATCHED_THRESHOLD_PERCENT) {
      await markAsWatchedLocally(context);
    }
  } catch (error) {
    failures += 1;
    console.warn(`[MdbListScrobble] ${action} error`, {
      error: error?.message,
      failures
    });
  }
}

export const MdbListScrobbleService = {
  isEnabled() {
    return ownsWatchProgress(WatchProgressSource.MDBLIST) && MdbListAuthService.isAuthenticated();
  },

  start(context) {
    clearStartTimer();
    startTimer = setTimeout(() => {
      startTimer = null;
      void send("start", context);
    }, START_DEBOUNCE_MS);
  },

  pause(context) {
    clearStartTimer();
    if (lastAction === "start" || lastAction === null) {
      void send("pause", context);
    }
  },

  stop(context) {
    clearStartTimer();
    void send("stop", context);
    lastAction = null;
  },

  reportPosition(context) {
    clearStartTimer();
    void send("pause", context);
    lastAction = null;
  },

  cancel() {
    clearStartTimer();
    failures = 0;
    lastAction = null;
  }
};
