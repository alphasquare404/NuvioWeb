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

test("offline, the snapshot does not hand back a logo that cannot be fetched", () => {
  // The remembered logo is a remote URL. With no connection it drew a broken
  // image box above the title -- worse than the plain text it replaced.
  const snapshot = { logo: "https://images.example/logo.png", title: "The Wire" };

  const online = applyOfflineDisplaySnapshot({ logo: null }, snapshot);
  assert.equal(online.logo, "https://images.example/logo.png");

  const offline = applyOfflineDisplaySnapshot({ logo: null }, snapshot, { allowRemoteArtwork: false });
  assert.equal(offline.logo, null);

  // A logo already resolved to a local copy survives either way.
  const local = applyOfflineDisplaySnapshot({ logo: "blob:local-logo" }, snapshot, { allowRemoteArtwork: false });
  assert.equal(local.logo, "blob:local-logo");
});
