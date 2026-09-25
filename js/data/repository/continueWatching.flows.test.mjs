import assert from "node:assert/strict";
import test from "node:test";

// Continue Watching end to end, through the real repository, the real store and
// the real projection rules. Every piece of this had unit coverage in isolation;
// what nothing exercised was a whole use of the app -- play, finish, remove,
// switch source, switch profile, come back later -- where the pieces have to
// agree with each other. The bugs that reached devices all lived in that gap.
//
// The seam is `localStorage`, read per call by every store here.

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
// Positions are fractions of the runtime: a bare millisecond count small enough
// to type is ambiguous with a second count, and gets rewritten by the heuristic
// that rescues legacy rows.
const at = (fraction) => Math.round(RUNTIME_MS * fraction);

async function loadModules() {
  return {
    repo: (await import("./watchProgressRepository.js")).watchProgressRepository,
    watched: (await import("./watchedItemsRepository.js")).watchedItemsRepository,
    ProgressStore: (await import("../local/watchProgressStore.js")).WatchProgressStore,
    WatchedStore: (await import("../local/watchedItemsStore.js")).WatchedItemsStore,
    TraktSettingsStore: (await import("../local/traktSettingsStore.js")).TraktSettingsStore,
    WatchProgressSource: (await import("../local/traktSettingsStore.js")).WatchProgressSource,
    Preferences: (await import("../local/continueWatchingPreferences.js"))
      .ContinueWatchingPreferences,
    LocalStore: (await import("../../core/storage/localStore.js")).LocalStore,
    suppression: (await import("./continueWatchingRemovalSuppression.js"))
      .continueWatchingRemovalSuppression
  };
}

// A fresh device: empty storage, one profile, Nuvio Sync owning progress.
async function freshDevice(profileId = "1") {
  const storage = createStorage();
  globalThis.localStorage = storage;
  const modules = await loadModules();
  storage.setItem("activeProfileId", JSON.stringify(profileId));
  storage.setItem("profiles", JSON.stringify([{ id: profileId, isPrimary: true }]));
  modules.TraktSettingsStore.set({ watchProgressSource: modules.WatchProgressSource.NUVIO_SYNC });
  modules.suppression.clear();
  return { storage, ...modules };
}

function switchProfile(device, profileId) {
  device.storage.setItem("activeProfileId", JSON.stringify(String(profileId)));
}

const movie = (fraction, extra = {}) => ({
  contentId: "tt1375666",
  contentType: "movie",
  videoId: null,
  season: null,
  episode: null,
  positionMs: at(fraction),
  durationMs: RUNTIME_MS,
  title: "Inception",
  poster: "inception.jpg",
  ...extra
});

const episode = (season, number, fraction, extra = {}) => ({
  contentId: "tt0903747",
  contentType: "series",
  videoId: `tt0903747:s${season}e${number}`,
  season,
  episode: number,
  positionMs: at(fraction),
  durationMs: RUNTIME_MS,
  title: "Breaking Bad",
  poster: "bb.jpg",
  ...extra
});

const idsOf = (items) => items.map((item) => item.contentId);

// ---------------------------------------------------------------------------
// Playing something
// ---------------------------------------------------------------------------

test("a film played part way through appears in Continue Watching at that position", async () => {
  const device = await freshDevice();
  await device.repo.saveProgress(movie(0.3));
  const recent = await device.repo.getRecent(20, { enrichMetadata: false });
  assert.deepEqual(idsOf(recent), ["tt1375666"]);
  assert.equal(recent[0].positionMs, at(0.3));
});

// The 2% "started" threshold only decides what is *definitely* in progress.
// Anything past zero and short of the completion line still counts, because the
// same test has to keep rows that carry no duration to compute a fraction from
// -- a provider's playback entry, or a legacy row. So a film opened for a minute
// does get a card. Documented here because the constant reads like a floor.
test("a film barely started still gets a card", async () => {
  const device = await freshDevice();
  await device.repo.saveProgress(movie(0.001));
  assert.deepEqual(idsOf(await device.repo.getRecent(20, { enrichMetadata: false })), [
    "tt1375666"
  ]);
});

test("a row with no duration at all is kept on its position alone", async () => {
  const device = await freshDevice();
  await device.repo.saveProgress({ ...movie(0), positionMs: 90_000, durationMs: 0 });
  assert.deepEqual(idsOf(await device.repo.getRecent(20, { enrichMetadata: false })), [
    "tt1375666"
  ]);
});

