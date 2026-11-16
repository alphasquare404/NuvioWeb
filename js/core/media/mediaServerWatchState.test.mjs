import assert from "node:assert/strict";
import test from "node:test";

const values = new Map();
globalThis.localStorage = {
  getItem: (key) => values.get(key) || null,
  setItem: (key, value) => values.set(key, String(value)),
  removeItem: (key) => values.delete(key),
  clear: () => values.clear()
};

const { WatchProgressStore } = await import("../../data/local/watchProgressStore.js");
const { WatchedItemsStore } = await import("../../data/local/watchedItemsStore.js");
const { projectServerWatchState } = await import("./mediaServerWatchState.js");

const SERVER = {
  id: "media:jellyfin:https://jelly.example.test:user-1",
  kind: "jellyfin",
  importWatchState: true
};
const META = {
  id: "server:media%3Ajellyfin%3Ahttps%3A%2F%2Fjelly.example.test%3Auser-1:series-1",
  type: "series",
  name: "The Show",
  poster: "https://img/poster.jpg"
};
const NOW = Date.parse("2026-11-16T10:00:00Z");

function episode(season, number, { played = false, position = 0, duration = 0, at = NOW } = {}) {
  return {
    Id: `ep-${season}-${number}`,
    ParentIndexNumber: season,
    IndexNumber: number,
    Name: `Episode ${number}`,
    RunTimeTicks: duration * 10000000,
    UserData: {
      Played: played,
      PlaybackPositionTicks: position * 10000000,
      LastPlayedDate: new Date(at).toISOString()
    }
  };
}

test("importing server state writes progress for the episode the server is on", () => {
  values.clear();
  projectServerWatchState({
    server: SERVER,
    meta: META,
    items: [episode(1, 1, { position: 600, duration: 1800 }), episode(1, 2)]
  });
  const rows = WatchProgressStore.listForProfile("1");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].contentId, META.id);
  assert.equal(rows[0].season, 1);
  assert.equal(rows[0].episode, 1);
  assert.equal(rows[0].positionMs, 600_000);
  assert.equal(rows[0].source, "media_server");
});

test("a finished episode becomes watched, an older server position does not win", () => {
  values.clear();
  WatchProgressStore.upsert(
    {
      contentId: META.id,
      contentType: "series",
      season: 2,
      episode: 1,
      positionMs: 900_000,
      durationMs: 1_800_000,
      updatedAt: NOW + 60_000
    },
    "1"
  );
  projectServerWatchState({
    server: SERVER,
    meta: META,
    items: [
      episode(2, 1, { position: 100, duration: 1800, at: NOW }),
      episode(2, 2, { played: true, at: NOW })
    ]
  });
  const rows = WatchProgressStore.listForProfile("1");
  const e1 = rows.find((row) => row.episode === 1);
  assert.equal(e1.positionMs, 900_000, "a newer local position is kept");
  const watched = WatchedItemsStore.listForProfile("1");
  assert.equal(watched.length, 1);
  assert.equal(watched[0].episode, 2);
});

test("importing is opt-in", () => {
  values.clear();
  projectServerWatchState({
    server: { ...SERVER, importWatchState: false },
    meta: META,
    items: [episode(1, 1, { played: true })]
  });
  assert.equal(WatchProgressStore.listForProfile("1").length, 0);
  assert.equal(WatchedItemsStore.listForProfile("1").length, 0);
});

test("catalog-metadata identities are left to the tracker", () => {
  values.clear();
  projectServerWatchState({
    server: SERVER,
    meta: { ...META, id: "tt1234567" },
    items: [episode(1, 1, { played: true })]
  });
  assert.equal(WatchedItemsStore.listForProfile("1").length, 0);
});
