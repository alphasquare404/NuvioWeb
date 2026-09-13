import assert from "node:assert/strict";
import test from "node:test";
import {
  parseExternalPlaybackPositionParts,
  validateExternalPlaybackPositionParts
} from "./browserExternalPlaybackTime.js";

const durationMs = 1_440_000;

test("manual external position accepts sparse HH/MM/SS input with exact milliseconds", () => {
  assert.equal(parseExternalPlaybackPositionParts("", "14", "", durationMs), 840_000);
  assert.equal(parseExternalPlaybackPositionParts("", "7", "40", durationMs), 460_000);
  assert.equal(840_000 / durationMs, 0.5833333333333334);
  assert.equal(460_000 / durationMs, 0.3194444444444444);
});

test("manual external position rejects invalid fields, out-of-range parts, and zero", () => {
  assert.equal(parseExternalPlaybackPositionParts("", "60", "", durationMs), null);
  assert.equal(parseExternalPlaybackPositionParts("", "", "60", durationMs), null);
  assert.equal(parseExternalPlaybackPositionParts("", "25", "", durationMs), null);
  assert.equal(validateExternalPlaybackPositionParts("", "", "", durationMs).valid, false);
  assert.equal(validateExternalPlaybackPositionParts("", "14", "", durationMs).valid, true);
});
