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
    probe: { container: "mp4", videoCodec: "h264", audioCodec: "aac" },
    capabilities: ALL
  });
  assert.match(direct, />Direct</);
  assert.match(direct, /rgba\(31,122,77/); // green

  const remux = renderStreamPlaybackBadge({
    url: "https://cdn/a.mkv",
    label: "1080p HEVC AAC",
    probe: { container: "mkv", videoCodec: "hevc", audioCodec: "aac" },
    capabilities: ALL
  });
  assert.match(remux, />Remux</);
  assert.match(remux, /rgba\(168,138,26/); // yellow

  const audio = renderStreamPlaybackBadge({
    url: "https://cdn/a.mp4",
    label: "1080p x264 DDP5.1",
    probe: { container: "mp4", videoCodec: "h264", audioCodec: "eac3", audioChannels: 6 },
    capabilities: { ...ALL, eac3: false }
  });
  assert.match(audio, />Transcode [A-Z0-9.]+.AAC</);
  assert.match(audio, /rgba\(190,94,20/); // orange

  const full = renderStreamPlaybackBadge({
    url: "https://cdn/a.mkv",
    label: "1080p AV1",
    probe: { container: "mkv", videoCodec: "av1", audioCodec: "aac" },
    capabilities: { ...ALL, av1: false }
  });
  assert.match(full, />Transcode</);
  assert.match(full, /rgba\(163,42,42/); // red
});

test("an estimate says so, an exact probe does not", () => {
  // Without a probe the label makes no claim at all, which is the point of this change.
  const estimate = renderStreamPlaybackBadge({
    url: "https://cdn/a.mkv",
    label: "1080p HEVC",
    capabilities: ALL
  });
  assert.match(estimate, />Unknown</);
  assert.match(estimate, /waiting for the probe/);

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

test("a deployment without a transcode endpoint says so instead of promising one", () => {
  const args = {
    url: "https://cdn/a.mp4",
    label: "1080p x264 DDP5.1",
    capabilities: { h264: true, aac: true, eac3: false }
  };
  const promised = renderStreamPlaybackBadge({
    ...args,
    probe: { container: "mp4", videoCodec: "h264", audioCodec: "eac3", audioChannels: 6 },
    transcodeAvailable: true
  });
  assert.match(promised, />Transcode [A-Z0-9.]+→AAC</);
  assert.match(promised, /rgba\(190,94,20/);

  const unavailable = renderStreamPlaybackBadge({
    ...args,
    probe: { container: "mp4", videoCodec: "h264", audioCodec: "eac3", audioChannels: 6 },
    transcodeAvailable: false
  });
  assert.match(unavailable, />Transcode \(unavailable\)</);
  assert.match(unavailable, /this deployment does not run a transcode endpoint/);
  // Neutral, not orange: the card must not look like an offer it cannot honour.
  assert.match(unavailable, /rgba\(120,120,120/);

  // Other labels are untouched by the setting.
  const direct = renderStreamPlaybackBadge({
    url: "https://cdn/a.mp4",
    label: "1080p x264 AAC",
    probe: { container: "mp4", videoCodec: "h264", audioCodec: "aac" },
    capabilities: { h264: true, aac: true },
    transcodeAvailable: false
  });
  assert.match(direct, />Direct</);
});

test("remux is described the same way when the deployment cannot relay it", () => {
  // HEVC in an MKV needs a container swap that this deployment does not offer.
  const args = {
    url: "https://cdn/a.mkv",
    label: "1080p HEVC AAC",
    capabilities: { h264: true, hevc: true, aac: true }
  };
  const offered = renderStreamPlaybackBadge({
    ...args,
    probe: { container: "mkv", videoCodec: "hevc", audioCodec: "aac" },
    remuxAvailable: true
  });
  assert.match(offered, />Remux</);

  const unavailable = renderStreamPlaybackBadge({
    ...args,
    probe: { container: "mkv", videoCodec: "hevc", audioCodec: "aac" },
    remuxAvailable: false
  });
  assert.match(unavailable, />Remux \(unavailable\)</);
  assert.match(unavailable, /does not run a remux endpoint/);
  assert.match(unavailable, /rgba\(120,120,120/);
});
