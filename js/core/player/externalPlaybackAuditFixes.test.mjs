import assert from "node:assert/strict";
import test from "node:test";

// Regression tests for the watch-state audit's completion/handoff findings:
// F04 (offline suppression reaches the handoff path), F13 (provider ids for a
// TMDB-only title), F17 (a report applies to the profile that launched it),
// and F18 (a rejected report must not leave the handoff stuck).

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

const { LocalStore } = await import("../storage/localStore.js");
const { WatchProgressStore } = await import("../../data/local/watchProgressStore.js");
const { PlayerController } = await import("./playerController.js");
const { TrackingScrobbleService } =
  await import("../../data/repository/trackingScrobbleService.js");
const { buildExternalScrobbleContext } = await import("./externalScrobbleContext.js");
const handoffModule = await import("../../ui/components/browserExternalPlaybackHandoff.js");

function reset() {
  localStorage.clear();
  LocalStore.set("activeProfileId", "1");
}

const settle = async () => {
  for (let index = 0; index < 30; index += 1) await Promise.resolve();
};

function externalRuntime() {
  const storage = new Map();
  return {
    crypto: { getRandomValues: (bytes) => bytes.fill(0xab) },
    location: { href: "https://audit.invalid/" },
    localStorage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
      removeItem: (key) => storage.delete(key)
    },
    document: { visibilityState: "hidden", addEventListener() {} },
    addEventListener() {},
    setTimeout() {
      throw new Error("Unexpected retry in controlled test");
    }
  };
}

test("F13: a TMDB-prefixed title keeps the TMDb id the provider needs", () => {
  const context = buildExternalScrobbleContext({ itemId: "tmdb:123", itemType: "movie" }, 100, 200);
  assert.equal(context.tmdbId, 123);
  assert.equal(context.imdbId, null);
  assert.equal(context.traktId, null);
});

test("F13: a Trakt-prefixed title keeps the Trakt id", () => {
  const context = buildExternalScrobbleContext({ itemId: "trakt:45", itemType: "movie" }, 100, 200);
  assert.equal(context.traktId, 45);
  assert.equal(context.imdbId, null);
});

test("F13: a TMDB external completion reaches the provider instead of being dropped", () => {
  const originalIsEnabled = TrackingScrobbleService.isEnabled;
  const originalStop = TrackingScrobbleService.stop;
  let sent = null;
  TrackingScrobbleService.isEnabled = () => true;
  TrackingScrobbleService.stop = (context) => {
    sent = context;
    return true;
  };
  try {
    const dispatched = PlayerController.scrobbleExternalCompletion.call(
      { getRecordedProgressSnapshot: () => null, getDurationSeconds: () => 7200 },
      { itemId: "tmdb:123", itemType: "movie" }
    );
    assert.equal(dispatched, true);
    assert.equal(sent.tmdbId, 123);
  } finally {
    TrackingScrobbleService.isEnabled = originalIsEnabled;
    TrackingScrobbleService.stop = originalStop;
  }
});

test("F17: an external report is written to the profile that launched it", async () => {
  reset();
  LocalStore.set("activeProfileId", "2");
  const handoff = {
    profileId: "1",
    knownDurationMs: 7_200_000,
    progressContext: { itemId: "tt424242", itemType: "movie", title: "Film" }
  };

  const applied = await PlayerController.applyExternalPlaybackReport.call(PlayerController, {
    handoff,
    outcome: "stopped",
    positionSeconds: 1800,
    durationSeconds: 7200
  });

  assert.equal(applied, true);
  assert.equal(WatchProgressStore.listForProfile("1").length, 1);
  assert.equal(WatchProgressStore.listForProfile("2").length, 0);
});

test("F04: an offline external report is not applied when offline progress is off", async () => {
  reset();
  const handoff = {
    profileId: "1",
    knownDurationMs: 7_200_000,
    progressContext: {
      itemId: "tt424242",
      itemType: "movie",
      offlinePlayback: true
    }
  };

  const applied = await PlayerController.applyExternalPlaybackReport.call(PlayerController, {
    handoff,
    outcome: "stopped",
    positionSeconds: 1800,
    durationSeconds: 7200
  });

  assert.equal(applied, false);
  assert.equal(WatchProgressStore.listForProfile("1").length, 0);
});

test("F18: a report that cannot be applied reaches a terminal state and stops being fetched", async () => {
  const runtime = externalRuntime();
  handoffModule.beginExternalPlaybackHandoff({
    runtime,
    playerMode: "outplayer",
    automatic: true,
    profileId: "1",
    progressContext: { itemId: "tt9999999", itemType: "movie" }
  });
  let fetches = 0;
  let applications = 0;
  const coordinator = handoffModule.installExternalPlaybackReturnCoordinator({
    runtime,
    getProfileId: () => "1",
    fetchImpl: async () => {
      fetches += 1;
      return {
        ok: true,
        json: async () => ({ found: true, outcome: "stopped", position: 0, duration: 0 })
      };
    },
    onAutomaticReport: async (report) => {
      applications += 1;
      return PlayerController.applyExternalPlaybackReport.call(PlayerController, {
        handoff: report.handoff,
        outcome: report.outcome,
        positionSeconds: report.positionSeconds,
        durationSeconds: report.durationSeconds
      });
    }
  });

  coordinator.collect();
  await settle();
  assert.equal(applications, 1);
  assert.equal(
    handoffModule.readPendingExternalPlaybackHandoff({ runtime }).state,
    "report-rejected"
  );

  coordinator.collect();
  await settle();
  const reloaded = handoffModule.installExternalPlaybackReturnCoordinator({
    runtime,
    getProfileId: () => "1",
    fetchImpl: async () => {
      fetches += 1;
      return { ok: false };
    }
  });
  reloaded.collect();
  await settle();
  assert.equal(fetches, 1);
});

test("F18: a persisted report is recovered after a reload", async () => {
  const runtime = externalRuntime();
  handoffModule.beginExternalPlaybackHandoff({
    runtime,
    playerMode: "outplayer",
    automatic: true,
    profileId: "1",
    progressContext: { itemId: "tt1010101", itemType: "movie" }
  });
  const pending = handoffModule.readPendingExternalPlaybackHandoff({ runtime });
  runtime.localStorage.setItem(
    "nuvioExternalPlaybackHandoff",
    JSON.stringify({
      ...pending,
      state: "applying-report",
      pendingReport: {
        outcome: "stopped",
        positionSeconds: 600,
        durationSeconds: 1200
      }
    })
  );
  let applied = 0;
  const coordinator = handoffModule.installExternalPlaybackReturnCoordinator({
    runtime,
    getProfileId: () => "1",
    fetchImpl: async () => {
      throw new Error("the consumed relay record must not be fetched again");
    },
    onAutomaticReport: async () => {
      applied += 1;
      return true;
    }
  });

  coordinator.collect();
  await settle();
  assert.equal(applied, 1);
  assert.equal(handoffModule.readPendingExternalPlaybackHandoff({ runtime }), null);
});
