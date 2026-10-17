import assert from "node:assert/strict";
import test from "node:test";
import { bindCompactHeader, compactHeaderVisible } from "./compactHeader.js";

test("the bar shows when the mark is out of view, and hides while it is visible", () => {
  assert.equal(compactHeaderVisible({ isIntersecting: false }), true);
  assert.equal(compactHeaderVisible({ isIntersecting: true }), false);
});

test("an entry without an intersection state keeps the bar hidden", () => {
  assert.equal(compactHeaderVisible(null), false);
  assert.equal(compactHeaderVisible(undefined), false);
  assert.equal(compactHeaderVisible({}), false);
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
    const cleanup = bindCompactHeader({ bar, mark });

    assert.deepEqual(observed, [mark]);
    assert.equal(bar.dataset.visible, "false");
    assert.equal(bar.getAttribute("aria-hidden"), "true");

    callback([{ isIntersecting: false }]);
    assert.equal(bar.dataset.visible, "true");
    assert.equal(bar.getAttribute("aria-hidden"), "false");

    callback([{ isIntersecting: true }]);
    assert.equal(bar.dataset.visible, "false");

    cleanup();
    assert.equal(disconnected, true);
  } finally {
    globalThis.IntersectionObserver = previous;
  }
});