test("a film watched to the end leaves Continue Watching without being removed", async () => {
  const device = await freshDevice();
  await device.repo.saveProgress(movie(0.98));
  assert.deepEqual(await device.repo.getRecent(20, { enrichMetadata: false }), []);
});

test("resuming reads back the position the player last wrote", async () => {
  const device = await freshDevice();
  await device.repo.saveProgress(movie(0.3));
  await device.repo.saveProgress(movie(0.62));
  const resume = await device.repo.getResumeByContentId("tt1375666");
  assert.equal(resume.positionMs, at(0.62));
});

test("two episodes of one series collapse to the latest card", async () => {
  const device = await freshDevice();
  await device.repo.saveProgress(episode(1, 2, 0.9, { updatedAt: 1000 }));
  await device.repo.saveProgress(episode(1, 3, 0.4, { updatedAt: 2000 }));
  const recent = await device.repo.getRecent(20, { enrichMetadata: false });
  assert.deepEqual(
    recent.map((item) => item.episode),
    [3]
  );
});

test("a film and an episode are separate cards", async () => {
  const device = await freshDevice();
  await device.repo.saveProgress(movie(0.3));
  await device.repo.saveProgress(episode(1, 2, 0.4));
  assert.equal((await device.repo.getRecent(20, { enrichMetadata: false })).length, 2);
});

// ---------------------------------------------------------------------------
// Finishing something
// ---------------------------------------------------------------------------

test("finishing a film takes its card away", async () => {
  const device = await freshDevice();
  await device.repo.saveProgress(movie(0.6));
  await device.repo.removePlaybackProgress({ contentId: "tt1375666", videoId: null });
  assert.deepEqual(await device.repo.getRecent(20, { enrichMetadata: false }), []);
});

test("finishing an episode takes only that episode's row", async () => {
  const device = await freshDevice();
  await device.repo.saveProgress(episode(1, 2, 0.6));
  await device.repo.saveProgress(episode(2, 1, 0.4));
  await device.repo.removePlaybackProgress({
    contentId: "tt0903747",
    videoId: "tt0903747:s1e2",
    season: 1,
    episode: 2
  });
  const remaining = await device.repo.getAll();
  assert.deepEqual(
    remaining.map((item) => `${item.season}x${item.episode}`),
    ["2x1"]
  );
});

// A provider can hand back a different video id for the same episode between
// launches, so season and episode are the stable identity.
test("an episode is finished by its number when the video id has changed", async () => {
  const device = await freshDevice();
  await device.repo.saveProgress(episode(1, 2, 0.6, { videoId: "old-id" }));
  const removed = await device.repo.removePlaybackProgress({
    contentId: "tt0903747",
    videoId: "new-id",
    season: 1,
    episode: 2
  });
  assert.equal(removed, true);
  assert.deepEqual(await device.repo.getAll(), []);
});

// The store hands out cached objects, so this used to compare by object
// identity and worked only as long as nothing else wrote in between.
test("finishing still removes the row when the store is re-read in between", async () => {
  const device = await freshDevice();
  await device.repo.saveProgress(episode(1, 2, 0.6));
  await device.repo.saveProgress(episode(2, 1, 0.4));
  // Another tab writing to the same key is enough to hand back fresh objects.
  const raw = JSON.parse(device.storage.getItem("watchProgressItems"));
  device.storage.setItem("watchProgressItems", JSON.stringify(raw));
  await device.repo.removePlaybackProgress({
    contentId: "tt0903747",
    videoId: "tt0903747:s1e2",
    season: 1,
    episode: 2
  });
  assert.deepEqual(
    (await device.repo.getAll()).map((item) => `${item.season}x${item.episode}`),
    ["2x1"]
  );
});

// ---------------------------------------------------------------------------
// Removing a card by hand
// ---------------------------------------------------------------------------

test("removing a series from Continue Watching removes every episode's progress", async () => {
  const device = await freshDevice();
  await device.repo.saveProgress(episode(1, 2, 0.6));
  await device.repo.saveProgress(episode(2, 5, 0.3));
  await device.repo.removeContinueWatchingTitle("tt0903747");
  assert.deepEqual(await device.repo.getAll(), []);
});

