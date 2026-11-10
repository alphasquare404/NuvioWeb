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
  containers: { mp4: true, webm: true, mkv: false, ts: false, avi: false },
  h264: true,
  hevc: true,
  av1: true,
  aac: true,
  eac3: true,
  opus: true,
  ac3: true,
  dts: true
};
const weak = {
  containers: { mp4: true, webm: true, mkv: false, ts: false, avi: false },
  h264: true,
  hevc: false,
  av1: false,
  aac: true,
  eac3: false,
  opus: false,
  dts: false
};

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

test("an mkv with unsupported audio is transcoded, not merely remuxed", () => {
  // The gap this closes, measured with a real DTS file: the container used to
  // decide first, so a DTS or E-AC3 MKV was labelled "Remux", sent to the remux
  // relay, and came back as an MP4 with the same undecodable audio. The audio
  // transcode relay copies the picture *and* writes an MP4, so it is the only
  // relay that fixes this file.
  const result = classifyPlayback({
    url: "https://cdn/a.mkv",
    label: "1080p x264 DTS-HD",
    capabilities: weak
  });
  assert.equal(result.method, PLAYBACK_METHODS.AUDIO_TRANSCODE);
  assert.equal(result.reason, "audio-dts-unsupported");
  assert.equal(playbackMethodTone(result.method), "orange");
});

test("an mkv whose audio is playable is still only a container problem", () => {
  const result = classifyPlayback({
    url: "https://cdn/a.mkv",
    label: "1080p x264 AAC",
    capabilities: capable
  });
  assert.equal(result.method, PLAYBACK_METHODS.REMUX);
  assert.equal(playbackMethodTone(result.method), "yellow");
});

test("HEVC tagged hev1 is a retag for a platform that only opens hvc1", () => {
  // Measured on a real 1080p x265 webrip: container mp4, HEVC Main 10, AAC 5.1 --
  // every codec supported, and the player still refused it with networkState 3
  // because the track said hev1. A `-c copy -tag:v hvc1` pass played it.
  const apple = { ...capable, hevcHvc1Required: true };
  const hev1 = {
    container: "mp4",
    videoCodec: "hevc",
    videoTag: "hev1",
    audioCodec: "aac"
  };
  const result = classifyPlayback({
    url: "https://cdn/a.mp4",
    label: "1080p x265",
    probe: {
      ...hev1,
      playbackCapabilities: {
        video: true,
        audio: [{ index: 0, supported: true }],
        container: true,
        needsRetag: true
      }
    },
    capabilities: apple
  });
  assert.equal(result.method, PLAYBACK_METHODS.REMUX);
  assert.equal(result.reason, "hevc-tag-hev1");
  assert.equal(playbackMethodTone(result.method), "yellow");

  // Already hvc1: nothing to repair.
  const hvc1 = classifyPlayback({
    url: "https://cdn/a.mp4",
    label: "1080p x265",
    probe: { ...hev1, videoTag: "hvc1" },
    capabilities: apple
  });
  assert.equal(hvc1.method, PLAYBACK_METHODS.DIRECT);

  // A platform that opens both tags keeps playing it directly.
  const android = classifyPlayback({
    url: "https://cdn/a.mp4",
    label: "1080p x265",
    probe: hev1,
    capabilities: capable
  });
  assert.equal(android.method, PLAYBACK_METHODS.DIRECT);

  // An estimate without a probe has no tag to judge, so it stays as it was.
  const estimate = classifyPlayback({
    url: "https://cdn/a.mp4",
    label: "1080p x265 AAC",
    capabilities: apple
  });
  assert.equal(estimate.method, PLAYBACK_METHODS.DIRECT);
});

