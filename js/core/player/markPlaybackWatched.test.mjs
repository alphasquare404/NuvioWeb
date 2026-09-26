import assert from "node:assert/strict";
import test from "node:test";
import { createMarkPlaybackWatched } from "./markPlaybackWatched.js";

test("external movie completion marks watched and removes its resumable progress", async () => {
  const watched = [];
  const removed = [];
  const mark = createMarkPlaybackWatched({
    watchedRepository: { mark: async (item) => watched.push(item) },
    progressRepository: { removePlaybackProgress: async (identity) => removed.push(identity) },
    seriesReconciliation: { isSeriesType: () => false }
  });
  await mark({ itemId: "movie:1", itemType: "movie", title: "Movie" });
  assert.equal(watched[0].contentId, "movie:1");
  assert.deepEqual(removed[0], {
    itemId: "movie:1",
    itemType: "movie",
    videoId: null,
    season: null,
    episode: null,
    title: "Movie",
    episodeTitle: null
  });
});

test("episode completion clears matching season/episode progress and reconciles next-up state", async () => {
  const calls = [];
  const mark = createMarkPlaybackWatched({
    watchedRepository: { mark: async (item) => calls.push(["watched", item]) },
    progressRepository: {
      removePlaybackProgress: async (identity) => calls.push(["progress-removed", identity])
    },
    seriesReconciliation: {
      isSeriesType: () => true,
      reconcile: async (id, type, options) => calls.push(["reconciled", { id, type, options }])
    }
  });
  await mark({
    itemId: "series:1",
    itemType: "series",
    videoId: "old-provider-id",
    season: 1,
    episode: 3,
    title: "Show"
  });
  assert.equal(calls[0][0], "watched");
  assert.equal(calls[1][0], "progress-removed");
  assert.deepEqual(calls[1][1].season, 1);
  assert.deepEqual(calls[1][1].episode, 3);
  assert.deepEqual(calls[2], [
    "reconciled",
    {
      id: "series:1",
      type: "series",
      options: { title: "Show", completedEpisode: { season: 1, episode: 3 } }
    }
  ]);
});

test("a completion the provider already heard about as a scrobble is not written twice", async () => {
  // A scrobble stop both marks watched and clears the provider's resume entry.
  // Writing the history again here would duplicate the entry.
  const options = [];
  const mark = createMarkPlaybackWatched({
    watchedRepository: { mark: async (_item, opts) => options.push(opts) },
    progressRepository: { removePlaybackProgress: async () => {} },
    seriesReconciliation: { isSeriesType: () => false }
  });
  await mark({ itemId: "movie:1", itemType: "movie" }, { skipTrackingWrite: true });
  assert.equal(options[0].skipTrackingWrite, true);
});

test("an ordinary completion still writes the provider history itself", async () => {
  const options = [];
  const mark = createMarkPlaybackWatched({
    watchedRepository: { mark: async (_item, opts) => options.push(opts) },
    progressRepository: { removePlaybackProgress: async () => {} },
    seriesReconciliation: { isSeriesType: () => false }
  });
  await mark({ itemId: "movie:1", itemType: "movie" });
  assert.equal(options[0].skipTrackingWrite, false);
  assert.equal(options[0].authoritative, false);
});

// A finished film that left Continue Watching and never appeared as watched.
//
// `createProgressContext` states a movie's absent season and episode as null.
// Normalising them with `Number.isFinite(Number(value))` turned that into 0,
// because `Number(null)` is 0 and 0 is finite. `isWatched` only calls a movie
// watched when its season and episode are null, so the completion was written
// and then could not be found.
//
// The tests above passed a context with season and episode left undefined,
// where `Number(undefined)` is NaN and the guard happened to give null. The
// caller sends null, which is the case that broke.
test("a movie completed from the player has no season or episode", async () => {
  const watched = [];
  const removed = [];
  const mark = createMarkPlaybackWatched({
    watchedRepository: { mark: async (item) => watched.push(item) },
    progressRepository: { removePlaybackProgress: async (identity) => removed.push(identity) },
    seriesReconciliation: { isSeriesType: () => false }
  });
  // Exactly what createProgressContext builds for a movie.
  await mark({
    itemId: "movie:1",
    itemType: "movie",
    videoId: null,
    season: null,
    episode: null,
    title: "Movie"
  });
  assert.equal(watched[0].season, null, "a movie marked watched at season 0 cannot be found");
  assert.equal(watched[0].episode, null);
  assert.equal(removed[0].season, null);
  assert.equal(removed[0].episode, null);
});

// The same shape isWatched applies, so the assertion above is the one that
// decides whether a film reads as watched.
test("a movie watched entry satisfies the movie lookup", async () => {
  const watched = [];
  const mark = createMarkPlaybackWatched({
    watchedRepository: { mark: async (item) => watched.push(item) },
    progressRepository: { removePlaybackProgress: async () => {} },
    seriesReconciliation: { isSeriesType: () => false }
  });
  await mark({ itemId: "movie:2", itemType: "movie", season: null, episode: null });
  const entry = watched[0];
  assert.equal(entry.season == null && entry.episode == null, true);
});

// An episode still carries its numbers; the fix must not flatten those.
test("an episode keeps its season and episode", async () => {
  const watched = [];
  const mark = createMarkPlaybackWatched({
    watchedRepository: { mark: async (item) => watched.push(item) },
    progressRepository: { removePlaybackProgress: async () => {} },
    seriesReconciliation: { isSeriesType: () => false }
  });
  await mark({ itemId: "tt1", itemType: "series", videoId: "tt1:2:5", season: 2, episode: 5 });
  assert.equal(watched[0].season, 2);
  assert.equal(watched[0].episode, 5);
});

// Season zero is a real season -- specials -- and must not be read as absent.
test("season zero survives as zero", async () => {
  const watched = [];
  const mark = createMarkPlaybackWatched({
    watchedRepository: { mark: async (item) => watched.push(item) },
    progressRepository: { removePlaybackProgress: async () => {} },
    seriesReconciliation: { isSeriesType: () => false }
  });
  await mark({ itemId: "tt2", itemType: "series", season: 0, episode: 3 });
  assert.equal(watched[0].season, 0);
  assert.equal(watched[0].episode, 3);
});
