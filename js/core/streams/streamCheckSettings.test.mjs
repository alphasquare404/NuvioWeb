import test from "node:test";
import assert from "node:assert/strict";
import {
  filterPlayerStreams,
  playerStreamCheckCandidates,
  playerStreamProbeCandidates
} from "./playerStreamPolicy.js";
import { isOnlyDirectEnabled } from "./streamLabelPolicy.js";
import { normalizeStreamBadgeSettings } from "../../data/local/streamBadgeSettingsStore.js";
import { normalizePlayerSettings } from "../../data/local/playerSettingsStore.js";
const capabilities = {
  h264: true,
  hevc: false,
  aac: true,
  ac3: false,
  containers: { mp4: true, mkv: false }
};
const rows = Array.from({ length: 12 }, (_, i) => ({
  id: String(i),
  addonName: i % 2 ? "B" : "A",
  url: `https://fixture.test/${i}.mp4`,
  name: `Film.H264.AAC.${i === 2 ? "mkv" : "mp4"}`
}));
const metadata = {
  compatibilityCheckEnabled: true,
  showPlaybackLabels: false,
  labelAddons: ["A"],
  clientLabelLimit: 3,
  playbackLabelSource: "FILE_METADATA"
};
const filename = {
  ...metadata,
  playbackLabelSource: "FILE_NAME",
  filenameAllAddons: true,
  filenameCheckLimit: 0
};
const options = (settings, labels = metadata) => ({
  settings,
  labels,
  mode: "client",
  capabilities,
  probeForStream: (s) => ({
    container: s.id === "2" ? "mkv" : "mp4",
    videoCodec: "h264",
    audioCodec: "aac"
  })
});
test("legacy check preferences never start background work or hide any streams", () => {
  for (const labels of [metadata, filename])
    for (const streamDisplayMode of ["ALL", "DIRECT", "DIRECT_REMUX"]) {
      const opt = options({ streamDisplayMode }, labels);
      assert.deepEqual(filterPlayerStreams(rows, opt), rows);
      assert.deepEqual(playerStreamCheckCandidates(rows, opt), []);
      assert.deepEqual(playerStreamProbeCandidates(rows, opt), []);
    }
});

test("check disable suspends filtering and network work while preserving the saved view", () => {
  const labels = { ...metadata, compatibilityCheckEnabled: false };
  assert.equal(isOnlyDirectEnabled({ streamDisplayMode: "DIRECT" }, labels), false);
  assert.deepEqual(
    filterPlayerStreams(rows, options({ streamDisplayMode: "DIRECT" }, labels)),
    rows
  );
  assert.deepEqual(playerStreamProbeCandidates(rows, options({}, labels)), []);
});
test("legacy preferences migrate without silently starting previously disabled checks", () => {
  assert.equal(
    normalizeStreamBadgeSettings({ showPlaybackLabels: false, labelAddons: ["A"] })
      .compatibilityCheckEnabled,
    false
  );
  assert.equal(
    normalizeStreamBadgeSettings({ ...metadata, showPlaybackLabels: false })
      .compatibilityCheckEnabled,
    true
  );
  const player = normalizePlayerSettings({
    showOnlyDirectStreams: true,
    streamCompatibilityFilter: "LIKELY_DIRECT_REMUX"
  });
  assert.equal(player.streamDisplayMode, "DIRECT");
  assert.equal(player.streamCompatibilityFilter, "OFF");
  assert.equal(
    normalizePlayerSettings({ streamCompatibilityFilter: "LIKELY_DIRECT_REMUX" }).streamDisplayMode,
    "DIRECT_REMUX"
  );
  assert.equal(
    normalizePlayerSettings({ ...player, streamDisplayMode: "ALL" }).streamDisplayMode,
    "ALL"
  );
});
