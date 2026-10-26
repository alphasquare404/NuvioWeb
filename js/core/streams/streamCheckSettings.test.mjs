import test from "node:test";
import assert from "node:assert/strict";
import {
  filterPlayerStreams,
  playerStreamCheckCandidates,
  playerStreamProbeCandidates,
  allowsPlayerStreamLabel
} from "./playerStreamPolicy.js";
import { isOnlyDirectEnabled, streamLabelProbeLimit } from "./streamLabelPolicy.js";
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
test("all streams remain visible while only three selected-addon files are checked with badges hidden", () => {
  const opt = options({ streamDisplayMode: "ALL" });
  assert.deepEqual(filterPlayerStreams(rows, opt), rows);
  assert.deepEqual(
    playerStreamProbeCandidates(rows, opt).map((s) => s.id),
    ["0", "2", "4"]
  );
  assert.deepEqual(
    filterPlayerStreams(rows, options({ streamDisplayMode: "DIRECT" })).map((s) => s.id),
    ["0", "4"]
  );
  assert.deepEqual(
    filterPlayerStreams(rows, options({ streamDisplayMode: "DIRECT_REMUX" })).map((s) => s.id),
    ["0", "2", "4"]
  );
});
test("filename All addons and All streams are local and independent of metadata network limits", () => {
  const opt = options({ streamDisplayMode: "DIRECT_REMUX" }, filename);
  assert.equal(playerStreamCheckCandidates(rows, opt).length, 12);
  assert.deepEqual(filterPlayerStreams(rows, opt), rows);
  assert.deepEqual(playerStreamProbeCandidates(rows, opt), []);
  assert.equal(allowsPlayerStreamLabel(rows[1], filename), true);
  assert.equal(streamLabelProbeLimit(filename, "client", 1), 0);
  const limited = { ...filename, filenameCheckLimit: 3 };
  assert.equal(playerStreamCheckCandidates(rows, options({}, limited)).length, 3);
  assert.equal(
    filterPlayerStreams(rows, options({ streamDisplayMode: "DIRECT_REMUX" }, limited)).length,
    3
  );
  const backToMetadata = { ...limited, playbackLabelSource: "FILE_METADATA" };
  assert.equal(allowsPlayerStreamLabel(rows[1], backToMetadata), false);
  assert.deepEqual(
    playerStreamProbeCandidates(rows, options({}, backToMetadata)).map((s) => s.id),
    ["0", "2", "4"]
  );
  assert.deepEqual(
    playerStreamProbeCandidates(rows, options({}, { ...backToMetadata, labelAddons: [] })),
    [],
    "All addons cannot authorize network work"
  );
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
