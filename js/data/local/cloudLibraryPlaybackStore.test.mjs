import assert from "node:assert/strict";
import test from "node:test";

const values = new Map();
globalThis.localStorage = {
  getItem: (key) => values.get(key) || null,
  setItem: (key, value) => values.set(key, String(value)),
  removeItem: (key) => values.delete(key),
  clear: () => values.clear()
};

const { CloudLibraryPlaybackSessionStore, CloudLibraryPlaybackProgressStore } =
  await import("./cloudLibraryPlaybackStore.js");

const SESSION = {
  token: "server:item-1:file-1",
  itemKey: "server:item-1",
  fileKey: "file-1",
  itemName: "The Movie",
  fileName: "The.Movie.2024.mkv",
  providerId: "jellyfin-1",
  providerName: "Jellyfin",
  libraryId: "srv-1",
  itemType: "movie",
  itemId: "item-1",
  poster: "https://image/poster.jpg",
  fileId: "file-1",
  fileSizeBytes: 1234
};

test("a playable session survives so Continue Watching can resolve it later", () => {
  values.clear();
  CloudLibraryPlaybackSessionStore.start(SESSION);
  const session = CloudLibraryPlaybackSessionStore.get(SESSION.token);
  assert.equal(session.itemKey, SESSION.itemKey);
  assert.equal(session.providerId, SESSION.providerId);
  assert.equal(session.fileId, SESSION.fileId);
  assert.equal(session.poster, SESSION.poster);
});

test("progress records the display fields Continue Watching needs", () => {
  values.clear();
  CloudLibraryPlaybackSessionStore.start(SESSION);
  CloudLibraryPlaybackProgressStore.record(SESSION.token, {
    positionMs: 65_000,
    durationMs: 7_200_000
  });
  const entry = CloudLibraryPlaybackProgressStore.findForContinueWatching(SESSION.itemKey);
  assert.equal(entry.contentType, "cloud");
  assert.equal(entry.title, SESSION.itemName);
  assert.equal(entry.poster, SESSION.poster);
  assert.equal(entry.positionMs, 65_000);
  assert.equal(entry.durationMs, 7_200_000);
  assert.equal(entry.completed, false);
  assert.equal(CloudLibraryPlaybackProgressStore.list().length, 1);
});

test("a completed cloud play is marked complete and keeps its session id", () => {
  values.clear();
  CloudLibraryPlaybackSessionStore.start(SESSION);
  CloudLibraryPlaybackProgressStore.record(SESSION.token, {
    positionMs: 7_200_000,
    durationMs: 7_200_000,
    completed: true
  });
  const entry = CloudLibraryPlaybackProgressStore.findForContinueWatching(SESSION.itemKey);
  assert.equal(entry.completed, true);
  assert.equal(entry.videoId, SESSION.token);
});

test("an unknown session cannot record progress", () => {
  values.clear();
  const entry = CloudLibraryPlaybackProgressStore.record("missing-token", {
    positionMs: 1000,
    durationMs: 2000
  });
  assert.equal(entry, null);
  assert.equal(CloudLibraryPlaybackProgressStore.list().length, 0);
});

test("progress and sessions are stored per profile", async () => {
  values.clear();
  const { ProfileManager } = await import("../../core/profile/profileManager.js");
  const original = ProfileManager.getActiveProfileId;
  try {
    ProfileManager.getActiveProfileId = () => "1";
    CloudLibraryPlaybackSessionStore.start(SESSION);
    CloudLibraryPlaybackProgressStore.record(SESSION.token, {
      positionMs: 1000,
      durationMs: 2000
    });
    assert.equal(CloudLibraryPlaybackProgressStore.list().length, 1);
    ProfileManager.getActiveProfileId = () => "2";
    assert.equal(CloudLibraryPlaybackProgressStore.list().length, 0);
    ProfileManager.getActiveProfileId = () => "1";
    assert.equal(CloudLibraryPlaybackProgressStore.list().length, 1);
  } finally {
    ProfileManager.getActiveProfileId = original;
    values.clear();
  }
});
