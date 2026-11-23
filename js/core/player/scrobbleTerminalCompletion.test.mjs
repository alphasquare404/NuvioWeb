import assert from "node:assert/strict";
import test from "node:test";
import { PlayerController } from "./playerController.js";
import { TrackingScrobbleService } from "../../data/repository/trackingScrobbleService.js";

const context = { itemId: "tt0133093", itemType: "movie", title: "The Matrix" };

function controllerAt(positionMs, durationMs, overrides = {}) {
  return {
    createProgressContext: () => context,
    getRecordedProgressSnapshot: () => ({ positionMs, durationMs }),
    getCurrentTimeSeconds: () => positionMs / 1000,
    getDurationSeconds: () => durationMs / 1000,
    shouldSuppressOfflineProgress: () => false,
    playbackEndedNaturally: false,
    externalProgressHandoff: null,
    ...overrides
  };
}

function captureTerminalReports(run) {
  const originalReport = TrackingScrobbleService.report;
  const originalComplete = TrackingScrobbleService.complete;
  const calls = [];
  TrackingScrobbleService.report = (value) => {
    calls.push({ action: "report", value });
    return true;
  };
  TrackingScrobbleService.complete = (value) => {
    calls.push({ action: "complete", value });
    return true;
  };
  try {
    run();
  } finally {
    TrackingScrobbleService.report = originalReport;
    TrackingScrobbleService.complete = originalComplete;
  }
  return calls;
}

test("leaving during the last minutes closes the provider scrobble session", () => {
  // The reported failure: Nuvio records the title as watched and drops the
  // Continue Watching card, while the provider keeps showing it as scrobbling
  // until the session expires. A stop is the only message that ends a session.
  const calls = captureTerminalReports(() =>
    PlayerController.scrobbleTerminalReport.call(controllerAt(950_000, 1_000_000))
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].action, "complete");
  assert.equal(calls[0].value.progressPercent, 100);
  assert.equal(calls[0].value.positionMs, 1_000_000);
  assert.equal(calls[0].value.durationMs, 1_000_000);
});

test("leaving mid-way still records where the viewer got to", () => {
  const calls = captureTerminalReports(() =>
    PlayerController.scrobbleTerminalReport.call(controllerAt(850_000, 1_000_000))
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].action, "report");
  assert.equal(calls[0].value.progressPercent, 85);
});

test("the natural end is not reported a second time by teardown", () => {
  const calls = captureTerminalReports(() =>
    PlayerController.scrobbleTerminalReport.call(
      controllerAt(1_000_000, 1_000_000, { playbackEndedNaturally: true })
    )
  );
  assert.equal(calls.length, 0);
});

test("an external player's session is left to its own final report", () => {
  const calls = captureTerminalReports(() =>
    PlayerController.scrobbleTerminalReport.call(
      controllerAt(950_000, 1_000_000, { externalProgressHandoff: { completed: false } })
    )
  );
  assert.equal(calls.length, 0);
});

test("offline playback with progress suppression reports nothing", () => {
  const calls = captureTerminalReports(() =>
    PlayerController.scrobbleTerminalReport.call(
      controllerAt(950_000, 1_000_000, { shouldSuppressOfflineProgress: () => true })
    )
  );
  assert.equal(calls.length, 0);
});
