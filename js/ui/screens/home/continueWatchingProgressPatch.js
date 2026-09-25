// Fast, safe path for reflecting an authoritative progress write (e.g. an
// accepted external-player callback report) on an already-displayed
// Continue Watching card, without waiting for the full store refresh /
// Next-Up re-resolution pipeline. Only the position/duration of an item
// that is already showing is touched here — nothing about ordering, artwork,
// or which items appear is decided by this module, so it can never guess a
// wrong Next-Up episode or misorder the row. The full refresh still runs
// afterward to reconcile everything else.

// Shared with the on-disk display snapshot, which is this same list persisted:
// a key that disagreed between them patched one and left the other stale.
import { watchProgressCardKey } from "../../../domain/model/watchProgress.js";

// Returns a new array with the matching item's positionMs/durationMs patched
// in place, or null if no displayed item matches this progress write (the
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
  const key = watchProgressCardKey(finishedItem);
  if (!key || !Array.isArray(displayItems) || !displayItems.length) {
    return null;
  }
  const next = displayItems.filter((item) => watchProgressCardKey(item) !== key);
  return next.length === displayItems.length ? null : next;
}