test("removing a card from Continue Watching never un-watches anything", async () => {
  const device = await freshDevice();
  await device.watched.mark(
    { contentId: "tt0903747", contentType: "series", season: 1, episode: 1, title: "Breaking Bad" },
    { skipTrackingWrite: true }
  );
  await device.repo.saveProgress(episode(1, 2, 0.6));
  await device.repo.removeContinueWatchingTitle("tt0903747");
  assert.equal((await device.watched.listLocal()).length, 1);
});

// ---------------------------------------------------------------------------
// Which source owns the row
// ---------------------------------------------------------------------------

test("playback recorded under Nuvio Sync stays out of a provider's list", async () => {
  const device = await freshDevice();
  await device.repo.saveProgress(movie(0.3));
  device.TraktSettingsStore.set({ watchProgressSource: device.WatchProgressSource.TRAKT });
  // Not signed in to Trakt, so the effective source is still Nuvio Sync and the
  // row belongs: the point is that switching the setting alone cannot strand it.
  assert.deepEqual(idsOf(await device.repo.getRecent(20, { enrichMetadata: false })), [
    "tt1375666"
  ]);
});

test("a row tagged to another provider is filtered out of Nuvio Sync's list", async () => {
  const device = await freshDevice();
  await device.repo.saveProgress(movie(0.3, { source: "simkl_playback" }));
  assert.deepEqual(await device.repo.getRecent(20, { enrichMetadata: false }), []);
});

test("a completion is tagged for the cloud that can actually receive it", async () => {
  const device = await freshDevice();
  await device.watched.mark(
    { contentId: "tt1375666", contentType: "movie", title: "Inception" },
    { skipTrackingWrite: true }
  );
  const [record] = await device.watched.listLocal();
  assert.equal(record.source, device.WatchProgressSource.NUVIO_SYNC);
});

// The setting defaults to Trakt whether or not an account is linked. Reading only
// the setting tagged every completion `trakt_local` on a profile that never
// linked one, which filtered it out of Nuvio's own cloud push for good.
test("the default provider setting does not strand completions with no account", async () => {
  const device = await freshDevice();
  device.TraktSettingsStore.set({ watchProgressSource: device.WatchProgressSource.TRAKT });
  await device.watched.mark(
    { contentId: "tt1375666", contentType: "movie", title: "Inception" },
    { skipTrackingWrite: true }
  );
  const [record] = await device.watched.listLocal();
  assert.equal(record.source, device.WatchProgressSource.NUVIO_SYNC);
});

// ---------------------------------------------------------------------------
// More than one profile
// ---------------------------------------------------------------------------

test("one profile's viewing never appears in another's Continue Watching", async () => {
  const device = await freshDevice("1");
  await device.repo.saveProgress(movie(0.3));
  switchProfile(device, "2");
  assert.deepEqual(await device.repo.getRecent(20, { enrichMetadata: false }), []);
  switchProfile(device, "1");
  assert.deepEqual(idsOf(await device.repo.getRecent(20, { enrichMetadata: false })), [
    "tt1375666"
  ]);
});

test("removing a title in one profile leaves the other profile's row alone", async () => {
  const device = await freshDevice("1");
  await device.repo.saveProgress(movie(0.3));
  switchProfile(device, "2");
  await device.repo.saveProgress(movie(0.7));
  await device.repo.removeContinueWatchingTitle("tt1375666");
  switchProfile(device, "1");
  assert.equal((await device.repo.getAll())[0].positionMs, at(0.3));
});

// ---------------------------------------------------------------------------
// The display snapshot that makes Home paint instantly
// ---------------------------------------------------------------------------

const SNAPSHOT_KEY = "homeContinueWatchingDisplaySnapshot";

function seedSnapshot(device, items) {
  device.LocalStore.set(SNAPSHOT_KEY, {
    [device.repo.getContinueWatchingSourceKey()]: { items, savedAt: Date.now() }
  });
}

function readSnapshot(device) {
  return device.LocalStore.get(SNAPSHOT_KEY, {})[device.repo.getContinueWatchingSourceKey()];
}

test("an ordinary progress write patches the snapshot instead of discarding it", async () => {
  const device = await freshDevice();
  seedSnapshot(device, [
    { contentId: "tt1375666", videoId: "main", season: null, episode: null, positionMs: at(0.3) }
  ]);
  await device.repo.saveProgress(movie(0.55));
  assert.equal(readSnapshot(device).items[0].positionMs, at(0.55));
});

