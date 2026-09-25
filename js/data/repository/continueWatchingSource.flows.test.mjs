import assert from "node:assert/strict";
import test from "node:test";

// Continue Watching belongs to exactly one source at a time -- Nuvio Sync, Trakt
// or SIMKL -- and switching between them is where its hardest bugs have come
// from: one source's viewing leaking into another's row, a card that will not
// stay removed, a provider's rows being republished as Nuvio Sync's own. Every
// rule for that lives in a different module, and nothing exercised them against
// each other with a provider actually signed in.

function createStorage() {
  const values = new Map();
  return {
    values,
    getItem: (key) => (values.has(key) ? values.get(key) : null),
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
    clear: () => values.clear()
  };
}

globalThis.localStorage = createStorage();

const RUNTIME_MS = 7_200_000;
const at = (fraction) => Math.round(RUNTIME_MS * fraction);

async function freshDevice() {
  const storage = createStorage();
  globalThis.localStorage = storage;
  const device = {
    storage,
    repo: (await import("./watchProgressRepository.js")).watchProgressRepository,
    watched: (await import("./watchedItemsRepository.js")).watchedItemsRepository,
    TraktSettingsStore: (await import("../local/traktSettingsStore.js")).TraktSettingsStore,
    Source: (await import("../local/traktSettingsStore.js")).WatchProgressSource,
    TraktAuthService: (await import("./traktAuthService.js")).TraktAuthService,
    SimklSyncService: (await import("./simklSyncService.js")).SimklSyncService,
    suppression: (await import("./continueWatchingRemovalSuppression.js"))
      .continueWatchingRemovalSuppression,
    LocalStore: (await import("../../core/storage/localStore.js")).LocalStore
  };
  storage.setItem("activeProfileId", JSON.stringify("1"));
  storage.setItem("profiles", JSON.stringify([{ id: "1", isPrimary: true }]));
  device.TraktSettingsStore.set({ watchProgressSource: device.Source.NUVIO_SYNC });
  device.suppression.clear();
  return device;
}

// Signing in is a token in the auth store; both stores read it per call.
function signIntoTrakt(device) {
  device.LocalStore.set("traktAuthState", {
    profiles: { 1: { accessToken: "trakt-token", refreshToken: "trakt-refresh" } }
  });
}

function signIntoSimkl(device) {
  device.LocalStore.set("simklAuthState", { profiles: { 1: { accessToken: "simkl-token" } } });
}

function selectSource(device, source) {
  device.TraktSettingsStore.set({ watchProgressSource: source });
}

// What Trakt would answer with. Only the three reads the snapshot makes.
//
// The provider snapshot is cached at module scope for 30 seconds and keyed by
// profile, and every device here is profile 1 -- so each set of answers has to
// drop that cache or the previous test's answers are what gets read.
async function stubTrakt(device, { history = [], playback = [], watchedShows = [] } = {}) {
  device.TraktAuthService.fetchWatchHistory = async () => history;
  device.TraktAuthService.fetchPlaybackState = async () => playback;
  device.TraktAuthService.fetchWatchedShows = async () => watchedShows;
  device.TraktAuthService.removePlaybackEntries = async (ids) => ({
    attempted: ids.length,
    deleted: ids.length,
    failed: 0
  });
  await device.repo.forceRefreshSelectedSource();
}

// The shape TraktAuthService.normalizePlaybackItem produces, which is what the
// repository is handed: it derives contentId from the Trakt/TMDB ids itself, and
// carries the playback entry id a removal needs.
const traktPlaybackEntry = (overrides = {}) => ({
  type: "movie",
  contentId: "tmdb:329865",
  videoId: "tmdb:329865",
  title: "Arrival",
  year: 2016,
  tmdbId: 329865,
  imdbId: "tt2543164",
  traktPlaybackId: 4242,
  progressPercent: 42,
  // Recent on purpose: under Trakt, Continue Watching applies a days cap and
  // anything older than it is dropped before the projection ever sees it.
  pausedAt: new Date(Date.now() - 60_000).toISOString(),
  ...overrides
});

const movie = (fraction, extra = {}) => ({
  contentId: "tt1375666",
  contentType: "movie",
  videoId: null,
  season: null,
  episode: null,
  positionMs: at(fraction),
  durationMs: RUNTIME_MS,
  title: "Inception",
  ...extra
});

const idsOf = (items) => items.map((item) => item.contentId);

// ---------------------------------------------------------------------------
// Which rows a source is allowed to show
// ---------------------------------------------------------------------------

test("selecting Trakt without an account leaves Continue Watching on Nuvio Sync", async () => {
  const device = await freshDevice();
  selectSource(device, device.Source.TRAKT);
  assert.equal(device.repo.getContinueWatchingSource(), device.Source.NUVIO_SYNC);
});

