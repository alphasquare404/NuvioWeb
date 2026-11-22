import assert from "node:assert/strict";
import test from "node:test";

// Regression tests for the watch-state audit (F01, F02, F03, F05, F08).
// The seams are the same ones the audit harness used: localStorage and
// SupabaseApi.rpc. A fresh module instance per test keeps the service's module
// state (push signatures, the reconnect barrier) from leaking between cases.

function createStorage() {
  const values = new Map();
  return {
    getItem: (key) => (values.has(key) ? values.get(key) : null),
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
    clear: () => values.clear()
  };
}

globalThis.localStorage = createStorage();
globalThis.__NUVIO_ENV__ = { TRAKT_CLIENT_ID: "audit-fake-client-id" };
// No production network is allowed here.
globalThis.fetch = async () => {
  throw new Error("audit: network disabled");
};

const { LocalStore } = await import("../storage/localStore.js");
const { AuthManager } = await import("../auth/authManager.js");
const { AuthState } = await import("../auth/authState.js");
const { ProfileManager } = await import("./profileManager.js");
const { SupabaseApi } = await import("../../data/remote/supabase/supabaseApi.js");
const { WatchedItemsStore } = await import("../../data/local/watchedItemsStore.js");
const { WatchProgressStore } = await import("../../data/local/watchProgressStore.js");
const { TraktSettingsStore, WatchProgressSource } =
  await import("../../data/local/traktSettingsStore.js");
const { TraktAuthService } = await import("../../data/repository/traktAuthService.js");
const { WatchedItemsSyncService } = await import("./watchedItemsSyncService.js");

function reset() {
  localStorage.clear();
  LocalStore.set("activeProfileId", "1");
  AuthManager.setState(AuthState.AUTHENTICATED);
  TraktSettingsStore.set(
    { watchProgressSource: WatchProgressSource.NUVIO_SYNC },
    { silentSync: true }
  );
}

function watchedKeysForProfile(profileId) {
  return WatchedItemsStore.listForProfile(profileId).map((item) => item.contentId);
}

test("F01: a successful empty snapshot deletes only what the cloud used to hold", async () => {
  reset();
  WatchedItemsStore.upsert({ contentId: "tt-cloud-held", watchedAt: 1_000 }, "1");
  WatchedItemsStore.upsert({ contentId: "tt-local-only", watchedAt: 2_000 }, "1");
  LocalStore.set("watchedItemsSyncState", {
    1: {
      remoteKeys: ["tt-cloud-held::"],
      lastSuccessfulPullAt: 5_000
    }
  });
  SupabaseApi.rpc = async () => [];

  await WatchedItemsSyncService.pull();

  assert.deepEqual(watchedKeysForProfile("1"), ["tt-local-only"]);
});

test("F01: with no baseline the agreement timestamp still settles an empty snapshot", async () => {
  reset();
  WatchedItemsStore.upsert({ contentId: "tt-old", watchedAt: 1_000 }, "1");
  WatchedItemsStore.upsert({ contentId: "tt-new", watchedAt: 9_000 }, "1");
  LocalStore.set("watchedItemsSyncState", { 1: { lastSuccessfulPushAt: 5_000 } });
  SupabaseApi.rpc = async () => [];

  await WatchedItemsSyncService.pull();

  assert.deepEqual(watchedKeysForProfile("1"), ["tt-new"]);
});

test("F02: a failed delete keeps the deletion intent in the baseline and skips the push", async () => {
  reset();
  const remote = {
    contentId: "tt-progress",
    videoId: "tt-progress",
    contentType: "movie",
    positionMs: 1_000,
    durationMs: 100_000,
    updatedAt: 1_000
  };
  LocalStore.set("watchProgressSyncState", { 1: { remoteSnapshot: [remote] } });
  const calls = [];
  SupabaseApi.rpc = async (name) => {
    calls.push(name);
    if (name === "sync_delete_watch_progress") throw new Error("injected delete failure");
    return [];
  };
  const { WatchProgressSyncService } = await import("./watchProgressSyncService.js?f02");

  assert.equal(await WatchProgressSyncService.push(), false);
  assert.equal(calls.includes("sync_push_watch_progress"), false);
  assert.equal(LocalStore.get("watchProgressSyncState")["1"].remoteSnapshot.length, 1);
});

