import assert from "node:assert/strict";
import test from "node:test";

const { shouldSeedNextUpFromLocalWatchedItems, selectWatchedItemsForContinueWatching } =
  await import("./nextUpSeedPolicy.js");

const localWatched = { contentId: "tt21209876", season: 2, episode: 13 };
const simklWatched = { contentId: "tt0903747", season: 1, episode: 4, trackingProviderId: "simkl" };

test("only Nuvio Sync seeds Next Up from the local watched-items store", () => {
  assert.equal(shouldSeedNextUpFromLocalWatchedItems("nuvio_sync"), true);
});

test("a tracking provider never has local watched items merged into its Next Up", () => {
  // The reported failure: after switching to SIMKL, shows SIMKL had never heard
  // of kept appearing as "Next episode" cards, because the local watched-items
  // store is not scoped to any provider.
  assert.equal(shouldSeedNextUpFromLocalWatchedItems("simkl"), false);
  assert.equal(shouldSeedNextUpFromLocalWatchedItems("trakt"), false);
});

test("an unknown or missing source is treated as a tracking provider, not as local", () => {
  assert.equal(shouldSeedNextUpFromLocalWatchedItems(undefined), false);
  assert.equal(shouldSeedNextUpFromLocalWatchedItems(null), false);
  assert.equal(shouldSeedNextUpFromLocalWatchedItems(""), false);
  assert.equal(shouldSeedNextUpFromLocalWatchedItems("something-else"), false);
});

test("under SIMKL only SIMKL's watched episodes count, so Next Up cannot skip ahead", () => {
  // Filtering titles alone left the right shows resuming at the wrong episode:
  // the watched episode index still held local episodes the provider has no
  // record of, so Next Up advanced past them.
  const result = selectWatchedItemsForContinueWatching([localWatched, simklWatched], "simkl");
  assert.deepEqual(result, [simklWatched]);
});

test("under SIMKL an empty provider result stays empty rather than falling back to local", () => {
  assert.deepEqual(selectWatchedItemsForContinueWatching([localWatched], "simkl"), []);
});

test("Nuvio Sync keeps the local watched items, which are its own state", () => {
  const items = [localWatched, simklWatched];
  assert.deepEqual(selectWatchedItemsForContinueWatching(items, "nuvio_sync"), items);
});

test("Trakt is left untouched: it supplies watched state through progress seeds", () => {
  const items = [localWatched];
  assert.deepEqual(selectWatchedItemsForContinueWatching(items, "trakt"), items);
});

test("a malformed list never throws", () => {
  assert.deepEqual(selectWatchedItemsForContinueWatching(null, "simkl"), []);
  assert.deepEqual(selectWatchedItemsForContinueWatching(undefined, "nuvio_sync"), []);
});
