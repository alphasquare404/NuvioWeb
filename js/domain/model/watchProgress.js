export function createWatchProgress({
  contentId,
  contentType,
  videoId = null,
  positionMs = 0,
  durationMs = 0,
  updatedAt = Date.now()
}) {
  return {
    contentId,
    contentType,
    videoId,
    positionMs,
    durationMs,
    updatedAt
  };
}

export const WATCH_PROGRESS_STARTED_THRESHOLD = 0.02;
export const WATCH_PROGRESS_COMPLETED_THRESHOLD = 0.9;

export function getWatchProgressFraction(progress = {}) {
  const positionMs = Number(progress?.positionMs || 0);
  const durationMs = Number(progress?.durationMs || 0);
  if (
    Number.isFinite(positionMs) &&
    Number.isFinite(durationMs) &&
    positionMs > 0 &&
    durationMs > 0
  ) {
    return Math.max(0, Math.min(1, positionMs / durationMs));
  }
  if (progress?.progressPercent != null && progress.progressPercent !== "") {
    const explicitPercent = Number(progress.progressPercent);
    if (Number.isFinite(explicitPercent)) {
      return Math.max(0, Math.min(1, explicitPercent / 100));
    }
  }
  return 0;
}

/**
 * Which card a progress row belongs to.
 *
 * One title reaches Continue Watching from two directions that spell it
 * differently. A film arrives from a tracking provider carrying its own title id
 * as the video id and zeros for season and episode, while the same film written
 * by playback here leaves all three empty. Compared literally they never match,
 * so anything keyed on the raw fields silently fails to find the card it means.
 *
 * Lives here because the display snapshot on disk and the row Home holds in
 * memory are the same list, and a key that disagreed between them patched one
 * and not the other.
 */
export function watchProgressCardKey({ contentId, videoId, season, episode } = {}) {
  const normalizedContentId = String(contentId || "").trim();
  if (!normalizedContentId) {
    return "";
  }
  const rawVideoId = videoId == null ? "" : String(videoId).trim();
  // A film's own id is not a distinct video within it.
  const normalizedVideoId = !rawVideoId || rawVideoId === normalizedContentId ? "main" : rawVideoId;
  // Episodes are numbered from one, so a zero means "not an episode at all".
  // Season is only meaningful alongside one, which leaves a real season zero --
  // a specials run -- intact.
  const episodeNumber = Number(episode);
  const hasEpisode = Number.isFinite(episodeNumber) && episodeNumber > 0;
  const seasonNumber = Number(season);
  return [
    normalizedContentId,
    normalizedVideoId,
    hasEpisode && Number.isFinite(seasonNumber) ? String(seasonNumber) : "",
    hasEpisode ? String(episodeNumber) : ""
  ].join("::");
}

export function isWatchProgressCompleted(progress = {}) {
  return getWatchProgressFraction(progress) >= WATCH_PROGRESS_COMPLETED_THRESHOLD;
}

export function isWatchProgressInProgress(progress = {}) {
  const fraction = getWatchProgressFraction(progress);
  return (
    fraction >= WATCH_PROGRESS_STARTED_THRESHOLD && fraction < WATCH_PROGRESS_COMPLETED_THRESHOLD
  );
}

export function hasWatchProgressStarted(progress = {}) {
  return Number(progress?.positionMs || 0) > 0 || Number(progress?.progressPercent || 0) > 0;
}

export function resolveWatchProgressResumePositionMs(progress = {}, actualDurationMs = 0) {
  const positionMs = Number(progress?.positionMs || 0);
  const durationMs = Number(actualDurationMs || progress?.durationMs || 0);
  if (Number.isFinite(positionMs) && positionMs > 0) {
    return Number.isFinite(durationMs) && durationMs > 0
      ? Math.max(0, Math.min(Math.trunc(positionMs), Math.trunc(durationMs)))
      : Math.trunc(positionMs);
  }
  const explicitPercent = Number(progress?.progressPercent);
  if (
    Number.isFinite(explicitPercent) &&
    explicitPercent > 0 &&
    Number.isFinite(durationMs) &&
    durationMs > 0
  ) {
    return Math.trunc((durationMs * Math.max(0, Math.min(100, explicitPercent))) / 100);
  }
  return 0;
}
