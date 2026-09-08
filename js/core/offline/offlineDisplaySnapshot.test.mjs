import test from "node:test";
import assert from "node:assert/strict";
import {
  applyOfflineDisplaySnapshot,
  createOfflineDisplaySnapshot,
  mergeOfflineDisplaySnapshot
} from "./offlineDisplaySnapshot.js";

test("normalized Series Detail metadata produces a canonical offline display snapshot", () => {
  const snapshot = createOfflineDisplaySnapshot({
    name: "The Mentalist", description: "Overview", releaseInfo: "2008–2015",
    genres: ["Drama", "Crime"], writers: ["Bruno Heller"], imdbRating: 8.2,
    runtime: 43, country: "US", language: "English", poster: "https://images.example/poster.jpg",
    background: "https://images.example/backdrop.jpg",
    episode: { title: "Red John's Friends", overview: "Episode overview", runtimeMinutes: 44, thumbnail: "https://images.example/still.jpg" }
  });
  assert.equal(snapshot.overview, "Overview");
  assert.equal(snapshot.runtimeMinutes, 43);
  assert.equal(snapshot.episode.still, "https://images.example/still.jpg");
  assert.deepEqual(snapshot.genres, ["Drama", "Crime"]);
});

test("remote empty fields do not erase useful local display fields or episode still", () => {
  const local = createOfflineDisplaySnapshot({ description: "Saved overview", genres: ["Drama"], runtime: 43, episode: { thumbnail: "still.jpg" } });
  const merged = mergeOfflineDisplaySnapshot(local, { overview: "", genres: [], episode: { still: "" } });
  assert.equal(merged.overview, "Saved overview");
  assert.deepEqual(merged.genres, ["Drama"]);
  assert.equal(merged.episode.still, "still.jpg");
  assert.equal(applyOfflineDisplaySnapshot({ name: "Title" }, merged).description, "Saved overview");
});