test("finishing a title discards the snapshot rather than leaving the card behind", async () => {
  const device = await freshDevice();
  await device.repo.saveProgress(movie(0.3));
  seedSnapshot(device, [
    { contentId: "tt1375666", videoId: "main", season: null, episode: null, positionMs: at(0.3) }
  ]);
  await device.repo.removePlaybackProgress({ contentId: "tt1375666", videoId: null });
  assert.equal(readSnapshot(device), undefined);
});

test("a snapshot taken under one source is not shown under another", async () => {
  const device = await freshDevice();
  seedSnapshot(device, [{ contentId: "tt1375666", videoId: "main", positionMs: at(0.3) }]);
  switchProfile(device, "2");
  assert.equal(readSnapshot(device), undefined);
});

// ---------------------------------------------------------------------------
// Dismissed Next Up cards
// ---------------------------------------------------------------------------

test("playing a series again brings back a Next Up card dismissed for it", async () => {
  const device = await freshDevice();
  device.Preferences.addDismissedNextUpKey("tt0903747|1|3");
  await device.repo.saveProgress(episode(1, 2, 0.4));
  assert.deepEqual(device.Preferences.getDismissedNextUpKeys(), []);
});

test("dismissing one series' Next Up does not clear another's", async () => {
  const device = await freshDevice();
  device.Preferences.addDismissedNextUpKey("tt0903747|1|3");
  device.Preferences.addDismissedNextUpKey("tt0944947|1|1");
  await device.repo.saveProgress(episode(1, 2, 0.4));
  assert.deepEqual(device.Preferences.getDismissedNextUpKeys(), ["tt0944947|1|1"]);
});

// Progress is written every few seconds while something plays. Each write asked
// the preferences store to drop this title's dismissed keys, and it rewrote the
// whole blob and queued a profile-settings cloud push whether or not there was
// anything to drop -- hundreds of pointless writes and pushes per episode.
test("a write with nothing to dismiss does not touch the preferences store", async () => {
  const device = await freshDevice();
  device.Preferences.addDismissedNextUpKey("tt0944947|1|1");
  const before = device.storage.getItem("continueWatchingPreferences");
  let writes = 0;
  const { setItem } = device.storage;
  device.storage.setItem = (key, value) => {
    if (key === "continueWatchingPreferences") writes += 1;
    return setItem.call(device.storage, key, value);
  };
  await device.repo.saveProgress(episode(1, 2, 0.4));
  await device.repo.saveProgress(episode(1, 2, 0.45));
  device.storage.setItem = setItem;
  assert.equal(writes, 0, "an unrelated dismissal must not be rewritten on every tick");
  assert.equal(device.storage.getItem("continueWatchingPreferences"), before);
});

// ---------------------------------------------------------------------------
// Change notifications Home listens to
// ---------------------------------------------------------------------------

test("an authoritative write is announced as authoritative", async () => {
  const device = await freshDevice();
  const seen = [];
  const stop = device.ProgressStore.subscribe((change) => seen.push(change));
  await device.repo.saveProgress(movie(0.3));
  await device.repo.saveProgress(movie(0.4), { authoritative: true });
  stop();
  assert.deepEqual(
    seen.map((change) => change.authoritative),
    [false, true]
  );
});

// Home drops a finished card the moment it hears about it, and hears about it
// through this one field.
test("a completion announces the item it finished", async () => {
  const device = await freshDevice();
  const seen = [];
  const stop = device.WatchedStore.subscribe((change) => seen.push(change));
  await device.watched.mark(
    { contentId: "tt1375666", contentType: "movie", title: "Inception" },
    { skipTrackingWrite: true, authoritative: true }
  );
  stop();
  assert.equal(seen[0].authoritative, true);
  assert.equal(seen[0].item?.contentId, "tt1375666");
});

// Reconciliation and the series-watched sweep remove rows in the background,
// where nothing else is going to tell Home the row is gone.
test("removing a title announces itself so Continue Watching can react", async () => {
  const device = await freshDevice();
  await device.repo.saveProgress(movie(0.3));
  const seen = [];
  const stop = device.ProgressStore.subscribe((change) => seen.push(change));
  await device.repo.removeProgress("tt1375666");
  stop();
  assert.equal(seen.length, 1);
  assert.equal(seen[0].reason, "remove");
  assert.equal(seen[0].authoritative, true, "a removal is never an ordinary playback tick");
});

