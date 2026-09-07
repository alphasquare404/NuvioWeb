import test from "node:test";
import assert from "node:assert/strict";
import { summarizeBrowserOfflineStorage } from "./browserOfflineStorageState.js";

test("offline storage summary separates completed media, partial files, subtitles, and queue states", () => {
  const summary = summarizeBrowserOfflineStorage(
    [
      { downloadId: "movie", status: "completed", contentType: "movie" },
      { downloadId: "episode-1", status: "completed", contentType: "episode", seriesId: "series" },
      { downloadId: "episode-2", status: "completed", contentType: "episode", seriesId: "series" },
      { downloadId: "paused", status: "paused" },
      { downloadId: "failed", status: "failed" }
    ],
    [{ subtitleId: "sub", status: "completed" }, { subtitleId: "stale", status: "failed" }],
    new Map([["movie", 100], ["episode-1", 20], ["episode-2", 20], ["paused", 10], ["failed", 5]]),
    new Map([["sub", 3], ["stale", 2]])
  );
  assert.deepEqual(summary, {
    mediaBytes: 140,
    partialBytes: 15,
    subtitleBytes: 5,
    totalOfflineBytes: 160,
    movies: 1,
    series: 1,
    episodes: 2,
    subtitles: 1,
    statusCounts: { completed: 3, paused: 1, failed: 1 }
  });
});
