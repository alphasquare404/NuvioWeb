import {
  hasWatchProgressStarted,
  isWatchProgressCompleted,
  isWatchProgressInProgress
} from "../../domain/model/watchProgress.js";
import { watchedItemIdentityValues } from "./watchedIdentity.js";

export function isSeriesType(type) {
  const normalized = String(type || "").toLowerCase();
  return normalized === "series" || normalized === "tv";
}

export function shouldTreatAsInProgressForContinueWatching(item = {}) {
  if (isWatchProgressInProgress(item)) {
    return true;
  }
  if (isWatchProgressCompleted(item)) {
    return false;
  }
  return hasWatchProgressStarted(item);
}

/**
 * Collapses a merged progress list down to one card per title.
 *
 * Continue Watching combines local playback rows with the selected tracker's
 * own records, and the two sides are free to identify the same title
 * differently: SIMKL may return `mal:1234` where the addon that played it used
 * `tt0903747`. Matching on identity sets rather than the raw contentId is what
 * keeps those from becoming two cards.
 *
 * Films and series are deduplicated separately so a movie can never collapse
 * into a show that happens to share an id in some provider's namespace.
 */
export function deduplicateContinueWatchingItems(items = []) {
  const nonSeriesItems = [];
  const latestSeriesItems = [];
  const seenSeriesIdentities = new Set();
  const seenNonSeriesIdentities = new Set();

  (Array.isArray(items) ? items : [])
    .slice()
    .sort((left, right) => Number(right.updatedAt || 0) - Number(left.updatedAt || 0))
    .forEach((item) => {
      const isSeries = isSeriesType(item?.contentType);
      const seenIdentities = isSeries ? seenSeriesIdentities : seenNonSeriesIdentities;
      const identities = Array.from(watchedItemIdentityValues(item));
      if (!identities.length || identities.some((identity) => seenIdentities.has(identity))) {
        return;
      }
      identities.forEach((identity) => seenIdentities.add(identity));
      // Eligibility is decided only after the newest record for a title has
      // won. Checking it first would drop a completed newest record and let an
      // older partial one resurface, putting a title you already finished back
      // into Continue Watching beside its real Next Up.
      if (shouldTreatAsInProgressForContinueWatching(item)) {
        (isSeries ? latestSeriesItems : nonSeriesItems).push(item);
      }
    });

  return [...nonSeriesItems, ...latestSeriesItems].sort(
    (left, right) => Number(right.updatedAt || 0) - Number(left.updatedAt || 0)
  );
}
