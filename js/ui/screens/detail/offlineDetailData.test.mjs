import test from "node:test";
import assert from "node:assert/strict";
import {
  createOfflineEpisodeEntries,
  hasPlayableOfflineDownload,
  mergeDetailEpisodesWithOfflineDownloads,
  selectCompletedOfflineDetailDownloads
} from "./offlineDetailData.js";

const episodes = [
  { downloadId: "s1e11", status: "completed", contentType: "episode", seriesId: "series-1", seasonNumber: 1, episodeNumber: 11, episodeId: "remote-11", title: "Eleven", fileName: "eleven.mp4" },
  { downloadId: "s2e3", status: "completed", contentType: "episode", seriesId: "series-1", seasonNumber: 2, episodeNumber: 3, episodeId: "remote-203", title: "Three", fileName: "three.mp4" }
];

test("offline Series Detail retains locally downloaded episodes after remote failure", () => {
  const local = createOfflineEpisodeEntries(selectCompletedOfflineDetailDownloads(episodes, { itemType: "series", itemIds: ["series-1"] }));
  assert.deepEqual(local.map((episode) => [episode.season, episode.episode]), [[1, 11], [2, 3]]);
  assert.equal(mergeDetailEpisodesWithOfflineDownloads([], local).length, 2);
});

test("remote episodes retain their metadata while completed local downloads overlay playback", () => {
  const local = createOfflineEpisodeEntries(episodes);
  const merged = mergeDetailEpisodesWithOfflineDownloads([{ id: "remote-11", season: 1, episode: 11, title: "Remote title", overview: "Rich metadata" }], local);
  assert.equal(merged[0].title, "Remote title");
  assert.equal(merged[0].offlineDownloadId, "s1e11");
  assert.deepEqual(merged.map((episode) => `${episode.season}:${episode.episode}`), ["1:11", "2:3"]);
});

test("only completed metadata with a local file name is eligible for offline playback", () => {
  assert.equal(hasPlayableOfflineDownload({ ...episodes[0] }), true);
  assert.equal(hasPlayableOfflineDownload({ ...episodes[0], fileName: "", status: "completed" }), false);
  assert.equal(hasPlayableOfflineDownload({ ...episodes[0], status: "failed" }), false);
});

test("local episodes retain the stable offline copy identity used by direct playback", () => {
  const [episode] = createOfflineEpisodeEntries([
    {
      ...episodes[0],
      mediaIdentity: "episode-series-1-s1-e11",
      sourceFingerprint: "safe-source",
      seriesTitle: "Series One",
      description: "Local episode description"
    }
  ]);
  assert.equal(episode.offlineDownloadId, "s1e11");
  assert.equal(episode.offlineMediaIdentity, "episode-series-1-s1-e11");
  assert.equal(episode.seriesId, "series-1");
  assert.equal(episode.seriesTitle, "Series One");
  assert.equal(episode.overview, "Local episode description");
});
