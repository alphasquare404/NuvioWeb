import test from "node:test";
import assert from "node:assert/strict";
import {
  enqueueSeasonDownloadSelections,
  firstEligibleSeasonDownloadStream,
  getMissingSeasonEpisodes,
  prepareAutomaticSeasonDownloads
} from "./seasonOfflineDownload.js";

const episodes = [
  { id: "s1e3", season: 1, episode: 3 },
  { id: "s1e1", season: 1, episode: 1 },
  { id: "s1e2", season: 1, episode: 2 }
];
const mediaId = (episode) => `episode-series-s${episode.season}-e${episode.episode}`;

test("season downloads skip completed episodes and retain episode order", () => {
  assert.deepEqual(
    getMissingSeasonEpisodes({
      episodes,
      completedMediaIds: new Set([mediaId(episodes[1])]),
      createMediaId: mediaId
    }).map((episode) => episode.id),
    ["s1e2", "s1e3"]
  );
});

test("automatic season download chooses the first eligible normal source and skips unavailable episodes", async () => {
  const prepared = await prepareAutomaticSeasonDownloads({
    episodes,
    concurrency: 2,
    resolveStreams: async (episode) => ({
      status: "success",
      data: [{ addonName: "A", streams: episode.id === "s1e2" ? [{ id: "hls" }] : [{ id: "bad" }, { id: "good" }] }]
    }),
    buildContext: (episode, stream) => ({ episode, stream }),
    canQueue: (context) => context.stream.id === "good"
  });
  assert.deepEqual(prepared.map((entry) => [entry.episode.id, entry.status, entry.stream?.id]), [
    ["s1e1", "selected", "good"],
    ["s1e2", "unavailable", undefined],
    ["s1e3", "selected", "good"]
  ]);
});

test("manual selections enqueue sequentially after existing queue jobs", async () => {
  const queued = ["movie-a", "movie-b"];
  await enqueueSeasonDownloadSelections(
    [
      { context: { id: "s1e1" } },
      { context: { id: "s1e3" } }
    ],
    async (context) => queued.push(context.id)
  );
  assert.deepEqual(queued, ["movie-a", "movie-b", "s1e1", "s1e3"]);
  assert.equal(firstEligibleSeasonDownloadStream([{ id: "no" }, { id: "yes" }], (stream) => stream, (stream) => stream.id === "yes").stream.id, "yes");
});
