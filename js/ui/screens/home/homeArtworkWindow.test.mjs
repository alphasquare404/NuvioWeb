import test from "node:test";
import assert from "node:assert/strict";
import {
  HOME_ARTWORK_RELEASE_VERTICAL_MARGIN_PX,
  HOME_ARTWORK_ROW_MARGIN,
  isRectBeyondWindow,
  isRectNearWindow,
  releasePaintedArtwork,
  windowRectFromViewport
} from "./homeArtworkWindow.js";

// Rects are plain client-space boxes, the shape getBoundingClientRect returns.
const rect = (top, bottom, left = 0, right = 400) => ({ top, bottom, left, right });

test("a rows wrapper in normal flow is clamped to the visible viewport", () => {
  // The desktop layout hands over the wrapper, which reports all 37 000px of
  // catalogs while the screen scrolls around it. Everything must be judged
  // against the 847px the viewer can see, not against the wrapper.
  const windowRect = windowRectFromViewport(rect(-35759, 1233), 390, 847);
  assert.deepEqual(windowRect, { top: 0, bottom: 847, left: 0, right: 390 });
});

test("a real scroll port keeps its own box inside the viewport", () => {
  const windowRect = windowRectFromViewport(rect(120, 700), 390, 844);
  assert.deepEqual(windowRect, { top: 120, bottom: 700, left: 0, right: 390 });
});

test("a box that is entirely off screen falls back to the whole viewport", () => {
  assert.deepEqual(windowRectFromViewport(rect(2000, 3000), 390, 844), {
    top: 0,
    bottom: 844,
    left: 0,
    right: 390
  });
  assert.deepEqual(windowRectFromViewport(null, 390, 844), {
    top: 0,
    bottom: 844,
    left: 0,
    right: 390
  });
});

test("a measurement taken before layout keeps the box instead of emptying the window", () => {
  // No viewport numbers to clamp against: an empty window would leave every
  // poster unloaded, so the box is judged as it is.
  const box = rect(-500, 1200, 0, 1280);
  assert.deepEqual(windowRectFromViewport(box, 0, 0), box);
});

test("a row on screen is near, one far above or below is not", () => {
  const windowRect = windowRectFromViewport(rect(0, 847), 390, 847);
  assert.equal(isRectNearWindow(rect(-100, 120), windowRect, HOME_ARTWORK_ROW_MARGIN), true);
  // A row below the fold is what the viewer scrolls into next, so the row gate
  // uses the load margin too -- a zero margin left every row past the first
  // screen blank until it was already on screen.
  assert.equal(isRectNearWindow(rect(900, 1400), windowRect, HOME_ARTWORK_ROW_MARGIN), true);
  assert.equal(isRectNearWindow(rect(2500, 2900), windowRect, HOME_ARTWORK_ROW_MARGIN), false);
  // One row above the top is still inside the 1200px load margin.
  assert.equal(isRectNearWindow(rect(-1000, -800), windowRect), true);
  // Two screens up is not: loading it would only buy decoded bitmaps.
  assert.equal(isRectNearWindow(rect(-1500, -1300), windowRect), false);
  assert.equal(isRectNearWindow(rect(3000, 3200), windowRect), false);
});

test("a rail scrolled sideways keeps a margin before it counts as near", () => {
  const windowRect = windowRectFromViewport(rect(0, 847), 390, 847);
  // 500px past the right edge of the viewport: still inside the 1000px margin.
  assert.equal(isRectNearWindow(rect(100, 300, 890, 1200), windowRect), true);
  // 1500px past it: not worth decoding yet.
  assert.equal(isRectNearWindow(rect(100, 300, 1890, 2200), windowRect), false);
});

test("the release margin is wider than the load margin, so scrolling back is free", () => {
  const windowRect = windowRectFromViewport(rect(0, 847), 390, 847);
  // Inside the hysteresis band: off screen, not loaded, but not released either.
  const bandRow = rect(-2000, -1800);
  assert.equal(isRectNearWindow(bandRow, windowRect), false);
  assert.equal(isRectBeyondWindow(bandRow, windowRect), false);
  // Past the band: this is the row whose bitmaps are given back.
  const distantRow = rect(-3600, -3400);
  assert.equal(isRectBeyondWindow(distantRow, windowRect), true);
  assert.equal(
    isRectBeyondWindow(rect(847 + HOME_ARTWORK_RELEASE_VERTICAL_MARGIN_PX + 1, 4200), windowRect),
    true
  );
  assert.equal(
    isRectBeyondWindow(rect(847 + HOME_ARTWORK_RELEASE_VERTICAL_MARGIN_PX - 1, 4000), windowRect),
    false
  );
});

