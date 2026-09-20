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
