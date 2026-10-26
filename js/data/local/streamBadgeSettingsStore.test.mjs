import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const storage = new Map();
globalThis.localStorage = {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: (key) => storage.delete(key)
};
globalThis.__NUVIO_INCLUDE_TRAKT_CLIENT_SECRET__ = false;
const { StreamBadgeSettingsStore } = await import("./streamBadgeSettingsStore.js");

test("the stream-card label toggle persists off and on without changing other preferences or profiles", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  storage.clear();
  storage.set("activeProfileId", JSON.stringify("1"));
  StreamBadgeSettingsStore.setForProfile(
    "1",
    {
      showPlaybackLabels: true,
      labelAddons: ["AIOStreams"],
      showAddonLogo: false,
      showFileSizeBadges: false
    },
    { silentSync: true }
  );
  StreamBadgeSettingsStore.setForProfile("2", { showPlaybackLabels: true }, { silentSync: true });
  const source = await readFile(
    new URL("../../ui/screens/settings/settingsScreen.js", import.meta.url),
    "utf8"
  );
  const registration = source.match(
    /this\.actionMap\.set\("streams:toggle:playbackLabels", \(\) => \{[\s\S]*?\n {4}\}\);/
  )?.[0];
  assert.ok(registration, "the actual Settings action is registered");
  const screen = { actionMap: new Map() };
  const updates = [];
  new Function("StreamBadgeSettingsStore", "PlayerSettingsStore", registration).call(
    screen,
    StreamBadgeSettingsStore,
    { set: (value) => updates.push(value) }
  );
  const toggle = screen.actionMap.get("streams:toggle:playbackLabels");
  for (const enabled of [false, true]) {
    toggle();
    assert.equal(StreamBadgeSettingsStore.snapshot().showPlaybackLabels, enabled);
    const saved = JSON.parse(storage.get("streamBadgeSettings")).profiles;
    assert.equal(saved["1"].showPlaybackLabels, enabled);
    assert.equal(saved["2"].showPlaybackLabels, true);
    assert.deepEqual(saved["1"].labelAddons, ["AIOStreams"]);
    assert.equal(saved["1"].showAddonLogo, false);
    assert.equal(saved["1"].showFileSizeBadges, false);
  }
  assert.deepEqual(updates, [], "badge visibility does not change filtering");
  assert.equal(StreamBadgeSettingsStore.snapshot().compatibilityCheckEnabled, true);
});

test("client labeling limit is profile scoped and accepts only the offered values", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  for (const count of [3, 5, 8, 10]) {
    StreamBadgeSettingsStore.setForProfile(
      "limit-a",
      { clientLabelLimit: count, labelAddons: ["AIOStreams"] },
      { silentSync: true }
    );
    assert.equal(StreamBadgeSettingsStore.getForProfile("limit-a").clientLabelLimit, count);
    assert.deepEqual(StreamBadgeSettingsStore.getForProfile("limit-a").labelAddons, ["AIOStreams"]);
  }
  StreamBadgeSettingsStore.setForProfile(
    "limit-b",
    { clientLabelLimit: 99, labelAddons: [] },
    { silentSync: true }
  );
  assert.equal(StreamBadgeSettingsStore.getForProfile("limit-b").clientLabelLimit, 5);
  assert.deepEqual(StreamBadgeSettingsStore.getForProfile("limit-b").labelAddons, []);
  assert.equal(StreamBadgeSettingsStore.getForProfile("limit-a").clientLabelLimit, 10);
});

test("label source defaults to metadata and is saved per profile", (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  StreamBadgeSettingsStore.setForProfile(
    "source-a",
    { playbackLabelSource: "FILE_NAME" },
    { silentSync: true }
  );
  StreamBadgeSettingsStore.setForProfile(
    "source-b",
    { playbackLabelSource: "invalid" },
    { silentSync: true }
  );
  assert.equal(StreamBadgeSettingsStore.getForProfile("source-a").playbackLabelSource, "FILE_NAME");
  assert.equal(
    StreamBadgeSettingsStore.getForProfile("source-b").playbackLabelSource,
    "FILE_METADATA"
  );
});
