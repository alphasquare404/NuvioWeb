import assert from "node:assert/strict";
import test from "node:test";
import { detectDeviceCapabilities } from "../../core/player/deviceCapabilities.js";
import { renderStreamPlaybackBadge } from "./streamPlaybackBadge.js";

const ALL = {
  h264: true,
  hevc: true,
  av1: true,
  aac: true,
  eac3: true,
  ac3: true,
  opus: true,
  dts: false
};

function fakePlatform(supported) {
  return { isTypeSupported: (type) => supported.some((entry) => type.includes(entry)) };
}

test("capabilities are read from the platform, and missing APIs mean no", () => {
  const none = detectDeviceCapabilities(fakePlatform([]));
  assert.equal(none.h264, false);
  assert.equal(none.hevc, false);
  assert.equal(none.dts, false);

  const some = detectDeviceCapabilities(fakePlatform(["avc1", "mp4a"]));
  assert.equal(some.h264, true);
  assert.equal(some.aac, true);
  assert.equal(some.hevc, false);

  const broken = detectDeviceCapabilities({
    isTypeSupported: () => {
      throw new Error("nope");
    }
  });
  assert.equal(broken.h264, false);
});

test("the badge sits in the top right corner and is rounded", () => {
  const html = renderStreamPlaybackBadge({
    url: "https://cdn/a.mp4",
    label: "x264 AAC",
    capabilities: ALL
  });
  assert.match(html, /position:absolute/);
  assert.match(html, /top:12px/);
  assert.match(html, /right:12px/);
  assert.match(html, /border-radius:8px/);
});

test("each cost has its own colour: green, yellow, orange, red", () => {
  const direct = renderStreamPlaybackBadge({
    url: "https://cdn/a.mp4",
    label: "1080p x264 AAC",
    capabilities: ALL
  });
  assert.match(direct, />Direct</);
  assert.match(direct, /rgba\(31,122,77/); // green

  const remux = renderStreamPlaybackBadge({
    url: "https://cdn/a.mkv",
    label: "1080p HEVC AAC",
    capabilities: ALL
  });
  assert.match(remux, />Remux</);
  assert.match(remux, /rgba\(168,138,26/); // yellow

  const audio = renderStreamPlaybackBadge({
    url: "https://cdn/a.mp4",
    label: "1080p x264 DDP5.1",
    capabilities: { ...ALL, eac3: false }
  });
  assert.match(audio, />Transcode</);
  assert.match(audio, /rgba\(190,94,20/); // orange

  const full = renderStreamPlaybackBadge({
    url: "https://cdn/a.mkv",
    label: "1080p AV1",
    capabilities: { ...ALL, av1: false }
  });
  assert.match(full, />Transcode</);
  assert.match(full, /rgba\(163,42,42/); // red
});

test("an estimate says so, an exact probe does not", () => {
  const estimate = renderStreamPlaybackBadge({
    url: "https://cdn/a.mkv",
    label: "1080p HEVC",
    capabilities: ALL
  });
  assert.match(estimate, /perkiraan/);

  const exact = renderStreamPlaybackBadge({
    url: "https://cdn/a.mkv",
    label: "",
    probe: { container: "mkv", videoCodec: "h264", audioCodec: "aac" },
    capabilities: ALL
  });
  assert.doesNotMatch(exact, /perkiraan/);
});

test("nothing the addon printed reaches the markup", () => {
  const html = renderStreamPlaybackBadge({
    url: "https://cdn/a.mp4",
    label: '<img src=x onerror="alert(1)">',
    capabilities: ALL
  });
  assert.doesNotMatch(html, /<img/);
  assert.doesNotMatch(html, /onerror/);
});

test("the unknown case is grey and says so", () => {
  const html = renderStreamPlaybackBadge({
    url: "https://cdn/stream/abc",
    label: "",
    capabilities: ALL
  });
  assert.match(html, />Unknown</);
  assert.match(html, /rgba\(120,120,120/);
});
