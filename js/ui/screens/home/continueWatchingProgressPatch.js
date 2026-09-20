// Fast, safe path for reflecting an authoritative progress write (e.g. an
// accepted external-player callback report) on an already-displayed
// Continue Watching card, without waiting for the full store refresh /
// Next-Up re-resolution pipeline. Only the position/duration of an item
// that is already showing is touched here — nothing about ordering, artwork,
// or which items appear is decided by this module, so it can never guess a
// wrong Next-Up episode or misorder the row. The full refresh still runs
// afterward to reconcile everything else.

function buildContinueWatchingIdentityKey({ contentId, videoId, season, episode } = {}) {
  const normalizedContentId = String(contentId || "").trim();
  if (!normalizedContentId) {
    return "";
  }
  const normalizedVideoId = videoId == null ? "main" : String(videoId).trim();
  const normalizedSeason = season == null ? "" : String(Number(season));
  const normalizedEpisode = episode == null ? "" : String(Number(episode));
  return `${normalizedContentId}::${normalizedVideoId}::${normalizedSeason}::${normalizedEpisode}`;
}

// Returns a new array with the matching item's positionMs/durationMs patched
// in place, or null if no displayed item matches this progress write (the
// caller should fall back to the normal full-refresh path in that case).
export function patchContinueWatchingDisplayProgress(displayItems, progressItem) {
  const key = buildContinueWatchingIdentityKey(progressItem);
  if (!key || !Array.isArray(displayItems) || !displayItems.length) {
    return null;
  }
  const index = displayItems.findIndex((item) => buildContinueWatchingIdentityKey(item) === key);
  if (index === -1) {
    return null;
  }
  const positionMs = Math.max(0, Math.trunc(Number(progressItem?.positionMs) || 0));
  const durationMs = Math.max(0, Math.trunc(Number(progressItem?.durationMs) || 0));
  const next = displayItems.slice();
  next[index] = { ...next[index], positionMs, durationMs };
  return next;
}
