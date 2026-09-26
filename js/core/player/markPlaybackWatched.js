import { watchProgressRepository } from "../../data/repository/watchProgressRepository.js";
import { watchedItemsRepository } from "../../data/repository/watchedItemsRepository.js";
import { watchedSeriesReconciliationService } from "../../data/repository/watchedSeriesReconciliationService.js";

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
  seriesReconciliation = watchedSeriesReconciliationService
} = {}) {
  return async function markPlaybackWatched(
    context,
    { reconcileSeries = true, authoritative = false, skipTrackingWrite = false } = {}
  ) {
    const active = normalizeContext(context);
    if (!active) return false;

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
      // A scrobble stop already tells the provider this finished, and it also
      // clears the provider's own resume entry -- something a history write
      // cannot do. When one was sent, writing the history again here would only
      // duplicate the entry.
      { authoritative, skipTrackingWrite }
    );

    // Completion is represented by watched state, not a synthetic 100%
    // resume row. Removing by the stable playback identity also clears an old
    // provider-specific episode ID that would otherwise keep CW stale.
    await progressRepository.removePlaybackProgress(active);

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
