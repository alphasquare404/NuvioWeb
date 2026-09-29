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

test("offline, a series shows only the episodes that are on the device", () => {
  // Opened after the app had been online, the metadata came from cache and the
  // whole run appeared -- episodes with no file and no artwork. Opened in an app
  // that started offline, only the downloads appeared. Same device, same files,
  // two different pages.
  const remote = [
    { id: "s1e1", season: 1, episode: 1, title: "One" },
    { id: "s1e2", season: 1, episode: 2, title: "Two" },
    { id: "s1e3", season: 1, episode: 3, title: "Three" }
  ];
  const offline = [{ season: 1, episode: 2, offlineDownloadId: "d2", title: "Two" }];

  const online = mergeDetailEpisodesWithOfflineDownloads(remote, offline);
  assert.deepEqual(online.map((episode) => episode.episode), [1, 2, 3]);

  const offlineOnly = mergeDetailEpisodesWithOfflineDownloads(remote, offline, { offlineOnly: true });
  assert.deepEqual(offlineOnly.map((episode) => episode.episode), [2]);
  assert.equal(offlineOnly[0].offlineDownloadId, "d2");
  // The remote title survives the filter; it is the list that shrinks, not the
  // metadata of what is left.
  assert.equal(offlineOnly[0].title, "Two");
});

test("offline with nothing downloaded is an empty list, not the whole series", () => {
  const remote = [{ id: "s1e1", season: 1, episode: 1 }];
  assert.deepEqual(mergeDetailEpisodesWithOfflineDownloads(remote, [], { offlineOnly: true }), []);
});

test("offline, an episode still comes from the download, not the cached remote URL", () => {
  // The cached metadata answers offline and carries a still URL that cannot be
  // fetched. Keeping it drew empty cards; the download's own stored image is
  // the one that loads. Online the remote still is the better picture and stays.
  const remote = [{ id: "s1e2", season: 1, episode: 2, thumbnail: "https://images/still.jpg" }];
  const offline = [
    { season: 1, episode: 2, offlineDownloadId: "d2", thumbnail: "blob:local-still" }
  ];

  const [online] = mergeDetailEpisodesWithOfflineDownloads(remote, offline);
  assert.equal(online.thumbnail, "https://images/still.jpg");

  const [off] = mergeDetailEpisodesWithOfflineDownloads(remote, offline, { offlineOnly: true });
  assert.equal(off.thumbnail, "blob:local-still");
});

test("offline, an episode with no stored image shows none rather than a broken one", () => {
  const remote = [{ id: "s1e2", season: 1, episode: 2, thumbnail: "https://images/still.jpg" }];
  const offline = [{ season: 1, episode: 2, offlineDownloadId: "d2", thumbnail: null }];
  const [off] = mergeDetailEpisodesWithOfflineDownloads(remote, offline, { offlineOnly: true });
  assert.equal(off.thumbnail, null);
});
