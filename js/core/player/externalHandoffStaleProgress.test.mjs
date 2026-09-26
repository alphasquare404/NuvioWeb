import assert from "node:assert/strict";
import test from "node:test";
import { PlayerController } from "./playerController.js";

// Continue Watching reverting to an older position after an external player.
//
// Reported flow: play a title from Continue Watching, pick a stream, watch in
// the external player from 17% to 70%, come back, press Back to Home. The new
// position showed for a second and then went back to the old one. Playing the
// same title a second time stuck.
//
// The device log named the writer. The external report landed correctly at
// 992000, was painted, and 2.4 seconds later the store read back 238000 -- the
// position the built-in player had been parked at before handing off. Two
// things let it through, and both are covered here:
//
//   1. the periodic save runs on an interval only stop() clears, and a handoff
//      does not call stop(), so the built-in player kept reporting its parked
//      position every five seconds for the whole external session;
//   2. the stale-progress filter gave up whenever no external report had
//      arrived yet -- the exact window where it was needed, and a permanent one
//      after a reload, since the handoff lives only in memory.
//
// It stuck on the second attempt because stop() had run by then and killed the
// interval.

const CONTEXT = { itemId: "movie:the-wire", itemType: "movie", title: "The Wire" };
const OTHER = { itemId: "movie:other", itemType: "movie", title: "Other" };

function makeController({ progressSaveTimer = null } = {}) {
  return {
    progressSaveTimer,
    externalProgressHandoff: null,
    isPlaying: true,
    video: { pause() {} },
    flushes: [],
    buildProgressSnapshotKey(context = CONTEXT) {
      return `key:${context?.itemId}`;
    },
    async flushCurrentProgress(options) {
      // Recorded with the handoff as it stood at call time: the final save has
      // to happen before the handoff exists, or the filter swallows it.
      this.flushes.push({ options, handoffAtCall: this.externalProgressHandoff });
      return true;
    },
    beginExternalPlaybackHandoff: PlayerController.beginExternalPlaybackHandoff,
    startProgressSaveTimer: PlayerController.startProgressSaveTimer,
    stopProgressSaveTimer: PlayerController.stopProgressSaveTimer,
    createProgressContext: () => CONTEXT,
    getCurrentTimeSeconds: () => 238,
    getDurationSeconds: () => 1407.84,
    flushProgress: () => true,
    releaseExternalPlaybackOwnership: PlayerController.releaseExternalPlaybackOwnership,
    shouldSuppressStaleInternalProgress: PlayerController.shouldSuppressStaleInternalProgress,
    acceptExternalPlaybackProgress: PlayerController.acceptExternalPlaybackProgress
  };
}

// Defect 1. A paused player that handed off has no business on a timer.
test("handing off stops the periodic save", () => {
  const controller = makeController({ progressSaveTimer: setInterval(() => {}, 60_000) });
  assert.equal(controller.beginExternalPlaybackHandoff({ progressContext: CONTEXT }), true);
  assert.equal(controller.progressSaveTimer, null);
});

test("handing off without a running timer is not an error", () => {
  const controller = makeController();
  assert.equal(controller.beginExternalPlaybackHandoff({ progressContext: CONTEXT }), true);
  assert.equal(controller.progressSaveTimer, null);
});

// The final save is the record of where the user actually was when they left,
// so it must land before the filter starts rejecting the built-in position.
test("the last save before handing off still gets through", () => {
  const controller = makeController();
  controller.beginExternalPlaybackHandoff({ progressContext: CONTEXT });
  assert.equal(controller.flushes.length, 1);
  assert.equal(controller.flushes[0].handoffAtCall, null);
  assert.equal(controller.flushes[0].options.forceCloudSync, true);
});

// Defect 2. The reported case: a tick arriving before any external report.
test("the built-in position is suppressed before any report arrives", () => {
  const controller = makeController({ progressSaveTimer: setInterval(() => {}, 60_000) });
  controller.beginExternalPlaybackHandoff({ progressContext: CONTEXT });
  assert.equal(controller.externalProgressHandoff.authoritativePositionMs, null);
  assert.equal(controller.shouldSuppressStaleInternalProgress(CONTEXT, 238_000), true);
});

