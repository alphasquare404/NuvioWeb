import test from "node:test";
import assert from "node:assert/strict";
import {
  createOfflineMediaId,
  createOfflineDownloadId,
  createOfflineSourceFingerprint,
  groupDownloadedMovies,
  groupDownloadedSeries
} from "./offlineDownloadIdentity.js";
import {
  createOfflineSubtitleFingerprint,
  createOfflineSubtitleId,
  decodeOfflineSubtitleBytes,
  detectOfflineSubtitleFormat,
  isOfflineSubtitleTextLoadable,
  isOfflineSubtitleFormatSupported
} from "./offlineSubtitleIdentity.js";
import {
  consumeBrowserOfflineDownloadPrefix,
  createBrowserOfflineDownloadRequestInit,
  getBrowserOfflineResumePlan,
  writeBrowserOfflineDownloadResponse
} from "./browserOfflineDownloadResume.js";

function resumeResponse({ status, contentLength, contentRange = "", hasBody = true }) {
  return {
    status,
    ok: status >= 200 && status < 300,
    body: hasBody ? {} : null,
    headers: { get: (name) => ({ "content-length": contentLength, "content-range": contentRange })[String(name).toLowerCase()] || null }
  };
}

test("resume fetch boundary sends Range for retained offline bytes", () => {
  assert.deepEqual(
    createBrowserOfflineDownloadRequestInit(new AbortController().signal, 49552935).headers,
    { Range: "bytes=49552935-" }
  );
  assert.equal(createBrowserOfflineDownloadRequestInit(new AbortController().signal, 0).headers, undefined);
});

test("ignored Range full response uses the verified skip-prefix append plan", () => {
  const originalTotal = 155681148;
  const retainedOffset = 49552935;
  const plan = getBrowserOfflineResumePlan(
    resumeResponse({ status: 200, contentLength: originalTotal }),
    retainedOffset,
    originalTotal,
    true
  );
  assert.deepEqual(plan, {
    valid: true,
    decision: "skip-prefix-and-append",
    reason: "verified-full-response-ignoring-range",
    prefixBytes: retainedOffset,
    totalBytes: originalTotal
  });
  assert.equal(originalTotal - plan.prefixBytes, 106128213);
});

test("prefix skipping is byte accurate across chunk boundaries", () => {
  let remaining = 100;
  const written = [];
  for (const chunk of [
    Uint8Array.from({ length: 64 }, (_, index) => index),
    Uint8Array.from({ length: 64 }, (_, index) => index + 64),
    Uint8Array.from({ length: 64 }, (_, index) => index + 128)
  ]) {
    const result = consumeBrowserOfflineDownloadPrefix(chunk, remaining);
    remaining = result.remainingPrefixBytes;
    if (result.writeChunk) written.push(...result.writeChunk);
  }
  assert.equal(remaining, 0);
  assert.deepEqual(written, Array.from({ length: 92 }, (_, index) => index + 100));
});

test("prefix skipping leaves retained OPFS bytes unchanged until the suffix starts", () => {
  let remaining = 100;
  let fileSize = 100;
  for (const chunk of [new Uint8Array(64), new Uint8Array(36)]) {
    const result = consumeBrowserOfflineDownloadPrefix(chunk, remaining);
    remaining = result.remainingPrefixBytes;
    if (result.writeChunk) fileSize += result.writeChunk.byteLength;
  }
  assert.equal(remaining, 0);
  assert.equal(fileSize, 100);

  const suffix = consumeBrowserOfflineDownloadPrefix(new Uint8Array(10), remaining);
  fileSize += suffix.writeChunk?.byteLength || 0;
  assert.equal(fileSize, 110);
});

test("production skip-prefix transfer writes the crossing chunk suffix exactly once", async () => {
  const chunks = [
    Uint8Array.from({ length: 64 }, (_, index) => index),
    Uint8Array.from({ length: 64 }, (_, index) => index + 64),
    Uint8Array.from({ length: 72 }, (_, index) => index + 128)
  ];
  let cursor = 0;
  const writes = [];
  const transfer = await writeBrowserOfflineDownloadResponse({
    prefixBytes: 100,
    reader: {
      read: async () => cursor < chunks.length
        ? { done: false, value: chunks[cursor++] }
        : { done: true }
    },
    write: async (chunk) => writes.push(chunk)
  });

  assert.deepEqual(writes.map((chunk) => chunk.byteLength), [28, 72]);
  assert.deepEqual(Array.from(writes[0]), Array.from({ length: 28 }, (_, index) => index + 100));
  assert.notEqual(writes[0].buffer, chunks[1].buffer);
  assert.equal(transfer.prefixBytesDiscarded, 100);
  assert.equal(transfer.suffixBytesWritten, 100);
  assert.equal(100 + transfer.suffixBytesWritten, 200);
});

