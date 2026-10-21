import assert from "node:assert/strict";
import test from "node:test";
import { createMoviSubtitleOverlay } from "./moviSubtitleOverlay.js";

// A document just real enough: elements with a style bag, children, append and
// remove, and a textContent setter that counts its writes — the count is the
// whole point of the idempotency rule.
function makeFakeDocument() {
  const writes = [];
  const createElement = (tag) => {
    const element = {
      tagName: String(tag).toUpperCase(),
      className: "",
      style: {},
      children: [],
      parent: null,
      _text: "",
      get textContent() {
        return this._text;
      },
      set textContent(value) {
        this._text = value;
        writes.push(value);
      },
      append(child) {
        this.children.push(child);
        child.parent = this;
      },
      remove() {
        if (!this.parent) return;
        this.parent.children = this.parent.children.filter((entry) => entry !== this);
        this.parent = null;
      }
    };
    return element;
  };
  return { createElement, writes };
}

function makeRig() {
  const documentRef = makeFakeDocument();
  const host = {
    children: [],
    append(child) {
      this.children.push(child);
      child.parent = this;
    }
  };
  const overlay = createMoviSubtitleOverlay({ host, documentRef });
  return { documentRef, host, overlay };
}

const CUES = [
  { start: 1, end: 2, text: "satu" },
  { start: 5, end: 7, text: "dua" }
];

test("mounting puts exactly one layer on the host", () => {
  const { host, overlay } = makeRig();
  overlay.mount();
  overlay.mount();
  assert.equal(host.children.length, 1);
  assert.equal(host.children[0].className, "movi-subtitle-overlay");
});

test("the text is written when the cue changes, and not again while it holds", () => {
  const { overlay, documentRef } = makeRig();
  overlay.mount();
  overlay.setCues(CUES);
  const before = documentRef.writes.length;

  overlay.setTime(1.2);
  const afterCueChange = documentRef.writes.length;
  assert.equal(overlay.line.textContent, "satu");
  assert.equal(overlay.line.style.display, "block");
  assert.equal(afterCueChange, before + 1);

  // Two more ticks inside the same cue must not touch the DOM at all.
  overlay.setTime(1.6);
  overlay.setTime(1.9);
  assert.equal(documentRef.writes.length, afterCueChange);
});

test("a gap between cues hides the line once", () => {
  const { overlay, documentRef } = makeRig();
  overlay.mount();
  overlay.setCues(CUES);
  overlay.setTime(1.2);
  const writes = documentRef.writes.length;

  overlay.setTime(3);
  assert.equal(overlay.line.style.display, "none");
  const afterHide = documentRef.writes.length;
  assert.equal(afterHide, writes + 1);

  overlay.setTime(4);
  assert.equal(documentRef.writes.length, afterHide);
});

test("new cues repaint even when the text happens to match", () => {
  const { overlay } = makeRig();
  overlay.mount();
  overlay.setCues([{ start: 1, end: 2, text: "sama" }]);
  overlay.setTime(1.2);
  assert.equal(overlay.line.style.display, "block");

  overlay.setCues([{ start: 10, end: 12, text: "sama" }]);
  assert.equal(overlay.line.style.display, "none");
  overlay.setTime(1.2);
  assert.equal(overlay.line.style.display, "none");
  overlay.setTime(11);
  assert.equal(overlay.line.style.display, "block");
});

test("style overrides land on the line and defaults survive", () => {
  const { overlay } = makeRig();
  overlay.setStyle({ color: "#ff0", fontSize: "22px", bottomOffset: "12%" });
  assert.equal(overlay.line.style.color, "#ff0");
  assert.equal(overlay.line.style.fontSize, "22px");
  assert.equal(overlay.line.style.marginBottom, "12%");
  assert.match(overlay.line.style.cssText, /font-family:system-ui/);
});

test("destroy removes the layer and empties it", () => {
  const { host, overlay } = makeRig();
  overlay.mount();
  overlay.setCues(CUES);
  overlay.setTime(1.2);
  overlay.destroy();
  assert.equal(host.children.length, 0);
  assert.equal(overlay.line.textContent, "");
});

test("an empty cue list is harmless", () => {
  const { overlay } = makeRig();
  overlay.mount();
  overlay.setCues([]);
  overlay.setCues(null);
  overlay.setTime(1);
  assert.equal(overlay.line.textContent, "");
  assert.equal(overlay.line.style.display, "none");
});

test("the layer follows the picture, because fullscreen moves the picture and not the page", () => {
  const { overlay } = makeRig();
  overlay.mount();
  assert.match(overlay.container.style.cssText, /position:fixed/);

  overlay.anchorTo({ left: 10, top: 20, width: 300, height: 200 });
  assert.equal(overlay.container.style.left, "10px");
  assert.equal(overlay.container.style.top, "20px");
  assert.equal(overlay.container.style.width, "300px");
  assert.equal(overlay.container.style.height, "200px");

  // A collapsed or nonsense rectangle is ignored: hiding the layer mid-transition
  // is worse than leaving it a moment stale.
  overlay.anchorTo({ left: 0, top: 0, width: 0, height: 0 });
  assert.equal(overlay.container.style.width, "300px");
  overlay.anchorTo({ left: Number.NaN, top: 0, width: 10, height: 10 });
  assert.equal(overlay.container.style.width, "300px");
});
