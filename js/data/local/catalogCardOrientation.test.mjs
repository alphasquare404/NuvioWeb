import assert from "node:assert/strict";
import test from "node:test";

const values = new Map();
globalThis.localStorage = {
  getItem: (key) => (values.has(key) ? values.get(key) : null),
  setItem: (key, value) => values.set(key, String(value)),
  removeItem: (key) => values.delete(key),
  clear: () => values.clear()
};

const { normalizeCatalogCardOrientation, shouldDrawCardLandscape } =
  await import("./layoutPreferences.js");

test("the three choices are kept, and anything else follows the source", () => {
  assert.equal(normalizeCatalogCardOrientation("source"), "source");
  assert.equal(normalizeCatalogCardOrientation("portrait"), "portrait");
  assert.equal(normalizeCatalogCardOrientation("LANDSCAPE"), "landscape");
  assert.equal(normalizeCatalogCardOrientation("wide"), "source");
  assert.equal(normalizeCatalogCardOrientation(null), "source");
});

// Forcing a shape means every card takes it, whatever the addon asked for.
test("a forced orientation ignores what the addon said", () => {
  assert.equal(shouldDrawCardLandscape("landscape", ""), true);
  assert.equal(shouldDrawCardLandscape("landscape", "poster"), true);
  assert.equal(shouldDrawCardLandscape("portrait", "landscape"), false);
  assert.equal(shouldDrawCardLandscape("portrait", ""), false);
});

// The default. An addon that ships wide artwork has already said which way
// round it wants to be read, so following it saves asking the person.
test("following the source uses the shape the addon declared", () => {
  assert.equal(shouldDrawCardLandscape("source", "landscape"), true);
  assert.equal(shouldDrawCardLandscape("source", "poster"), false);
  assert.equal(shouldDrawCardLandscape("source", "square"), false);
});

// Most addons say nothing at all, and silence is not a request for landscape.
test("an addon that says nothing gets the shape it has always had", () => {
  assert.equal(shouldDrawCardLandscape("source", ""), false);
  assert.equal(shouldDrawCardLandscape("source", null), false);
  assert.equal(shouldDrawCardLandscape("source", undefined), false);
});
