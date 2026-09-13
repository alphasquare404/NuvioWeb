import assert from "node:assert/strict";
import test from "node:test";
import { dispatchOutplayerExplicitFinish } from "./browserOutplayerFinishDispatch.js";

test("the collected Outplayer finished envelope reaches explicit completion before handoff consumption", async () => {
  const calls = [];
  const report = {
    provider: "outplayer",
    outcome: "stopped",
    sourceOutcome: "finished",
    positionSeconds: null,
    durationSeconds: null,
    handoff: { playerMode: "outplayer", progressContext: { itemId: "movie:1", itemType: "movie" } }
  };
  const result = await dispatchOutplayerExplicitFinish({
    report,
    controller: { completePlayback: async (...args) => { calls.push(args); return true; } },
    log: () => {}
  });
  assert.deepEqual(result, { handled: true, applied: true });
  assert.deepEqual(calls, [[report.handoff.progressContext, { externalAuthoritative: true }]]);
});

test("a non-Outplayer report remains with its provider dispatcher", async () => {
  const result = await dispatchOutplayerExplicitFinish({
    report: { outcome: "finished", handoff: { playerMode: "infuse", progressContext: { itemId: "movie:1" } } },
    controller: {},
    log: () => {}
  });
  assert.deepEqual(result, { handled: false, applied: false });
});
