import assert from "node:assert/strict";
import test from "node:test";
import {
  PLAYBACK_METHODS,
  classifyPlayback,
  detectAudioCodec,
  detectContainer,
  detectVideoCodec,
  playbackMethodTone
} from "./playbackMethod.js";

const capable = {
  h264: true,
  hevc: true,
  av1: true,
  aac: true,
  eac3: true,
  opus: true,
  ac3: true,
  dts: true
};
const weak = { h264: true, hevc: false, av1: false, aac: true, eac3: false, opus: false };

test("the container is read from the source, query strings included", () => {
  assert.equal(detectContainer("https://cdn/a.mkv?token=1"), "mkv");
  assert.equal(detectContainer("https://cdn/a.MKV"), "mkv");
  assert.equal(detectContainer("https://cdn/a.mp4"), "mp4");
  assert.equal(detectContainer("https://cdn/a.m3u8"), "hls");
  assert.equal(detectContainer("https://cdn/a.mpd"), "dash");
  assert.equal(detectContainer("https://cdn/x"), "unknown");
});

test("a filename inside the addon text is enough to know the container", () => {
  // The regression that labelled real MKVs as Direct: the url often has no extension,
  // because it points at a proxy, while the filename sits in the description.
  assert.equal(detectContainer("Silo.S02E02.1080p.WEBRip.mkv 4.3 GB"), "mkv");
  assert.equal(detectContainer("1080p HEVC [Silo.S02E02.mp4]"), "mp4");
  assert.equal(
    detectContainer("https://aiostreams.test/api/v1/proxy/e.abc Silo S02E02.mkv"),
    "mkv"
  );
});

test("codec hints come from the addon's text, not only from the url", () => {
  assert.equal(detectVideoCodec("Silo 1080p HEVC"), "hevc");
  assert.equal(detectVideoCodec("Silo 1080p x265"), "hevc");
  assert.equal(detectVideoCodec("Silo AV1 DS4k"), "av1");
  assert.equal(detectVideoCodec("Silo x264"), "h264");
  assert.equal(detectVideoCodec("Silo 1080p"), "unknown");
  assert.equal(detectAudioCodec("DDP5.1"), "eac3");
  assert.equal(detectAudioCodec("DTS-HD"), "dts");
  assert.equal(detectAudioCodec("Opus 5.1"), "opus");
});

test("a proxied url with the filename only in the label is still remuxed", () => {
  const result = classifyPlayback({
    url: "https://aiostreams.test/api/v1/proxy/e.abc123",
    label: "Silo S02E02 1080p HEVC AAC Silo.S02E02.mkv",
    capabilities: capable
  });
  assert.equal(result.container, "mkv");
  assert.equal(result.method, PLAYBACK_METHODS.REMUX);
});

test("a supported file is played directly, with no relay in the way", () => {
  const result = classifyPlayback({
    url: "https://cdn/a.mp4",
    label: "1080p x264 AAC",
    capabilities: capable
  });
  assert.equal(result.method, PLAYBACK_METHODS.DIRECT);
  assert.equal(result.confidence, "estimate");
});

test("an mkv with a playable codec is a container problem, so it is remuxed", () => {
  const result = classifyPlayback({
    url: "https://cdn/a.mkv",
    label: "1080p HEVC AAC",
    capabilities: capable
  });
  assert.equal(result.method, PLAYBACK_METHODS.REMUX);
  assert.equal(result.reason, "container-mkv");
});

test("the same mkv on a device that cannot decode hevc needs a full transcode", () => {
  const result = classifyPlayback({
    url: "https://cdn/a.mkv",
    label: "1080p HEVC AAC",
    capabilities: weak
  });
  assert.equal(result.method, PLAYBACK_METHODS.TRANSCODE);
  assert.equal(result.reason, "video-hevc-unsupported");
});

test("a playable picture with an unsupported audio track is the cheap case", () => {
  const result = classifyPlayback({
    url: "https://cdn/a.mp4",
    label: "1080p x264 DDP5.1",
    capabilities: weak
  });
  assert.equal(result.method, PLAYBACK_METHODS.AUDIO_TRANSCODE);
  assert.equal(result.reason, "audio-eac3-unsupported");
});

test("adaptive streams are left to the player, which negotiates", () => {
  for (const url of ["https://cdn/a.m3u8", "https://cdn/a.mpd"]) {
    const result = classifyPlayback({ url, label: "1080p HEVC", capabilities: weak });
    assert.equal(result.method, PLAYBACK_METHODS.DIRECT);
    assert.equal(result.reason, "adaptive-stream");
  }
});

test("a probe turns an estimate into a decision", () => {
  const result = classifyPlayback({
    url: "https://cdn/stream/abc",
    label: "1080p",
    probe: { container: "mkv", videoCodec: "h264", audioCodec: "aac" },
    capabilities: capable
  });
  assert.equal(result.method, PLAYBACK_METHODS.REMUX);
  assert.equal(result.confidence, "exact");
  assert.equal(result.container, "mkv");
});

test("an unknown codec is not treated as a failure", () => {
  const result = classifyPlayback({ url: "https://cdn/a.mp4", label: "", capabilities: weak });
  assert.equal(result.method, PLAYBACK_METHODS.DIRECT);
  assert.equal(result.videoCodec, "unknown");
});

test("the tones follow the four costs: green, yellow, orange, red", () => {
  assert.equal(playbackMethodTone(PLAYBACK_METHODS.DIRECT), "green");
  assert.equal(playbackMethodTone(PLAYBACK_METHODS.REMUX), "yellow");
  assert.equal(playbackMethodTone(PLAYBACK_METHODS.AUDIO_TRANSCODE), "orange");
  assert.equal(playbackMethodTone(PLAYBACK_METHODS.TRANSCODE), "red");
});

test("no container and no codec is Unknown, not a confident Direct", () => {
  const result = classifyPlayback({
    url: "https://cdn/stream/abc",
    label: "",
    capabilities: capable
  });
  assert.equal(result.container, "unknown");
  assert.equal(result.method, PLAYBACK_METHODS.UNKNOWN);
  assert.equal(result.reason, "not-enough-information");
  assert.equal(playbackMethodTone(result.method), "neutral");
});

test("an unknown container is not claimed as Direct", () => {
  // A container nobody can name may be an MKV, so the honest answer is "cannot tell
  // yet" — the probe is what turns this into a decision.
  const unknownContainer = classifyPlayback({
    url: "https://cdn/stream/abc",
    label: "1080p x264 AAC",
    capabilities: capable
  });
  assert.equal(unknownContainer.method, PLAYBACK_METHODS.UNKNOWN);
  assert.equal(unknownContainer.reason, "container-unknown");

  // A codec the device cannot decode stays a transcode regardless of the container.
  const bad = classifyPlayback({
    url: "https://cdn/stream/abc",
    label: "1080p AV1",
    capabilities: weak
  });
  assert.equal(bad.method, PLAYBACK_METHODS.TRANSCODE);
});

test("an unresolved row is still estimated from its own label", () => {
  // The estimate is about the text, not about whether the addon has handed over a
  // URL yet: a row that names its container keeps its label while it resolves.
  const withName = classifyPlayback({
    url: "",
    label: "TB Instant Silo.S02E02.1080p.WEBRip.mkv",
    capabilities: capable
  });
  assert.equal(withName.method, PLAYBACK_METHODS.REMUX);

  // Nothing to read is still nothing to read.
  const bare = classifyPlayback({
    url: "",
    label: "4K TB Instant 2160p WEBRip",
    capabilities: capable
  });
  assert.equal(bare.method, PLAYBACK_METHODS.UNKNOWN);
});
