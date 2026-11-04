import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  resetContinueWatchingDisplayWatchedState,
  patchContinueWatchingDisplayProgress,
  removeContinueWatchingDisplayItem
} from "./continueWatchingProgressPatch.js";
import { shouldRefreshContinueWatchingForChange } from "./continueWatchingRefreshPolicy.js";
const source = readFileSync(new URL("./homeScreen.js", import.meta.url), "utf8");
const start = source.indexOf("  bindContinueWatchingStoreSubscriptions()"),
  end = source.indexOf("\n  },", start);
test("retained Home immediately reorders internal progress and removes finished or reset cards", () => {
  let progress,
    watched,
    refreshes = 0,
    renders = 0,
    persists = 0;
  const deps = {
    Platform: { isBrowser: () => true },
    ProfileManager: { getActiveProfileId: () => "1" },
    WatchProgressStore: {
      subscribe: (f) => {
        progress = f;
        return () => {};
      }
    },
    WatchedItemsStore: {
      subscribe: (f) => {
        watched = f;
        return () => {};
      }
    },
    onContinueWatchingStale: () => () => {},
    resetContinueWatchingDisplayWatchedState,
    patchContinueWatchingDisplayProgress,
    removeContinueWatchingDisplayItem,
    shouldRefreshContinueWatchingForChange
  };
  const bind = new Function(
    ...Object.keys(deps),
    "return ({" + source.slice(start, end + 5) + "})"
  )(...Object.values(deps)).bindContinueWatchingStoreSubscriptions;
  const ctx = {
    continueWatchingDisplay: [
      { contentId: "b", updatedAt: 200 },
      { contentId: "a", updatedAt: 100 }
    ],
    requestBackgroundRender: () => renders++,
    persistContinueWatchingSnapshot: () => persists++,
    scheduleContinueWatchingStoreRefresh: () => refreshes++
  };
  bind.call(ctx);
  progress({
    profileId: "1",
    reason: "upsert",
    authoritative: false,
    item: { contentId: "a", updatedAt: 300, positionMs: 500, durationMs: 1000 }
  });
  assert.deepEqual(
    ctx.continueWatchingDisplay.map((i) => i.contentId),
    ["a", "b"]
  );
  assert.equal(refreshes, 0, "a periodic tick does not launch network enrichment");
  watched({ profileId: "1", reason: "upsert", authoritative: true, item: { contentId: "b" } });
  assert.deepEqual(
    ctx.continueWatchingDisplay.map((i) => i.contentId),
    ["a"]
  );
  progress({
    profileId: "2",
    reason: "remove",
    authoritative: true,
    removedItems: [{ contentId: "a" }]
  });
  assert.equal(ctx.continueWatchingDisplay.length, 1, "other profiles cannot modify this row");
  progress({
    profileId: "1",
    reason: "remove",
    authoritative: true,
    removedItems: [{ contentId: "a" }]
  });
  assert.deepEqual(ctx.continueWatchingDisplay, []);
  assert.equal(renders, 3);
  assert.equal(persists, 3);
  ctx.continueWatchingDisplay = [{ contentId: "series", season: 1, episode: 2, isNextUp: true }];
  watched({
    profileId: "1",
    reason: "remove",
    authoritative: true,
    item: { contentId: "series", season: 1, episode: 1 }
  });
  assert.deepEqual(ctx.continueWatchingDisplay, []);
});
