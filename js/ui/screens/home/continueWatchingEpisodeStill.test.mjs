import assert from "node:assert/strict";
import test from "node:test";

const { resolveContinueWatchingEpisodeStill } = await import("./homeUtils.js");

// What enrichment produces for a film with no landscape still of its own:
// thumbnail falls back to the portrait poster.
const film = {
  poster: "https://img/h900_bestv2/poster.jpg",
  thumbnail: "https://img/h900_bestv2/poster.jpg",
  backdrop: "https://img/original/backdrop.jpg",
  background: "https://img/original/backdrop.jpg"
};

const episode = {
  episodeThumbnail: "https://img/still/s1e3.jpg",
  poster: "https://img/h900_bestv2/poster.jpg",
  backdrop: "https://img/original/backdrop.jpg"
};

test("a film has no episode still", () => {
  // The reported failure: with Use Episode Thumbnails on, the card led with
  // this value, and for a film it resolved to the portrait poster.
  assert.equal(resolveContinueWatchingEpisodeStill(film, false), "");
});

test("an episode uses its own still", () => {
  assert.equal(resolveContinueWatchingEpisodeStill(episode, true), "https://img/still/s1e3.jpg");
});

test("an episode with no still of its own still falls back", () => {
  assert.equal(
    resolveContinueWatchingEpisodeStill({ backdrop: "https://img/original/b.jpg" }, true),
    "https://img/original/b.jpg"
  );
});

test("a film is empty no matter how many images it carries", () => {
  assert.equal(
    resolveContinueWatchingEpisodeStill({ ...film, episodeThumbnail: film.poster }, false),
    ""
  );
});

test("an empty result lets the card fall through to its landscape art", () => {
  // uniqueNonEmptyValues drops "", so the renderer's next source wins.
  const sources = [resolveContinueWatchingEpisodeStill(film, false), film.backdrop, film.poster];
  assert.equal(sources.filter(Boolean)[0], film.backdrop);
});

test("malformed input never throws", () => {
  assert.equal(resolveContinueWatchingEpisodeStill(), "");
  assert.equal(resolveContinueWatchingEpisodeStill(null, true), "");
  assert.equal(resolveContinueWatchingEpisodeStill({}, true), "");
});