test("playback recorded under Nuvio Sync is hidden once Trakt owns the row", async () => {
  const device = await freshDevice();
  await device.repo.saveProgress(movie(0.3));
  signIntoTrakt(device);
  selectSource(device, device.Source.TRAKT);
  await stubTrakt(device);
  // tt-prefixed, so Trakt would know it: under Trakt this is Trakt's business,
  // and Trakt says nothing about it.
  assert.deepEqual(await device.repo.getRecent(20, { enrichMetadata: false }), []);
});

test("switching back to Nuvio Sync shows its own viewing again", async () => {
  const device = await freshDevice();
  await device.repo.saveProgress(movie(0.3));
  signIntoTrakt(device);
  selectSource(device, device.Source.TRAKT);
  await stubTrakt(device);
  await device.repo.getRecent(20, { enrichMetadata: false });
  selectSource(device, device.Source.NUVIO_SYNC);
  assert.deepEqual(idsOf(await device.repo.getRecent(20, { enrichMetadata: false })), [
    "tt1375666"
  ]);
});

test("Trakt's own playback entries become Continue Watching cards", async () => {
  const device = await freshDevice();
  signIntoTrakt(device);
  selectSource(device, device.Source.TRAKT);
  await stubTrakt(device, { playback: [traktPlaybackEntry()] });
  assert.deepEqual(idsOf(await device.repo.getRecent(20, { enrichMetadata: false })), [
    "tmdb:329865"
  ]);
});

// History is completed viewing. It seeds Next Up; it is not a partial.
test("Trakt's watch history does not become a Continue Watching card", async () => {
  const device = await freshDevice();
  signIntoTrakt(device);
  selectSource(device, device.Source.TRAKT);
  await stubTrakt(device, {
    history: [
      {
        type: "movie",
        title: "Arrival",
        tmdbId: 329865,
        watchedAt: new Date(Date.now() - 60_000).toISOString()
      }
    ]
  });
  assert.deepEqual(await device.repo.getRecent(20, { enrichMetadata: false }), []);
});

// Playback this device recorded while Trakt owned the row is Trakt's record kept
// locally so resume works. Pushing it to Nuvio's own cloud would republish it as
// Nuvio Sync's, which is how titles watched under a provider reappeared on other
// clients that only ever see the cloud.
test("playback recorded while a provider owned the row is not Nuvio Sync's to publish", async () => {
  const device = await freshDevice();
  signIntoTrakt(device);
  selectSource(device, device.Source.TRAKT);
  await device.repo.saveProgress(movie(0.3));
  const { isNuvioSyncOwnedProgress } = await import("./watchProgressProvenance.js");
  const [row] = await device.repo.getAll();
  assert.equal(row.source, "trakt_local");
  assert.equal(isNuvioSyncOwnedProgress(row), false);
});

test("a completion recorded while SIMKL owned the row is tagged to SIMKL", async () => {
  const device = await freshDevice();
  signIntoSimkl(device);
  selectSource(device, device.Source.SIMKL);
  device.SimklSyncService.markWatched = async () => true;
  await device.watched.mark({ contentId: "tt1375666", contentType: "movie", title: "Inception" });
  const [record] = await device.watched.listLocal();
  assert.equal(record.source, "simkl_local");
});

// ---------------------------------------------------------------------------
// Removing a provider-backed card
// ---------------------------------------------------------------------------

test("a removed Trakt card stays gone while the provider still reports it", async () => {
  const device = await freshDevice();
  signIntoTrakt(device);
  selectSource(device, device.Source.TRAKT);
  await stubTrakt(device, { playback: [traktPlaybackEntry()] });
  await device.repo.removeContinueWatchingTitle("tmdb:329865");
  // The delete succeeded but Trakt has not applied it yet, and a fresh compose
  // would hand the card straight back.
  assert.deepEqual(await device.repo.getAllForContinueWatching(), []);
});

test("a removed Trakt card is released once the provider stops reporting it", async () => {
  const device = await freshDevice();
  signIntoTrakt(device);
  selectSource(device, device.Source.TRAKT);
  await stubTrakt(device, { playback: [traktPlaybackEntry()] });
  await device.repo.removeContinueWatchingTitle("tmdb:329865");
  await stubTrakt(device, { playback: [] });
  await device.repo.getAllForContinueWatching();
  assert.equal(device.repo.getContinueWatchingSourceKey(), "1:trakt");
  assert.equal(device.suppression.size, 0, "nothing left to suppress once the row is gone");
});

