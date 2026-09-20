import assert from "node:assert/strict";
import test from "node:test";

const { buildExternalScrobbleContext } = await import("./externalScrobbleContext.js");

const movie = { itemId: "tt1130884", itemType: "movie", title: "Shutter Island" };
const episode = {
  itemId: "tt0903747",
  itemType: "series",
  videoId: "tt0903747:1:4",
  season: 1,
  episode: 4,
  title: "Breaking Bad",
  episodeTitle: "Cancer Man"
};

test("a partial external report becomes a scrobble context with its progress", () => {
  // The reported failure: an external player's position only ever reached the
  // local store, so the tracking site never moved.
  const context = buildExternalScrobbleContext(movie, 30 * 60 * 1000, 100 * 60 * 1000);
  assert.equal(context.contentId, "tt1130884");
  assert.equal(context.contentType, "movie");
  assert.equal(context.imdbId, "tt1130884");
  assert.equal(context.progressPercent, 30);
});

test("an episode carries the season and episode the provider needs", () => {
  const context = buildExternalScrobbleContext(episode, 15 * 60 * 1000, 60 * 60 * 1000);
  assert.equal(context.contentType, "series");
  assert.equal(context.seasonNumber, 1);
  assert.equal(context.episodeNumber, 4);
  assert.equal(context.videoId, "tt0903747:1:4", "the anime id path reads this");
});

test("a series with no episode number is dropped rather than sent", () => {
  assert.equal(buildExternalScrobbleContext({ ...episode, episode: null }, 1000, 2000), null);
});

test("a report with no usable position or duration is dropped", () => {
  assert.equal(buildExternalScrobbleContext(movie, 0, 100), null);
  assert.equal(buildExternalScrobbleContext(movie, 100, 0), null);
  assert.equal(buildExternalScrobbleContext({ itemType: "movie" }, 100, 200), null);
  assert.equal(buildExternalScrobbleContext(null, 100, 200), null);
});

test("a non-imdb content id is not passed off as one", () => {
  const context = buildExternalScrobbleContext({ ...movie, itemId: "kitsu:998" }, 100, 200);
  assert.equal(context.imdbId, null);
  assert.equal(context.contentId, "kitsu:998");
});

test("progress never exceeds 100 when a player overshoots the duration", () => {
  assert.equal(buildExternalScrobbleContext(movie, 210, 200).progressPercent, 100);
});

test("a completion reported at the full duration is exactly 100 percent", () => {
  // completePlayback reports the whole duration so the provider treats it as
  // finished and drops its own resume entry.
  const context = buildExternalScrobbleContext(movie, 6180000, 6180000);
  assert.equal(context.progressPercent, 100);
  assert.equal(context.positionMs, 6180000);
});
