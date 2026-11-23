import assert from "node:assert/strict";
import test from "node:test";

// A completion records which source owned Continue Watching when it happened.
// Switching trackers must not present that title as watched under the new
// source: this is the reported case of a film finished under MDBList showing as
// finished under Simkl and Nuvio Sync, without either having seen it.

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
const { TraktSettingsStore, WatchProgressSource } = await import("../local/traktSettingsStore.js");
const { SimklAuthStore } = await import("../local/simklAuthStore.js");
const { MdbListAuthStore } = await import("../local/mdbListAuthStore.js");
const { SimklSyncService } = await import("./simklSyncService.js");
const { MdbListSyncService } = await import("./mdbListSyncService.js");
const { watchedItemsRepository } = await import("./watchedItemsRepository.js");
const { watchProgressRepository } = await import("./watchProgressRepository.js");
const { detailWatchedEnrichmentService } = await import("./detailWatchedEnrichmentService.js");

const TITLE_ID = "tt27165187";

function reset() {
  localStorage.clear();
  LocalStore.set("activeProfileId", "1");
  TraktSettingsStore.set(
    { watchProgressSource: WatchProgressSource.NUVIO_SYNC },
    { silentSync: true }
  );
  SimklSyncService.getWatchedItems = async () => [];
  MdbListSyncService.markWatched = async () => false;
}

function useSource(source) {
  TraktSettingsStore.set({ watchProgressSource: source }, { silentSync: true });
}

async function completeUnderMdbList() {
  MdbListAuthStore.saveToken({ access_token: "m", refresh_token: "m" }, "1");
  useSource(WatchProgressSource.MDBLIST);
  await watchedItemsRepository.mark({
    contentId: TITLE_ID,
    contentType: "movie",
    title: "The End of Oak Street",
    watchedAt: 1_000
  });
}

test("a completion under MDBList is not watched under Simkl or Nuvio Sync", async () => {
  reset();
  await completeUnderMdbList();
  const stored = WatchedItemsStore.listForProfile("1");
  assert.equal(stored.length, 1);
  assert.equal(stored[0].source, "mdblist_local");
  assert.equal((await watchedItemsRepository.getAll()).length, 1);

  SimklAuthStore.saveToken("s", "1");
  useSource(WatchProgressSource.SIMKL);
  assert.equal((await watchedItemsRepository.getAll()).length, 0);
  assert.equal(await watchedItemsRepository.isWatched(TITLE_ID), false);

  useSource(WatchProgressSource.NUVIO_SYNC);
  assert.equal((await watchedItemsRepository.getAll()).length, 0);
  assert.equal(await watchedItemsRepository.isWatched(TITLE_ID), false);
});

test("Detail enrichment does not read an MDBList completion while Simkl owns progress", async () => {
  reset();
  await completeUnderMdbList();
  SimklAuthStore.saveToken("s", "1");
  useSource(WatchProgressSource.SIMKL);
  detailWatchedEnrichmentService.invalidateAllCache();

  const result = await detailWatchedEnrichmentService.enrichMovieWatchedState(TITLE_ID, null);

  assert.equal(result.isWatched, false);
});

test("an untagged row stays under Nuvio Sync and does not count for a provider", async () => {
  reset();
  WatchedItemsStore.upsert({ contentId: "tt-untagged", watchedAt: 1 }, "1");
  useSource(WatchProgressSource.NUVIO_SYNC);

  assert.equal(
    (await watchedItemsRepository.getAll()).some((item) => item.contentId === "tt-untagged"),
    true
  );

  SimklAuthStore.saveToken("s", "1");
  useSource(WatchProgressSource.SIMKL);
  assert.equal(
    (await watchedItemsRepository.getAll()).some((item) => item.contentId === "tt-untagged"),
    false
  );
});

test("progress rows are scoped to the owning source too", async () => {
  reset();
  MdbListAuthStore.saveToken({ access_token: "m", refresh_token: "m" }, "1");
  useSource(WatchProgressSource.MDBLIST);
  WatchProgressStore.upsert(
    {
      contentId: TITLE_ID,
      contentType: "movie",
      positionMs: 1_000,
      durationMs: 1_000,
      source: "mdblist_local",
      updatedAt: 1
    },
    "1"
  );

  assert.equal((await watchProgressRepository.getAllForSelectedSource()).length, 1);

  SimklAuthStore.saveToken("s", "1");
  useSource(WatchProgressSource.SIMKL);
  assert.equal((await watchProgressRepository.getAllForSelectedSource()).length, 0);
});
