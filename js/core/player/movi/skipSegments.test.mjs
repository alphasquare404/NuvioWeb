import assert from "node:assert/strict";
import test from "node:test";
import {
  createSkipGuide,
  normalizeIntervals,
  resolvePlayableImdbId,
  resolveSkipIdentity,
  segmentLabel
} from "./skipSegments.js";

const INTRO = { startTime: 30, endTime: 90, type: "intro" };
const RECAP = { startTime: 5, endTime: 20, type: "recap" };

test("intervals are cleaned, coerced, and sorted", () => {
  assert.deepEqual(
    normalizeIntervals([
      { startTime: "30", endTime: "90", type: "INTRO" },
      { startTime: 5, endTime: 20 },
      { startTime: 10, endTime: 10 },
      { startTime: null, endTime: 30 },
      null,
      "nonsense"
    ]),
    [
      { startTime: 5, endTime: 20, type: "intro" },
      { startTime: 30, endTime: 90, type: "intro" }
    ]
  );
  assert.deepEqual(normalizeIntervals(null), []);
});

test("the label says which segment it is", () => {
  assert.equal(segmentLabel("intro"), "Skip intro");
  assert.equal(segmentLabel("recap"), "Skip recap");
  assert.equal(segmentLabel("outro"), "Skip outro");
  assert.equal(segmentLabel(""), "Skip intro");
});

test("the imdb id is found wherever the flow happened to put it", () => {
  assert.equal(resolvePlayableImdbId({ imdbId: "tt1234567" }), "tt1234567");
  assert.equal(resolvePlayableImdbId({ imdb_id: "tt1234567" }), "tt1234567");
  // A Cinemeta-style video id carries the episode after a colon.
  assert.equal(resolvePlayableImdbId({ videoId: "tt1234567:2:5" }), "tt1234567");
  assert.equal(resolvePlayableImdbId({ itemId: "tt1234567" }), "tt1234567");
  assert.equal(resolvePlayableImdbId({ itemId: "tmdb-1234" }), "");
  assert.equal(resolvePlayableImdbId({}), "");
  assert.equal(resolvePlayableImdbId(null), "");
});

test("skip data is asked for an episode only, exactly as the built-in player asks", () => {
  assert.deepEqual(resolveSkipIdentity({ imdbId: "tt1234567", season: 2, episode: 5 }), {
    imdbId: "tt1234567",
    season: 2,
    episode: 5
  });
  // Numbers arriving as strings from the route still work.
  assert.deepEqual(resolveSkipIdentity({ videoId: "tt1234567:1:1", season: "1", episode: "1" }), {
    imdbId: "tt1234567",
    season: 1,
    episode: 1
  });
  // A film has no season: IntroDB is not asked, and the reason says so.
  assert.equal(
    resolveSkipIdentity({ imdbId: "tt1234567", season: null, episode: null }).reason,
    "no-season"
  );
  assert.equal(
    resolveSkipIdentity({ imdbId: "tt1234567", season: 0, episode: 0 }).reason,
    "no-season"
  );
  assert.equal(resolveSkipIdentity({ imdbId: "tt1234567", season: 1 }).reason, "no-episode");
  assert.equal(resolveSkipIdentity({ season: 1, episode: 1 }).reason, "no-imdb-id");
});

test("outside every interval there is nothing to do", () => {
  const guide = createSkipGuide({ intervals: [INTRO] });
  assert.equal(guide.evaluate(0).action, "none");
  assert.equal(guide.evaluate(29.9).action, "none");
  assert.equal(guide.evaluate(90).action, "none");
  assert.equal(guide.evaluate(Number.NaN).action, "none");
});

test("inside an interval the skip is offered, however many ticks arrive", () => {
  const guide = createSkipGuide({ intervals: [INTRO] });
  for (const time of [30, 31, 45, 89]) {
    assert.equal(guide.evaluate(time).action, "prompt");
  }
  // Prompting is not "handling": the offer must survive the ticks, and only the
  // press takes it.
  guide.markHandled(INTRO);
  assert.equal(guide.evaluate(45).action, "none");
});

test("an interval the profile auto-skips is taken once, not on every tick", () => {
  const guide = createSkipGuide({ intervals: [INTRO, RECAP], autoSkipTypes: ["intro"] });

  const first = guide.evaluate(40);
  assert.equal(first.action, "auto");
  assert.equal(first.segment, INTRO);
  // The caller seeks; the next tick must not ask again.
  assert.equal(guide.evaluate(41).action, "none");
  // A different type is still offered as a prompt.
  assert.equal(guide.evaluate(10).action, "prompt");
});

test("the auto-skip list is case-insensitive and ignores junk", () => {
  const guide = createSkipGuide({
    intervals: [RECAP],
    autoSkipTypes: ["RECAP", null, 7]
  });
  assert.equal(guide.evaluate(10).action, "auto");
});

test("reset makes every segment offerable again", () => {
  const guide = createSkipGuide({ intervals: [INTRO], autoSkipTypes: ["intro"] });
  assert.equal(guide.evaluate(40).action, "auto");
  guide.reset();
  assert.equal(guide.evaluate(40).action, "auto");
});
