import assert from "node:assert/strict";
import test from "node:test";
import { continueWatchingProgressFraction } from "./homeUtils.js";

// The number a Continue Watching card's progress bar is drawn from.
//
// Two answers to "how far along is this" used to exist, and they disagreed
// about which source wins. The badge on a card takes the position; the bar took
// a percentage the provider sent. Normally those agree, so nothing showed. They
// come apart the moment playback moves: only the position is updated, and a
// provider percentage recorded earlier survives untouched -- so the same card
// read "1m left" beside a bar drawn at ten per cent.
//
// Position is the answer whenever there is one, because it is what playback
// actually wrote. A percentage is the fallback for rows that carry no position
// at all, which is how a provider's own paused entries arrive.

// The exact shape from the report: a provider percentage left behind by a newer
// local position.
const mixed = { progressPercent: 10, positionMs: 50_000, durationMs: 100_000 };

test("a newer position beats a percentage left behind by the provider", () => {
  assert.equal(continueWatchingProgressFraction(mixed), 0.5);
});

test("the bar agrees with the badge on the same card", () => {
  // The badge is built from position over duration. The bar must land on the
  // same number, or one card states two different things at once.
  const fromBadge = mixed.positionMs / mixed.durationMs;
  assert.equal(continueWatchingProgressFraction(mixed), fromBadge);
});

// A provider's paused entry carries no position at all -- Trakt and SIMKL send
// a percentage and nothing else -- so the fallback has to stay.
test("a row with only a percentage still reports it", () => {
  assert.equal(continueWatchingProgressFraction({ progressPercent: 42 }), 0.42);
  assert.equal(
    continueWatchingProgressFraction({ progressPercent: 42, positionMs: 0, durationMs: 0 }),
    0.42
  );
});

test("an ordinary local row reports its position", () => {
  assert.equal(continueWatchingProgressFraction({ positionMs: 30_000, durationMs: 120_000 }), 0.25);
});

test("a fraction never leaves 0..1", () => {
  assert.equal(continueWatchingProgressFraction({ progressPercent: 140 }), 1);
  assert.equal(continueWatchingProgressFraction({ progressPercent: -10 }), 0);
  assert.equal(continueWatchingProgressFraction({ positionMs: 200_000, durationMs: 100_000 }), 1);
});

test("nothing to go on is zero rather than a guess", () => {
  assert.equal(continueWatchingProgressFraction({}), 0);
  assert.equal(continueWatchingProgressFraction(), 0);
  assert.equal(continueWatchingProgressFraction({ positionMs: 0, durationMs: 0 }), 0);
});

// A duration with no position is not progress; it is a known runtime.
test("a duration alone is not progress", () => {
  assert.equal(continueWatchingProgressFraction({ durationMs: 100_000 }), 0);
});
