import assert from "node:assert/strict";
import test from "node:test";
import { PlayerSettingsStore } from "../../data/local/playerSettingsStore.js";
import { StreamBadgeSettingsStore } from "../../data/local/streamBadgeSettingsStore.js";
import { ExperienceModeStore } from "../../data/local/experienceModeStore.js";
import { filenameStreamFilter } from "../streams/filenameStreamPolicy.js";
import { resolveExperienceRoute } from "./experienceModeRouting.js";

const storage = new Map();
globalThis.localStorage = {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, value)
};

const legacyPlayer = {
  playerEngine: "native",
  browserExternalPlayer: "infuse",
  filenamePlaybackRoutingEnabled: false,
  filenameStreamDisplayMode: "DIRECT_REMUX"
};

test("fresh playback defaults leave saved and legacy settings intact", () => {
  storage.clear();
  storage.set("playerSettings", JSON.stringify(legacyPlayer));
  storage.set("streamBadgeSettings", JSON.stringify({ show_playback_labels: true }));
  const saved = PlayerSettingsStore.getForProfile("1");
  assert.equal(saved.mediabunnyMode, "process");
  assert.equal(saved.browserExternalPlayer, "infuse");
  assert.equal(saved.filenamePlaybackRoutingEnabled, false);
  assert.deepEqual(filenameStreamFilter(saved), ["direct", "remux"]);
  assert.equal(StreamBadgeSettingsStore.getForProfile("1").showPlaybackLabels, true);

  const fresh = PlayerSettingsStore.getForProfile("2");
  assert.equal(fresh.playerEngine, "native");
  assert.equal(fresh.browserExternalPlayer, "disabled");
  assert.equal(fresh.mediabunnyEnabled, true);
  assert.equal(fresh.mediabunnyMode, "decode");
  assert.equal(fresh.filenamePlaybackRoutingEnabled, true);
  assert.deepEqual(filenameStreamFilter(fresh), ["all"]);
  assert.deepEqual(filenameStreamFilter({ ...fresh, mediabunnyMode: "process" }), ["all"]);
  assert.equal(StreamBadgeSettingsStore.getForProfile("2").showPlaybackLabels, false);
  assert.deepEqual(PlayerSettingsStore.getForProfile("1"), saved);
  assert.equal(StreamBadgeSettingsStore.getForProfile("1").showPlaybackLabels, true);
});

test("new and existing profiles enter Home without an onboarding screen", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  storage.clear();
  ExperienceModeStore.setForProfile(
    "1",
    { mode: "ESSENTIAL", quickSetupVersion: 1 },
    { silentSync: true }
  );
  assert.equal(await resolveExperienceRoute("1", { pullRemoteSettings: false }), "home");
  assert.equal(ExperienceModeStore.getForProfile("1").mode, "ESSENTIAL");
  assert.equal(ExperienceModeStore.getForProfile("1").quickSetupVersion, 1);
  storage.clear();
  assert.equal(await resolveExperienceRoute("2", { pullRemoteSettings: false }), "home");
  assert.equal(ExperienceModeStore.getForProfile("2").mode, "ADVANCED");
});
