// Transitional suppression for provider-backed Continue Watching removals.
//
// A SIMKL or Trakt row is not stored locally: it is read fresh from the
// provider snapshot every time Continue Watching is composed. Deleting the
// remote playback entry is a network round trip, so between the user pressing
// Remove and the provider confirming it, the next compose would hand the item
// straight back and the card would visibly return.
//
// So a removed target is suppressed from the projection until a *fresh snapshot
// proves it is gone*. That is deliberately not the same as "the refresh call
// succeeded" -- a refresh can succeed and still carry the row, because the
// provider had not applied the delete yet.
//
// This is reconciliation state, never a tombstone. Every path out of
// suppression ends in the item being shown again if it really is still there:
// a definitive delete failure drops it immediately, and otherwise it expires
// after a bounded number of reconciles or a bounded time. A permanently
// suppressed item would be a lie the user could not undo.

const DEFAULT_MAX_RECONCILES = 3;
const DEFAULT_MAX_AGE_MS = 60000;

export function normalizeSuppressionKey(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

/**
 * Removal is title-wide, so suppression is keyed by contentId alone. Episode
 * identity deliberately plays no part: removing a series removes its progress.
 */
export function createContinueWatchingRemovalSuppression({
  maxReconciles = DEFAULT_MAX_RECONCILES,
  maxAgeMs = DEFAULT_MAX_AGE_MS,
  now = () => Date.now()
} = {}) {
  const entries = new Map();

  function suppress(contentId) {
    const key = normalizeSuppressionKey(contentId);
    if (!key) {
      return false;
    }
    entries.set(key, { createdAt: now(), reconciles: 0 });
    return true;
  }

  function isSuppressed(contentId) {
    return entries.has(normalizeSuppressionKey(contentId));
  }

  function release(contentId) {
    return entries.delete(normalizeSuppressionKey(contentId));
  }

  function filterItems(items = []) {
    if (!entries.size) {
      return Array.isArray(items) ? items : [];
    }
    return (Array.isArray(items) ? items : []).filter((item) => !isSuppressed(item?.contentId));
  }

  /**
   * Settle suppression against a freshly fetched provider snapshot.
   *
   * @param snapshotContentIds every contentId the new snapshot still carries.
   * @param deletionFailed the remote delete definitively failed, so the
   *   provider is the authority and the item should come back rather than stay
   *   hidden behind a removal that never happened.
   */
  function reconcile(snapshotContentIds = [], { deletionFailed = false } = {}) {
    if (!entries.size) {
      return [];
    }
    const present = new Set(
      (Array.isArray(snapshotContentIds) ? snapshotContentIds : [])
        .map(normalizeSuppressionKey)
        .filter(Boolean)
    );
    const released = [];
    const currentTime = now();
    entries.forEach((entry, key) => {
      if (!present.has(key)) {
        // The snapshot no longer carries it: the removal is real.
        released.push(key);
        return;
      }
      if (deletionFailed) {
        released.push(key);
        return;
      }
      entry.reconciles += 1;
      const expired =
        entry.reconciles >= maxReconciles || currentTime - entry.createdAt >= maxAgeMs;
      if (expired) {
        released.push(key);
      }
    });
    released.forEach((key) => entries.delete(key));
    return released;
  }

  return {
    suppress,
    isSuppressed,
    release,
    filterItems,
    reconcile,
    clear: () => entries.clear(),
    get size() {
      return entries.size;
    }
  };
}

export const continueWatchingRemovalSuppression = createContinueWatchingRemovalSuppression();
