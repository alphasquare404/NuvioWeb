// Fast, safe path for reflecting an authoritative progress write (e.g. an
// accepted external-player callback report) on an already-displayed
// Continue Watching card, without waiting for the full store refresh /
// Next-Up re-resolution pipeline. Only the position/duration of an item
// that is already showing is touched here — nothing about ordering, artwork,
// or which items appear is decided by this module, so it can never guess a
// wrong Next-Up episode or misorder the row. The full refresh still runs
// afterward to reconcile everything else.

// One title reaches this from two directions that spell it differently. A film
// arrives from a provider carrying its own title id as the video id and zeros
// for season and episode, while the same film written by playback here leaves
// all three empty. Compared literally they never matched, so the fast path
// silently never ran for a film and its card only moved once the whole row had
// been rebuilt over the network -- seconds, for a number already in hand.
function buildContinueWatchingIdentityKey({ contentId, videoId, season, episode } = {}) {
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

// Returns a new array with the finished item dropped, or null when nothing
// displayed matches it. A completion removes its progress row rather than
// updating it, so there is no position left to patch -- and under a tracking
// provider the row that produced the card lives on the provider's server, so
// the full refresh has to wait on the network before the card can go. Dropping
// it here is what makes finishing a title feel immediate; the refresh still
// runs afterwards and decides everything else, including whether a Next Up
// card should take its place.
export function removeContinueWatchingDisplayItem(displayItems, finishedItem) {
  const key = buildContinueWatchingIdentityKey(finishedItem);
  if (!key || !Array.isArray(displayItems) || !displayItems.length) {
    return null;
  }
  const next = displayItems.filter((item) => buildContinueWatchingIdentityKey(item) !== key);
  return next.length === displayItems.length ? null : next;
}
