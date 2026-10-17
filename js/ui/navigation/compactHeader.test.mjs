import assert from "node:assert/strict";
import test from "node:test";
import { bindCompactHeader, compactHeaderVisible } from "./compactHeader.js";

const covered = (bottom) => ({ isIntersecting: false, boundingClientRect: { bottom } });

test("the bar shows once the mark is behind it and the page has moved", () => {
  assert.equal(compactHeaderVisible(covered(-10), { scrollTop: 300 }), true);
  assert.equal(compactHeaderVisible(covered(52), { scrollTop: 300 }), true);
});

test("the bar waits while any part of the mark is still below the bar", () => {
  assert.equal(compactHeaderVisible(covered(53), { scrollTop: 300 }), false);
  assert.equal(compactHeaderVisible(covered(140), { scrollTop: 300 }), false);
});

test("the bar stays hidden before the page has been scrolled", () => {
  assert.equal(compactHeaderVisible(covered(-10), { scrollTop: 0 }), false);
  assert.equal(compactHeaderVisible(covered(-10), {}), false);
});

test("a mark still on screen keeps the bar hidden, whatever its position", () => {
  assert.equal(
    compactHeaderVisible(
      { isIntersecting: true, boundingClientRect: { bottom: 200 } },
      { scrollTop: 200 }
    ),
    false
  );
});

test("an entry without an intersection state keeps the bar hidden", () => {
  assert.equal(compactHeaderVisible(null, { scrollTop: 200 }), false);
  assert.equal(compactHeaderVisible(undefined, { scrollTop: 200 }), false);
  assert.equal(compactHeaderVisible({}, { scrollTop: 200 }), false);
});

test("binding without a bar, a mark, or an observer is a no-op", () => {
  const cleanup = bindCompactHeader({});
  assert.equal(typeof cleanup, "function");
  cleanup();
});

test("the bar follows its mark through the observer, and stops when unbound", () => {
  const previous = globalThis.IntersectionObserver;
  const observed = [];
  let callback = null;
  let disconnected = false;

  globalThis.IntersectionObserver = class {
    constructor(handler) {
      callback = handler;
    }
    observe(element) {
      observed.push(element);
    }
    disconnect() {
      disconnected = true;
    }
  };

  try {
    const bar = {
      dataset: {},
      attributes: {},
      getAttribute(name) {
        return this.attributes[name] ?? null;
      },
      setAttribute(name, value) {
        this.attributes[name] = value;
      }
    };
    const mark = { id: "mark" };
    let scrollTop = 0;
    const cleanup = bindCompactHeader({ bar, mark, getScrollTop: () => scrollTop });

    assert.deepEqual(observed, [mark]);
    assert.equal(bar.dataset.visible, "false");
    assert.equal(bar.getAttribute("aria-hidden"), "true");

    // Scrolled, and the mark is behind the bar.
    scrollTop = 400;
    callback([covered(-5)]);
    assert.equal(bar.dataset.visible, "true");
    assert.equal(bar.getAttribute("aria-hidden"), "false");

    // Back at the top of the page.
    scrollTop = 0;
    callback([{ isIntersecting: true, boundingClientRect: { bottom: 220 } }]);
    assert.equal(bar.dataset.visible, "false");

    cleanup();
    assert.equal(disconnected, true);
  } finally {
    globalThis.IntersectionObserver = previous;
  }
});
