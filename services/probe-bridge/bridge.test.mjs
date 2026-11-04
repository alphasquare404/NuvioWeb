import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeProbe,
  parseProbeSource,
  probeCacheKey,
  pruneProbeCache,
  createProbeOutputCollector
} from "./bridge.mjs";

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
    audioStreams: [
      {
        index: 0,
        codec: "eac3",
        channels: 0,
        sampleRate: 0,
        profile: "",
        language: "",
        default: false
      }
    ],
    codecString: "",
    videoProfile: "",
    videoLevel: 0,
    pixelFormat: "",
    bitDepth: 0,
    frameRate: 0,
    videoBitrate: 0,
    colorTransfer: "",
    colorPrimaries: "",
    hasAudio: true,
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

test("probe preserves decoder configuration and skips attached cover art", () => {
  const result = normalizeProbe({
    streams: [
      { codec_type: "video", codec_name: "mjpeg", disposition: { attached_pic: 1 } },
      {
        codec_type: "video",
        codec_name: "h264",
        extradata: "\n00000000: 0164 0028 ffe1 0000  .d.(....",
        profile: "High",
        level: 40,
        pix_fmt: "yuv420p10le",
        avg_frame_rate: "24000/1001",
        width: 1920,
        height: 1080
      },
      {
        codec_type: "audio",
        codec_name: "aac",
        profile: "LC",
        channels: 6,
        sample_rate: "48000",
        tags: { language: "eng" },
        disposition: { default: 1 }
      }
    ],
    format: { format_name: "mov,mp4" }
  });
  assert.equal(result.videoCodec, "h264");
  assert.equal(result.codecString, "avc1.640028");
  assert.equal(result.bitDepth, 10);
  assert.equal(result.frameRate, 24000 / 1001);
  assert.equal(result.audioStreams[0].language, "eng");
  assert.equal(result.audioStreams[0].sampleRate, 48000);
});
test("unambiguous WebM format is not rewritten as MKV", () => {
  assert.equal(normalizeProbe({ format: { format_name: "webm" } }).container, "webm");
});

test("HEVC codec strings retain Main10 level and compatibility flags", () => {
  const result = normalizeProbe({
    streams: [
      {
        codec_type: "video",
        codec_name: "hevc",
        extradata: "00000000: 0102 2000 0000 b000 0000 0000 99  ............."
      }
    ],
    format: { format_name: "mp4" }
  });
  assert.equal(result.codecString, "hvc1.2.4.L153.B0");
});
test("AV1 codec strings retain the actual level, tier and bit depth", () => {
  const result = normalizeProbe({
    streams: [{ codec_type: "video", codec_name: "av1", extradata: "00000000: 8108 4c00  ...." }],
    format: { format_name: "mp4" }
  });
  assert.equal(result.codecString, "av01.0.08M.10");
});

test("large attachment extradata is discarded incrementally without truncating codec JSON", () => {
  const collector = createProbeOutputCollector();
  collector.write(
    '{\n"streams": [\n{\n"codec_type": "video",\n"codec_name": "h264",\n"extradata": "video-config"\n},\n{\n"codec_type": "attachment",\n"extradata": "'
  );
  for (let i = 0; i < 512; i++) collector.write("a".repeat(65536));
  collector.write("\\");
  collector.write('"still attachment');
  assert.ok(collector.retainedChars < 512);
  collector.write('"\n}\n],\n"format": {"format_name":"matroska,webm","duration":"1544.62"}\n}');
  const result = JSON.parse(collector.finish());
  assert.equal(result.streams[0].extradata, "video-config");
  assert.equal(result.streams[1].extradata, "");
  assert.equal(normalizeProbe(result).videoCodec, "h264");
  assert.equal(normalizeProbe(result).durationSeconds, 1544.62);
});

test("retained metadata remains bounded and incomplete attachment JSON fails explicitly", () => {
  const huge = createProbeOutputCollector(32);
  assert.throws(() => huge.write("a".repeat(33)), /probe-output-limit/);
  const broken = createProbeOutputCollector();
  broken.write('"codec_type": "attachment"\n"extradata": "unfinished');
  assert.throws(() => broken.finish(), /probe-unreadable/);
});
