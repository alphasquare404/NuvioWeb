// The policy itself lives beside the data, because Home is not the only screen
// that has to apply it -- see watchedItemsScope.js. Re-exported here under the
// name Home has always used it by.
export {
  shouldSeedNextUpFromLocalWatchedItems,
  selectWatchedItemsForSource as selectWatchedItemsForContinueWatching
} from "../../../data/repository/watchedItemsScope.js";
