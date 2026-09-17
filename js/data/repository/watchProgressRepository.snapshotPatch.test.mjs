import assert from "node:assert/strict";
import test from "node:test";

const values = new Map();
globalThis.localStorage = {
  getItem: (key) => values.get(key) || null,
  setItem: (key, value) => values.set(key, value),
  removeItem: (key) => values.delete(key),
  clear: () => values.clear()
};

const { watchProgressRepository } = await import("./watchProgressRepository.js");

const SNAPSHOT_KEY = "homeContinueWatchingDisplaySnapshot";
const SCOPE_KEY = "1:nuvio_sync";

function seedSnapshot(items) {
  values.set(
    SNAPSHOT_KEY,
    JSON.stringify({ [SCOPE_KEY]: { savedAt: Date.now(), items } })
  );
}

function readSnapshotScope() {
  const raw = values.get(SNAPSHOT_KEY);
  const parsed = raw ? JSON.parse(raw) : {};
  return parsed[SCOPE_KEY] || null;
}

test("saveProgress() patches position/duration in place for an item already in the snapshot", async () => {
  values.clear();
  seedSnapshot([
    { contentId: "tt-shown", videoId: null, season: null, episode: null, positionMs: 1000, durationMs: 9000, title: "Shown" },
    { contentId: "tt-other", videoId: null, season: null, episode: null, positionMs: 2000, durationMs: 9000, title: "Other" }
  ]);
  try {
    await watchProgressRepository.saveProgress({
      contentId: "tt-shown",
      contentType: "movie",
      positionMs: 5000,
      durationMs: 9000
    });
    const scope = readSnapshotScope();
    assert.notEqual(scope, null, "the scope's snapshot entry must survive, not be deleted");
    const patched = scope.items.find((item) => item.contentId === "tt-shown");
    const untouched = scope.items.find((item) => item.contentId === "tt-other");
    assert.equal(patched.positionMs, 5000);
    assert.equal(untouched.positionMs, 2000, "an unrelated item in the same snapshot is left alone");
  } finally {
    values.clear();
  }
});

test("saveProgress() leaves the snapshot untouched for an item not already in it", async () => {
  values.clear();
  seedSnapshot([
    { contentId: "tt-shown", videoId: null, season: null, episode: null, positionMs: 1000, durationMs: 9000, title: "Shown" }
  ]);
  try {
    await watchProgressRepository.saveProgress({
      contentId: "tt-new",
      contentType: "movie",
      positionMs: 1000,
      durationMs: 9000
    });
    const scope = readSnapshotScope();
    assert.notEqual(scope, null, "an unrelated write must not wipe the existing snapshot");
    assert.equal(scope.items.length, 1);
    assert.equal(scope.items[0].contentId, "tt-shown", "the existing card is preserved as-is");
  } finally {
    values.clear();
  }
});

test("saveProgress() is a no-op on the snapshot when no snapshot exists yet for the scope", async () => {
  values.clear();
  try {
    await watchProgressRepository.saveProgress({
      contentId: "tt-cold-start",
      contentType: "movie",
      positionMs: 1000,
      durationMs: 9000
    });
    assert.equal(readSnapshotScope(), null);
  } finally {
    values.clear();
  }
});
