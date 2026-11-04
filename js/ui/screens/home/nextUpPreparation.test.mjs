import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { retireCompletedContinueWatchingCards } from "./continueWatchingProgressPatch.js";
import { watchProgressCardKey } from "../../../domain/model/watchProgress.js";
import { createPlaybackCompletionPreparation } from "../../../data/repository/playbackCompletionPreparation.js";
const source = readFileSync(new URL("./homeScreen.js", import.meta.url), "utf8");
const completed = { contentId: "show", season: 1, episode: 2, watchedAt: 100 };
const card = { ...completed, positionMs: 600, durationMs: 1000 };
const next = { contentId: "show", season: 1, episode: 3, isNextUp: true, updatedAt: 100 };
function fixture() {
  const state = {
    scope: "1:nuvio",
    prefs: { showUnairedNextUp: false },
    watched: [completed],
    progress: [],
    writes: []
  };
  let resolve;
  const deps = {
    watchProgressRepository: {
      getContinueWatchingSourceKey: () => state.scope,
      getContinueWatchingSource: () => "nuvio"
    },
    ProfileManager: { getActiveProfileId: () => "1" },
    LayoutPreferences: { get: () => state.prefs },
    watchProgressCardKey,
    WatchedItemsStore: { listForProfile: () => state.watched },
    WatchProgressStore: { listForProfile: () => state.progress },
    selectWatchedItemsForContinueWatching: (items) => items,
    isWatchProgressFromOtherSource: () => false,
    shouldSeedNextUpFromLocalWatchedItems: () => true,
    readContinueWatchingDisplaySnapshot: () => [card],
    retireCompletedContinueWatchingCards,
    ContinueWatchingPreferences: { getDismissedNextUpKeys: () => [] },
    writeContinueWatchingDisplaySnapshot: (scope, display) => state.writes.push({ scope, display })
  };
  const start = source.indexOf("  async prepareCompletedEpisodeNextUp("),
    end = source.indexOf("\n  persistContinueWatchingSnapshot()", start);
  const method = new Function(...Object.keys(deps), "return ({" + source.slice(start, end) + "})")(
    ...Object.values(deps)
  ).prepareCompletedEpisodeNextUp;
  const ctx = {
    loadedWatchProgressSourceKey: "1:nuvio",
    continueWatchingDisplay: [card],
    selectNextUpProgressCandidates: (all) => all,
    buildNextUpItems: async (opts) => {
      state.options = opts;
      return new Promise((r) => {
        resolve = r;
      });
    },
    requestBackgroundRender: () => {
      state.rendered = true;
    }
  };
  return {
    state,
    ctx,
    prepare: () =>
      method.call(ctx, { itemId: "show", itemType: "series", season: 1, episode: 2 }, "1:nuvio"),
    finish: () => resolve([next])
  };
}
test("completion prepares the existing Next Up resolver while Home is absent and saves its result", async () => {
  const f = fixture();
  const pending = f.prepare();
  assert.equal(f.state.writes.length, 0);
  assert.equal(f.state.options.layoutPrefs.showUnairedNextUp, false);
  f.finish();
  assert.equal(await pending, true);
  assert.deepEqual(f.ctx.continueWatchingDisplay, [next]);
  assert.deepEqual(f.state.writes[0].display, [next]);
});
for (const change of ["scope", "unwatch", "progress", "settings"])
  test("late preparation cannot overwrite " + change, async () => {
    const f = fixture();
    const pending = f.prepare();
    if (change === "scope") f.state.scope = "2:nuvio";
    if (change === "unwatch") f.state.watched = [];
    if (change === "progress")
      f.state.progress = [
        {
          contentId: "show",
          season: 1,
          episode: 3,
          positionMs: 50,
          durationMs: 1000,
          updatedAt: 101
        }
      ];
    if (change === "settings") f.state.prefs = { showUnairedNextUp: true };
    f.finish();
    assert.equal(await pending, false);
    assert.equal(f.state.writes.length, 0);
  });
test("remounted cache retires only completed episodes, retaining Next Up and newer rewatches", () => {
  assert.deepEqual(retireCompletedContinueWatchingCards([card, next], [completed]), [next]);
  assert.deepEqual(
    retireCompletedContinueWatchingCards([card], [completed], [{ ...card, updatedAt: 101 }]),
    [card]
  );
  assert.deepEqual(
    retireCompletedContinueWatchingCards([card], [completed], [{ ...card, updatedAt: 99 }]),
    []
  );
  assert.deepEqual(retireCompletedContinueWatchingCards([card], []), [card]);
});
test("repeated completion shares preparation; other profiles or episodes get distinct work", async () => {
  const service = createPlaybackCompletionPreparation();
  let calls = 0,
    finish;
  service.register(async () => {
    calls++;
    return new Promise((r) => {
      finish = r;
    });
  });
  const context = { itemId: "show", season: 1, episode: 2 };
  const first = service.prepare(context, "1:nuvio");
  const second = service.prepare(context, "1:nuvio");
  await Promise.resolve();
  assert.equal(calls, 1);
  assert.equal(first, second);
  finish(true);
  await first;
  assert.equal(await service.prepare(context, "1:nuvio"), true);
  assert.equal(calls, 1);
  const third = service.prepare(context, "2:nuvio");
  await Promise.resolve();
  assert.equal(calls, 2);
  finish(true);
  await third;
});
