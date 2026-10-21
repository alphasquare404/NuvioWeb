import assert from "node:assert/strict";
import test from "node:test";
import { PlayerSettingsStore, normalizePlayerSettings } from "./playerSettingsStore.js";

test("the playback engine defaults to the built-in player", () => {
  assert.equal(PlayerSettingsStore.getDefaults().playerEngine, "native");
  assert.equal(normalizePlayerSettings({}).playerEngine, "native");
});

test("the movi engine is remembered once chosen", () => {
  assert.equal(normalizePlayerSettings({ playerEngine: "movi" }).playerEngine, "movi");
});

test("an unknown engine falls back to native rather than opening nothing", () => {
  for (const value of ["", null, undefined, "vlc", "MOVI-2", 42, {}, []]) {
    assert.equal(normalizePlayerSettings({ playerEngine: value }).playerEngine, "native");
  }
});

test("the stored value is read case-insensitively", () => {
  assert.equal(normalizePlayerSettings({ playerEngine: "  MOVI " }).playerEngine, "movi");
  assert.equal(normalizePlayerSettings({ playerEngine: "Native" }).playerEngine, "native");
});
