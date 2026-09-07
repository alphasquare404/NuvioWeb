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
