import assert from "node:assert/strict";
import test from "node:test";

globalThis.__NUVIO_ENV__ = { TRANSCODE_MODE: "client" };
const { renderFilenamePlaybackBadge } = await import("./filenamePlaybackBadge.js");

test("audio, video, and full transcode share the visible label and have distinct colors", () => {
  const caps = { av1: false, h264: true, aac: true, dts: false, containers: { mkv: false } };
  const audio = renderFilenamePlaybackBadge({ name: "Film.1080p.H264.DTS.mkv" }, {}, caps);
  const video = renderFilenamePlaybackBadge({ name: "Film.1080p.AV1.AAC.mkv" }, {}, caps);
  const full = renderFilenamePlaybackBadge({ name: "Film.1080p.AV1.DTS.mkv" }, {}, caps);

  assert.match(audio, /tone-orange.*aria-label="Audio Transcode\./);
  assert.match(video, /tone-purple.*aria-label="Video Transcode.*Estimates only/);
  assert.match(full, /tone-red.*aria-label="Full Transcode\./);
  assert.match(audio, /playback-badge-compact-audio-transcode\.svg" alt="Transcode"/);
  assert.match(video, /playback-badge-compact-video-transcode\.svg" alt="Transcode"/);
  assert.match(full, /playback-badge-compact-full-transcode\.svg" alt="Transcode"/);
  for (const badge of [audio, video, full]) assert.doesNotMatch(badge, /≈/);
});

test("an unknown stream uses the gray SVG without an estimate symbol", () => {
  const badge = renderFilenamePlaybackBadge({ name: "Film 1080p" });
  assert.match(badge, /tone-neutral/);
  assert.match(badge, /playback-badge-compact-unknown\.svg" alt="Unknown"/);
  assert.doesNotMatch(badge, /≈/);
});
