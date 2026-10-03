import test from "node:test";
import assert from "node:assert/strict";

import {
  markContinueWatchingStale,
  onContinueWatchingStale,
  resetContinueWatchingStaleSignal
} from "./continueWatchingStaleSignal.js";

test("a signal raised before Home is listening is delivered when it binds", () => {
  // The whole point: returning from an external player is a cold start, so the
  // report is applied while Home is still mounting. Dropping the signal there
  // is exactly the bug -- the card kept a position the player had moved past.
  resetContinueWatchingStaleSignal();
  markContinueWatchingStale();

  let calls = 0;
  onContinueWatchingStale(() => {
    calls += 1;
  });
  assert.equal(calls, 1);

  // Delivered once, not replayed to every later listener.
  let second = 0;
  onContinueWatchingStale(() => {
    second += 1;
  });
  assert.equal(second, 0);
});

test("a listener already bound hears the signal immediately", () => {
  resetContinueWatchingStaleSignal();
  let calls = 0;
  const off = onContinueWatchingStale(() => {
    calls += 1;
  });
  markContinueWatchingStale();
  assert.equal(calls, 1);

  off();
  markContinueWatchingStale();
  assert.equal(calls, 1);

  // With nobody listening the signal waits again rather than being lost.
  let afterRebind = 0;
  onContinueWatchingStale(() => {
    afterRebind += 1;
  });
  assert.equal(afterRebind, 1);
  resetContinueWatchingStaleSignal();
});

test("one listener throwing does not stop the others", () => {
  resetContinueWatchingStaleSignal();
  let reached = false;
  onContinueWatchingStale(() => {
    throw new Error("boom");
  });
  onContinueWatchingStale(() => {
    reached = true;
  });
  markContinueWatchingStale();
  assert.equal(reached, true);
  resetContinueWatchingStaleSignal();
});