test("true 206 resumes keep the normal append path when Content-Range is hidden", () => {
  const total = 1513847775;
  const offset = 234881024;
  const plan = getBrowserOfflineResumePlan(
    resumeResponse({ status: 206, contentLength: total - offset }),
    offset,
    total,
    true
  );
  assert.equal(plan.valid, true);
  assert.equal(plan.decision, "append");
  assert.equal(plan.prefixBytes, 0);
});

test("ambiguous retained responses retain the safe restart plan", () => {
  const total = 155681148;
  const offset = 49552935;
  assert.equal(
    getBrowserOfflineResumePlan(resumeResponse({ status: 200, contentLength: total - offset }), offset, total, true).decision,
    "restart"
  );
  assert.equal(
    getBrowserOfflineResumePlan(resumeResponse({ status: 200, contentLength: total }), offset, total, false).decision,
    "restart"
  );
  assert.equal(
    getBrowserOfflineResumePlan(resumeResponse({ status: 200, contentLength: total }), 0, total, false).decision,
    "append"
  );
  assert.equal(
    getBrowserOfflineResumePlan(resumeResponse({ status: 206, contentLength: total }), offset, total, true).decision,
    "restart"
  );
});

test("offline media and copy identities keep source fingerprints separate", () => {
  assert.equal(
    createOfflineMediaId({ contentType: "movie", mediaId: "tt123" }),
    "movie-tt123"
  );
  assert.equal(
    createOfflineMediaId({ contentType: "episode", seriesId: "series-4", season: 2, episode: 7 }),
    "episode-series-4-s2-e7"
  );
  const sourceA = { addonId: "aio", infoHash: "hash-a", quality: "1080p" };
  const sourceB = { addonId: "aio", infoHash: "hash-b", quality: "1080p" };
  assert.notEqual(createOfflineSourceFingerprint(sourceA), createOfflineSourceFingerprint(sourceB));
  assert.notEqual(
    createOfflineDownloadId({ contentType: "movie", mediaId: "tt123", stream: sourceA }),
    createOfflineDownloadId({ contentType: "movie", mediaId: "tt123", stream: sourceB })
  );
});

test("downloaded episodes group under one series and retain episode order", () => {
  const grouped = groupDownloadedSeries([
    {
      status: "completed",
      contentType: "episode",
      seriesId: "series-1",
      seriesTitle: "Example Series",
      seasonNumber: 2,
      episodeNumber: 1,
      downloadId: "episode-series-1-s2-e1"
    },
    {
      status: "completed",
      contentType: "episode",
      seriesId: "series-1",
      seriesTitle: "Example Series",
      seasonNumber: 1,
      episodeNumber: 3,
      downloadId: "episode-series-1-s1-e3"
    },
    { status: "failed", contentType: "episode", seriesId: "series-2" }
  ]);

  assert.equal(grouped.length, 1);
  assert.equal(grouped[0].seriesId, "series-1");
  assert.deepEqual(
    grouped[0].episodes.map((episode) => episode.downloadId),
    ["episode-series-1-s1-e3", "episode-series-1-s2-e1"]
  );
});

test("downloaded Series cards use canonical Series artwork instead of an episode still", () => {
  const [series] = groupDownloadedSeries([
    {
      status: "completed",
      contentType: "episode",
      seriesId: "series-1",
      seriesTitle: "Example Series",
      poster: "episode-still.jpg",
      displaySnapshot: {
        title: "Example Series",
        poster: "series-poster.jpg",
        backdrop: "series-backdrop.jpg",
        logo: "series-logo.png"
      },
      localSeriesPosterFile: "series-1-series-poster.image",
      seasonNumber: 1,
      episodeNumber: 1,
      downloadId: "episode-series-1-s1-e1"
    }
  ]);

  assert.equal(series.poster, "series-poster.jpg");
  assert.equal(series.backdrop, "series-backdrop.jpg");
  assert.equal(series.logo, "series-logo.png");
  assert.equal(series.seriesPosterDownloadId, "episode-series-1-s1-e1");
});

