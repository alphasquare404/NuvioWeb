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

const { removeContinueWatchingDisplayItem } = await import("./continueWatchingProgressPatch.js");

const shown = [
  { contentId: "tt1", videoId: null, season: null, episode: null, title: "Film" },
  { contentId: "tt2", videoId: "tt2:1:3", season: 1, episode: 3, title: "Episode" }
];

test("a finished film leaves the row immediately", () => {
  // A completion removes its progress row rather than updating it, and under a
  // tracking provider the card cannot go until the network answers -- long
  // enough that a finished title visibly lingered.
  const next = removeContinueWatchingDisplayItem(shown, { contentId: "tt1" });
  assert.equal(next.length, 1);
  assert.equal(next[0].contentId, "tt2");
});

test("a finished episode only removes that episode", () => {
  const next = removeContinueWatchingDisplayItem(shown, {
    contentId: "tt2",
    videoId: "tt2:1:3",
    season: 1,
    episode: 3
  });
  assert.deepEqual(
    next.map((i) => i.contentId),
    ["tt1"]
  );
});

test("a different episode of the same show is left alone", () => {
  assert.equal(
    removeContinueWatchingDisplayItem(shown, {
      contentId: "tt2",
      videoId: "tt2:1:4",
      season: 1,
      episode: 4
    }),
    null
  );
});

test("nothing displayed to remove yields null, so the caller falls back", () => {
  assert.equal(removeContinueWatchingDisplayItem(shown, { contentId: "tt9" }), null);
  assert.equal(removeContinueWatchingDisplayItem([], { contentId: "tt1" }), null);
  assert.equal(removeContinueWatchingDisplayItem(shown, {}), null);
  assert.equal(removeContinueWatchingDisplayItem(null, { contentId: "tt1" }), null);
});

test("the original list is never mutated", () => {
  const before = shown.length;
  removeContinueWatchingDisplayItem(shown, { contentId: "tt1" });
  assert.equal(shown.length, before);
});

test("a film matches however each side spells it", () => {
  // The provider hands a film its own title id as the video id and zeros for
  // season and episode; playback here writes null for all three. Compared
  // literally they never matched, so a film's card never took the fast path.
  const providerCard = [
    {
      contentId: "tt28014327",
      videoId: "tt28014327",
      season: 0,
      episode: 0,
      positionMs: 0,
      durationMs: 0
    }
  ];
  const localWrite = {
    contentId: "tt28014327",
    videoId: null,
    season: null,
    episode: null,
    positionMs: 90000,
    durationMs: 6624928
  };
  const patched = patchContinueWatchingDisplayProgress(providerCard, localWrite);
  assert.equal(patched[0].positionMs, 90000);
});

test("a film with no video id on either side still matches", () => {
  const card = [{ contentId: "tt27165187", videoId: null, season: 0, episode: 0 }];
  const write = {
    contentId: "tt27165187",
    videoId: null,
    season: null,
    episode: null,
    positionMs: 60000,
    durationMs: 5984672
  };
  assert.equal(patchContinueWatchingDisplayProgress(card, write)[0].positionMs, 60000);
});

test("a finished film is removed however it is spelled", () => {
  const card = [{ contentId: "tt28014327", videoId: "tt28014327", season: 0, episode: 0 }];
  assert.deepEqual(
    removeContinueWatchingDisplayItem(card, {
      contentId: "tt28014327",
      videoId: null,
      season: null,
      episode: null
    }),
    []
  );
});

test("a specials episode is still its own entry", () => {
  // Season zero is a real season; only a zero episode means "not an episode".
  const card = [
    { contentId: "tt2", videoId: "tt2:0:3", season: 0, episode: 3 },
    { contentId: "tt2", videoId: "tt2:1:3", season: 1, episode: 3 }
  ];
  const next = patchContinueWatchingDisplayProgress(card, {
    contentId: "tt2",
    videoId: "tt2:0:3",
    season: 0,
    episode: 3,
    positionMs: 1000,
    durationMs: 2000
  });
  assert.equal(next[0].positionMs, 1000);
  assert.equal(next[1].positionMs, undefined);
});

test("a film never collapses into an episode of the same title", () => {
  const card = [{ contentId: "tt2", videoId: "tt2:1:3", season: 1, episode: 3 }];
  assert.equal(
    patchContinueWatchingDisplayProgress(card, {
      contentId: "tt2",
      videoId: null,
      season: null,
      episode: null
    }),
    null
  );
});