test("the built-in position is still suppressed after a report", () => {
  const controller = makeController();
  controller.beginExternalPlaybackHandoff({ progressContext: CONTEXT });
  controller.acceptExternalPlaybackProgress(CONTEXT, 992_000, 1_407_840);
  assert.equal(controller.shouldSuppressStaleInternalProgress(CONTEXT, 238_000), true);
});

// A position past the external player's own is not stale, so it still writes --
// this is how a resumed built-in session reports normally.
test("a position ahead of the external report is not treated as stale", () => {
  const controller = makeController();
  controller.beginExternalPlaybackHandoff({ progressContext: CONTEXT });
  controller.acceptExternalPlaybackProgress(CONTEXT, 992_000, 1_407_840);
  assert.equal(controller.shouldSuppressStaleInternalProgress(CONTEXT, 1_100_000), false);
});

// Handing playback back has to restore ordinary writes, or the fix would freeze
// progress for the rest of the session. resume() and play() both do this.
test("releasing ownership restores ordinary progress writes", () => {
  const controller = makeController();
  controller.beginExternalPlaybackHandoff({ progressContext: CONTEXT });
  assert.equal(controller.shouldSuppressStaleInternalProgress(CONTEXT, 238_000), true);
  controller.releaseExternalPlaybackOwnership();
  assert.equal(controller.shouldSuppressStaleInternalProgress(CONTEXT, 238_000), false);
});

// A handoff for one title must not silence another title's progress.
test("another title keeps writing while this one is handed off", () => {
  const controller = makeController();
  controller.beginExternalPlaybackHandoff({ progressContext: CONTEXT });
  assert.equal(controller.shouldSuppressStaleInternalProgress(OTHER, 30_000), false);
});

test("no handoff at all suppresses nothing", () => {
  const controller = makeController();
  assert.equal(controller.shouldSuppressStaleInternalProgress(CONTEXT, 238_000), false);
});

// A finished title has had its progress row deleted; any later built-in write
// would resurrect the card.
test("a completed handoff suppresses every position", () => {
  const controller = makeController();
  controller.beginExternalPlaybackHandoff({ progressContext: CONTEXT });
  controller.acceptExternalPlaybackProgress(CONTEXT, 1_400_000, 1_407_840);
  assert.equal(controller.externalProgressHandoff.completed, true);
  assert.equal(controller.shouldSuppressStaleInternalProgress(CONTEXT, 1_407_000), true);
});

// A mismatched title cannot arm a handoff in the first place.
test("a handoff for a title that is not playing is refused", () => {
  const controller = makeController();
  controller.buildProgressSnapshotKey = (context) => (context === OTHER ? "key:other" : "key:now");
  assert.equal(controller.beginExternalPlaybackHandoff({ progressContext: OTHER }), false);
  assert.equal(controller.externalProgressHandoff, null);
});

// Stopping the periodic save on handoff is only safe if something starts it
// again. Only play() used to start it, so taking playback back with resume()
// after an external session left the periodic save off for the rest of that
// session -- progress then survived only a clean exit, not a crash.
test("taking playback back restarts the periodic save", () => {
  const controller = makeController({ progressSaveTimer: setInterval(() => {}, 60_000) });
  controller.beginExternalPlaybackHandoff({ progressContext: CONTEXT });
  assert.equal(controller.progressSaveTimer, null);
  controller.startProgressSaveTimer();
  assert.notEqual(controller.progressSaveTimer, null);
  controller.stopProgressSaveTimer();
});

test("starting the periodic save twice leaves one timer", () => {
  const controller = makeController();
  controller.startProgressSaveTimer();
  const first = controller.progressSaveTimer;
  controller.startProgressSaveTimer();
  assert.notEqual(controller.progressSaveTimer, first);
  controller.stopProgressSaveTimer();
  assert.equal(controller.progressSaveTimer, null);
});
