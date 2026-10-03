import { WatchProgressSource } from "../local/traktSettingsStore.js";
import { isWatchProgressFromOtherSource, watchProgressOwner } from "./watchProgressProvenance.js";

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
 * through the source-filtered progress list -- so reaching into the local store
 * as well merges one source's viewing history into another's Continue Watching.
 * That is how shows the selected provider has never heard of kept appearing as
 * "Next episode" cards after switching to it: the local store is not scoped to
 * any provider, so nothing filtered them out.
 */
export function shouldSeedNextUpFromLocalWatchedItems(continueWatchingSource) {
  return String(continueWatchingSource || "") === WatchProgressSource.NUVIO_SYNC;
}

/**
 * The watched items a screen is allowed to reason about.
 *
 * Two questions, not one, and the rule used to answer only the first.
 *
 * Under a provider that keeps its own watched list, only that provider's
 * records may count. Filtering titles alone once left the right shows resuming
 * at the wrong episode, because the watched episode index still held local
 * episodes the provider had no record of and Next Up advanced past them. A
 * record qualifies either by carrying the provider's id -- the provider's own
 * list does -- or by its source tag, which is how viewing recorded here while
 * that provider owned the row is marked "simkl_local". The tag half was
 * missing, so Simkl's own local records were hidden from Simkl.
 *
 * Under Nuvio Sync the question is the other way round: anything a provider
 * owns is excluded, and everything else stays. That half was missing too, which
 * is why a season marked watched under Simkl turned up as watched under Nuvio
 * Sync -- on screen only, since the cloud push correctly refuses rows that are
 * not Nuvio Sync's.
 *
 * An untagged record belongs to nobody in particular: it predates the tag, or
 * came back from a cloud with no column for it. Under Nuvio Sync it stays, as
 * it does on the progress side. Under a provider it does not count, which is
 * the whole point of the first question.
 */
export function selectWatchedItemsForSource(watchedItems, continueWatchingSource) {
  const items = Array.isArray(watchedItems) ? watchedItems : [];
  const selected = String(continueWatchingSource || "");
  if (PROVIDERS_OWNING_WATCHED_ITEMS.has(selected)) {
    return items.filter(
      (item) =>
        String(item?.trackingProviderId || "") === selected || watchProgressOwner(item) === selected
    );
  }
  return items.filter((item) => !isWatchProgressFromOtherSource(item, selected));
}
