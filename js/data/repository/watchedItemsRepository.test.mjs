import assert from "node:assert/strict";
import test from "node:test";

const values = new Map();
globalThis.localStorage = {
  getItem: (key) => values.get(key) || null,
  setItem: (key, value) => values.set(key, value),
  removeItem: (key) => values.delete(key),
  clear: () => values.clear()
};

const { watchedItemsRepository } = await import("./watchedItemsRepository.js");
const { WatchedItemsStore } = await import("../local/watchedItemsStore.js");
const { TraktSettingsStore, WatchProgressSource } = await import("../local/traktSettingsStore.js");
const { SimklAuthStore } = await import("../local/simklAuthStore.js");
const { SimklSyncService } = await import("./simklSyncService.js");

test("marking watched commits the local row before a tracking provider completes", async () => {
  values.clear();
  TraktSettingsStore.set({ watchProgressSource: WatchProgressSource.SIMKL });
  SimklAuthStore.saveToken("test-token");
  const originalMarkWatched = SimklSyncService.markWatched;
  let providerStarted = false;
  SimklSyncService.markWatched = () => {
    providerStarted = true;
    return new Promise(() => {});
  };
  try {
    await watchedItemsRepository.mark({
      contentId: "movie:external-finish",
      contentType: "movie",
      title: "External finish"
    });
    assert.equal(providerStarted, true);
    assert.equal(
      WatchedItemsStore.listForProfile("1").some((item) => item.contentId === "movie:external-finish"),
      true
    );
  } finally {
    SimklSyncService.markWatched = originalMarkWatched;
    values.clear();
  }
});
