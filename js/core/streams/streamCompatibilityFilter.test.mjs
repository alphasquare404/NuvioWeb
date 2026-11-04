import test from "node:test";
import assert from "node:assert/strict";
import {
  filterStreamsByCompatibility,
  normalizeStreamCompatibilityFilter
} from "./streamCompatibilityFilter.js";

import { normalizePlayerSettings } from "../../data/local/playerSettingsStore.js";

const device = {
  h264: true,
  hevc: false,
  aac: true,
  ac3: false,
  containers: { mp4: true, mkv: false }
};
const stream = (id, text) => ({
  id,
  addonName: "AIOStreams",
  url: "https://cdn.test/source/" + id,
  name: text
});
const sources = [
  stream("unknown", "1080p"),
  stream("video-conversion", "film.mp4 HEVC AAC"),
  stream("audio-conversion", "film.mp4 H264 AC3"),
  stream("remux", "film.mkv H264 AAC"),
  stream("direct", "film.mp4 H264 AAC")
];

test("text compatibility filtering is opt-in and normalizes persisted settings", () => {
  assert.equal(filterStreamsByCompatibility(sources), sources);
  assert.equal(normalizeStreamCompatibilityFilter("likely_direct"), "LIKELY_DIRECT");
  assert.equal(normalizeStreamCompatibilityFilter("invalid"), "OFF");
  assert.equal(normalizePlayerSettings({}).streamCompatibilityFilter, "OFF");
  assert.equal(
    normalizePlayerSettings({ streamCompatibilityFilter: "LIKELY_DIRECT_REMUX" }).streamDisplayMode,
    "DIRECT_REMUX"
  );
});

test("text filter distinguishes supported Direct, Remux, conversion and incomplete candidates locally", () => {
  assert.deepEqual(
    filterStreamsByCompatibility(
      sources,
      { streamCompatibilityFilter: "LIKELY_DIRECT" },
      device
    ).map((s) => s.id),
    ["direct"]
  );
  assert.deepEqual(
    filterStreamsByCompatibility(
      sources,
      { streamCompatibilityFilter: "LIKELY_DIRECT_REMUX" },
      device
    ).map((s) => s.id),
    ["remux", "direct"]
  );
  const mkvDevice = { ...device, containers: { mp4: true, mkv: true } };
  assert.deepEqual(
    filterStreamsByCompatibility(
      sources,
      { streamCompatibilityFilter: "LIKELY_DIRECT" },
      mkvDevice
    ).map((s) => s.id),
    ["remux", "direct"],
    "no blanket MKV remux rule"
  );
});

test("filter reads encoded filenames and unresolved descriptors without consulting URL credentials", () => {
  const encoded = { url: "https://cdn.test/Film%20H264%20AAC.mp4?token=AC3-HEVC" };
  const unresolved = { clientResolve: { filename: "Film.H264.AAC.mp4" } };
  const missing = { url: "https://cdn.test/file?filename=Film.H264.AAC.mp4" };
  assert.deepEqual(
    filterStreamsByCompatibility(
      [encoded, unresolved, missing],
      { streamCompatibilityFilter: "LIKELY_DIRECT" },
      device
    ),
    [encoded, unresolved]
  );
});
