import assert from "node:assert/strict";
import test from "node:test";
import { normalizeProbe, parseProbeSource } from "./bridge.mjs";

test("only http(s) sources without credentials are probed", () => {
  assert.equal(parseProbeSource("https://cdn/a.mkv").ok, true);
  assert.equal(parseProbeSource("file:///etc/passwd").reason, "unsupported-scheme");
  assert.equal(parseProbeSource("blob:https://app.test/1").reason, "unsupported-scheme");
  assert.equal(parseProbeSource("").reason, "missing-source");
  assert.equal(parseProbeSource("nope").reason, "invalid-url");
  assert.equal(parseProbeSource("https://a:b@cdn/a.mkv").reason, "credentials-not-allowed");
});

test("ffprobe output is reduced to the facts the decision needs", () => {
  const result = normalizeProbe({
    streams: [
      { codec_type: "video", codec_name: "hevc", width: 1920, height: 800 },
      { codec_type: "audio", codec_name: "eac3" }
    ],
    format: { format_name: "matroska,webm", duration: "3120.4" }
  });
  assert.deepEqual(result, {
    container: "mkv",
    videoCodec: "hevc",
    audioCodec: "eac3",
    width: 1920,
    height: 800,
    durationSeconds: 3120.4
  });
});

test("mp4 and unknown containers are named as they are", () => {
  const mp4 = normalizeProbe({
    streams: [{ codec_type: "video", codec_name: "h264" }],
    format: { format_name: "mov,mp4,m4a,3gp,3g2,mj2" }
  });
  assert.equal(mp4.container, "mp4");
  assert.equal(mp4.audioCodec, "unknown");

  const unknown = normalizeProbe({ streams: [], format: {} });
  assert.equal(unknown.container, "unknown");
  assert.equal(unknown.videoCodec, "unknown");
});

test("a stream without an audio track does not break the shape", () => {
  const result = normalizeProbe({
    streams: [{ codec_type: "video", codec_name: "av1" }],
    format: { format_name: "matroska" }
  });
  assert.equal(result.videoCodec, "av1");
  assert.equal(result.audioCodec, "unknown");
  assert.equal(result.width, 0);
});