test("a removal the provider rejected lets the card come back", async () => {
  const device = await freshDevice();
  signIntoTrakt(device);
  selectSource(device, device.Source.TRAKT);
  await stubTrakt(device, { playback: [traktPlaybackEntry()] });
  device.TraktAuthService.removePlaybackEntries = async () => ({
    attempted: 1,
    deleted: 0,
    failed: 1
  });
  await device.repo.removeContinueWatchingTitle("tmdb:329865");
  assert.deepEqual(idsOf(await device.repo.getAllForContinueWatching()), ["tmdb:329865"]);
});

// A suppression is a claim about one provider account. Carrying it to another
// would hide somebody else's card.
test("a pending removal does not follow the row to another account", async () => {
  const device = await freshDevice();
  signIntoTrakt(device);
  selectSource(device, device.Source.TRAKT);
  await stubTrakt(device, { playback: [traktPlaybackEntry()] });
  await device.repo.removeContinueWatchingTitle("tmdb:329865");
  assert.equal(device.suppression.size, 1);
  signIntoSimkl(device);
  selectSource(device, device.Source.SIMKL);
  device.SimklSyncService.getProgressSnapshot = async () => ({
    historyItems: [],
    playbackItems: [],
    watchedShowSeedItems: []
  });
  await device.repo.getAllForContinueWatching();
  assert.equal(device.suppression.size, 0);
});

// Under Nuvio Sync every row is local, so removing one deletes it outright and
// there is nothing to suppress. The set is not consulted on that path, and a
// removal still pending against a provider stays pending across a visit to it.
test("a pending provider removal survives a detour through Nuvio Sync", async () => {
  const device = await freshDevice();
  signIntoTrakt(device);
  selectSource(device, device.Source.TRAKT);
  await stubTrakt(device, { playback: [traktPlaybackEntry()] });
  await device.repo.removeContinueWatchingTitle("tmdb:329865");
  selectSource(device, device.Source.NUVIO_SYNC);
  assert.deepEqual(await device.repo.getAllForContinueWatching(), []);
  selectSource(device, device.Source.TRAKT);
  assert.deepEqual(await device.repo.getAllForContinueWatching(), []);
});

// The cap is a Trakt-only rule and it applies before anything else sees the row,
// so a paused film left alone for long enough simply stops being offered.
test("Trakt rows older than the days cap are not offered", async () => {
  const device = await freshDevice();
  signIntoTrakt(device);
  selectSource(device, device.Source.TRAKT);
  device.TraktSettingsStore.setContinueWatchingDaysCap(7);
  await stubTrakt(device, {
    playback: [
      traktPlaybackEntry({
        pausedAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()
      })
    ]
  });
  assert.deepEqual(await device.repo.getRecent(20, { enrichMetadata: false }), []);
});

// ---------------------------------------------------------------------------
// Asking the source again on purpose
// ---------------------------------------------------------------------------

// Pull-to-refresh under a provider must reach past the snapshot cache, or the
// gesture shows the same rows and looks broken.
test("a forced refresh under Trakt asks the provider again", async () => {
  const device = await freshDevice();
  signIntoTrakt(device);
  selectSource(device, device.Source.TRAKT);
  let fetches = 0;
  await stubTrakt(device, { playback: [traktPlaybackEntry()] });
  const { fetchPlaybackState } = device.TraktAuthService;
  device.TraktAuthService.fetchPlaybackState = async (...args) => {
    fetches += 1;
    return fetchPlaybackState(...args);
  };
  await device.repo.getRecent(20, { enrichMetadata: false });
  await device.repo.getRecent(20, { enrichMetadata: false });
  assert.equal(fetches, 1, "the snapshot is cached for ordinary reads");
  await device.repo.forceRefreshSelectedSource();
  await device.repo.getRecent(20, { enrichMetadata: false });
  assert.equal(fetches, 2, "an explicit refresh must not be answered from the cache");
});

// Under Nuvio Sync the rows are local, but viewing done in another app reaches
// them only through a cloud pull -- and a completion reaches this device as the
// absence of a row, which only the watched records explain. Pulled in parallel,
// the merge read a watched store that had not caught up and pushed a stale
// partial back over the completion on every other device.
test("a forced refresh under Nuvio Sync has the watched records before it merges", async () => {
  const device = await freshDevice();
  const order = [];
  const watchedSync = await import("../../core/profile/watchedItemsSyncService.js");
  const progressSync = await import("../../core/profile/watchProgressSyncService.js");
  const originals = {
    watchedPull: watchedSync.WatchedItemsSyncService.pull,
    progressPull: progressSync.WatchProgressSyncService.pull
  };
  // Slow enough that running the two in parallel would let the merge finish
  // first, which is exactly the bug: a partial the completion should retire
  // survived the merge and was pushed back over it on every other device.
  watchedSync.WatchedItemsSyncService.pull = async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
    order.push("watched");
    return [];
  };
  progressSync.WatchProgressSyncService.pull = async ({ watchedItemsReady } = {}) => {
    if (watchedItemsReady) await watchedItemsReady;
    order.push("merge");
    return [];
  };
  try {
    await device.repo.forceRefreshSelectedSource();
    assert.deepEqual(order, ["watched", "merge"]);
  } finally {
    watchedSync.WatchedItemsSyncService.pull = originals.watchedPull;
    progressSync.WatchProgressSyncService.pull = originals.progressPull;
  }
});

