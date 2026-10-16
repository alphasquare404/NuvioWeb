import assert from "node:assert/strict";
import test from "node:test";

const values = new Map();
globalThis.localStorage = {
  getItem: (key) => (values.has(key) ? values.get(key) : null),
  setItem: (key, value) => values.set(key, String(value)),
  removeItem: (key) => values.delete(key),
  clear: () => values.clear()
};

const { normalizeBrowserNavigationPlacement, normalizeBrowserNavigationRailCorner } =
  await import("./layoutPreferences.js");

test("the three placements are kept as they are", () => {
  assert.equal(normalizeBrowserNavigationPlacement("top"), "top");
  assert.equal(normalizeBrowserNavigationPlacement("bottom"), "bottom");
  assert.equal(normalizeBrowserNavigationPlacement("sidebar"), "sidebar");
});

test("case and surrounding space do not make a placement unreadable", () => {
  assert.equal(normalizeBrowserNavigationPlacement("  Bottom "), "bottom");
  assert.equal(normalizeBrowserNavigationPlacement("SIDEBAR"), "sidebar");
});

// A value this build does not know -- written by a newer one, or by hand -- must
// not move the navigation somewhere nobody can find it. The default is the
// placement this has always had, so an unreadable setting looks like no setting.
test("anything else reads as the placement it has always been", () => {
  assert.equal(normalizeBrowserNavigationPlacement("left"), "top");
  assert.equal(normalizeBrowserNavigationPlacement("floating-rail"), "top");
  assert.equal(normalizeBrowserNavigationPlacement(""), "top");
  assert.equal(normalizeBrowserNavigationPlacement(null), "top");
  assert.equal(normalizeBrowserNavigationPlacement(undefined), "top");
  assert.equal(normalizeBrowserNavigationPlacement(42), "top");
});

test("the three rail corners are kept as they are", () => {
  assert.equal(normalizeBrowserNavigationRailCorner("top-right"), "top-right");
  assert.equal(normalizeBrowserNavigationRailCorner("bottom-right"), "bottom-right");
  assert.equal(normalizeBrowserNavigationRailCorner(" BOTTOM-LEFT "), "bottom-left");
});

// Top left is the one corner there is no rule for, because Back owns it. A
// setting asking for it must land somewhere real rather than under Back.
test("a corner with no rules reads as the default one", () => {
  assert.equal(normalizeBrowserNavigationRailCorner("top-left"), "top-right");
  assert.equal(normalizeBrowserNavigationRailCorner("center"), "top-right");
  assert.equal(normalizeBrowserNavigationRailCorner(""), "top-right");
  assert.equal(normalizeBrowserNavigationRailCorner(null), "top-right");
});

// Nobody has chosen yet, so the device is asked instead. The question is the
// shape of the thing in the hand: a phone is narrow whichever way it is held,
// a tablet is not.
test("the unchosen placement follows the shape of the device", async () => {
  const { resolveDefaultBrowserNavigationPlacement } = await import("./layoutPreferences.js");
  const onScreen = (width, height) => {
    globalThis.innerWidth = width;
    globalThis.innerHeight = height;
    return resolveDefaultBrowserNavigationPlacement();
  };
  assert.equal(onScreen(414, 896), "bottom");
  assert.equal(onScreen(896, 414), "bottom");
  assert.equal(onScreen(820, 1180), "top");
  assert.equal(onScreen(1180, 820), "top");
  assert.equal(onScreen(1920, 1080), "top");
});
