import assert from "node:assert/strict";
import test from "node:test";

const memory = new Map();
globalThis.localStorage = {
  getItem(key) {
    return memory.has(key) ? memory.get(key) : null;
  },
  setItem(key, value) {
    memory.set(key, String(value));
  },
  removeItem(key) {
    memory.delete(key);
  },
  clear() {
    memory.clear();
  }
};

const { buildMdbListHistoryPayload, parseMdbListPlayback, parseMdbListWatched } =
  await import("./mdbListSyncService.js");

test("MDBList playback maps movie progress and poster-shaped ids", () => {
  const items = parseMdbListPlayback([
    {
      id: 7,
      type: "movie",
      progress: 42.25,
      runtime: 100,
      paused_at: "2026-09-01T12:00:00Z",
      movie: { title: "Movie", year: 2024, ids: { imdb: "tt123", tmdb: 1, trakt: 2 } }
    }
  ]);
  assert.equal(items.length, 1);
  assert.equal(items[0].contentId, "tt123");
  assert.equal(items[0].contentType, "movie");
  assert.equal(items[0].source, "mdblist_playback");
  assert.equal(items[0].progressPercent, 42.25);
  assert.equal(items[0].durationMs, 6_000_000);
  assert.equal(items[0].positionMs, 2_535_000);
  assert.deepEqual(items[0].mdbListScrobbleBody, {
    movie: { ids: { imdb: "tt123", tmdb: 1, trakt: 2 } }
  });
});

test("MDBList playback keeps episode coordinates and show identity", () => {
  const items = parseMdbListPlayback([
    {
      id: 8,
      type: "episode",
      progress: 30,
      runtime: 45,
      updated_at: "2026-09-01T12:00:00Z",
      show: { title: "Series", year: 2023, ids: { imdb: "tt999", tmdb: 50 } },
      episode: {
        season: 2,
        number: 3,
        title: "Third",
        ids: { tmdb: 500, tvdb: 600 }
      }
    }
  ]);
  assert.equal(items[0].contentId, "tt999");
  assert.equal(items[0].contentType, "series");
  assert.equal(items[0].season, 2);
  assert.equal(items[0].episode, 3);
  assert.equal(items[0].videoId, "tmdb:500");
  assert.deepEqual(items[0].mdbListScrobbleBody, {
    show: { ids: { imdb: "tt999", tmdb: 50 }, season: 2, episode: 3 }
  });
});

test("MDBList playback keeps a real 1% session that the app-wide start threshold would drop", () => {
  const items = parseMdbListPlayback([
    {
      id: 9,
      type: "movie",
      progress: 1,
      paused_at: "2026-10-20T12:00:00Z",
      movie: { title: "Barely Started", ids: { imdb: "tt100" } }
    }
  ]);
  assert.equal(items.length, 1);
  assert.equal(items[0].contentId, "tt100");
  assert.equal(items[0].progressPercent, 1);
});

test("MDBList playback drops stale, complete, malformed, and untimestamped rows", () => {
  const items = parseMdbListPlayback([
    { type: "movie", progress: 0, paused_at: "2026-09-01T12:00:00Z", movie: { ids: { tmdb: 1 } } },
    {
      type: "movie",
      progress: 100,
      paused_at: "2026-09-01T12:00:00Z",
      movie: { ids: { tmdb: 2 } }
    },
    { type: "movie", progress: 50, movie: { ids: { tmdb: 3 } } },
    {
      type: "episode",
      progress: 50,
      paused_at: "2026-09-01T12:00:00Z",
      show: { ids: { tmdb: 4 } },
      episode: { number: 1 }
    }
  ]);
  assert.deepEqual(items, []);
});

test("MDBList watched writes use ids and dated movie entries", () => {
  const payload = buildMdbListHistoryPayload(
    {
      contentId: "tt123",
      contentType: "movie",
      title: "Movie",
      year: 2024,
      watchedAt: Date.UTC(2026, 8, 1, 12)
    },
    { remove: false }
  );
  assert.deepEqual(payload, {
    movies: [
      {
        ids: { imdb: "tt123" },
        title: "Movie",
        year: 2024,
        watched_at: "2026-09-01T12:00:00.000Z"
      }
    ]
  });
  const removal = buildMdbListHistoryPayload(
    { contentId: "tt123", contentType: "movie" },
    { remove: true }
  );
  assert.equal("watched_at" in removal.movies[0], false);
});

test("MDBList watched writes can address an episode by its own ids", () => {
  const payload = buildMdbListHistoryPayload({
    contentId: "tt999",
    contentType: "series",
    season: 2,
    episode: 3,
    episodeTmdbId: 500,
    episodeTvdbId: 600,
    watchedAt: Date.UTC(2026, 8, 1, 12)
  });
  assert.deepEqual(payload, {
    episodes: [
      {
        ids: { tmdb: 500, tvdb: 600 },
        watched_at: "2026-09-01T12:00:00.000Z"
      }
    ]
  });
});

test("MDBList watched writes fall back to show season coordinates", () => {
  const payload = buildMdbListHistoryPayload({
    contentId: "tt999",
    contentType: "series",
    season: 2,
    episode: 3,
    watchedAt: Date.UTC(2026, 8, 1, 12)
  });
  assert.deepEqual(payload, {
    shows: [
      {
        ids: { imdb: "tt999" },
        seasons: [
          {
            number: 2,
            episodes: [{ number: 3, watched_at: "2026-09-01T12:00:00.000Z" }]
          }
        ]
      }
    ]
  });
});

test("MDBList watched maps movies, episodes, and show episode seeds", () => {
  const result = parseMdbListWatched({
    movies: [{ watched_at: "2026-09-01T12:00:00Z", movie: { title: "Movie", ids: { tmdb: 1 } } }],
    episodes: [
      {
        watched_at: "2026-09-01T12:00:00Z",
        episode: {
          season: 2,
          number: 3,
          name: "Third",
          ids: { tmdb: 500 },
          show: { title: "Series", ids: { imdb: "tt1234", tmdb: 50 } }
        }
      }
    ],
    shows: [
      {
        watched_at: "2026-09-01T12:00:00Z",
        show: { title: "Series", ids: { imdb: "tt1234", tmdb: 50 } },
        seasons: [
          {
            number: 1,
            episodes: [{ number: 4, watched_at: "2026-09-01T12:00:00Z" }]
          }
        ]
      }
    ]
  });
  assert.equal(result.historyItems.length, 2);
  assert.equal(
    result.historyItems.find((item) => item.contentId === "tmdb:1").contentType,
    "movie"
  );
  assert.equal(result.historyItems.find((item) => item.season === 2).videoId, "tmdb:500");
  assert.equal(result.watchedShowSeedItems.length, 1);
  assert.equal(result.watchedShowSeedItems[0].videoId, "tt1234:s1e4");
  assert.equal(result.watchedShowSeedItems[0].progressPercent, 100);
});
