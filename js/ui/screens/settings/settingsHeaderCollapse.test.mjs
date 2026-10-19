import assert from "node:assert/strict";
import test from "node:test";
import { resolveSettingsHeadingProgress } from "./settingsHeaderCollapse.js";

test("the Settings heading grows from zero to one over its scroll range", () => {
  assert.equal(resolveSettingsHeadingProgress(0), 0);
  assert.equal(resolveSettingsHeadingProgress(24), 0.25);
  assert.equal(resolveSettingsHeadingProgress(48), 0.5);
  assert.equal(resolveSettingsHeadingProgress(96), 1);
  assert.equal(resolveSettingsHeadingProgress(400), 1);
});

test("the Settings heading progress is reversible", () => {
  assert.equal(resolveSettingsHeadingProgress(72), 0.75);
  assert.equal(resolveSettingsHeadingProgress(24), 0.25);
  assert.equal(resolveSettingsHeadingProgress(0), 0);
});

test("a missing or impossible scroll position reads as the top of the page", () => {
  assert.equal(resolveSettingsHeadingProgress(undefined), 0);
  assert.equal(resolveSettingsHeadingProgress(null), 0);
  assert.equal(resolveSettingsHeadingProgress(Number.NaN), 0);
  assert.equal(resolveSettingsHeadingProgress(-20), 0);
});
