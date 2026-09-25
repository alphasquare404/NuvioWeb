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
      WatchedItemsStore.listForProfile("1").some(
        (item) => item.contentId === "movie:external-finish"
      ),
      true
    );
  } finally {
    SimklSyncService.markWatched = originalMarkWatched;
    values.clear();
  }
});

// Every caller of mark() is a finish, a scrobble stop, a reconciliation sweep or
// the user marking something watched -- never one of playback's periodic writes.
// Announcing them as ordinary was why a title marked watched from a poster menu
// kept its Continue Watching card until something else forced a refresh.
test("a completion is announced as authoritative unless the caller says otherwise", async () => {
  values.clear();
  const notifications = [];
  const unsubscribe = WatchedItemsStore.subscribe((payload) => notifications.push(payload));
  try {
    await watchedItemsRepository.mark(
      { contentId: "movie:external-authoritative", contentType: "movie", title: "External" },
      { authoritative: true, skipTrackingWrite: true }
    );
    await watchedItemsRepository.mark(
      { contentId: "movie:ordinary", contentType: "movie", title: "Ordinary" },
      { skipTrackingWrite: true }
    );
    await watchedItemsRepository.mark(
      { contentId: "movie:opted-out", contentType: "movie", title: "Opted out" },
      { authoritative: false, skipTrackingWrite: true }
    );
    assert.deepEqual(
      notifications.map((payload) => payload.authoritative),
      [true, true, false]
    );
  } finally {
    unsubscribe();
    values.clear();
  }
});
