import assert from "node:assert/strict";
import test from "node:test";

const { patchContinueWatchingDisplayProgress } = await import("./continueWatchingProgressPatch.js");

test("patches positionMs/durationMs on the matching displayed movie", () => {
  const display = [
    {
      contentId: "tt1",
      videoId: null,
      season: null,
      episode: null,
      positionMs: 1000,
      durationMs: 9000,
      title: "A"
    },
    {
      contentId: "tt2",
      videoId: null,
      season: null,
      episode: null,
      positionMs: 2000,
      durationMs: 9000,
      title: "B"
    }
  ];
  const result = patchContinueWatchingDisplayProgress(display, {
    contentId: "tt2",
    videoId: null,
    season: null,
    episode: null,
    positionMs: 5000,
    durationMs: 9000
  });
  assert.notEqual(result, null);
  assert.equal(result[0].positionMs, 1000, "unrelated item is untouched");
  assert.equal(result[1].positionMs, 5000);
  assert.equal(result[1].durationMs, 9000);
  assert.equal(result[1].title, "B", "other fields on the matched item are preserved");
  assert.notEqual(result, display, "returns a new array, does not mutate the input");
});

test("matches a series item by contentId + season + episode, not just contentId", () => {
  const display = [
    {
      contentId: "series1",
      videoId: null,
      season: 1,
      episode: 2,
      positionMs: 1000,
      durationMs: 9000
    },
    {
      contentId: "series1",
      videoId: null,
      season: 1,
      episode: 3,
      positionMs: 500,
      durationMs: 9000
    }
  ];
  const result = patchContinueWatchingDisplayProgress(display, {
    contentId: "series1",
    videoId: null,
    season: 1,
    episode: 3,
    positionMs: 4000,
    durationMs: 9000
  });
  assert.equal(result[0].positionMs, 1000);
  assert.equal(result[1].positionMs, 4000);
});

test("returns null when the item is not currently displayed (falls back to full refresh)", () => {
  const display = [
    {
      contentId: "tt1",
      videoId: null,
      season: null,
      episode: null,
      positionMs: 1000,
      durationMs: 9000
    }
  ];
  const result = patchContinueWatchingDisplayProgress(display, {
    contentId: "tt-not-shown",
    videoId: null,
    season: null,
    episode: null,
    positionMs: 4000,
    durationMs: 9000
  });
  assert.equal(result, null);
});

test("returns null for an empty or missing display list", () => {
  assert.equal(
    patchContinueWatchingDisplayProgress([], { contentId: "tt1", positionMs: 1, durationMs: 2 }),
    null
  );
  assert.equal(
    patchContinueWatchingDisplayProgress(null, { contentId: "tt1", positionMs: 1, durationMs: 2 }),
    null
  );
});

test("returns null when the progress item has no contentId", () => {
  const display = [{ contentId: "tt1", positionMs: 1000, durationMs: 9000 }];
  assert.equal(
    patchContinueWatchingDisplayProgress(display, { positionMs: 1, durationMs: 2 }),
    null
  );
});
