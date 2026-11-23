import { playbackCompletionPreparation } from "../../data/repository/playbackCompletionPreparation.js";
import { watchProgressRepository } from "../../data/repository/watchProgressRepository.js";
import { watchedItemsRepository } from "../../data/repository/watchedItemsRepository.js";
import { watchedSeriesReconciliationService } from "../../data/repository/watchedSeriesReconciliationService.js";
import { ProfileManager } from "../profile/profileManager.js";

// A movie has no season or episode, and saying so has to survive the trip.
// `Number(null)` is 0, and 0 is finite, so a movie's empty season and episode
// were written as zeros -- and `isWatched` asks for entries whose season and
// episode are null before it will call a movie watched. The completion was
// recorded and could not be found, which is why a finished film left Continue
// Watching and never appeared as watched.
function toEpisodeNumber(value) {
  if (value == null || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function normalizeContext(context = {}) {
  const itemId = String(context.itemId || "").trim();
  if (!itemId) return null;
  return {
    itemId,
    itemType: String(context.itemType || "movie").trim() || "movie",
    videoId: context.videoId == null ? null : String(context.videoId),
    season: toEpisodeNumber(context.season),
    episode: toEpisodeNumber(context.episode),
    title: context.title || null,
    episodeTitle: context.episodeTitle || null
  };
}

export function createMarkPlaybackWatched({
  watchedRepository = watchedItemsRepository,
  progressRepository = watchProgressRepository,
  completionPreparation = playbackCompletionPreparation,
  seriesReconciliation = watchedSeriesReconciliationService
} = {}) {
  return async function markPlaybackWatched(
    context,
    {
      reconcileSeries = true,
      authoritative = false,
      skipTrackingWrite = false,
      profileId = null
    } = {}
  ) {
    const active = normalizeContext(context);
    if (!active) return false;
    const pid = profileId == null ? null : String(profileId);
    const activeProfileId = String(ProfileManager.getActiveProfileId() || "1");
    const profileIsActive = pid == null || pid === activeProfileId;

    await watchedRepository.mark(
      {
        contentId: active.itemId,
        contentType: active.itemType,
        videoId: active.videoId,
        season: active.season,
        episode: active.episode,
        title: active.episodeTitle || active.title || active.itemId,
        watchedAt: Date.now()
      },
      {
        authoritative,
        skipTrackingWrite,
        ...(pid ? { profileId: pid } : {})
      }
    );

    // Completion is represented by watched state, not a synthetic 100%
    // resume row. Removing by the stable playback identity also clears an old
    // provider-specific episode ID that would otherwise keep CW stale.
    await progressRepository.removePlaybackProgress(active, pid ? { profileId: pid } : {});

    // The provider writes and series reconciliation use the active profile's
    // credentials and settings. A completion applied to another profile may
    // still record the local watched state above, but it must not reach a
    // provider as the profile currently on screen.
    if (!profileIsActive) {
      return true;
    }

    if (seriesReconciliation.isSeriesType(active.itemType)) {
      void completionPreparation.prepare(
        active,
        progressRepository.getContinueWatchingSourceKey?.()
      );
    }

    if (reconcileSeries && seriesReconciliation.isSeriesType(active.itemType)) {
      await seriesReconciliation.reconcile(active.itemId, active.itemType, {
        title: active.title || active.itemId,
        completedEpisode: { season: active.season, episode: active.episode }
      });
    }
    return true;
  };
}

export const markPlaybackWatched = createMarkPlaybackWatched();
