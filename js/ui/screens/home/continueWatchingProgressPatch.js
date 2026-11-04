// Reflect locally accepted progress immediately on existing CW cards, including
// recency. Metadata and Next Up discovery remain the full refresh's job.
// Shared with the on-disk display snapshot, which is this same list persisted:
// a key that disagreed between them patched one and left the other stale.
import { watchProgressCardKey } from "../../../domain/model/watchProgress.js";

// Returns a new array with the matching item's positionMs/durationMs patched
// and recency sorted, or null if no displayed item matches this progress write (the
// caller should fall back to the normal full-refresh path in that case).
export function patchContinueWatchingDisplayProgress(displayItems, progressItem) {
  const key = watchProgressCardKey(progressItem);
  if (!key || !Array.isArray(displayItems) || !displayItems.length) {
    return null;
  }
  const index = displayItems.findIndex((item) => watchProgressCardKey(item) === key);
  if (index === -1) {
    return null;
  }
  const positionMs = Math.max(0, Math.trunc(Number(progressItem?.positionMs) || 0));
  const durationMs = Math.max(0, Math.trunc(Number(progressItem?.durationMs) || 0));
  const next = displayItems.slice();
  const updatedAt = Number(progressItem?.updatedAt || 0);
  next[index] = { ...next[index], positionMs, durationMs, ...(updatedAt > 0 ? { updatedAt } : {}) };
  return updatedAt > 0
    ? next.sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0))
    : next;
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
  const key = watchProgressCardKey(finishedItem);
  if (!key || !Array.isArray(displayItems) || !displayItems.length) {
    return null;
  }
  const next = displayItems.filter((item) => watchProgressCardKey(item) !== key);
  return next.length === displayItems.length ? null : next;
}

// Unwatch invalidates derived Next Up immediately; another episode's genuine
// in-progress card stays put until the full, source-scoped reconciliation.
export function resetContinueWatchingDisplayWatchedState(displayItems, target) {
  if (!Array.isArray(displayItems) || !target?.contentId) return null;
  const scoped = target.season != null || target.episode != null;
  const key = watchProgressCardKey(target);
  const next = displayItems.filter((item) => {
    if (String(item.contentId) !== String(target.contentId)) return true;
    if (target.rootOnly) return !item.isNextUp;
    return scoped && !item.isNextUp && watchProgressCardKey(item) !== key;
  });
  return next.length === displayItems.length ? null : next;
}

// A remounted Home missed completion notifications. Retire stale cached cards
// synchronously, but preserve a rewatch started after the watched marker.
export function retireCompletedContinueWatchingCards(
  displayItems,
  watchedItems,
  progressItems = []
) {
  const watched = new Map(
    watchedItems.map((item) => [watchProgressCardKey(item), Number(item.watchedAt || 0)])
  );
  const progress = new Map(progressItems.map((item) => [watchProgressCardKey(item), item]));
  const next = (displayItems || []).filter((item) => {
    const key = watchProgressCardKey(item);
    if (!watched.has(key)) return true;
    const current = progress.get(key);
    return (
      current &&
      Number(current.updatedAt || 0) > watched.get(key) &&
      Number(current.positionMs || 0) > 0 &&
      Number(current.durationMs || 0) > 0 &&
      Number(current.positionMs) / Number(current.durationMs) < 0.9
    );
  });
  return next.length === (displayItems || []).length ? displayItems : next;
}