test("F03: a reconnect whose pulls fail keeps the barrier and pushes nothing", async () => {
  reset();
  const calls = [];
  SupabaseApi.rpc = async (name) => {
    calls.push(name);
    if (name.startsWith("sync_pull_")) throw new Error("injected pull failure");
    return [];
  };
  const { WatchProgressSyncService, noteWatchProgressReconnectPullOwed } =
    await import("./watchProgressSyncService.js?f03");
  const { setWatchProgressReconnectDelaysForTests } =
    await import("./watchProgressSyncService.js?f03");
  setWatchProgressReconnectDelaysForTests([0]);
  noteWatchProgressReconnectPullOwed();

  assert.equal(await WatchProgressSyncService.syncAfterReconnect("audit"), false);
  assert.equal(
    calls.some((name) => name.startsWith("sync_push_")),
    false
  );
});

test("F05: a Trakt snapshot started for one profile is not reused for another", async () => {
  reset();
  const { watchProgressRepository } =
    await import("../../data/repository/watchProgressRepository.js?f05");
  LocalStore.set("traktAuthState", {
    profiles: {
      1: { accessToken: "fake1", refreshToken: "refresh1", username: "one" },
      2: { accessToken: "fake2", refreshToken: "refresh2", username: "two" }
    }
  });
  TraktSettingsStore.set({ watchProgressSource: WatchProgressSource.TRAKT }, { silentSync: true });
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  let reads = 0;
  TraktAuthService.fetchWatchHistory = async () => [];
  TraktAuthService.fetchWatchedShows = async () => [];
  TraktAuthService.fetchPlaybackState = async () => {
    reads += 1;
    const read = reads;
    await gate;
    return [
      {
        type: "movie",
        contentId: read === 1 ? "tt-profile-one" : "tt-profile-two",
        videoId: read === 1 ? "tt-profile-one" : "tt-profile-two",
        progressPercent: 40,
        pausedAt: new Date().toISOString()
      }
    ];
  };

  const first = watchProgressRepository.getAllForContinueWatching();
  await ProfileManager.setActiveProfile("2");
  const second = watchProgressRepository.getAllForContinueWatching();
  release();

  const firstItems = await first;
  const secondItems = await second;

  assert.equal(reads, 2);
  assert.equal(
    firstItems.some((item) => item.contentId === "tt-profile-one"),
    true
  );
  assert.equal(
    secondItems.some((item) => item.contentId === "tt-profile-one"),
    false
  );
  assert.equal(
    secondItems.some((item) => item.contentId === "tt-profile-two"),
    true
  );
});

test("F08: watched rows are never sent under a profile that took over mid-push", async () => {
  reset();
  WatchedItemsStore.upsert({ contentId: "tt-profile-one-secret", watchedAt: 1_000 }, "1");
  const calls = [];
  SupabaseApi.rpc = async (name, body) => {
    calls.push({ name, body });
    return [];
  };

  const pushing = WatchedItemsSyncService.push();
  await ProfileManager.setActiveProfile("2");
  const result = await pushing;

  assert.equal(result, false);
  assert.equal(
    calls.some((call) => call.name === "sync_push_watched_items"),
    false
  );
});

test("F08: progress rows are never sent under a profile that took over mid-push", async () => {
  reset();
  WatchProgressStore.upsert(
    {
      contentId: "tt-progress-secret",
      contentType: "movie",
      positionMs: 60_000,
      durationMs: 600_000,
      updatedAt: Date.now()
    },
    "1"
  );
  const calls = [];
  SupabaseApi.rpc = async (name, body) => {
    calls.push({ name, body });
    return [];
  };
  const { WatchProgressSyncService } = await import("./watchProgressSyncService.js?f08p");

  const pushing = WatchProgressSyncService.push();
  await ProfileManager.setActiveProfile("2");
  const result = await pushing;

  assert.equal(result, false);
  assert.equal(
    calls.some((call) => call.name === "sync_push_watch_progress"),
    false
  );
});
