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

const { parseMdbListUserLists, parseMdbListWatchlist } = await import("./mdbListLibraryService.js");

test("MDBList watchlist maps movie and show rows into Library entries", () => {
  const entries = parseMdbListWatchlist([
    {
      id: 101,
      imdb_id: "tt101",
      title: "Movie",
      release_year: 2024,
      mediatype: "movie",
      poster: "/poster.jpg",
      backdrop: "https://example.com/backdrop.jpg",
      description: "Synopsis",
      genres: ["Action", { name: "Drama" }],
      added_at: "2026-09-01T12:00:00Z"
    },
    {
      id: 202,
      title: "Series",
      release_year: 2023,
      mediatype: "show",
      ids: { imdb: "tt202", tmdb: 202 }
    }
  ]);
  assert.equal(entries.length, 2);
  assert.deepEqual(
    {
      id: entries[0].id,
      type: entries[0].type,
      name: entries[0].name,
      poster: entries[0].poster,
      genres: entries[0].genres,
      listKeys: entries[0].listKeys,
      imdbId: entries[0].imdbId
    },
    {
      id: "tt101",
      type: "movie",
      name: "Movie",
      poster: "https://image.tmdb.org/t/p/w500/poster.jpg",
      genres: ["Action", "Drama"],
      listKeys: ["watchlist"],
      imdbId: "tt101"
    }
  );
  assert.equal(entries[0].listMeta.watchlist.traktRank, null);
  assert.equal(entries[1].id, "tt202");
  assert.equal(entries[1].type, "series");
  assert.equal(entries[1].tmdbId, 202);
});

test("MDBList user lists keep static personal lists and their tab keys", () => {
  const lists = parseMdbListUserLists({
    lists: [
      {
        id: 9,
        name: "Best of 2026",
        type: "static",
        private: true,
        description: "Kept",
        updated_at: "2026-09-01T12:00:00Z"
      },
      { id: 10, name: "Dynamic", type: "dynamic" },
      { id: 11, name: "No name" }
    ]
  });
  assert.equal(lists.length, 2);
  assert.equal(lists[0].key, "list:9");
  assert.equal(lists[0].title, "Best of 2026");
  assert.equal(lists[0].type, "personal");
  assert.equal(lists[0].privacy, "private");
  assert.equal(lists[1].key, "list:11");
});

test("MDBList watchlist accepts object pages and drops rows without external ids", () => {
  const entries = parseMdbListWatchlist({
    movies: [{ id: 303, title: "Only TMDB", mediatype: "movie" }],
    shows: [{ id: 404, title: "Broken", mediatype: "show" }, { title: "No ids" }]
  });
  assert.equal(entries.length, 2);
  assert.equal(entries[0].id, "tmdb:303");
  assert.equal(entries[1].id, "tmdb:404");
});
