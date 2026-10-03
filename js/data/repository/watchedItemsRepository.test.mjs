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

// The same promise `mark` has always kept, now kept by `unmark` too. It did not:
// every provider call went first, in sequence, so un-watching a 23-episode season
// meant 23 round trips before the first tick went and the page looked like the
// menu press had not registered.
test("un-marking removes the local row before a tracking provider completes", async () => {
  values.clear();
  TraktSettingsStore.set({ watchProgressSource: WatchProgressSource.SIMKL });
  SimklAuthStore.saveToken("test-token");

  const season = Array.from({ length: 23 }, (_, index) => ({
    contentId: "tt1196946",
    contentType: "series",
    season: 1,
    episode: index + 1,
    watchedAt: 1_790_000_000_000 + index
  }));
  for (const episode of season) {
    await watchedItemsRepository.mark(episode, { skipTrackingWrite: true });
  }
  assert.equal(WatchedItemsStore.listForProfile("1").length, 23);

  const originalUnmark = SimklSyncService.unmarkWatched;
  let providerCalls = 0;
  // A provider that never answers: the local removal must not be waiting on it.
  SimklSyncService.unmarkWatched = () => {
    providerCalls += 1;
    return new Promise(() => {});
  };
  try {
    for (const episode of season) {
      await watchedItemsRepository.unmark("tt1196946", {
        season: episode.season,
        episode: episode.episode
      });
    }
    assert.deepEqual(WatchedItemsStore.listForProfile("1"), []);
    assert.equal(providerCalls, 23, "every episode is still sent to the provider");
  } finally {
    SimklSyncService.unmarkWatched = originalUnmark;
  }
});

// An episode un-watched with no local row left to name it still has to reach the
// provider as an episode. The fallback target defaulted to "movie", which is the
// right guess only when no season or episode was asked for.
test("an episode with no local row is still sent to the provider as an episode", async () => {
  values.clear();
  TraktSettingsStore.set({ watchProgressSource: WatchProgressSource.SIMKL });
  SimklAuthStore.saveToken("test-token");

  const originalUnmark = SimklSyncService.unmarkWatched;
  const originalGetWatched = SimklSyncService.getWatchedItems;
  const sent = [];
  SimklSyncService.unmarkWatched = async (item) => sent.push(item);
  SimklSyncService.getWatchedItems = async () => [];
  try {
    await watchedItemsRepository.unmark("tt1196946", { season: 1, episode: 4 });
    // The provider write is off the critical path now, so let it land.
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(sent.length, 1);
    assert.equal(sent[0].contentType, "series");
    assert.equal(sent[0].episode, 4);
  } finally {
    SimklSyncService.unmarkWatched = originalUnmark;
    SimklSyncService.getWatchedItems = originalGetWatched;
  }
});

// Un-marking under a provider.
//
// A tick under Simkl means Simkl has the episode, so it comes from Simkl's list,
// not from the local row. Deleting the local row cannot clear it, and the person
// is left looking at a tick that did not respond to the menu they just used --
// which is what "unwatch tidak langsung berubah" was.
test("un-marking hides the provider's row straight away", async () => {
  values.clear();
  TraktSettingsStore.set({ watchProgressSource: WatchProgressSource.SIMKL });
  SimklAuthStore.saveToken("test-token");

  const originalGetWatched = SimklSyncService.getWatchedItems;
  const originalUnmark = SimklSyncService.unmarkWatched;
  // Simkl keeps answering with the episode: the provider has not caught up yet,
  // which is the whole point.
  SimklSyncService.getWatchedItems = async () => [
    {
      contentId: "tt1196946",
      contentType: "series",
      season: 1,
      episode: 4,
      trackingProviderId: "simkl",
      watchedAt: 1_790_000_000_000
    }
  ];
  SimklSyncService.unmarkWatched = async () => {};
  try {
    const before = await watchedItemsRepository.getAll();
    assert.equal(before.length, 1, "Simkl's row is there to begin with");

    await watchedItemsRepository.unmark("tt1196946", { season: 1, episode: 4 });
    assert.deepEqual(
      await watchedItemsRepository.getAll(),
      [],
      "the tick has to go without waiting for Simkl"
    );

    // Watching it again is the latest intent and must show at once.
    await watchedItemsRepository.mark(
      { contentId: "tt1196946", contentType: "series", season: 1, episode: 4 },
      { skipTrackingWrite: true }
    );
    assert.equal((await watchedItemsRepository.getAll()).length, 1);
  } finally {
    SimklSyncService.getWatchedItems = originalGetWatched;
    SimklSyncService.unmarkWatched = originalUnmark;
  }
});

// And the hold is not permanent: once the provider's list drops the row, the
// record has done its job and is forgotten, so a later re-watch is not swallowed.
test("the hold is forgotten once the provider agrees", async () => {
  values.clear();
  TraktSettingsStore.set({ watchProgressSource: WatchProgressSource.SIMKL });
  SimklAuthStore.saveToken("test-token");

  const originalGetWatched = SimklSyncService.getWatchedItems;
  const originalUnmark = SimklSyncService.unmarkWatched;
  let providerHasIt = true;
  SimklSyncService.getWatchedItems = async () =>
    providerHasIt
      ? [
          {
            contentId: "tt1196946",
            contentType: "series",
            season: 1,
            episode: 4,
            trackingProviderId: "simkl",
            watchedAt: 1_790_000_000_000
          }
        ]
      : [];
  SimklSyncService.unmarkWatched = async () => {};
  try {
    await watchedItemsRepository.unmark("tt1196946", { season: 1, episode: 4 });
    assert.deepEqual(await watchedItemsRepository.getAll(), []);

    providerHasIt = false;
    await watchedItemsRepository.getAll();

    // The record is gone, so Simkl saying it again later is believed.
    providerHasIt = true;
    assert.equal(
      (await watchedItemsRepository.getAll()).length,
      1,
      "a provider row must not be held back for ever"
    );
  } finally {
    SimklSyncService.getWatchedItems = originalGetWatched;
    SimklSyncService.unmarkWatched = originalUnmark;
  }
});

// Measured on a real library of 2206 records: six episodes of one series showed
// as unwatched on its Detail page although the records were there, because the
// repository capped every read at 2000 and those six sat past the cut. Nothing
// pages through this list -- every caller wants the whole set -- so the cap only
// ever hid rows.
test("a library past the old 2000 cap is returned whole", async () => {
  values.clear();
  TraktSettingsStore.set({ watchProgressSource: WatchProgressSource.NUVIO_SYNC });

  const rows = Array.from({ length: 2206 }, (_, index) => ({
    contentId: index < 2200 ? `tt${1000000 + index}` : "tt1196946",
    contentType: "series",
    season: 1,
    episode: index < 2200 ? 1 : index - 2199,
    watchedAt: 1_790_000_000_000 + index
  }));
  for (const row of rows) {
    await watchedItemsRepository.mark(row, { skipTrackingWrite: true });
  }

  assert.equal((await watchedItemsRepository.listLocal()).length, 2206);
  assert.equal((await watchedItemsRepository.getAll()).length, 2206);

  // The six that used to fall off the end.
  const tail = (await watchedItemsRepository.getAll()).filter(
    (item) => item.contentId === "tt1196946"
  );
  assert.equal(tail.length, 6, "the tail of the library has to survive the read");

  // A caller that really does want a page can still ask for one.
  assert.equal((await watchedItemsRepository.listLocal(10)).length, 10);
});
