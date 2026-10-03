import assert from "node:assert/strict";
import test from "node:test";
import { selectWatchedItemsForSource } from "./watchedItemsScope.js";

// Reported from a real library: a season marked watched while Simkl owned
// Continue Watching turned up as watched under Nuvio Sync as well. The cloud
// stayed clean -- the push correctly refuses rows that are not Nuvio Sync's --
// so it was only the rows on screen that crossed over.
//
// A record carries its owner in `source`: "simkl_local" for one recorded while
// Simkl owned the row, "nuvio_sync" for Nuvio's own. The same tag the progress
// list has always been filtered by.

const episode = (source, episodeNumber = 1) => ({
  contentId: "tt0306414",
  contentType: "series",
  season: 1,
  episode: episodeNumber,
  watchedAt: 1_790_000_000_000 + episodeNumber,
  ...(source ? { source } : {})
});

test("a record made under Simkl does not count under Nuvio Sync", () => {
  const kept = selectWatchedItemsForSource([episode("simkl_local")], "nuvio_sync");
  assert.deepEqual(kept, []);
});

test("a record made under Simkl does count under Simkl", () => {
  // The rule this replaced hid these too, by matching a field a locally
  // recorded row never carries.
  const kept = selectWatchedItemsForSource([episode("simkl_local")], "simkl");
  assert.equal(kept.length, 1);
});

test("Nuvio Sync's own records do not count under Simkl", () => {
  assert.deepEqual(selectWatchedItemsForSource([episode("nuvio_sync")], "simkl"), []);
});

// The provider's own list arrives carrying its id rather than a source tag.
test("the provider's own records count under it", () => {
  const fromSimkl = { ...episode(null, 4), trackingProviderId: "simkl" };
  assert.equal(selectWatchedItemsForSource([fromSimkl], "simkl").length, 1);
  assert.deepEqual(selectWatchedItemsForSource([fromSimkl], "nuvio_sync"), [fromSimkl]);
});

test("Trakt is scoped the same way", () => {
  assert.deepEqual(selectWatchedItemsForSource([episode("trakt_history")], "nuvio_sync"), []);
  assert.equal(selectWatchedItemsForSource([episode("trakt_history")], "trakt").length, 1);
});

// Under Nuvio Sync an untagged row belongs to nobody in particular and stays,
// as it does on the progress side. Under Simkl it does not count: that is the
// rule that stopped Next Up skipping past episodes Simkl had no record of.
test("an untagged record stays under Nuvio Sync and not under Simkl", () => {
  for (const source of ["nuvio_sync", "trakt", ""]) {
    assert.equal(
      selectWatchedItemsForSource([episode(null)], source).length,
      1,
      source || "(none)"
    );
  }
  assert.deepEqual(selectWatchedItemsForSource([episode(null)], "simkl"), []);
});

test("a mixed list keeps only what the selected source owns", () => {
  const list = [episode("simkl_local", 1), episode("nuvio_sync", 2), episode(null, 3)];
  assert.deepEqual(
    selectWatchedItemsForSource(list, "nuvio_sync").map((i) => i.episode),
    [2, 3]
  );
  assert.deepEqual(
    selectWatchedItemsForSource(list, "simkl").map((i) => i.episode),
    [1]
  );
});

test("nothing in, nothing out", () => {
  assert.deepEqual(selectWatchedItemsForSource(null, "simkl"), []);
});

// One rule, reached from both screens under the name each already used.
test("Home reaches the same function", async () => {
  const { selectWatchedItemsForContinueWatching } =
    await import("../../ui/screens/home/nextUpSeedPolicy.js");
  assert.equal(selectWatchedItemsForContinueWatching, selectWatchedItemsForSource);
});
