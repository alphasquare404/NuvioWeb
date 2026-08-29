import test from "node:test";
import assert from "node:assert/strict";
import {
  createOfflineMediaId,
  createOfflineDownloadId,
  createOfflineSourceFingerprint,
  groupDownloadedMovies,
  groupDownloadedSeries
} from "./offlineDownloadIdentity.js";

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
