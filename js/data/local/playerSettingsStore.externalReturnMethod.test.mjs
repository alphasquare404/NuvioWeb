import assert from "node:assert/strict";
import test from "node:test";
import { PlayerSettingsStore, normalizePlayerSettings } from "./playerSettingsStore.js";

test("the way back from an external player starts unchosen rather than guessed", () => {
  // An existing profile may already hold a Push subscription, which is the
  // only record the notification path has ever kept. Defaulting this to
  // "notification" would write an answer nobody gave, and defaulting it to
  // "automation" would silence a notification someone had deliberately
  // switched on. Empty is the only honest default.
  assert.equal(PlayerSettingsStore.getDefaults().externalReturnMethod, "");
  assert.equal(normalizePlayerSettings({}).externalReturnMethod, "");
});

test("only the two real ways back survive normalisation", () => {
  assert.equal(
    normalizePlayerSettings({ externalReturnMethod: "automation" }).externalReturnMethod,
    "automation"
  );
  assert.equal(
    normalizePlayerSettings({ externalReturnMethod: "notification" }).externalReturnMethod,
    "notification"
  );
  assert.equal(
    normalizePlayerSettings({ externalReturnMethod: "  AUTOMATION  " }).externalReturnMethod,
    "automation"
  );

  // Anything else reads as unchosen. A stored value that no longer means
  // anything must not suppress the return notification by accident, because
  // that failure is invisible: playback works, and only the way back is gone.
  for (const value of ["shortcut", "push", "true", true, 1, null, undefined, {}]) {
    assert.equal(
      normalizePlayerSettings({ externalReturnMethod: value }).externalReturnMethod,
      "",
      `${String(value)} must not be taken for a way back`
    );
  }
});

test("choosing a way back leaves the other playback settings alone", () => {
  const normalized = normalizePlayerSettings({
    externalReturnMethod: "automation",
    browserExternalPlayer: "outplayer",
    externalPlayerProgress: "manual",
    syncOfflineProgress: true
  });
  assert.equal(normalized.externalReturnMethod, "automation");
  assert.equal(normalized.browserExternalPlayer, "outplayer");
  assert.equal(normalized.externalPlayerProgress, "manual");
  assert.equal(normalized.syncOfflineProgress, true);
});
