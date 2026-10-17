import assert from "node:assert/strict";
import test from "node:test";
import { bindCompactHeader, compactHeaderVisibleFromGeometry } from "./compactHeader.js";

test("the bar shows once the mark is fully behind it and the page has moved", () => {
  assert.equal(compactHeaderVisibleFromGeometry({ markBottom: 52, scrollTop: 300 }), true);
  assert.equal(
    compactHeaderVisibleFromGeometry({ markBottom: -40, markHeight: 120, scrollTop: 300 }),
    true
  );
});

test("the bar waits while any part of the mark is still below the bar", () => {
  assert.equal(compactHeaderVisibleFromGeometry({ markBottom: 53, scrollTop: 300 }), false);
  assert.equal(compactHeaderVisibleFromGeometry({ markBottom: 140, scrollTop: 300 }), false);
});

test("the bar stays hidden before the page has been scrolled", () => {
  assert.equal(compactHeaderVisibleFromGeometry({ markBottom: -10, scrollTop: 0 }), false);
  assert.equal(compactHeaderVisibleFromGeometry({ markBottom: -10 }), false);
});

test("a mark with no size never shows the bar", () => {
  assert.equal(
    compactHeaderVisibleFromGeometry({ markBottom: 0, markHeight: 0, scrollTop: 200 }),
    false
  );
});

test("missing geometry keeps the bar hidden", () => {
  assert.equal(compactHeaderVisibleFromGeometry(), false);
  assert.equal(compactHeaderVisibleFromGeometry({}), false);
  assert.equal(compactHeaderVisibleFromGeometry({ scrollTop: 200 }), false);
});

test("binding without resolvers is a no-op", () => {
  const binding = bindCompactHeader({});
  assert.equal(typeof binding.cleanup, "function");
  binding.cleanup();
});

function makeBar() {
  return {
    dataset: {},
    attributes: {},
    getAttribute(name) {
      return this.attributes[name] ?? null;
    },
    setAttribute(name, value) {
      this.attributes[name] = value;
    }
  };
}

test("the bar follows the mark as the page scrolls, and stops when cleaned up", () => {
  const listeners = [];
  const previousDocument = globalThis.document;
  const previousAdd = globalThis.addEventListener;
  const previousRemove = globalThis.removeEventListener;
  const previousRaf = globalThis.requestAnimationFrame;

  globalThis.document = {
    addEventListener(type, handler) {
      listeners.push({ type, handler });
    },
    removeEventListener(type, handler) {
      const at = listeners.findIndex((entry) => entry.type === type && entry.handler === handler);
      if (at >= 0) listeners.splice(at, 1);
    }
  };
  globalThis.addEventListener = () => {};
  globalThis.removeEventListener = () => {};
  globalThis.requestAnimationFrame = () => 0;

  try {
    let scrollTop = 0;
    let markBottom = 220;
    const bar = makeBar();
    const mark = { getBoundingClientRect: () => ({ bottom: markBottom, height: 120 }) };

    const binding = bindCompactHeader({
      resolveBar: () => bar,
      resolveMark: () => mark,
      getScrollTop: () => scrollTop
    });
    assert.equal(bar.dataset.visible, "false");

    scrollTop = 400;
    markBottom = 30;
    const scrollListener = listeners.find((entry) => entry.type === "scroll");
    assert.ok(scrollListener, "a scroll listener should be attached");
    scrollListener.handler();
    assert.equal(bar.dataset.visible, "true");
    assert.equal(bar.getAttribute("aria-hidden"), "false");

    markBottom = 120;
    scrollListener.handler();
    assert.equal(bar.dataset.visible, "false");

    binding.cleanup();
    assert.equal(listeners.filter((entry) => entry.type === "scroll").length, 0);
  } finally {
    globalThis.document = previousDocument;
    globalThis.addEventListener = previousAdd;
    globalThis.removeEventListener = previousRemove;
    globalThis.requestAnimationFrame = previousRaf;
  }
});

test("a re-rendered bar and mark are picked up without rebinding", () => {
  const previousDocument = globalThis.document;
  const previousAdd = globalThis.addEventListener;
  const previousRemove = globalThis.removeEventListener;
  const previousRaf = globalThis.requestAnimationFrame;
  globalThis.document = { addEventListener() {}, removeEventListener() {} };
  globalThis.addEventListener = () => {};
  globalThis.removeEventListener = () => {};
  globalThis.requestAnimationFrame = () => 0;

  try {
    let scrollTop = 500;
    let bar = makeBar();
    let mark = { getBoundingClientRect: () => ({ bottom: -20, height: 120 }) };

    const binding = bindCompactHeader({
      resolveBar: () => bar,
      resolveMark: () => mark,
      getScrollTop: () => scrollTop
    });
    assert.equal(bar.dataset.visible, "true");

    // A render replaces both nodes; the binding must follow the new ones.
    bar = makeBar();
    mark = { getBoundingClientRect: () => ({ bottom: 200, height: 120 }) };
    binding.refresh();
    assert.equal(bar.dataset.visible, "false");

    mark = { getBoundingClientRect: () => ({ bottom: 10, height: 120 }) };
    binding.refresh();
    assert.equal(bar.dataset.visible, "true");
  } finally {
    globalThis.document = previousDocument;
    globalThis.addEventListener = previousAdd;
    globalThis.removeEventListener = previousRemove;
    globalThis.requestAnimationFrame = previousRaf;
  }
});
