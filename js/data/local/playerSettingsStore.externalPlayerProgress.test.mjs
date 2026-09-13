import assert from "node:assert/strict";
import test from "node:test";
import { PlayerSettingsStore, normalizePlayerSettings } from "./playerSettingsStore.js";

test("external player progress defaults to automatic and preserves the manual privacy choice", () => {
  assert.equal(PlayerSettingsStore.getDefaults().externalPlayerProgress, "automatic");
  assert.equal(normalizePlayerSettings({ externalPlayerProgress: "manual" }).externalPlayerProgress, "manual");
  assert.equal(normalizePlayerSettings({ externalPlayerProgress: "unexpected" }).externalPlayerProgress, "automatic");
});

test("Outplayer remains a persisted external-player preference independent of progress mode", () => {
  const normalized = normalizePlayerSettings({
    browserExternalPlayer: "outplayer",
    externalPlayerProgress: "manual"
  });
  assert.equal(normalized.browserExternalPlayer, "outplayer");
  assert.equal(normalized.externalPlayerProgress, "manual");
});
