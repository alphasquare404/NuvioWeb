import assert from "node:assert/strict";
import test from "node:test";

const { deduplicateContinueWatchingItems } = await import("./continueWatchingDeduplication.js");
const { watchedItemIdentityValues, watchedItemsShareIdentity } =
  await import("./watchedIdentity.js");

// Half-watched, so every fixture is Continue-Watching eligible unless it says
// otherwise.
function partial(overrides = {}) {
  return {
    contentType: "movie",
    positionMs: 30 * 60 * 1000,
    durationMs: 100 * 60 * 1000,
    progressPercent: 30,
    updatedAt: 1000,
    ...overrides
  };
}

test("a film present both locally and on the tracker yields one card", () => {
  // The exact reported failure: films were never deduplicated at all, so the
  // local row and SIMKL's own record produced two identical cards.
  const items = [
    partial({ contentId: "tt1130884", source: "simkl_local", updatedAt: 2000 }),
    partial({ contentId: "tt1130884", source: "simkl_history", updatedAt: 1000 })
  ];
  const result = deduplicateContinueWatchingItems(items);
  assert.equal(result.length, 1);
  assert.equal(result[0].source, "simkl_local", "the newest record wins");
});

test("the same show under different provider namespaces yields one card", () => {
  const items = [
    partial({
      contentType: "series",
      contentId: "tt0903747",
      source: "simkl_local",
      updatedAt: 2000
    }),
    partial({
      contentType: "series",
      contentId: "mal:1234",
      imdbId: "tt0903747",
      source: "simkl_history",
      updatedAt: 1000
    })
  ];
  assert.equal(deduplicateContinueWatchingItems(items).length, 1);
});

test("an anime with no IMDb id still matches through SIMKL's alias set", () => {
  // SIMKL is the only side that knows every alias, so it carries them; the
  // local row holds whichever single id its addon happened to use.
  const items = [
    partial({
      contentType: "series",
      contentId: "kitsu:998",
      source: "simkl_local",
      updatedAt: 2000
    }),
    partial({
      contentType: "series",
      contentId: "mal:1234",
      ids: { mal: "1234", kitsu: "998", anidb: "77" },
      source: "simkl_history",
      updatedAt: 1000
    })
  ];
  assert.equal(deduplicateContinueWatchingItems(items).length, 1);
});

test("genuinely different titles are never merged", () => {
  const items = [
    partial({ contentId: "tt1130884", updatedAt: 3000 }),
    partial({ contentId: "tt0903747", updatedAt: 2000 }),
    partial({ contentType: "series", contentId: "tt2085059", updatedAt: 1000 })
  ];
  assert.equal(deduplicateContinueWatchingItems(items).length, 3);
});

test("a film and a series sharing an id in some namespace stay separate", () => {
  const items = [
    partial({ contentType: "movie", contentId: "tmdb:99", updatedAt: 2000 }),
    partial({ contentType: "series", contentId: "tmdb:99", updatedAt: 1000 })
  ];
  assert.equal(deduplicateContinueWatchingItems(items).length, 2);
});

test("missing ids carried as zero never collapse unrelated titles", () => {
  const items = [
    partial({ contentId: "tt1130884", tmdbId: 0, updatedAt: 3000 }),
    partial({ contentId: "tt0903747", tmdbId: 0, updatedAt: 2000 }),
    partial({ contentId: "tt2085059", ids: { tmdb: "0", mal: "0" }, updatedAt: 1000 })
  ];
  assert.equal(deduplicateContinueWatchingItems(items).length, 3);
});

test("a finished title does not come back through an older partial record", () => {
  const items = [
    partial({
      contentId: "tt1130884",
      positionMs: 99 * 60 * 1000,
      progressPercent: 99,
      updatedAt: 2000
    }),
    partial({ contentId: "tt1130884", updatedAt: 1000 })
  ];
  assert.deepEqual(deduplicateContinueWatchingItems(items), []);
});

test("two episodes of one series collapse to its newest state", () => {
  const items = [
    partial({ contentType: "series", contentId: "tt0903747", episode: 4, updatedAt: 2000 }),
    partial({ contentType: "series", contentId: "tt0903747", episode: 2, updatedAt: 1000 })
  ];
  const result = deduplicateContinueWatchingItems(items);
  assert.equal(result.length, 1);
  assert.equal(result[0].episode, 4);
});

test("items with no usable identity at all are dropped rather than duplicated", () => {
  assert.deepEqual(deduplicateContinueWatchingItems([partial({ contentId: "" })]), []);
});

test("results stay ordered newest first", () => {
  const items = [
    partial({ contentId: "tt1", updatedAt: 1000 }),
    partial({ contentType: "series", contentId: "tt2", updatedAt: 3000 }),
    partial({ contentId: "tt3", updatedAt: 2000 })
  ];
  assert.deepEqual(
    deduplicateContinueWatchingItems(items).map((item) => item.contentId),
    ["tt2", "tt3", "tt1"]
  );
});

test("identity values cover the namespaces SIMKL actually returns", () => {
  const identities = watchedItemIdentityValues({
    contentId: "mal:1234",
    imdbId: "tt0903747",
    ids: { tvdb: "81189", kitsu: "998", simkl: "55" }
  });
  ["mal:1234", "tt0903747", "tvdb:81189", "kitsu:998", "simkl:55"].forEach((value) => {
    assert.ok(identities.has(value), `expected identity ${value}`);
  });
});

test("watchedItemsShareIdentity bridges two records of the same title", () => {
  assert.equal(
    watchedItemsShareIdentity(
      { contentId: "tt0903747" },
      { contentId: "mal:1", imdbId: "tt0903747" }
    ),
    true
  );
  assert.equal(
    watchedItemsShareIdentity({ contentId: "tt0903747" }, { contentId: "tt1130884" }),
    false
  );
});
