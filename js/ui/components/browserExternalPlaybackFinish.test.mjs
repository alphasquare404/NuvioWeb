import assert from "node:assert/strict";
import test from "node:test";
import { markBrowserExternalPlaybackFinished } from "./browserExternalPlaybackFinish.js";

test("manual and automatic finish entry points share the same timing-free completion action", async () => {
  const calls = [];
  const controller = { completePlayback: async (...args) => { calls.push(args); return true; } };
  const handoff = { progressContext: { itemId: "series:1", itemType: "series", videoId: "series:1:1:2", season: 1, episode: 2 } };
  assert.equal(await markBrowserExternalPlaybackFinished({ handoff, controller }), true);
  assert.equal(await markBrowserExternalPlaybackFinished({ handoff, controller }), true);
  assert.deepEqual(calls, [
    [handoff.progressContext, { externalAuthoritative: true }],
    [handoff.progressContext, { externalAuthoritative: true }]
  ]);
});
