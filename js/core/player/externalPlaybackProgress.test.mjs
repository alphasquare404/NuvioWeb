import assert from "node:assert/strict";
import test from "node:test";
import { PlayerController } from "./playerController.js";

const handoff = {
  knownDurationMs: 120_000,
  progressContext: { itemId: "movie:external", itemType: "movie", title: "External movie" }
};

test("a stopped Outplayer report converts fractional seconds and reuses canonical progress", async () => {
  const calls = [];
  const controller = {
    flushProgress: async (...args) => {
      calls.push(args);
      return true;
    }
  };
  assert.equal(
    await PlayerController.applyExternalPlaybackReport.call(controller, {
      handoff,
      outcome: "stopped",
      positionSeconds: 45.625,
      durationSeconds: 120
    }),
    true
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 45_625);
  assert.equal(calls[0][1], 120_000);
  assert.equal(calls[0][3], handoff.progressContext);
});

test("Outplayer partial reports remain ordinary canonical progress", async () => {
  const calls = [];
  const controller = {
    flushProgress: async (...args) => {
      calls.push(["progress", ...args]);
      return true;
    }
  };
  assert.equal(
    await PlayerController.applyExternalPlaybackReport.call(controller, {
      handoff,
      outcome: "stopped",
      positionSeconds: 117.6,
      durationSeconds: 120
    }),
    true
  );
  assert.deepEqual(calls[0], [
    "progress",
    117_600,
    120_000,
    false,
    handoff.progressContext,
    { externalAuthoritative: true }
  ]);
  assert.equal(
    await PlayerController.applyExternalPlaybackReport.call(controller, {
      handoff,
      outcome: "stopped",
      positionSeconds: 300,
      durationSeconds: 120
    }),
    false
  );
});

test("pre-seeded episode finish reports preserve their stable identity through canonical completion", async () => {
  const calls = [];
  const controller = {
    flushProgress: async (...args) => {
      calls.push(args);
      return true;
    }
  };
  const episodeHandoff = {
    knownDurationMs: 1_800_000,
    progressContext: {
      itemId: "series:external",
      itemType: "series",
      videoId: "series:external:1:2",
      season: 1,
      episode: 2,
      title: "External series",
      episodeTitle: "Episode 2"
    }
  };
  assert.equal(
    await PlayerController.applyExternalPlaybackReport.call(controller, {
      handoff: episodeHandoff,
      outcome: "stopped",
      positionSeconds: 1764,
      durationSeconds: 1800
    }),
    true
  );
  assert.equal(calls[0][0], 1_764_000);
  assert.equal(calls[0][1], 1_800_000);
  assert.equal(calls[0][3], episodeHandoff.progressContext);
});

test("an Infuse position in seconds uses the saved known duration through canonical progress", async () => {
  const calls = [];
  const controller = {
    flushProgress: async (...args) => {
      calls.push(args);
      return true;
    }
  };
  const infuseHandoff = { ...handoff, knownDurationMs: 1_440_000 };
  assert.equal(
    await PlayerController.applyExternalPlaybackReport.call(controller, {
      handoff: infuseHandoff,
      outcome: "stopped",
      positionSeconds: 840,
      durationSeconds: 1440
    }),
    true
  );
  assert.deepEqual(calls[0], [
    840_000,
    1_440_000,
    false,
    infuseHandoff.progressContext,
    { externalAuthoritative: true }
  ]);
});

test("an explicit Outplayer finish completes without a reported or metadata duration", async () => {
  const calls = [];
  const controller = {
    markPlaybackWatched: async (context) => {
      calls.push(["watched", context]);
    },
    pushProgressIfDue: async (force) => {
      calls.push(["sync", force]);
    },
    acceptExternalPlaybackCompletion: (context) => {
      calls.push(["ownership", context]);
    }
  };
  assert.equal(
    await PlayerController.applyExternalPlaybackReport.call(controller, {
      handoff: { ...handoff, knownDurationMs: 3_000_000 },
      outcome: "finished"
    }),
    true
  );
  assert.deepEqual(calls, [
    ["watched", handoff.progressContext],
    ["ownership", handoff.progressContext],
    ["sync", true]
  ]);
});

test("an accepted finish report marks watched as authoritative", async () => {
  const calls = [];
  const controller = {
    markPlaybackWatched: async (...args) => {
      calls.push(args);
    },
    pushProgressIfDue: async () => {},
    acceptExternalPlaybackCompletion: () => {}
  };
  assert.equal(
    await PlayerController.applyExternalPlaybackReport.call(controller, {
      handoff,
      outcome: "finished"
    }),
    true
  );
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], [
    handoff.progressContext,
    { authoritative: true, skipTrackingWrite: false }
  ]);
});

test("a real flushProgress call forwards externalAuthoritative into watchProgressRepository.saveProgress", async () => {
  const { watchProgressRepository } =
    await import("../../data/repository/watchProgressRepository.js");
  const originalSaveProgress = watchProgressRepository.saveProgress;
  const calls = [];
  watchProgressRepository.saveProgress = async (...args) => {
    calls.push(args);
  };
  const controller = {
    shouldSuppressStaleInternalProgress: () => false,
    recordProgressSnapshot: () => {}
  };
  try {
    await PlayerController.flushProgress.call(
      controller,
      45_625,
      120_000,
      false,
      handoff.progressContext,
      { allowCloudSync: false, externalAuthoritative: true }
    );
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0][1], { authoritative: true });
  } finally {
    watchProgressRepository.saveProgress = originalSaveProgress;
  }
});

test("an ordinary (non-external) flushProgress call saves progress as non-authoritative", async () => {
  const { watchProgressRepository } =
    await import("../../data/repository/watchProgressRepository.js");
  const originalSaveProgress = watchProgressRepository.saveProgress;
  const calls = [];
  watchProgressRepository.saveProgress = async (...args) => {
    calls.push(args);
  };
  const controller = {
    shouldSuppressStaleInternalProgress: () => false,
    recordProgressSnapshot: () => {}
  };
  try {
    await PlayerController.flushProgress.call(
      controller,
      45_625,
      120_000,
      false,
      handoff.progressContext,
      { allowCloudSync: false }
    );
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0][1], { authoritative: false });
  } finally {
    watchProgressRepository.saveProgress = originalSaveProgress;
  }
});

// Handing a downloaded file to another app reports nothing back, so the manual
// prompt is the only source of progress -- and it was passing a zero duration
// whenever the runtime was unknown. A zero is "never learned", not a
// measurement, and sending it as one had the whole report refused: the viewer
// typed a position, pressed Save, and nothing was written.
test("a position sent with no known runtime is still saved", async () => {
  const calls = [];
  const controller = {
    flushProgress: async (...args) => {
      calls.push(args);
      return true;
    }
  };
  const withoutRuntime = {
    knownDurationMs: 0,
    progressContext: { itemId: "series:offline", itemType: "series", title: "Offline episode" }
  };
  assert.equal(
    await PlayerController.applyExternalPlaybackReport.call(controller, {
      handoff: withoutRuntime,
      outcome: "stopped",
      positionSeconds: 930,
      durationSeconds: null
    }),
    true
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 930_000);
  assert.equal(calls[0][1], 0);
});

test("a duration that is reported as zero is still refused, because that claims a measurement", async () => {
  const controller = { flushProgress: async () => true };
  assert.equal(
    await PlayerController.applyExternalPlaybackReport.call(controller, {
      handoff,
      outcome: "stopped",
      positionSeconds: 45,
      durationSeconds: 0
    }),
    false
  );
});