// ---------------------------------------------------------------------------
// Legacy and malformed rows
// ---------------------------------------------------------------------------

test("a row with no content id is discarded rather than stored as empty", async () => {
  const device = await freshDevice();
  await device.repo.saveProgress({ ...movie(0.3), contentId: "" });
  assert.deepEqual(await device.repo.getAll(), []);
});

test("a duration recorded in seconds is read back as milliseconds", async () => {
  const device = await freshDevice();
  // 7200 seconds stored where milliseconds were meant.
  await device.repo.saveProgress({
    ...movie(0),
    positionMs: 3600 * 1000 * 1000,
    durationMs: 7200 * 1000 * 1000
  });
  const [row] = await device.repo.getAll();
  assert.equal(row.durationMs, 7_200_000);
  assert.equal(row.positionMs, 3_600_000);
});

test("nothing anywhere is an empty Continue Watching, not a failure", async () => {
  const device = await freshDevice();
  assert.deepEqual(await device.repo.getRecent(20, { enrichMetadata: false }), []);
  assert.deepEqual(await device.repo.getAllForContinueWatching(), []);
  assert.equal(await device.repo.getResumeByContentId("tt1375666"), null);
  assert.equal(await device.repo.getResumeByContentId(""), null);
});

// ---------------------------------------------------------------------------
// Two ways of naming the same card
// ---------------------------------------------------------------------------

// A film reaches the snapshot from a provider carrying its own title id as the
// video id, and reaches the patch from playback here with that field empty.
// Compared literally they never match, so the write finds nothing to patch --
// and because a miss deliberately leaves the snapshot alone, the next cold mount
// paints the position the card had before. The in-memory row that Home patches
// already normalises this; the on-disk snapshot did not.
test("a film's position is patched however the card spells its video id", async () => {
  const device = await freshDevice();
  seedSnapshot(device, [
    {
      contentId: "tt1375666",
      // As a provider hands it over: the film's own id, not a video within it.
      videoId: "tt1375666",
      season: null,
      episode: null,
      positionMs: at(0.3),
      durationMs: RUNTIME_MS
    }
  ]);
  await device.repo.saveProgress(movie(0.55));
  assert.equal(readSnapshot(device).items[0].positionMs, at(0.55));
});

// The same disagreement the other way round: zeros for season and episode mean
// "not an episode", not season zero episode zero.
test("a film's position is patched when the card carries zeros for episode", async () => {
  const device = await freshDevice();
  seedSnapshot(device, [
    {
      contentId: "tt1375666",
      videoId: null,
      season: 0,
      episode: 0,
      positionMs: at(0.3),
      durationMs: RUNTIME_MS
    }
  ]);
  await device.repo.saveProgress(movie(0.55));
  assert.equal(readSnapshot(device).items[0].positionMs, at(0.55));
});

test("an episode's position is patched on its own card and no other", async () => {
  const device = await freshDevice();
  seedSnapshot(device, [
    {
      contentId: "tt0903747",
      videoId: "tt0903747:s1e2",
      season: 1,
      episode: 2,
      positionMs: at(0.2)
    },
    {
      contentId: "tt0903747",
      videoId: "tt0903747:s1e3",
      season: 1,
      episode: 3,
      positionMs: at(0.1)
    }
  ]);
  await device.repo.saveProgress(episode(1, 3, 0.44));
  assert.deepEqual(
    readSnapshot(device).items.map((item) => item.positionMs),
    [at(0.2), at(0.44)]
  );
});

// A specials run really is season zero, so a zero season must survive whenever
// there is an episode number beside it.
test("a season zero episode keeps its own card", async () => {
  const device = await freshDevice();
  seedSnapshot(device, [
    {
      contentId: "tt0903747",
      videoId: "tt0903747:s0e1",
      season: 0,
      episode: 1,
      positionMs: at(0.2)
    },
    {
      contentId: "tt0903747",
      videoId: "tt0903747:s1e1",
      season: 1,
      episode: 1,
      positionMs: at(0.1)
    }
  ]);
  await device.repo.saveProgress(episode(0, 1, 0.6, { videoId: "tt0903747:s0e1" }));
  assert.deepEqual(
    readSnapshot(device).items.map((item) => item.positionMs),
    [at(0.6), at(0.1)]
  );
});
