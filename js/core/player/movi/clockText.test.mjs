import assert from "node:assert/strict";
import test from "node:test";
import { endsAtLabel, formatWallClock } from "./clockText.js";

test("the wall clock is zero-padded, 24-hour", () => {
  assert.equal(formatWallClock(new Date(2026, 9, 20, 9, 5)), "09:05");
  assert.equal(formatWallClock(new Date(2026, 9, 20, 23, 59)), "23:59");
  assert.equal(formatWallClock(new Date(2026, 9, 20, 0, 0)), "00:00");
});

test("the end time is the clock plus what is left", () => {
  const now = new Date(2026, 9, 20, 20, 0);
  // 40 minutes left at 20:00 → 20:40.
  assert.equal(endsAtLabel(1200, 3600, now), "Ends at 20:40");
});

test("there is no end time to show when there is no end", () => {
  const now = new Date(2026, 9, 20, 20, 0);
  assert.equal(endsAtLabel(10, Number.POSITIVE_INFINITY, now), "");
  assert.equal(endsAtLabel(10, 0, now), "");
  assert.equal(endsAtLabel(10, Number.NaN, now), "");
  // Finished, or a rounding overshoot at `ended`.
  assert.equal(endsAtLabel(300, 300, now), "");
  assert.equal(endsAtLabel(301, 300, now), "");
});