test("downloaded movie copies collapse to one movie card", () => {
  const movies = groupDownloadedMovies([
    {
      status: "completed",
      contentType: "movie",
      mediaIdentity: "movie-tt123",
      downloadId: "older-copy",
      completedAt: 10
    },
    {
      status: "completed",
      contentType: "movie",
      mediaIdentity: "movie-tt123",
      downloadId: "newer-copy",
      completedAt: 20
    },
    {
      status: "completed",
      contentType: "movie",
      mediaIdentity: "movie-tt456",
      downloadId: "other-movie",
      completedAt: 5
    }
  ]);

  assert.deepEqual(
    movies.map((movie) => movie.downloadId),
    ["newer-copy", "other-movie"]
  );
});

test("offline subtitle identity is stable, media-scoped, and excludes signed URL queries", () => {
  const track = {
    id: "english-main",
    url: "https://subtitles.example/file.srt?token=secret-value",
    lang: "en",
    addonName: "Example subtitles",
    fileName: "Example.S01E01.srt"
  };
  const fingerprint = createOfflineSubtitleFingerprint(track);
  assert.equal(fingerprint.includes("secret-value"), false);
  assert.match(fingerprint, /https:\/\/subtitles\.example\/file\.srt/);
  assert.notEqual(
    createOfflineSubtitleId({ mediaIdentity: "movie-tt1", fingerprint }),
    createOfflineSubtitleId({ mediaIdentity: "episode-tt1-s1-e1", fingerprint })
  );
  assert.equal(isOfflineSubtitleFormatSupported(track), true);
  assert.equal(isOfflineSubtitleFormatSupported({ url: "https://example.test/subtitle.txt" }), false);
});

test("offline subtitle validation accepts Player-loadable VTT and SRT only", () => {
  assert.equal(detectOfflineSubtitleFormat("WEBVTT\n\n00:00.000 --> 00:01.000\nHello"), "vtt");
  assert.equal(detectOfflineSubtitleFormat("1\n00:00:00,000 --> 00:00:01,000\nHello"), "srt");
  assert.equal(
    detectOfflineSubtitleFormat("[Script Info]\nTitle: Example\n[Events]\nDialogue: 0,0:00:00.00,0:00:01.00,Default,,0,0,0,,Hello"),
    "ass"
  );
  assert.equal(isOfflineSubtitleTextLoadable("WEBVTT\n\n00:00.000 --> 00:01.000\nHello"), true);
  assert.equal(isOfflineSubtitleTextLoadable("<html><body>Not a subtitle</body></html>"), false);
  assert.equal(
    isOfflineSubtitleTextLoadable("[Script Info]\n[Events]\nDialogue: 0,0:00:00.00,0:00:01.00,Default,,0,0,0,,Hello"),
    false
  );
});

test("offline subtitle decoding honors UTF-16 BOMs before format detection", () => {
  const text = "1\r\n00:00:00,000 --> 00:00:01,000\r\nHello";
  const bytes = new TextEncoder().encode(text);
  const utf16le = new Uint8Array([0xff, 0xfe, ...Array.from(bytes).flatMap((value) => [value, 0])]);
  const decoded = decodeOfflineSubtitleBytes(utf16le);
  assert.equal(decoded.encoding, "utf-16le");
  assert.equal(detectOfflineSubtitleFormat(decoded.text), "srt");
});

test("offline all-subtitle selection persists deduped safe descriptors", () => {
  const tracks = [
    { id: "english", url: "https://subs.example/en.srt?token=one", lang: "en", addonId: "a" },
    { id: "english", url: "https://subs.example/en.srt?token=two", lang: "en", addonId: "a" },
    { id: "indonesian", url: "https://subs.example/id.vtt?token=three", lang: "id", addonId: "a" }
  ];
  const seen = new Set();
  const descriptors = tracks
    .map((track) => ({ fingerprint: createOfflineSubtitleFingerprint(track), lang: track.lang, addonId: track.addonId }))
    .filter((descriptor) => !seen.has(descriptor.fingerprint) && seen.add(descriptor.fingerprint));
  assert.equal(descriptors.length, 2);
  assert.equal(descriptors.some((descriptor) => descriptor.fingerprint.includes("token=")), false);
  assert.equal(descriptors[0].lang, "en");
});

test("offline subtitle fingerprints retain distinct releases from one provider and normalize signed ids", () => {
  const base = { addonName: "AIOStreams", lang: "eng", url: "https://subs.example/file.srt?token=secret" };
  const releaseA = createOfflineSubtitleFingerprint({ ...base, id: "https://api.example/a?token=one", fileName: "Release.A.srt" });
  const releaseB = createOfflineSubtitleFingerprint({ ...base, id: "https://api.example/b?token=two", fileName: "Release.B.srt" });
  assert.notEqual(releaseA, releaseB);
  assert.equal(releaseA.includes("token="), false);
  assert.equal(releaseB.includes("token="), false);
});