test("a row scrolled to the bottom of a long Home is not treated as near the top", () => {
  // The measured page: 101 rows, the first one 35 416px above the viewport once
  // the screen is scrolled to its end. Both ends used to be "near" because the
  // window was the whole wrapper; after clamping only the visible band is.
  const windowRect = windowRectFromViewport(rect(-35759, 1233), 1280, 847);
  const firstRow = rect(-35416, -35192);
  const lastRow = rect(903, 1127);
  assert.equal(isRectNearWindow(firstRow, windowRect), false);
  assert.equal(isRectBeyondWindow(firstRow, windowRect), true);
  assert.equal(isRectNearWindow(lastRow, windowRect), true);
  assert.equal(isRectBeyondWindow(lastRow, windowRect), false);
});

test("a missing rectangle is never near and never released", () => {
  const windowRect = windowRectFromViewport(rect(0, 847), 390, 847);
  assert.equal(isRectNearWindow(null, windowRect), false);
  assert.equal(isRectBeyondWindow(undefined, windowRect), false);
  assert.equal(isRectNearWindow(rect(0, 100), null), false);
});

// The attributes a card image actually carries: src once painted, data-src
// while it waits (again), loading toggled by the hydration pass.
class FakeImage {
  constructor(attrs = {}) {
    this.attrs = new Map(Object.entries(attrs));
    this.dataset = {};
    if (this.attrs.has("data-src")) {
      this.dataset.src = this.attrs.get("data-src");
    }
    this.loading = this.attrs.get("loading") || "";
  }

  getAttribute(name) {
    return this.attrs.has(name) ? this.attrs.get(name) : null;
  }

  setAttribute(name, value) {
    this.attrs.set(name, value);
    if (name === "data-src") {
      this.dataset.src = value;
    }
  }

  removeAttribute(name) {
    this.attrs.delete(name);
    if (name === "data-src") {
      delete this.dataset.src;
    }
  }
}

test("a painted poster gives its bitmap back and stays loadable", () => {
  const poster = new FakeImage({ src: "https://image.tmdb.org/t/p/w500/a.jpg", loading: "eager" });
  assert.equal(releasePaintedArtwork(poster), true);
  assert.equal(poster.getAttribute("src"), null);
  assert.equal(poster.getAttribute("data-src"), "https://image.tmdb.org/t/p/w500/a.jpg");
  assert.equal(poster.loading, "lazy");
  // Releasing twice must not lose the source: the second call is a no-op.
  assert.equal(releasePaintedArtwork(poster), false);
  assert.equal(poster.getAttribute("data-src"), "https://image.tmdb.org/t/p/w500/a.jpg");
});

test("a poster that never painted is left alone", () => {
  const waiting = new FakeImage({ "data-src": "https://image.tmdb.org/t/p/w500/b.jpg" });
  assert.equal(releasePaintedArtwork(waiting), false);
  assert.equal(waiting.getAttribute("data-src"), "https://image.tmdb.org/t/p/w500/b.jpg");
  assert.equal(waiting.getAttribute("src"), null);
  assert.equal(waiting.loading, "");
});

test("a released poster loads again exactly like the first time", () => {
  const poster = new FakeImage({ src: "https://image.tmdb.org/t/p/w500/c.jpg" });
  releasePaintedArtwork(poster);
  // What the hydration pass does on the way back: src restored, data-src gone.
  const reloaded = poster.getAttribute("data-src");
  poster.setAttribute("src", reloaded);
  poster.removeAttribute("data-src");
  assert.equal(poster.getAttribute("src"), reloaded);
  assert.equal(poster.getAttribute("data-src"), null);
  // And it can be handed back again when the viewer scrolls past it once more.
  assert.equal(releasePaintedArtwork(poster), true);
});

test("an image with no source, or no image at all, is not released", () => {
  assert.equal(releasePaintedArtwork(new FakeImage()), false);
  assert.equal(releasePaintedArtwork(null), false);
  assert.equal(releasePaintedArtwork({}), false);
});
