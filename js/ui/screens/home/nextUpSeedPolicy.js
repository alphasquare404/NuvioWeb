import { WatchProgressSource } from "../../../data/local/traktSettingsStore.js";

// Providers that deliver their own watched state through the watched-items
// list. Trakt is deliberately absent: it ships its watched shows through the
// progress snapshot's seeds instead, so this list holds nothing of Trakt's and
// narrowing it would only blank the episode index.
const PROVIDERS_OWNING_WATCHED_ITEMS = new Set([WatchProgressSource.SIMKL]);

/**
 * Whether Next Up may be seeded from the local watched-items store.
 *
 * Only when Nuvio Sync owns Continue Watching. A tracking provider ships its
 * own watched-show seeds in its progress snapshot, and those already travel
 * through the source-filtered progress list — so reaching into the local store
 * as well merges one source's viewing history into another's Continue Watching.
 * That is how shows the selected provider has never heard of kept appearing as
 * "Next episode" cards after switching to it: the local store is not scoped to
 * any provider, so nothing filtered them out.
 */
export function shouldSeedNextUpFromLocalWatchedItems(continueWatchingSource) {
  return String(continueWatchingSource || "") === WatchProgressSource.NUVIO_SYNC;
}

/**
 * The watched items Continue Watching is allowed to reason about.
 *
 * Which titles appear is only half of "the selected source owns Continue
 * Watching" — which *episode* each card resumes at is decided by the watched
 * episode index built from this list. Leaving another source's watched episodes
 * in it makes Next Up skip ahead past episodes the selected provider has no
 * record of, so a correctly-filtered show still shows the wrong episode.
 */
export function selectWatchedItemsForContinueWatching(watchedItems, continueWatchingSource) {
  const items = Array.isArray(watchedItems) ? watchedItems : [];
  const source = String(continueWatchingSource || "");
  if (!PROVIDERS_OWNING_WATCHED_ITEMS.has(source)) {
    return items;
  }
  return items.filter((item) => String(item?.trackingProviderId || "") === source);
}
