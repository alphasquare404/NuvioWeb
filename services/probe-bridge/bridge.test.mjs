import assert from "node:assert/strict";
import test from "node:test";
import { normalizeProbe, parseProbeSource, probeCacheKey, pruneProbeCache } from "./bridge.mjs";

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
    // The tag is part of the answer now: `hvc1` and `hev1` are the difference
    // between a file Apple plays and one it refuses.
    videoTag: "",
    audioCodec: "eac3",
    audioChannels: 0,
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

test("only a real four-character code is reported as a tag", () => {
  // Measured on the real list: Matroska has no fourcc and ffprobe answers
  // `[0][0][0][0]`, which is not a tag and means nothing to a reader.
  const mkv = normalizeProbe({
    streams: [{ codec_type: "video", codec_name: "hevc", codec_tag_string: "[0][0][0][0]" }],
    format: { format_name: "matroska,webm" }
  });
  assert.equal(mkv.videoTag, "");

  const mp4 = normalizeProbe({
    streams: [{ codec_type: "video", codec_name: "hevc", codec_tag_string: "hev1" }],
    format: { format_name: "mov,mp4,m4a,3gp,3g2,mj2" }
  });
  assert.equal(mp4.videoTag, "hev1");
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

test("the answer cache is bounded by age and by size", () => {
  const cache = new Map();
  const at = 1_000_000;
  cache.set("fresh", { expiresAt: at + 60_000 });
  cache.set("stale", { expiresAt: at - 1 });
  pruneProbeCache(cache, { at, maxEntries: 10 });
  assert.deepEqual([...cache.keys()], ["fresh"], "an expired answer is removed, not just skipped");

  const full = new Map();
  for (const name of ["a", "b", "c", "d"]) full.set(name, { expiresAt: at + 60_000 });
  pruneProbeCache(full, { at, maxEntries: 2 });
  assert.deepEqual([...full.keys()], ["c", "d"], "the oldest answers go first");
});

test("an answer is keyed by the file when the caller can name it", () => {
  const fromUrl = probeCacheKey({ urlKey: "urlhash" });
  assert.equal(fromUrl, "urlhash", "no identity: the URL stands, as before");
  assert.equal(probeCacheKey({ host: "cdn.test", urlKey: "urlhash" }), "urlhash");

  const byId = probeCacheKey({
    host: "cdn.test",
    identity: "torbox|abc|1|film.mkv",
    urlKey: "urlhash"
  });
  assert.notEqual(byId, "urlhash");
  // Same file, same answer, even though the link was re-issued with a new token.
  assert.equal(
    byId,
    probeCacheKey({ host: "cdn.test", identity: "torbox|abc|1|film.mkv", urlKey: "otherhash" })
  );
  // A different host is a different cache entry, so two CDNs cannot cross answers.
  assert.notEqual(byId, probeCacheKey({ host: "cdn2.test", identity: "torbox|abc|1|film.mkv" }));
  // A different file is a different entry.
  assert.notEqual(
    byId,
    probeCacheKey({ host: "cdn.test", identity: "torbox|abc|2|film.mkv", urlKey: "urlhash" })
  );
});

test("the channel count travels with the answer, because no browser API can report it", () => {
  const result = normalizeProbe({
    streams: [
      {
        codec_type: "video",
        codec_name: "hevc",
        codec_tag_string: "hvc1",
        width: 1920,
        height: 1080
      },
      { codec_type: "audio", codec_name: "aac", channels: 6 }
    ],
    format: { format_name: "matroska,webm" }
  });
  assert.equal(result.audioChannels, 6);
  // A probe without the field still yields a usable shape.
  const silent = normalizeProbe({
    streams: [{ codec_type: "video", codec_name: "h264" }],
    format: {}
  });
  assert.equal(silent.audioChannels, 0);
});
