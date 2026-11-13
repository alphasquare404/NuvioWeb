import assert from "node:assert/strict";
import test from "node:test";
import { normalizePlayerSettings } from "../../data/local/playerSettingsStore.js";
import { shouldRouteToDecodePlayback } from "./mediabunnySettings.js";

test("Mediabunny preserves existing playback and migrates an explicit movi selection", () => {
  assert.equal(normalizePlayerSettings({}).mediabunnyEnabled, true);
  assert.equal(normalizePlayerSettings({ playerEngine: "native" }).mediabunnyMode, "process");
  assert.equal(normalizePlayerSettings({ playerEngine: "movi" }).mediabunnyMode, "decode");
  const updated = normalizePlayerSettings({
    playerEngine: "movi",
    mediabunnyEnabled: false,
    mediabunnyMode: "process",
    preferredAudioLanguage: "ja"
  });
  assert.equal(updated.mediabunnyMode, "process");
  assert.equal(updated.mediabunnyEnabled, false);
  assert.equal(updated.preferredAudioLanguage, "ja");
});

test("Decode & Play is opt-in and fallback does not route back to Decode & Play", () => {
  const source = { streamUrl: "https://media.example/video.mkv" };
  const scope = { isSecureContext: true, AudioContext: function AudioContext() {} };
  const settings = { mediabunnyEnabled: true, mediabunnyMode: "decode" };
  assert.equal(shouldRouteToDecodePlayback(source, settings, scope), true);
  assert.equal(
    shouldRouteToDecodePlayback(source, { ...settings, mediabunnyMode: "process" }, scope),
    false
  );
  assert.equal(
    shouldRouteToDecodePlayback(source, { ...settings, mediabunnyEnabled: false }, scope),
    false
  );
  assert.equal(
    shouldRouteToDecodePlayback({ ...source, skipMediabunnyDecode: true }, settings, scope),
    false
  );
  assert.equal(
    shouldRouteToDecodePlayback(
      { ...source, externalFrameUrl: "https://example.test" },
      settings,
      scope
    ),
    false
  );
  assert.equal(
    shouldRouteToDecodePlayback(source, settings, { ...scope, isSecureContext: false }),
    false
  );
});
