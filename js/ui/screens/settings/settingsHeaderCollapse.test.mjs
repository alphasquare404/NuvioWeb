import assert from "node:assert/strict";
import test from "node:test";
import {
  SETTINGS_HEADER_COLLAPSE_AT,
  SETTINGS_HEADER_EXPAND_AT,
  shouldCollapseSettingsHeader
} from "./settingsHeaderCollapse.js";

test("the heading stays open at the top of the page", () => {
  assert.equal(shouldCollapseSettingsHeader(0), false);
  assert.equal(shouldCollapseSettingsHeader(12), false);
  assert.equal(shouldCollapseSettingsHeader(79), false);
});

test("the heading collapses once the page passes 80px", () => {
  assert.equal(shouldCollapseSettingsHeader(80), true);
  assert.equal(shouldCollapseSettingsHeader(400), true);
});

test("a collapsed heading stays collapsed until the page is back under 64px", () => {
  assert.equal(shouldCollapseSettingsHeader(78, true), true);
  assert.equal(shouldCollapseSettingsHeader(70, true), true);
  assert.equal(shouldCollapseSettingsHeader(64, true), true);
  assert.equal(shouldCollapseSettingsHeader(63, true), false);
});

test("the two thresholds leave a gap, so a resting scroll position cannot flicker", () => {
  assert.ok(SETTINGS_HEADER_EXPAND_AT < SETTINGS_HEADER_COLLAPSE_AT);
  // Inside the gap, the state depends on which it came from: that is the point.
  assert.equal(shouldCollapseSettingsHeader(70, false), false);
  assert.equal(shouldCollapseSettingsHeader(70, true), true);
});

test("a missing or impossible scroll position reads as the top of the page", () => {
  assert.equal(shouldCollapseSettingsHeader(undefined), false);
  assert.equal(shouldCollapseSettingsHeader(null), false);
  assert.equal(shouldCollapseSettingsHeader(Number.NaN), false);
  assert.equal(shouldCollapseSettingsHeader(-20), false);
});
