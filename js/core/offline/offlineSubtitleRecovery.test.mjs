import assert from "node:assert/strict";
import test from "node:test";
import { isOfflineSubtitleStepUnfinished } from "./browserOfflineDownloads.js";

// Two places depend on this answer and they have to agree: the startup retry
// picks up downloads whose subtitle step is unfinished, and a subtitle that has
// just been written off hands its parent back to exactly that retry. When the
// two drifted, a subtitle marked failed was retired permanently -- the record
// said failed, every list filtered it out, and nothing ever tried again.

test("a step that never finished is unfinished", () => {
  assert.equal(isOfflineSubtitleStepUnfinished("pending"), true);
  assert.equal(isOfflineSubtitleStepUnfinished("downloading"), true);
  assert.equal(isOfflineSubtitleStepUnfinished("partial"), true);
});

test("a finished step is left alone, so an intact download is not re-run", () => {
  assert.equal(isOfflineSubtitleStepUnfinished("completed"), false);
  assert.equal(isOfflineSubtitleStepUnfinished("none"), false);
  assert.equal(isOfflineSubtitleStepUnfinished("processing"), false);
});

// A record written before this field existed carries nothing, and the queue has
// always read that as "not started yet".
test("a missing status counts as never started", () => {
  assert.equal(isOfflineSubtitleStepUnfinished(""), true);
  assert.equal(isOfflineSubtitleStepUnfinished(null), true);
  assert.equal(isOfflineSubtitleStepUnfinished(undefined), true);
});

test("surrounding whitespace does not change the answer", () => {
  assert.equal(isOfflineSubtitleStepUnfinished("  partial  "), true);
  assert.equal(isOfflineSubtitleStepUnfinished("  completed  "), false);
});
