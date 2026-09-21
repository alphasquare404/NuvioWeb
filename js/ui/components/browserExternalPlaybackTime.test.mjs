import assert from "node:assert/strict";
import test from "node:test";
import {
  externalPlaybackReportDurationSeconds,
  formatExternalPlaybackDuration,
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

// The manual prompt is the only way a document handoff ever records progress,
// and it was sending knownDurationMs straight through. When the runtime was
// never learned that is a zero, which reads as a claimed measurement of nothing
// and had the report refused -- Save appeared to do nothing at all.
test("an unknown runtime is reported as absent, not as a zero-length measurement", () => {
  assert.equal(externalPlaybackReportDurationSeconds(0), null);
  assert.equal(externalPlaybackReportDurationSeconds(null), null);
  assert.equal(externalPlaybackReportDurationSeconds(undefined), null);
  assert.equal(externalPlaybackReportDurationSeconds("not a number"), null);
  assert.equal(externalPlaybackReportDurationSeconds(-5), null);
});

test("a known runtime is reported in seconds", () => {
  assert.equal(externalPlaybackReportDurationSeconds(3_540_000), 3540);
  assert.equal(externalPlaybackReportDurationSeconds(1500), 1.5);
});

// The label sits directly above HH/MM/SS entry fields. Printed as minutes and
// seconds, a 138-minute film read "138:05" while the fields wanted 02:18:05 --
// which nothing on screen said. Episodes hid this: "45:30" reads fine either way.
test("an hour or more is shown the way the fields have to be filled", () => {
  assert.equal(formatExternalPlaybackDuration(8_285_000), "2:18:05");
  assert.equal(formatExternalPlaybackDuration(3_600_000), "1:00:00");
  assert.equal(formatExternalPlaybackDuration(3_661_000), "1:01:01");
});

test("under an hour stays minutes and seconds", () => {
  assert.equal(formatExternalPlaybackDuration(2_730_000), "45:30");
  assert.equal(formatExternalPlaybackDuration(65_000), "1:05");
  assert.equal(formatExternalPlaybackDuration(3_599_000), "59:59");
});

// The caller turns an empty string into its own wording, so a missing runtime
// must not come back as "0:00" pretending to be a measurement.
test("no runtime returns nothing rather than a zero", () => {
  assert.equal(formatExternalPlaybackDuration(0), "");
  assert.equal(formatExternalPlaybackDuration(null), "");
  assert.equal(formatExternalPlaybackDuration(undefined), "");
  assert.equal(formatExternalPlaybackDuration("not a number"), "");
  assert.equal(formatExternalPlaybackDuration(-5000), "");
});
