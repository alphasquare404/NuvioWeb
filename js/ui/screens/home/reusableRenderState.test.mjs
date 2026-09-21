import test from "node:test";
import assert from "node:assert/strict";
import {
  captureReusableRenderState,
  restoreDecodedImages,
  restoreTrackScroll
} from "./reusableRenderState.js";

// Minimal stand-ins: only the surface the module actually touches.
class FakeImage {
  constructor(src, { complete = true, naturalWidth = 300, attrs = {} } = {}) {
    this.src = src;
    this.complete = complete;
    this.naturalWidth = naturalWidth;
    this.attrs = new Map(Object.entries({ src, ...attrs }));
    this.parent = null;
  }

  get isConnected() {
    return Boolean(this.parent?.images?.includes(this));
  }

  get attributes() {
    return Array.from(this.attrs, ([name, value]) => ({ name, value }));
  }

  getAttribute(name) {
    return this.attrs.has(name) ? this.attrs.get(name) : null;
  }

  setAttribute(name, value) {
    this.attrs.set(name, value);
  }

  removeAttribute(name) {
    this.attrs.delete(name);
  }

  hasAttribute(name) {
    return this.attrs.has(name);
  }

  replaceWith(node) {
    const list = this.parent?.images;
    if (!list) return;
    list.splice(list.indexOf(this), 1, node);
    node.parent = this.parent;
    this.parent = null;
  }
}

class FakeTrack {
  constructor(rowKey, { scrollLeft = 0, scrollWidth = 2000, clientWidth = 400 } = {}) {
    this.dataset = { trackRowKey: rowKey };
    this.scrollLeft = scrollLeft;
    this.scrollWidth = scrollWidth;
    this.clientWidth = clientWidth;
  }
}

class FakeContainer {
  constructor({ tracks = [], images = [] } = {}) {
    this.tracks = tracks;
    this.images = images;
    images.forEach((image) => {
      image.parent = this;
    });
  }

  querySelectorAll(selector) {
    if (selector === ".home-track[data-track-row-key]") return this.tracks;
    if (selector === "img[src]") return this.images;
    throw new Error(`unexpected selector: ${selector}`);
  }

  // What writing innerHTML does to what was there: every node is detached.
  rewrite() {
    this.images.forEach((image) => {
      image.parent = null;
    });
    this.images = [];
  }
}

test("a rail's position survives the rewrite, clamped to the new extent", () => {
  const before = new FakeContainer({
    tracks: [new FakeTrack("trending", { scrollLeft: 420 }), new FakeTrack("genres")]
  });
  const state = captureReusableRenderState(before);

  const trending = new FakeTrack("trending");
  const genres = new FakeTrack("genres");
  restoreTrackScroll(new FakeContainer({ tracks: [trending, genres] }), state);

  assert.equal(trending.scrollLeft, 420);
  // A rail that was already at 0 must not be written to at all.
  assert.equal(genres.scrollLeft, 0);
});

test("a rail shorter after the rewrite is clamped, never left past its end", () => {
  const state = captureReusableRenderState(
    new FakeContainer({ tracks: [new FakeTrack("trending", { scrollLeft: 1500 })] })
  );
  const shorter = new FakeTrack("trending", { scrollWidth: 900, clientWidth: 400 });
  restoreTrackScroll(new FakeContainer({ tracks: [shorter] }), state);
  assert.equal(shorter.scrollLeft, 500);
});

test("a decoded poster node is carried over instead of re-created", () => {
  const decoded = new FakeImage("https://cdn/poster-a.jpg", { attrs: { class: "old" } });
  const before = new FakeContainer({ images: [decoded] });
  const state = captureReusableRenderState(before);
  before.rewrite();

  const fresh = new FakeImage("https://cdn/poster-a.jpg", {
    attrs: { class: "home-poster-image", loading: "lazy" }
  });
  const after = new FakeContainer({ images: [fresh] });
  restoreDecodedImages(after, state);

  // The surviving node is the one that already holds the decoded bitmap.
  assert.equal(after.images[0], decoded);
  // ...carrying this pass's attributes.
  assert.equal(decoded.getAttribute("class"), "home-poster-image");
  assert.equal(decoded.getAttribute("loading"), "lazy");
});

