// Transitional suppression for provider-backed Continue Watching removals.
//
// A SIMKL or Trakt row is not stored locally: it is read fresh from the
// provider snapshot every time Continue Watching is composed. Deleting the
// remote playback entry is a network round trip, so between the user pressing
// Remove and the provider confirming it, the next compose would hand the item
// straight back and the card would visibly return.
//
// So a removed target is suppressed from the projection until the provider
// itself settles it. That is deliberately not the same as "the refresh call
// succeeded" -- a refresh can succeed and still carry the row, because the
// provider had not applied the delete yet.
//
// There are exactly two ways out, and both are authoritative:
//
//   1. a fresh provider snapshot no longer carries the target -> the removal
//      is real, stop suppressing it;
//   2. the delete definitively failed while the provider still reports the
//      target -> the provider wins, show it again.
//
// Nothing else releases a suppression. There is no time limit and no reconcile
// budget: a card that came back because a timer fired would be a removal
// silently undoing itself, with no provider fact behind it. This is also why
// suppression is never persisted -- it lives in memory, dies with the page,
// and is dropped wholesale by `scopeTo` when the profile or the Continue
// Watching source changes, since a suppression only means anything against the
// provider account it was created for.

export function normalizeSuppressionKey(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

/**
 * Removal is title-wide, so suppression is keyed by contentId alone. Episode
 * identity deliberately plays no part: removing a series removes its progress.
 */
export function createContinueWatchingRemovalSuppression() {
  const entries = new Set();
  let scope = null;

  function suppress(contentId) {
    const key = normalizeSuppressionKey(contentId);
    if (!key) {
      return false;
    }
    entries.add(key);
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
   * Lifecycle cleanup, not expiry.
   *
   * A suppression is a claim about one provider account: it is meaningless
   * against a different profile or a different Continue Watching source, and
   * leaving it in place would hide somebody else's card. Dropping the whole set
   * when the scope changes is the cleanup the removed timer used to approximate
   * by accident.
   *
   * @returns whether the scope changed, which means entries were dropped.
   */
  function scopeTo(scopeKey) {
    const key = String(scopeKey ?? "");
    if (key === scope) {
      return false;
    }
    scope = key;
    entries.clear();
    return true;
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
    entries.forEach((key) => {
      if (!present.has(key)) {
        // The snapshot no longer carries it: the removal is real.
        released.push(key);
        return;
      }
      if (deletionFailed) {
        // The provider still has it and the delete definitively failed, so the
        // provider is right and the card belongs back on screen.
        released.push(key);
      }
      // Still present and nothing has failed: the delete is simply not applied
      // yet. Keep suppressing and ask the provider again next compose.
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
    scopeTo,
    clear: () => entries.clear(),
    get size() {
      return entries.size;
    }
  };
}

export const continueWatchingRemovalSuppression = createContinueWatchingRemovalSuppression();
