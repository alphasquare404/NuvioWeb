import test from "node:test";
import assert from "node:assert/strict";
import {
  allowsPlayerStreamLabel,
  filterPlayerStreams,
  playerStreamProbeCandidates
} from "./playerStreamPolicy.js";
const rows = [
  { id: "other", addonName: "Other", url: "https://cdn/other" },
  { id: "direct", addonName: "AIOStreams", url: "https://cdn/direct" },
  { id: "convert", addonName: "AIOStreams", url: "https://cdn/convert" },
  { id: "pending", addonName: "AIOStreams", url: "https://cdn/pending" }
];
const labels = { showPlaybackLabels: true, labelAddons: ["AIOStreams"] };
const capabilities = { h264: true, aac: true, hevc: false, containers: { mp4: true } };
const probes = {
  direct: { container: "mp4", videoCodec: "h264", audioCodec: "aac" },
  other: { container: "mp4", videoCodec: "h264", audioCodec: "aac" },
  convert: { container: "mp4", videoCodec: "hevc", audioCodec: "aac" }
};
test("label addon choice does not hide other addon streams while Only Direct is off", () => {
  assert.deepEqual(
    filterPlayerStreams(rows, { settings: { showOnlyDirectStreams: false }, labels }),
    rows
  );
  assert.equal(allowsPlayerStreamLabel(rows[0], labels), false);
  assert.equal(allowsPlayerStreamLabel(rows[1], labels), true);
});
test("Only Direct requires a verified Direct result in label addon scope even with labels hidden", () => {
  const options = {
    settings: { showOnlyDirectStreams: true },
    labels: { ...labels, showPlaybackLabels: false },
    capabilities,
    probeForStream: (s) => probes[s.id]
  };
  assert.deepEqual(
    filterPlayerStreams(rows, options).map((s) => s.id),
    ["direct"]
  );
  assert.deepEqual(
    filterPlayerStreams(rows, { ...options, labels: { labelAddons: [] } }).map((s) => s.id),
    ["other", "direct"]
  );
});
test("player probe scope applies before cap, disables cosmetic probing, and preserves source order", () => {
  assert.deepEqual(
    playerStreamProbeCandidates(rows, { labels, limit: 2 }).map((s) => s.id),
    ["direct", "convert"]
  );
  assert.deepEqual(
    playerStreamProbeCandidates(rows, { labels: { ...labels, showPlaybackLabels: false } }),
    []
  );
  assert.equal(
    playerStreamProbeCandidates(rows, {
      settings: { showOnlyDirectStreams: true },
      labels: { ...labels, showPlaybackLabels: false },
      limit: 0
    }).length,
    3
  );
});
test("HDR candidate priority uses allowed addons before the player probe cap", () => {
  const sources = [
    rows[0],
    rows[1],
    { id: "hdr", addonName: "AIOStreams", url: "https://cdn/hdr", title: "HDR10" }
  ];
  assert.deepEqual(
    playerStreamProbeCandidates(sources, {
      labels,
      limit: 1,
      settings: { streamAutoPlayMode: "FIRST_STREAM", streamAutoPlayHdrPreference: "PREFER" }
    }).map((s) => s.id),
    ["hdr"]
  );
});