test("an attribute dropped by the new markup is dropped from the reused node", () => {
  const decoded = new FakeImage("https://cdn/poster-a.jpg", { attrs: { "aria-hidden": "true" } });
  const before = new FakeContainer({ images: [decoded] });
  const state = captureReusableRenderState(before);
  before.rewrite();

  const after = new FakeContainer({ images: [new FakeImage("https://cdn/poster-a.jpg")] });
  restoreDecodedImages(after, state);

  assert.equal(decoded.hasAttribute("aria-hidden"), false);
});

test("an image that never finished is left for the new markup to retry", () => {
  const pending = new FakeImage("https://cdn/broken.jpg", { complete: false, naturalWidth: 0 });
  const state = captureReusableRenderState(new FakeContainer({ images: [pending] }));
  assert.equal(state.decodedImages.size, 0);

  const fresh = new FakeImage("https://cdn/broken.jpg");
  const after = new FakeContainer({ images: [fresh] });
  restoreDecodedImages(after, state);
  assert.equal(after.images[0], fresh);
});

test("one decoded node is spent once, so a repeated poster does not appear twice", () => {
  const decoded = new FakeImage("https://cdn/poster-a.jpg");
  const before = new FakeContainer({ images: [decoded] });
  const state = captureReusableRenderState(before);
  before.rewrite();

  const first = new FakeImage("https://cdn/poster-a.jpg");
  const second = new FakeImage("https://cdn/poster-a.jpg");
  const after = new FakeContainer({ images: [first, second] });
  restoreDecodedImages(after, state);

  assert.equal(after.images[0], decoded);
  assert.equal(after.images[1], second);
});

test("a poster the new markup no longer shows is simply not carried over", () => {
  const gone = new FakeImage("https://cdn/removed.jpg");
  const before = new FakeContainer({ images: [gone] });
  const state = captureReusableRenderState(before);
  before.rewrite();

  const fresh = new FakeImage("https://cdn/other.jpg");
  const after = new FakeContainer({ images: [fresh] });
  restoreDecodedImages(after, state);

  assert.equal(after.images.length, 1);
  assert.equal(after.images[0], fresh);
});

// Regression: a section-scoped update leaves most nodes in place. Two cards
// sharing one artwork URL then made the restore move a node that was still on
// screen into the other's slot, tearing it out and leaving a hole.
test("a poster still on screen is never moved, even when another card shares its URL", () => {
  const live = new FakeImage("https://cdn/shared.jpg");
  const container = new FakeContainer({ images: [live] });
  const state = captureReusableRenderState(container);

  // Nothing was detached: the update kept `live` and added a second card that
  // happens to point at the same artwork.
  const second = new FakeImage("https://cdn/shared.jpg");
  container.images.push(second);
  second.parent = container;
  restoreDecodedImages(container, state);

  assert.equal(container.images.length, 2);
  assert.equal(container.images[0], live);
  assert.equal(container.images[1], second);
});

// Why homeScreen restores rails only after the cached poster metrics are
// applied: against a track the layout has not sized yet, the clamp is 0 and the
// carried position is silently thrown away.
test("an unsized track clamps to 0, which is why the restore runs after sizing", () => {
  const state = captureReusableRenderState(
    new FakeContainer({ tracks: [new FakeTrack("trending", { scrollLeft: 420 })] })
  );
  const unsized = new FakeTrack("trending", { scrollWidth: 400, clientWidth: 400 });
  restoreTrackScroll(new FakeContainer({ tracks: [unsized] }), state);
  assert.equal(unsized.scrollLeft, 0);
});

test("no container and no state are both no-ops rather than throws", () => {
  assert.equal(captureReusableRenderState(null), null);
  assert.doesNotThrow(() => restoreDecodedImages(null, null));
  assert.doesNotThrow(() => restoreDecodedImages(new FakeContainer(), null));
  assert.doesNotThrow(() => restoreTrackScroll(null, null));
  assert.doesNotThrow(() => restoreTrackScroll(new FakeContainer(), null));
});
