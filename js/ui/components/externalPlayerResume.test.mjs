import assert from "node:assert/strict";
import test from "node:test";

const { resolveExternalResumeSeconds } = await import("./externalPlayerResume.js");

test("a known position is used directly", () => {
  assert.equal(resolveExternalResumeSeconds({ positionMs: 684769, durationMs: 6105002 }), 684.769);
});

test("a provider's percent-only progress becomes a position", () => {
  // The reported failure: SIMKL rows carry a percent and no position, so an
  // external player was told to start at zero even though Continue Watching
  // was showing real progress.
  assert.equal(
    resolveExternalResumeSeconds({ positionMs: 0, progressPercent: 44.07, durationMs: 3240000 }),
    (44.07 / 100) * 3240
  );
});

test("a position wins over a percent when both are present", () => {
  assert.equal(
    resolveExternalResumeSeconds({ positionMs: 60000, progressPercent: 90, durationMs: 3240000 }),
    60
  );
});

test("an essentially finished title starts over rather than resuming at the end", () => {
  assert.equal(
    resolveExternalResumeSeconds({ positionMs: 2916000, durationMs: 3240000 }),
    0,
    "position at 90%"
  );
  assert.equal(
    resolveExternalResumeSeconds({ positionMs: 0, progressPercent: 95, durationMs: 3240000 }),
    0,
    "percent at 95%"
  );
});

test("a percent with no duration to measure it against yields nothing", () => {
  // Better to start from the beginning than to invent a position.
  assert.equal(
    resolveExternalResumeSeconds({ positionMs: 0, progressPercent: 44, durationMs: 0 }),
    0
  );
});

test("a position with no known duration is still honoured", () => {
  assert.equal(resolveExternalResumeSeconds({ positionMs: 90000, durationMs: 0 }), 90);
});

test("nothing to resume from yields zero", () => {
  assert.equal(resolveExternalResumeSeconds({}), 0);
  assert.equal(resolveExternalResumeSeconds(), 0);
  assert.equal(
    resolveExternalResumeSeconds({ positionMs: 0, progressPercent: 0, durationMs: 3240000 }),
    0
  );
});

test("malformed values never produce NaN", () => {
  const result = resolveExternalResumeSeconds({
    positionMs: "x",
    progressPercent: "y",
    durationMs: "z"
  });
  assert.equal(result, 0);
});