// ---------------------------------------------------------------------------
// Resuming under a provider
// ---------------------------------------------------------------------------

test("resuming under Trakt reads the provider's position, not a stale local one", async () => {
  const device = await freshDevice();
  signIntoTrakt(device);
  selectSource(device, device.Source.TRAKT);
  await stubTrakt(device, { playback: [traktPlaybackEntry({ progressPercent: 42 })] });
  const resume = await device.repo.getResumeByContentId("tmdb:329865");
  assert.equal(Math.round(resume.progressFraction * 100), 42);
});

test("a title the provider has never heard of resumes at nothing", async () => {
  const device = await freshDevice();
  signIntoTrakt(device);
  selectSource(device, device.Source.TRAKT);
  await stubTrakt(device);
  assert.equal(await device.repo.getResumeByContentId("tt1375666"), null);
});

// A provider read that fails must not take resume down with it: the local row is
// still the best answer available.
test("resume survives the provider failing", async () => {
  const device = await freshDevice();
  await device.repo.saveProgress(movie(0.3));
  signIntoTrakt(device);
  selectSource(device, device.Source.TRAKT);
  device.TraktAuthService.fetchWatchHistory = async () => {
    throw new Error("Trakt is down");
  };
  device.TraktAuthService.fetchPlaybackState = async () => {
    throw new Error("Trakt is down");
  };
  device.TraktAuthService.fetchWatchedShows = async () => {
    throw new Error("Trakt is down");
  };
  assert.equal(await device.repo.getResumeByContentId("tt1375666"), null);
});

// The suppression list is scoped by profile as well as by source, and nothing
// drove that half through the repository. Deleting either `scopeTo` call left
// the whole suite green, while a viewer would have seen a title they removed in
// one profile go missing from another profile's Continue Watching -- a profile
// where it was never removed, and where it only came back after a reload,
// because the list lives in memory.
test("a removal in one profile does not hide the title in another", async () => {
  const device = await freshDevice();
  signIntoTrakt(device);
  selectSource(device, device.Source.TRAKT);
  await stubTrakt(device, { playback: [traktPlaybackEntry()] });

  // Profile 1 removes it. Trakt has not applied the delete yet, so it is
  // suppressed rather than gone.
  await device.repo.removeContinueWatchingTitle("tmdb:329865");
  assert.deepEqual(await device.repo.getAllForContinueWatching(), []);
  assert.equal(device.suppression.size, 1);

  // Profile 2 never removed anything and must still see it.
  device.storage.setItem("activeProfileId", JSON.stringify("2"));
  device.LocalStore.set("traktAuthState", {
    profiles: {
      1: { accessToken: "trakt-token", refreshToken: "trakt-refresh" },
      2: { accessToken: "trakt-token-2", refreshToken: "trakt-refresh-2" }
    }
  });
  device.TraktSettingsStore.set({ watchProgressSource: device.Source.TRAKT });

  assert.deepEqual(
    idsOf(await device.repo.getAllForContinueWatching()),
    ["tmdb:329865"],
    "the other profile never removed it"
  );
});

// The scope key names both, so a removal is settled against the account it was
// made for and no other. A provider is signed in per profile, so the source
// half follows that too: switching to a profile that never linked Trakt lands
// on Nuvio Sync, and the key says so.
test("the suppression scope key names the profile and that profile's own source", async () => {
  const device = await freshDevice();
  signIntoTrakt(device);
  selectSource(device, device.Source.TRAKT);
  assert.equal(device.repo.getContinueWatchingSourceKey(), "1:trakt");

  // Profile 2 has no Trakt account of its own, whatever the setting says.
  device.storage.setItem("activeProfileId", JSON.stringify("2"));
  assert.equal(device.repo.getContinueWatchingSourceKey(), "2:nuvio_sync");

  // Give it one, and the same setting now resolves to Trakt for this profile.
  device.LocalStore.set("traktAuthState", {
    profiles: {
      1: { accessToken: "t1", refreshToken: "r1" },
      2: { accessToken: "t2", refreshToken: "r2" }
    }
  });
  assert.equal(device.repo.getContinueWatchingSourceKey(), "2:trakt");
});
