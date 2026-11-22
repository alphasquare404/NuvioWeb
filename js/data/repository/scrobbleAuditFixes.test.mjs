import assert from "node:assert/strict";
import test from "node:test";

// Regression tests for the watch-state audit's provider findings:
// F10 (a derived series marker must not remove provider history) and
// F15 (the Trakt circuit breaker must recover for a new playback).

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
globalThis.__NUVIO_ENV__ = { TRAKT_CLIENT_ID: "audit-fake-client-id" };
globalThis.fetch = async () => {
  throw new Error("audit: network disabled");
};

const { LocalStore } = await import("../../core/storage/localStore.js");
const { AuthManager } = await import("../../core/auth/authManager.js");
const { AuthState } = await import("../../core/auth/authState.js");
const { TraktAuthStore } = await import("../local/traktAuthStore.js");
const { TraktAuthService } = await import("./traktAuthService.js");
const { TraktSettingsStore, WatchProgressSource } = await import("../local/traktSettingsStore.js");
const { watchedItemsRepository } = await import("./watchedItemsRepository.js");
const { watchProgressRepository } = await import("./watchProgressRepository.js");
const { watchedSeriesReconciliationService } =
  await import("./watchedSeriesReconciliationService.js");

function reset() {
  localStorage.clear();
  LocalStore.set("activeProfileId", "1");
  AuthManager.setState(AuthState.AUTHENTICATED);
}

test("F10: reconciling a derived series marker never sends a provider removal", async () => {
  reset();
  const originals = {
    getAll: watchedItemsRepository.getAll,
    isWatched: watchedItemsRepository.isWatched,
    unmark: watchedItemsRepository.unmark,
    progressAll: watchProgressRepository.getAll
  };
  let unmarkArgs = null;
  watchedItemsRepository.getAll = async () => [
    { contentId: "tt4444444", contentType: "series", season: 1, episode: 1 }
  ];
  watchedItemsRepository.isWatched = async () => true;
  watchedItemsRepository.unmark = async (...args) => {
    unmarkArgs = args;
  };
  watchProgressRepository.getAll = async () => [];
  try {
    await watchedSeriesReconciliationService.reconcile("tt4444444", "series", {
      meta: {
        videos: [
          { id: "tt4444444:1:1", season: 1, episode: 1 },
          { id: "tt4444444:1:2", season: 1, episode: 2 }
        ]
      }
    });
  } finally {
    watchedItemsRepository.getAll = originals.getAll;
    watchedItemsRepository.isWatched = originals.isWatched;
    watchedItemsRepository.unmark = originals.unmark;
    watchProgressRepository.getAll = originals.progressAll;
  }

  assert.deepEqual(unmarkArgs, [
    "tt4444444",
    { rootOnly: true, skipTrackingWrite: true, skipServerWrite: true }
  ]);
});

test("F15: the Trakt breaker lets a new playback retry after cancel", async () => {
  reset();
  TraktSettingsStore.set({ watchProgressSource: WatchProgressSource.TRAKT }, { silentSync: true });
  TraktAuthStore.saveToken({ access_token: "fake", refresh_token: "fake" }, "1");
  TraktAuthService.getValidAccessToken = async () => "fake";
  let requests = 0;
  globalThis.fetch = async () => {
    requests += 1;
    return { ok: false, status: 503, text: async () => "" };
  };
  const { TraktScrobbleService } = await import("./traktScrobbleService.js?f15");
  const context = {
    contentId: "tt6666666",
    contentType: "movie",
    imdbId: "tt6666666",
    progressPercent: 40
  };
  const tick = () => new Promise((resolve) => setImmediate(resolve));
  try {
    for (let index = 0; index < 3; index += 1) {
      TraktScrobbleService.stop(context);
      await tick();
    }
    assert.equal(requests, 3);

    // The breaker is open: a fourth request in the cooldown is suppressed.
    TraktScrobbleService.stop({ ...context, contentId: "tt7777777", imdbId: "tt7777777" });
    await tick();
    assert.equal(requests, 3);

    // A new playback is a new session and may probe again.
    TraktScrobbleService.cancel();
    TraktScrobbleService.stop({ ...context, contentId: "tt8888888", imdbId: "tt8888888" });
    await tick();
    assert.equal(requests, 4);
  } finally {
    globalThis.fetch = async () => {
      throw new Error("audit: network disabled");
    };
  }
});
