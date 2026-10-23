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
  new Function("StreamBadgeSettingsStore", registration).call(screen, StreamBadgeSettingsStore);
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
});
