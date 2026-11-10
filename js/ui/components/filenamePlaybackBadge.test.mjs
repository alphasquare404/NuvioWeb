import assert from "node:assert/strict";
import test from "node:test";

globalThis.__NUVIO_ENV__ = { TRANSCODE_MODE: "client" };
const { renderFilenamePlaybackBadge } = await import("./filenamePlaybackBadge.js");

test("a stream estimated to require video conversion shows Full Transcode in client mode", () => {
  const stream = { name: "Film.1080p.AV1.AAC.mkv" };
  const caps = { av1: false, aac: true, containers: { mkv: false } };
  const badge = renderFilenamePlaybackBadge(stream, {}, caps);
  assert.match(badge, /tone-orange/);
  assert.match(badge, />Full Transcode <span[^>]+>≈<\/span>/);
  assert.doesNotMatch(badge, /Unsupported/);
});
