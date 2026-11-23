import assert from "node:assert/strict";
import test from "node:test";

import {
  mergeNextUpItemsIntoDisplay,
  splitNextUpCandidates
} from "./nextUpProgressiveResolution.js";

const candidate = (contentId, updatedAt = 0) => ({
  contentId,
  contentType: "series",
  season: 1,
  episode: 2,
  updatedAt
});

const nextUp = (contentId, updatedAt = 0) => ({
  ...candidate(contentId, updatedAt),
  isNextUp: true
});

test("the first batch paints and the rest stay pending", () => {
  const candidates = Array.from({ length: 100 }, (_, index) => candidate(`tt${index}`, index));
  const { initial, pending } = splitNextUpCandidates(candidates, 32);
  assert.equal(initial.length, 32);
  assert.equal(pending.length, 68);
  assert.equal(initial[0].contentId, "tt0");
  assert.equal(pending[0].contentId, "tt32");
});

test("no candidates leaves both sides empty", () => {
  assert.deepEqual(splitNextUpCandidates(null, 32), { initial: [], pending: [] });
  assert.deepEqual(splitNextUpCandidates([], 0), { initial: [], pending: [] });
});

test("an older Next Up card is appended to the displayed row", () => {
  const display = [nextUp("tt-new", 200), nextUp("tt-mid", 100)];
  const merged = mergeNextUpItemsIntoDisplay(display, [nextUp("tt-old", 50)], {
    sort: (items) => items.slice().sort((a, b) => b.updatedAt - a.updatedAt),
    maxItems: 300
  });
  assert.equal(merged.added, 1);
  assert.deepEqual(
    merged.items.map((item) => item.contentId),
    ["tt-new", "tt-mid", "tt-old"]
  );
});

test("a show that already has a progress card gets no Next Up duplicate", () => {
  const display = [{ contentId: "tt-show", contentType: "series", season: 1, episode: 3 }];
  const merged = mergeNextUpItemsIntoDisplay(display, [nextUp("tt-show", 10)], {
    maxItems: 300
  });
  assert.equal(merged.added, 0);
  assert.equal(merged.items.length, 1);
});

test("only one Next Up card per show is added", () => {
  const merged = mergeNextUpItemsIntoDisplay([], [nextUp("tt-show", 1), nextUp("tt-show", 2)], {
    maxItems: 300
  });
  assert.equal(merged.added, 1);
  assert.equal(merged.items.length, 1);
});

test("non Next Up items and rows without an id are ignored", () => {
  const merged = mergeNextUpItemsIntoDisplay(
    [],
    [{ contentId: "tt-progress" }, nextUp(""), null, nextUp("tt-good", 1)],
    { maxItems: 300 }
  );
  assert.equal(merged.added, 1);
  assert.equal(merged.items[0].contentId, "tt-good");
});

test("the merged row is bounded by the visible-row maximum", () => {
  const display = Array.from({ length: 299 }, (_, index) => nextUp(`tt-a${index}`, index));
  const merged = mergeNextUpItemsIntoDisplay(display, [nextUp("tt-extra", 0)], {
    maxItems: 300
  });
  assert.equal(merged.items.length, 300);
  assert.equal(merged.added, 1);
});
