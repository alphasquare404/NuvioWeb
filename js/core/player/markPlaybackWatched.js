import { watchProgressRepository } from "../../data/repository/watchProgressRepository.js";
import { watchedItemsRepository } from "../../data/repository/watchedItemsRepository.js";
import { watchedSeriesReconciliationService } from "../../data/repository/watchedSeriesReconciliationService.js";

function normalizeContext(context = {}) {
  const itemId = String(context.itemId || "").trim();
  if (!itemId) return null;
  return {
    itemId,
    itemType: String(context.itemType || "movie").trim() || "movie",
    videoId: context.videoId == null ? null : String(context.videoId),
    season: Number.isFinite(Number(context.season)) ? Number(context.season) : null,
    episode: Number.isFinite(Number(context.episode)) ? Number(context.episode) : null,
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
    { reconcileSeries = true, authoritative = false } = {}
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
      { authoritative }
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
