import assert from "node:assert/strict";
import test from "node:test";

globalThis.__NUVIO_INCLUDE_TRAKT_CLIENT_SECRET__ = false;

const { ensureSpatialFocusVisible, ScreenUtils } = await import("./screen.js");
const { focusWithoutAutoScroll } = await import("../components/sidebarNavigation.js");

function makeCard({ left, top, focused = false } = {}) {
  const classes = new Set(["focusable"]);
  if (focused) classes.add("focused");
  const calls = { focus: 0, scrollIntoView: [] };
  return {
    dataset: {},
    tabIndex: 0,
    calls,
    classList: {
      add: (name) => classes.add(name),
      remove: (name) => classes.delete(name),
      contains: (name) => classes.has(name)
    },
    matches: (selector) => selector === "article.focusable",
    removeAttribute(name) {
      if (name === "tabindex") this.tabIndex = -1;
    },
    focus: () => {
      calls.focus += 1;
    },
    scrollIntoView: (options) => calls.scrollIntoView.push(options),
    getBoundingClientRect: () => ({ left, top, width: 100, height: 100 })
  };
}

function makeContainer(cards) {
  return {
    querySelectorAll: () => cards,
    querySelector: (selector) => (selector.endsWith(".focused") ? cards.find((card) => card.classList.contains("focused")) : null)
  };
}

test("Arrow spatial navigation keeps vertically and horizontally moved cards visible without DOM focus", () => {
  const current = makeCard({ left: 0, top: 0, focused: true });
  const below = makeCard({ left: 0, top: 900 });
  const right = makeCard({ left: 900, top: 0 });
  const container = makeContainer([current, below, right]);

  ScreenUtils.moveFocusDirectional(container, "down");
  assert.equal(below.classList.contains("focused"), true);
  assert.deepEqual(below.calls.scrollIntoView, []);
  assert.equal(below.calls.focus, 0);

  ScreenUtils.moveFocusDirectional(container, "up");
  assert.equal(current.classList.contains("focused"), true);
  assert.deepEqual(current.calls.scrollIntoView, []);

  ScreenUtils.moveFocusDirectional(container, "right");
  assert.equal(right.classList.contains("focused"), true);
  assert.deepEqual(right.calls.scrollIntoView, []);
});

test("spatial visibility adjusts the actual vertical and horizontal scroll containers", () => {
  const originalDocument = globalThis.document;
  const originalGetComputedStyle = globalThis.getComputedStyle;
  const originalInnerHeight = globalThis.innerHeight;
  const originalInnerWidth = globalThis.innerWidth;
  const vertical = {
    scrollHeight: 1000,
    clientHeight: 100,
    scrollWidth: 100,
    clientWidth: 100,
    scrollTop: 0,
    scrollLeft: 0,
    parentElement: null,
    getBoundingClientRect: () => ({ left: 0, top: 0, right: 100, bottom: 100 })
  };
  const horizontal = {
    scrollHeight: 100,
    clientHeight: 100,
    scrollWidth: 1000,
    clientWidth: 100,
    scrollTop: 0,
    scrollLeft: 0,
    parentElement: vertical,
    getBoundingClientRect: () => ({ left: 0, top: 0, right: 100, bottom: 100 })
  };
  const target = {
    parentElement: horizontal,
    getBoundingClientRect: () => ({ left: 260, top: 260, right: 360, bottom: 360 })
  };

  globalThis.document = { scrollingElement: vertical, documentElement: vertical };
  globalThis.getComputedStyle = (node) => ({
    overflowY: node === vertical ? "auto" : "hidden",
    overflowX: node === horizontal ? "auto" : "hidden"
  });
  globalThis.innerHeight = 100;
  globalThis.innerWidth = 100;
  try {
    ensureSpatialFocusVisible(target);
    assert.equal(vertical.scrollTop, 280);
    assert.equal(horizontal.scrollLeft, 276);
  } finally {
    globalThis.document = originalDocument;
    globalThis.getComputedStyle = originalGetComputedStyle;
    globalThis.innerHeight = originalInnerHeight;
    globalThis.innerWidth = originalInnerWidth;
  }
});

test("spatial cards are removed from the native Tab order while ordinary focusables remain native controls", () => {
  const card = makeCard({ left: 0, top: 0 });
  const button = {
    dataset: {},
    tabIndex: -1,
    matches: () => false,
    removeAttribute: () => {
      throw new Error("ordinary controls must keep their native Tab behavior");
    }
  };
  const container = { querySelectorAll: () => [card, button] };

  ScreenUtils.indexFocusables(container);

  assert.equal(card.dataset.index, "0");
  assert.equal(card.tabIndex, -1);
  assert.equal(button.dataset.index, "1");
  assert.equal(button.tabIndex, 0);
});

test("moving to a spatial card releases an active editable control without focusing the card", () => {
  const originalDocument = globalThis.document;
  let blurred = 0;
  let focused = 0;
  const input = { blur: () => { blurred += 1; } };
  const card = {
    matches: (selector) => selector === "article.focusable",
    removeAttribute: () => {},
    focus: () => { focused += 1; }
  };
  globalThis.document = { activeElement: input, body: {} };
  try {
    focusWithoutAutoScroll(card);
    assert.equal(blurred, 1);
    assert.equal(focused, 0);
  } finally {
    globalThis.document = originalDocument;
  }
});

test.after(() => {
  delete globalThis.__NUVIO_INCLUDE_TRAKT_CLIENT_SECRET__;
});
