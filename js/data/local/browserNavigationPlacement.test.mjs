import assert from "node:assert/strict";
import test from "node:test";

const values = new Map();
globalThis.localStorage = {
  getItem: (key) => (values.has(key) ? values.get(key) : null),
  setItem: (key, value) => values.set(key, String(value)),
  removeItem: (key) => values.delete(key),
  clear: () => values.clear()
};

const {
  normalizeBrowserNavigationStyle,
  normalizeBrowserNavigationRailCorner,
  resolveBrowserNavigationStyle,
  resolveFloatingNavigationPlacement
} = await import("./layoutPreferences.js");

// Two shapes, not three positions: where the floating bar sits is decided by the
// layout, so only the shape is a choice.
test("the two navigation shapes are kept as they are", () => {
  assert.equal(normalizeBrowserNavigationStyle("floating"), "floating");
  assert.equal(normalizeBrowserNavigationStyle(" RAIL "), "rail");
  assert.equal(normalizeBrowserNavigationStyle("RAIL"), "rail");
});

test("a profile that stored a position is read as the shape it belonged to", () => {
  assert.equal(normalizeBrowserNavigationStyle("", "sidebar"), "rail");
  assert.equal(normalizeBrowserNavigationStyle("", "top"), "floating");
  assert.equal(normalizeBrowserNavigationStyle("", "bottom"), "floating");
  assert.equal(normalizeBrowserNavigationStyle("rail", "bottom"), "rail");
});

// A value this build does not know -- written by a newer one, or by hand -- must
// not move the navigation somewhere nobody can find it. Empty means nobody has
// chosen, and the resolver then answers with the floating bar.
test("anything else reads as nobody having chosen", () => {
  assert.equal(normalizeBrowserNavigationStyle("left"), "");
  assert.equal(normalizeBrowserNavigationStyle("floating-rail"), "");
  assert.equal(normalizeBrowserNavigationStyle(""), "");
  assert.equal(normalizeBrowserNavigationStyle(null), "");
  assert.equal(normalizeBrowserNavigationStyle(undefined), "");
  assert.equal(normalizeBrowserNavigationStyle(42), "");
});

test("the resolved style is always one of the two shapes", () => {
  assert.equal(resolveBrowserNavigationStyle({ browserNavigationStyle: "rail" }), "rail");
  assert.equal(resolveBrowserNavigationStyle({ browserNavigationStyle: "floating" }), "floating");
  assert.equal(resolveBrowserNavigationStyle({}), "floating");
  assert.equal(resolveBrowserNavigationStyle({ browserNavigationPlacement: "sidebar" }), "rail");
  assert.equal(resolveBrowserNavigationStyle({ browserNavigationPlacement: "bottom" }), "floating");
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

// The floating bar's edge is not a preference: the shape of the thing in the hand
// answers it. A phone is narrow whichever way it is held, a tablet is not.
test("the floating bar sits on the edge the device asks for", () => {
  const onScreen = (width, height) => {
    globalThis.innerWidth = width;
    globalThis.innerHeight = height;
    return resolveFloatingNavigationPlacement();
  };
  assert.equal(onScreen(414, 896), "bottom");
  assert.equal(onScreen(896, 414), "bottom");
  assert.equal(onScreen(820, 1180), "top");
  assert.equal(onScreen(1180, 820), "top");
  assert.equal(onScreen(1920, 1080), "top");
});
