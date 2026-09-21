import test from "node:test";
import assert from "node:assert/strict";
import { MAX_DEPTH, childrenAlign, keyOf } from "./homeSectionUpdate.js";

// The full update needs a real HTML parser, so it is exercised in a browser.
// These lock the alignment rules that decide whether a subtree may be reused at
// all -- get one wrong and the update either corrupts the DOM or never fires.
class FakeElement {
  constructor(tagName, attrs = {}, children = []) {
    this.tagName = tagName;
    this.attrs = new Map(Object.entries(attrs));
    this.children = children;
  }

  get id() {
    return this.attrs.get("id") || "";
  }

  getAttribute(name) {
    return this.attrs.has(name) ? this.attrs.get(name) : null;
  }
}

const row = (key, tag = "SECTION") => new FakeElement(tag, { "data-row-key": key });

test("a row is identified by its row key ahead of anything else", () => {
  assert.equal(keyOf(row("trending")), "trending");
  assert.equal(keyOf(new FakeElement("DIV", { "data-track-row-key": "genres" })), "genres");
  assert.equal(keyOf(new FakeElement("DIV", { id: "homeCatalogRows" })), "homeCatalogRows");
  assert.equal(keyOf(new FakeElement("DIV")), "");
});

test("rows in the same order under the same keys align", () => {
  const live = new FakeElement("DIV", {}, [row("cw"), row("trending"), row("genres")]);
  const next = new FakeElement("DIV", {}, [row("cw"), row("trending"), row("genres")]);
  assert.equal(childrenAlign(live, next), true);
});

test("a row inserted above the others does not align, so that level is replaced", () => {
  const live = new FakeElement("DIV", {}, [row("cw"), row("genres")]);
  const next = new FakeElement("DIV", {}, [row("cw"), row("trending"), row("genres")]);
  assert.equal(childrenAlign(live, next), false);
});

test("reordered rows do not align: matching by position would swap their content", () => {
  const live = new FakeElement("DIV", {}, [row("trending"), row("genres")]);
  const next = new FakeElement("DIV", {}, [row("genres"), row("trending")]);
  assert.equal(childrenAlign(live, next), false);
});

test("a changed tag does not align even under the same key", () => {
  const live = new FakeElement("DIV", {}, [row("trending", "SECTION")]);
  const next = new FakeElement("DIV", {}, [row("trending", "ARTICLE")]);
  assert.equal(childrenAlign(live, next), false);
});

test("unkeyed children of the same shape align by position", () => {
  const live = new FakeElement("DIV", {}, [new FakeElement("H2"), new FakeElement("DIV")]);
  const next = new FakeElement("DIV", {}, [new FakeElement("H2"), new FakeElement("DIV")]);
  assert.equal(childrenAlign(live, next), true);
});

test("a leaf pair never aligns, so a changed leaf is replaced rather than descended into", () => {
  assert.equal(childrenAlign(new FakeElement("SPAN"), new FakeElement("SPAN")), false);
});

// Home's own nesting, counted from the container's child down to a poster's
// frame. Measured: at a depth of 8 one changed card title recreated 61 nodes
// because the walk stopped at the rail; at 10 it recreates none, for the same
// cost. Lowering this silently gives that back.
test("the walk reaches a card, not just the rail it sits in", () => {
  const homeNesting = [
    "div.home-shell",
    "main.home-main",
    "div.home-route-content",
    "section.home-modern-stage",
    "div.home-modern-rows-viewport",
    "div.home-modern-rows-scroll",
    "section.home-row",
    "div.home-track",
    "article.home-poster-card",
    "div.home-poster-frame"
  ];
  assert.ok(
    MAX_DEPTH >= homeNesting.length,
    `MAX_DEPTH ${MAX_DEPTH} stops above ${homeNesting[MAX_DEPTH] || "the card"}`
  );
});
