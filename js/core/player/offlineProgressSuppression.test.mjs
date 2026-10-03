import assert from "node:assert/strict";
import test from "node:test";
import { PlayerController } from "./playerController.js";
import { normalizePlayerSettings } from "../../data/local/playerSettingsStore.js";

// "Sync offline progress" off means watching a downloaded file records nothing
// at all: no position, no completion, nothing to Trakt or Simkl. Watch and
// forget. The first shape of this setting gated the reconnect push instead, and
// that was the wrong place twice over -- the row had already been written, so
// the device still disagreed with itself, and a gate there would also have held
// back progress recorded with a network that merely failed to send.

test("the setting is off until someone asks for it", () => {
  assert.equal(normalizePlayerSettings({}).syncOfflineProgress, false);
  assert.equal(normalizePlayerSettings({ syncOfflineProgress: true }).syncOfflineProgress, true);
  // Anything that is not an explicit yes is a no, including the string "true"
  // a hand-edited profile might carry.
  assert.equal(normalizePlayerSettings({ syncOfflineProgress: "true" }).syncOfflineProgress, false);
});

// The predicate both the controller and the player screen ask, so the position
// write, the completion, and the three scrobble calls cannot drift apart.
test("only offline playback is suppressed, and only while the setting is off", () => {
  const ask = (currentPlaybackIsOffline) =>
    PlayerController.shouldSuppressOfflineProgress.call({ currentPlaybackIsOffline });

  // No stored profile here, so the setting reads its default: off.
  assert.equal(ask(true), true, "a downloaded file records nothing while it is off");

  // A streamed title is never suppressed by this, whatever the setting says --
  // the setting is about downloads, not about the network being poor.
  assert.equal(ask(false), false);
  assert.equal(ask(undefined), false);
  assert.equal(ask(null), false);
  assert.equal(ask("yes"), false, "anything but exactly true reads as streamed");
});

test("an offline playback with the setting off writes neither a position nor a completion", async () => {
  const calls = [];
  const screen = {
    currentPlaybackIsOffline: true,
    shouldSuppressOfflineProgress: () => true,
    createProgressContext: () => ({ itemId: "tt0903747", itemType: "series" }),
    shouldSuppressStaleInternalProgress: () => {
      calls.push("stale-check");
      return false;
    },
    recordProgressSnapshot: () => calls.push("snapshot"),
    markPlaybackWatched: async () => calls.push("mark"),
    acceptExternalPlaybackCompletion: () => calls.push("accept"),
    pushProgressIfDue: async () => calls.push("push"),
    scrobbleExternalCompletion: () => calls.push("scrobble")
  };

  await PlayerController.flushProgress.call(screen, 600000, 1200000, false, null);
  await PlayerController.completePlayback.call(screen, null);

  // Not even the snapshot: it is what a later flush would publish.
  assert.deepEqual(calls, []);
});

test("the same playback writes normally once the setting is on", async () => {
  const calls = [];
  const screen = {
    currentPlaybackIsOffline: true,
    shouldSuppressOfflineProgress: () => false,
    createProgressContext: () => ({ itemId: "tt0903747", itemType: "series" }),
    shouldSuppressStaleInternalProgress: () => false,
    markPlaybackWatched: async () => calls.push("mark"),
    acceptExternalPlaybackCompletion: () => calls.push("accept"),
    pushProgressIfDue: async () => calls.push("push"),
    scrobbleExternalCompletion: () => false
  };

  await PlayerController.completePlayback.call(screen, null);
  assert.deepEqual(calls, ["mark", "push"]);
});
