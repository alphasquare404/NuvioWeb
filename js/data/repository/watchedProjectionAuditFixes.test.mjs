import assert from "node:assert/strict";
import test from "node:test";

// Regression tests for the watch-state audit's identity/projection findings:
// F06 (MDBList nested watched episodes reach the watched list),
// F07 (the record cap is per profile, not global),
// F09 (Detail only asks the source that owns watch progress),
// F12 (an episode card identity does not depend on the stream video id),
// F20 (a title is recognised under any of its verified provider aliases).

function createStorage() {
  const values = new Map();
  return {
    get length() {
      return values.size;
    },
    key: (index) => Array.from(values.keys())[index] ?? null,
    getItem: (key) => (values.has(key) ? values.get(key) : null),
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
    clear: () => values.clear()
  };
}

globalThis.localStorage = createStorage();
globalThis.__NUVIO_ENV__ = {};
globalThis.fetch = async () => {
  throw new Error("audit: network disabled");
};

const { LocalStore } = await import("../../core/storage/localStore.js");
const { WatchedItemsStore } = await import("../local/watchedItemsStore.js");
const { WatchProgressStore } = await import("../local/watchProgressStore.js");
const { watchedItemsRepository } = await import("./watchedItemsRepository.js");
const { watchProgressCardKey } = await import("../../domain/model/watchProgress.js");
const { retireCompletedContinueWatchingCards } =
  await import("../../ui/screens/home/continueWatchingProgressPatch.js");
const { buildWatchedTitleIdSet, isTitleItemWatched } =
  await import("../../ui/components/watchedTitleBadge.js");
const { TraktSettingsStore, WatchProgressSource } = await import("../local/traktSettingsStore.js");
const { MdbListAuthService } = await import("./mdbListAuthService.js");
const { TraktAuthService } = await import("./traktAuthService.js");
const { detailWatchedEnrichmentService } = await import("./detailWatchedEnrichmentService.js");

function reset() {
  localStorage.clear();
  LocalStore.set("activeProfileId", "1");
  TraktSettingsStore.set(
    { watchProgressSource: WatchProgressSource.NUVIO_SYNC },
    { silentSync: true }
  );
}

test("F06: MDBList nested episode watched rows reach the watched list", async () => {
  reset();
  MdbListAuthService.isAuthenticated = () => true;
  MdbListAuthService.apiRequest = async (path) => ({
    response: { ok: true },
    payload:
      path === "/sync/playback"
        ? []
        : {
            shows: [
              {
                show: { ids: { imdb: "tt2222222" } },
                seasons: [
                  { number: 1, episodes: [{ number: 1, watched_at: "2026-01-01T00:00:00Z" }] }
                ]
              }
            ]
          }
  });
  const { MdbListSyncService } = await import("./mdbListSyncService.js?f06");
  MdbListSyncService.clearCache();

  const items = await MdbListSyncService.getWatchedItems({ allowStale: true });

  assert.equal(items.length, 1);
  assert.equal(items[0].contentId, "tt2222222");
  assert.equal(items[0].season, 1);
  assert.equal(items[0].episode, 1);
});

test("F07: a full profile cannot evict another profile's watched history", () => {
  reset();
  WatchedItemsStore.upsert({ contentId: "other-profile", watchedAt: 1 }, "2");
  WatchedItemsStore.replaceForProfile(
    "1",
    Array.from({ length: 5000 }, (_, index) => ({ contentId: `p1-${index}`, watchedAt: index + 2 }))
  );

  assert.equal(WatchedItemsStore.listForProfile("2").length, 1);
  assert.equal(WatchedItemsStore.listForProfile("2")[0].contentId, "other-profile");
  assert.equal(WatchedItemsStore.listForProfile("1").length, 5000);
});

test("F07: a full profile cannot evict another profile's progress", () => {
  reset();
  WatchProgressStore.upsert(
    {
      contentId: "other-progress",
      contentType: "movie",
      positionMs: 1,
      durationMs: 2,
      updatedAt: 1
    },
    "2"
  );
  WatchProgressStore.replaceForProfile(
    "1",
    Array.from({ length: 5000 }, (_, index) => ({
      contentId: `p1-${index}`,
      contentType: "movie",
      positionMs: 1,
      durationMs: 2,
      updatedAt: index + 2
    }))
  );

  assert.equal(WatchProgressStore.listForProfile("2").length, 1);
  assert.equal(WatchProgressStore.listForProfile("2")[0].contentId, "other-progress");
  assert.equal(WatchProgressStore.listForProfile("1").length, 5000);
});

test("F09: Detail does not read Trakt watched state when Nuvio Sync owns progress", async () => {
  reset();
  let traktReads = 0;
  TraktAuthService.isAuthenticated = () => true;
  TraktAuthService.fetchWatchedMovies = async () => {
    traktReads += 1;
    return [{ traktId: 123, watchedAt: 1 }];
  };
  detailWatchedEnrichmentService.invalidateAllCache();

  const result = await detailWatchedEnrichmentService.enrichMovieWatchedState("tt3333333", 123);

  assert.equal(traktReads, 0);
  assert.equal(result.isWatched, false);
});

test("F09: Detail does read Trakt when Trakt owns progress", async () => {
  reset();
  TraktSettingsStore.set({ watchProgressSource: WatchProgressSource.TRAKT }, { silentSync: true });
  TraktAuthService.isAuthenticated = () => true;
  TraktAuthService.fetchWatchedMovies = async () => [{ traktId: 123, watchedAt: 1 }];
  detailWatchedEnrichmentService.invalidateAllCache();

  const result = await detailWatchedEnrichmentService.enrichMovieWatchedState("tt3333333", 123);

  assert.equal(result.isWatched, true);
  assert.equal(result.source, "trakt");
});

test("F12: an episode card identity ignores the stream video id", () => {
  const progressRow = {
    contentId: "tt5555555",
    contentType: "series",
    videoId: "tt5555555:1:2",
    season: 1,
    episode: 2
  };
  const watchedRow = { ...progressRow, videoId: null, watchedAt: 1 };
  assert.equal(watchProgressCardKey(progressRow), watchProgressCardKey(watchedRow));

  const kept = retireCompletedContinueWatchingCards([progressRow], [watchedRow], []);
  assert.equal(kept.length, 0);
});

test("F20: a watched title matches under its TMDb alias", async () => {
  reset();
  await watchedItemsRepository.mark({
    contentId: "tt1234567",
    contentType: "movie",
    title: "Film",
    tmdbId: 123,
    watchedAt: 1_000
  });

  assert.equal(await watchedItemsRepository.isWatched("tmdb:123"), true);
  assert.equal(await watchedItemsRepository.isWatched("tt1234567"), true);
  assert.equal(await watchedItemsRepository.isWatched("tmdb:999"), false);
});

test("F20: the watched badge matches the title under an alias", () => {
  const ids = buildWatchedTitleIdSet([
    { contentId: "tt1234567", contentType: "movie", imdbId: "tt1234567", tmdbId: 123 }
  ]);
  assert.equal(isTitleItemWatched({ id: "tmdb:123" }, ids), true);
  assert.equal(isTitleItemWatched({ id: "tt1234567" }, ids), true);
  assert.equal(isTitleItemWatched({ id: "tmdb:999" }, ids), false);
});
