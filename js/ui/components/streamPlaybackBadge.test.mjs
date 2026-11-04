import assert from "node:assert/strict";
import test from "node:test";
import { detectDeviceCapabilities } from "../../core/player/deviceCapabilities.js";
import { renderStreamPlaybackBadge } from "./streamPlaybackBadge.js";

const ALL = {
  containers: { mp4: true, webm: true, mkv: false, ts: false, avi: false },
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

test("capabilities distinguish an explicit refusal from an unavailable API", () => {
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
  assert.equal(broken.h264, null);
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
  assert.match(audio, />Transcoding [A-Z0-9.]+.AAC</);
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
  assert.match(estimate, /Stream metadata unavailable/);

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
    capabilities: { containers: { mp4: true, mkv: false }, h264: true, aac: true, eac3: false }
  };
  const promised = renderStreamPlaybackBadge({
    ...args,
    probe: { container: "mp4", videoCodec: "h264", audioCodec: "eac3", audioChannels: 6 },
    transcodeAvailable: true
  });
  assert.match(promised, />Transcoding [A-Z0-9.]+→AAC</);
  assert.match(promised, /rgba\(190,94,20/);

  const unavailable = renderStreamPlaybackBadge({
    ...args,
    probe: { container: "mp4", videoCodec: "h264", audioCodec: "eac3", audioChannels: 6 },
    transcodeAvailable: false
  });
  assert.match(unavailable, />Transcode \(unavailable\)</);
  assert.match(unavailable, /the audio transcode service is unavailable or access is missing/);
  // Neutral, not orange: the card must not look like an offer it cannot honour.
  assert.match(unavailable, /rgba\(120,120,120/);

  // Other labels are untouched by the setting.
  const direct = renderStreamPlaybackBadge({
    url: "https://cdn/a.mp4",
    label: "1080p x264 AAC",
    probe: { container: "mp4", videoCodec: "h264", audioCodec: "aac" },
    capabilities: { containers: { mp4: true, mkv: false }, h264: true, aac: true },
    transcodeAvailable: false
  });
  assert.match(direct, />Direct</);
});

test("remux is described the same way when the deployment cannot relay it", () => {
  // HEVC in an MKV needs a container swap that this deployment does not offer.
  const args = {
    url: "https://cdn/a.mkv",
    label: "1080p HEVC AAC",
    capabilities: { containers: { mp4: true, mkv: false }, h264: true, hevc: true, aac: true }
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
  assert.match(unavailable, /remux service is unavailable/);
  assert.match(unavailable, /rgba\(120,120,120/);
});

test("configured but unchecked relay is distinct from a working service", () => {
  const html = renderStreamPlaybackBadge({
    probe: { container: "mkv", videoCodec: "h264", audioCodec: "aac" },
    capabilities: ALL,
    remuxAvailable: null
  });
  assert.match(html, />Remux \(unverified\)</);
  assert.match(html, /rgba\(120,120,120/);
});
test("the red full-transcode label stays diagnostic even without a service", () => {
  const html = renderStreamPlaybackBadge({
    probe: { container: "mp4", videoCodec: "av1", audioCodec: "aac" },
    capabilities: { av1: false, aac: true },
    transcodeAvailable: false
  });
  assert.match(html, />Transcode</);
  assert.match(html, /rgba\(163,42,42/);
});

test("filename labels are immediate estimates and ignore cached metadata", () => {
  const stream = { url: "https://cdn.test/video", name: "Film.H264.AAC.mp4", title: "HDR" };
  const html = renderStreamPlaybackBadge({
    stream,
    labelSource: "FILE_NAME",
    capabilities: ALL,
    probe: { container: "mkv", videoCodec: "hevc", audioCodec: "dts" }
  });
  assert.match(html, />Direct : HDR \(estimate\)</);
  assert.match(html, /filename estimate; playback not verified/);
  assert.doesNotMatch(html, /Checking|waiting for the probe/);
  const unknown = renderStreamPlaybackBadge({
    stream: { name: "1080p" },
    labelSource: "FILE_NAME",
    capabilities: ALL
  });
  assert.match(unknown, />Unknown</);
});

test("metadata fallback is opt-in, waits for failure and includes an escaped tappable reason", () => {
  const options = {
    stream: { url: "https://media.test/movie.mkv", name: "Movie.1080p.H264.AAC.mkv" },
    capabilities: ALL
  };
  assert.doesNotMatch(
    renderStreamPlaybackBadge({ ...options, filenameFallback: true, probing: true }),
    /labelFallbackReason/
  );
  assert.doesNotMatch(
    renderStreamPlaybackBadge({ ...options, probeFailed: true }),
    /labelFallbackReason/
  );
  const html = renderStreamPlaybackBadge({
    ...options,
    filenameFallback: true,
    probeFailed: true,
    fallbackReason: "timeout <script>"
  });
  assert.match(html, /data-action="labelFallbackReason"/);
  assert.match(html, /border-radius:50%/);
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /estimate/);
});

test("fallback marker replaces the visible estimate suffix; ordinary filename labels retain it", () => {
  const options = {
    stream: { url: "https://media.test/movie.mkv", name: "Movie.H264.AAC.mkv" },
    capabilities: ALL
  };
  const fallback = renderStreamPlaybackBadge({
    ...options,
    filenameFallback: true,
    probeFailed: true
  });
  assert.match(fallback, /labelFallbackReason/);
  assert.doesNotMatch(fallback, /\(estimate\)/);
  assert.match(renderStreamPlaybackBadge({ ...options, labelSource: "FILE_NAME" }), /\(estimate\)/);
});

test("metadata labels distinguish waiting, checking and failed without enabling filename estimates", () => {
  const args = {
    url: "https://cdn/a.mkv",
    label: "AVC AAC",
    capabilities: ALL,
    filenameFallback: false,
    waiting: true
  };
  assert.match(renderStreamPlaybackBadge(args), />Waiting…</);
  assert.match(renderStreamPlaybackBadge({ ...args, probing: true }), />Checking…</);
  const failure = renderStreamPlaybackBadge({ ...args, probeFailed: true });
  assert.match(failure, />Unknown</);
  assert.doesNotMatch(failure, /Waiting|Checking|Remux|estimated/);
  assert.match(
    renderStreamPlaybackBadge({
      ...args,
      probe: { container: "mkv", videoCodec: "h264", audioCodec: "aac" }
    }),
    />Remux</
  );
});
