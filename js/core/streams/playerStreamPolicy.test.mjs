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
test("Only Direct requires metadata when labeling is enabled, and is inactive otherwise", () => {
  const options = {
    settings: { showOnlyDirectStreams: true },
    labels,
    capabilities,
    probeForStream: (s) => probes[s.id]
  };
  assert.deepEqual(
    filterPlayerStreams(rows, options).map((s) => s.id),
    ["other", "direct"]
  );
  assert.deepEqual(
    filterPlayerStreams(rows, { ...options, labels: { labelAddons: [] } }).map((s) => s.id),
    ["other", "direct"]
  );
  assert.deepEqual(
    filterPlayerStreams(rows, { ...options, labels: { ...labels, showPlaybackLabels: false } }),
    rows
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
    0
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

test("no selected label addons means no probes, including Only Direct", () => {
  for (const settings of [{}, { showOnlyDirectStreams: true }]) {
    assert.deepEqual(
      playerStreamProbeCandidates(rows, { labels: { labelAddons: [] }, settings }),
      []
    );
  }
  assert.equal(allowsPlayerStreamLabel(rows[0], {}), false);
});

test("client cap applies after addon scope and combines selected addons within one limit", () => {
  const streams = Array.from({ length: 15 }, (_, i) => ({
    id: String(i),
    addonName: i % 2 ? "AIOStreams" : "Other",
    url: "https://cdn/" + i
  }));
  for (const count of [3, 5, 8, 10]) {
    const candidates = playerStreamProbeCandidates(streams, {
      mode: "client",
      limit: 0,
      labels: { labelAddons: ["AIOStreams", "Other"], clientLabelLimit: count }
    });
    assert.equal(candidates.length, count);
    assert.deepEqual(candidates, streams.slice(0, count));
  }
  assert.equal(
    playerStreamProbeCandidates(streams, {
      mode: "client",
      limit: 2,
      labels: { labelAddons: ["Other"], clientLabelLimit: 10 }
    }).length,
    2
  );
  assert.equal(
    playerStreamProbeCandidates(streams, {
      mode: "server",
      limit: 0,
      labels: { labelAddons: ["Other"], clientLabelLimit: 3 }
    }).length,
    8
  );
});

test("incomplete torrent identity cannot merge different file URLs", () => {
  const hash = "a".repeat(40);
  const streams = [
    { addonName: "A", infoHash: hash, name: "same release", url: "https://cdn.test/one.mp4" },
    { addonName: "A", infoHash: hash, name: "same release", url: "https://cdn.test/two.mp4" }
  ];
  assert.equal(
    playerStreamProbeCandidates(streams, { labels: { labelAddons: ["A"] }, limit: 3 }).length,
    2
  );
});

test("filename Only Direct uses text without probes or the metadata candidate cap", () => {
  const streams = Array.from({ length: 8 }, (_, i) => ({
    id: String(i),
    addonName: "AIOStreams",
    url: "https://cdn/" + i,
    name: "Film.H264.AAC.mp4"
  }));
  const filenameLabels = { ...labels, playbackLabelSource: "FILE_NAME", clientLabelLimit: 3 };
  const shown = filterPlayerStreams(streams, {
    settings: { showOnlyDirectStreams: true },
    labels: filenameLabels,
    capabilities,
    mode: "client",
    probeForStream: () => {
      throw Error("must not consult metadata");
    }
  });
  assert.equal(shown.length, 8);
  assert.deepEqual(
    playerStreamProbeCandidates(streams, {
      labels: filenameLabels,
      settings: { showOnlyDirectStreams: true },
      mode: "client"
    }),
    []
  );
});

test("a legacy disabled check suspends filtering; addon choices only bound background work", () => {
  for (const disabled of [{ ...labels, showPlaybackLabels: false }]) {
    assert.equal(
      filterPlayerStreams(rows, { settings: { showOnlyDirectStreams: true }, labels: disabled }),
      rows
    );
    assert.deepEqual(
      playerStreamProbeCandidates(rows, {
        settings: { showOnlyDirectStreams: true },
        labels: disabled
      }),
      []
    );
  }
});
