import test from "node:test";
import assert from "node:assert/strict";
import {
  createOfflineMetadataEnricher,
  fetchOfflineDisplaySnapshot
} from "./offlineMetadataEnrichment.js";

test("movie downloads fetch metadata without a Detail screen", async () => {
  let requested;
  const snapshot = await fetchOfflineDisplaySnapshot(
    { contentType: "movie", mediaId: "tt1" },
    {
      settings: { enabled: false },
      repository: {
        getMetaFromAllAddons: async (...args) => {
          requested = args;
          return {
            status: "success",
            data: {
              name: "Movie",
              description: "Story",
              poster: "poster",
              background: "backdrop",
              logo: "logo"
            }
          };
        }
      }
    }
  );
  assert.deepEqual(requested, ["movie", "tt1"]);
  assert.equal(snapshot.overview, "Story");
  assert.equal(snapshot.logo, "logo");
  assert.equal(snapshot.episode, null);
});

test("episode downloads enrich only their own season and select the correct episode", async () => {
  let seasons;
  const snapshot = await fetchOfflineDisplaySnapshot(
    { contentType: "episode", seriesId: "tt2", seasonNumber: 2, episodeNumber: 3 },
    {
      settings: {
        enabled: true,
        useEpisodes: true,
        useArtwork: true,
        useBasicInfo: true,
        useDetails: true,
        useReleaseDates: true,
        language: "id-ID"
      },
      repository: {
        getMetaFromAllAddons: async () => ({
          status: "success",
          data: {
            name: "Series",
            videos: [
              { season: 1, episode: 3, title: "Wrong" },
              { season: 2, episode: 3, title: "Original" }
            ]
          }
        })
      },
      tmdb: { ensureTmdbId: async () => "123" },
      metadata: {
        fetchEnrichment: async () => ({
          poster: "series-poster",
          backdrop: "series-backdrop",
          logo: "logo",
          runtime: "43 min"
        }),
        fetchEpisodeEnrichment: async (options) => {
          seasons = options.seasonNumbers;
          return new Map([
            [
              "2:3",
              {
                title: "Localized episode",
                overview: "Episode story",
                thumbnail: "still",
                runtime: 44,
                airDate: "2026-01-01"
              }
            ]
          ]);
        }
      }
    }
  );
  assert.deepEqual(seasons, [2]);
  assert.equal(snapshot.poster, "series-poster");
  assert.equal(snapshot.runtimeMinutes, 43);
  assert.equal(snapshot.episode.title, "Localized episode");
  assert.equal(snapshot.episode.still, "still");
  assert.equal(snapshot.episode.released, "2026-01-01");
});

test("metadata failure does not discard available addon metadata", async () => {
  const snapshot = await fetchOfflineDisplaySnapshot(
    { contentType: "movie", mediaId: "tt1" },
    {
      settings: { enabled: true },
      repository: {
        getMetaFromAllAddons: async () => ({ status: "success", data: { name: "Saved" } })
      },
      tmdb: {
        ensureTmdbId: async () => {
          throw new Error("offline");
        }
      }
    }
  );
  assert.equal(snapshot.title, "Saved");
});

test("background enrichment deduplicates a download and skips deleted media", async () => {
  const record = { downloadId: "d1", status: "completed" };
  let saves = 0,
    fetches = 0;
  const enrich = createOfflineMetadataEnricher({
    read: async () => record,
    update: async (_id, patch) => Object.assign(record, patch),
    fetchSnapshot: async () => {
      fetches++;
      return { title: "Movie" };
    },
    save: async () => {
      saves++;
    }
  });
  const first = enrich(record);
  assert.equal(enrich(record), first);
  assert.equal(await first, true);
  assert.equal(fetches, 1);
  assert.equal(saves, 1);
  assert.equal(record.offlineMetadataStatus, "completed");
  await enrich(record);
  assert.equal(fetches, 1);
  const deleted = createOfflineMetadataEnricher({
    read: async () => null,
    fetchSnapshot: async () => {
      throw Error("must not fetch");
    }
  });
  assert.equal(await deleted(record), false);
});

test("timed-out metadata releases the background queue and cannot save late results", async () => {
  const records = new Map(
    ["slow", "next"].map((id) => [id, { downloadId: id, status: "completed" }])
  );
  let release,
    saved = [];
  const enrich = createOfflineMetadataEnricher({
    timeoutMs: 5,
    read: async (id) => records.get(id),
    update: async (id, patch) => Object.assign(records.get(id), patch),
    fetchSnapshot: (record) =>
      record.downloadId === "slow"
        ? new Promise((resolve) => {
            release = resolve;
          })
        : Promise.resolve({ title: "Next" }),
    save: async (id) => saved.push(id)
  });
  const slow = enrich(records.get("slow"));
  const next = enrich(records.get("next"));
  assert.equal(await slow, false);
  assert.equal(await next, true);
  release({ title: "Late" });
  await Promise.resolve();
  assert.deepEqual(saved, ["next"]);
  assert.equal(records.get("slow").status, "completed");
  assert.equal(records.get("slow").offlineMetadataStatus, "partial");
});