test("adaptive variants are not promised Direct without manifest verification", () => {
  for (const url of ["https://cdn/a.m3u8", "https://cdn/a.mpd"]) {
    const result = classifyPlayback({ url, label: "1080p HEVC", capabilities: weak });
    assert.equal(result.method, PLAYBACK_METHODS.UNKNOWN);
    assert.equal(result.reason, "adaptive-variants-unverified");
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
  assert.equal(result.confidence, "predicted");
  assert.equal(result.container, "mkv");
});

test("an unknown codec is not treated as a failure", () => {
  const result = classifyPlayback({ url: "https://cdn/a.mp4", label: "", capabilities: weak });
  // Not a failure, but not an answer either: an unnamed video codec decides remux versus a
  // full re-encode, so it goes to the probe rather than being guessed as Direct.
  assert.equal(result.method, PLAYBACK_METHODS.UNKNOWN);
  assert.equal(result.reason, "video-unknown");
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
  // A container is not enough to promise a remux: without a named video codec the relay
  // cannot know whether a copy is enough, so the row stays Unknown until it is probed.
  assert.equal(withName.method, PLAYBACK_METHODS.UNKNOWN);

  // Nothing to read is still nothing to read.
  const bare = classifyPlayback({
    url: "",
    label: "4K TB Instant 2160p WEBRip",
    capabilities: capable
  });
  assert.equal(bare.method, PLAYBACK_METHODS.UNKNOWN);
});
test("an existing aac track is selected instead of converting anything", () => {
  const apple = {
    containers: { mp4: true, mkv: false },
    h264: true,
    hevc: true,
    aac: true,
    eac3: false,
    hevcHvc1Required: true
  };
  const probe = (tracks, extra = {}) => ({
    container: "mkv",
    videoCodec: "h264",
    audioCodec: tracks[0].codec,
    audioChannels: tracks[0].channels,
    audioStreams: tracks,
    ...extra
  });
  const eac3ThenAac = [
    { index: 0, codec: "eac3", channels: 6 },
    { index: 1, codec: "aac", channels: 2 }
  ];

  // Measured on a phone: mapping the second track played with sound and no encoding.
  for (const extra of [{}, { container: "mp4", videoCodec: "hevc", videoTag: "hvc1" }]) {
    const verdict = classifyPlayback({
      url: "",
      label: "judul.x265.mkv",
      capabilities: apple,
      probe: probe(eac3ThenAac, extra)
    });
    assert.equal(verdict.method, PLAYBACK_METHODS.REMUX);
    assert.equal(verdict.audioIndex, 1);
    assert.equal(verdict.reason, "audio-track-selected");
  }

  // No AAC track anywhere: conversion really is the only way to hear it.
  const onlyEac3 = classifyPlayback({
    url: "",
    label: "judul.x265.mkv",
    capabilities: apple,
    probe: probe([{ index: 0, codec: "eac3", channels: 6 }])
  });
  assert.equal(onlyEac3.method, PLAYBACK_METHODS.AUDIO_TRANSCODE);

  // AAC 5.1 plays (measured), so it is not converted and needs no track selection.
  const aac51 = classifyPlayback({
    url: "",
    label: "judul.x265.mkv",
    capabilities: apple,
    probe: probe([{ index: 0, codec: "aac", channels: 6 }])
  });
  assert.equal(aac51.method, PLAYBACK_METHODS.REMUX);
  assert.equal(aac51.audioIndex, 0);
});

test("a row without a named video stays Unknown until the probe decides", () => {
  const apple = {
    containers: { mp4: true, mkv: false },
    h264: true,
    hevc: true,
    aac: true,
    eac3: false,
    av1: false
  };
  const label = "judul.1080p.WEB-DL.mkv";
  const row = { url: "https://cdn/judul.1080p.WEB-DL.mkv", label, capabilities: apple };

  // Before the probe: no promise is made. This is the label the list shows first.
  const estimate = classifyPlayback(row);
  assert.equal(estimate.method, PLAYBACK_METHODS.UNKNOWN);
  assert.equal(estimate.reason, "video-unknown");

  // The probe answers with a picture this device plays: a copy is enough.
  const remuxed = classifyPlayback({
    ...row,
    probe: { container: "mkv", videoCodec: "hevc", videoTag: "hvc1", audioCodec: "aac" }
  });
  assert.equal(remuxed.method, PLAYBACK_METHODS.REMUX);

  // The probe answers with a picture it cannot play: that is a re-encode.
  const encoded = classifyPlayback({
    ...row,
    probe: { container: "mkv", videoCodec: "av1", videoTag: "", audioCodec: "aac" }
  });
  assert.equal(encoded.method, PLAYBACK_METHODS.TRANSCODE);
  assert.equal(encoded.reason, "video-av1-unsupported");
});

test("unrecognised codec capabilities never default to Direct", () => {
  for (const probe of [
    { container: "mp4", videoCodec: "vc1", audioCodec: "aac" },
    { container: "mp4", videoCodec: "h264", audioCodec: "truehd" },
    { container: "mp4", videoCodec: "h264", audioCodec: "unknown" }
  ])
    assert.equal(classifyPlayback({ probe, capabilities: weak }).method, "unknown");
});
test("supported first audio is retained even when another AAC track exists", () => {
  const result = classifyPlayback({
    capabilities: capable,
    probe: {
      container: "mp4",
      videoCodec: "h264",
      audioCodec: "eac3",
      audioStreams: [
        { index: 0, codec: "eac3" },
        { index: 1, codec: "aac" }
      ]
    }
  });
  assert.equal(result.method, "direct");
});
test("a fallback track must actually be supported on this device", () => {
  const result = classifyPlayback({
    capabilities: { ...weak, aac: false },
    probe: {
      container: "mkv",
      videoCodec: "h264",
      audioCodec: "eac3",
      audioStreams: [
        { index: 0, codec: "eac3" },
        { index: 1, codec: "aac" }
      ]
    }
  });
  assert.equal(result.method, "audio-transcode");
});
test("local per-file assessment overrides a generic codec yes", () => {
  const probe = {
    container: "mp4",
    videoCodec: "h264",
    audioCodec: "aac",
    playbackCapabilities: {
      engine: "native",
      video: false,
      container: true,
      audio: [{ index: 0, supported: true }]
    }
  };
  assert.equal(classifyPlayback({ probe, capabilities: capable }).method, "transcode");
  probe.playbackCapabilities.video = null;
  assert.equal(classifyPlayback({ probe, capabilities: capable }).method, "unknown");
});
test("known video-only files are distinct from unknown audio metadata", () => {
  assert.equal(
    classifyPlayback({
      capabilities: capable,
      probe: { container: "mp4", videoCodec: "h264", audioCodec: "unknown", hasAudio: false }
    }).method,
    "direct"
  );
});
