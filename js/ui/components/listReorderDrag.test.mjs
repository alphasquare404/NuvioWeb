import assert from "node:assert/strict";
import test from "node:test";

import { nearestRowIndex } from "./listReorderDrag.js";

// Four rows 60 tall with 10 of gap: centres at 30, 100, 170, 240.
const CENTRES = [30, 100, 170, 240];

test("a pointer inside a row asks for that row", () => {
  assert.equal(nearestRowIndex(CENTRES, 30), 0);
  assert.equal(nearestRowIndex(CENTRES, 55), 0);
  assert.equal(nearestRowIndex(CENTRES, 170), 2);
});

// The reported fault. Asking which row contains the pointer leaves the gaps
// with no answer, and the drag stopped responding there.
test("a pointer in the gap between two rows still asks for one", () => {
  assert.equal(nearestRowIndex(CENTRES, 62), 0, "nearer the row above");
  assert.equal(nearestRowIndex(CENTRES, 68), 1, "nearer the row below");
});

// Above the first and below the last is where a person aims when moving a row
// to an end, and it is exactly where containment has nothing to offer.
test("past either end asks for the end", () => {
  assert.equal(nearestRowIndex(CENTRES, -500), 0);
  assert.equal(nearestRowIndex(CENTRES, 5000), 3);
});

// Held exactly between two rows, the answer must not oscillate.
test("a tie settles on the earlier row rather than flickering", () => {
  assert.equal(nearestRowIndex(CENTRES, 65), 0);
  assert.equal(nearestRowIndex(CENTRES, 65), 0);
});

test("an empty list asks for nothing rather than for row zero", () => {
  assert.equal(nearestRowIndex([], 100), -1);
  assert.equal(nearestRowIndex(undefined, 100), -1);
});
