import assert from "node:assert/strict";
import test from "node:test";

function makeElement({ scrollHeight = 0, clientHeight = 0, scrollTop = 0, position = "" } = {}) {
  return {
    nodeType: 1,
    scrollHeight,
    clientHeight,
    scrollTop,
    style: { position }
  };
}

const fakeDocument = { body: null, documentElement: null };
globalThis.document = fakeDocument;

const {
  getBrowserVerticalScrollOwner,
  getBrowserVerticalScrollTop,
  setBrowserVerticalScrollTop
} = await import("./browserScrollPosition.js");

test("a layered screen scrolls inside its own container", () => {
  fakeDocument.body = makeElement({ scrollHeight: 4836, clientHeight: 896, scrollTop: 336 });
  const detail = makeElement({ scrollHeight: 1097, clientHeight: 812, scrollTop: 72, position: "fixed" });
  assert.equal(getBrowserVerticalScrollOwner(detail), detail);
  assert.equal(getBrowserVerticalScrollTop(detail), 72);
});

test("the bottom screen, which is not a layer, scrolls the document", () => {
  const body = makeElement({ scrollHeight: 2273, clientHeight: 910, scrollTop: 600 });
  fakeDocument.body = body;
  const home = makeElement({ scrollHeight: 2273, clientHeight: 2273 });
  assert.equal(getBrowserVerticalScrollOwner(home), body);
  assert.equal(getBrowserVerticalScrollTop(home), 600);
});

test("a layered screen is never handed another screen's scroller, whatever the geometry says", () => {
  // The exact cold-start failure: body is scrolled and its geometry even
  // false-positives as overflowing (939 vs 910), while the layer on top has not
  // been scrolled at all. The layer must still get itself, or writing its own
  // scroll position would discard the scroll of the screen underneath it.
  const body = makeElement({ scrollHeight: 939, clientHeight: 910, scrollTop: 600 });
  fakeDocument.body = body;
  const detail = makeElement({ scrollHeight: 910, clientHeight: 910, scrollTop: 0, position: "fixed" });

  assert.equal(getBrowserVerticalScrollOwner(detail), detail);
  setBrowserVerticalScrollTop(0, detail);
  assert.equal(body.scrollTop, 600, "the screen underneath keeps the position Back must restore");
});

test("document.documentElement is never the owner, even when it reports overflow", () => {
  fakeDocument.documentElement = makeElement({ scrollHeight: 896, clientHeight: 852 });
  const body = makeElement({ scrollHeight: 2273, clientHeight: 910 });
  fakeDocument.body = body;
  assert.equal(getBrowserVerticalScrollOwner(null), body);
  assert.notEqual(getBrowserVerticalScrollOwner(null), fakeDocument.documentElement);
});

test("setBrowserVerticalScrollTop clamps to the resolved owner's scrollable range", () => {
  const body = makeElement({ scrollHeight: 2297, clientHeight: 812, scrollTop: 0 });
  fakeDocument.body = body;
  const home = makeElement({ scrollHeight: 812, clientHeight: 812 });

  setBrowserVerticalScrollTop(5000, home);
  assert.equal(body.scrollTop, 2297 - 812);
  setBrowserVerticalScrollTop(-100, home);
  assert.equal(body.scrollTop, 0);
  setBrowserVerticalScrollTop(900, home);
  assert.equal(body.scrollTop, 900);
});

test("returns 0 when there is no document (non-browser)", () => {
  const original = globalThis.document;
  delete globalThis.document;
  try {
    assert.equal(getBrowserVerticalScrollTop(null), 0);
  } finally {
    globalThis.document = original;
  }
});
