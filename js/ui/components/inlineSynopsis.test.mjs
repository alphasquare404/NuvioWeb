import assert from "node:assert/strict";
import test from "node:test";
import { fitInlineSynopsis } from "./inlineSynopsis.js";

function paragraphFixture(t, capacity = 32) {
  const previous = globalThis.getComputedStyle;
  globalThis.getComputedStyle = () => ({ lineHeight: "19.6px", fontSize: "14px" });
  t.after(() => {
    globalThis.getComputedStyle = previous;
  });
  const text = { textContent: "" };
  const toggle = { hidden: true };
  const classes = new Set();
  const paragraph = {
    style: {},
    classList: { add: (key) => classes.add(key), remove: (key) => classes.delete(key) },
    clientWidth: 320,
    scrollWidth: 320,
    get scrollHeight() {
      const length = Array.from(text.textContent).length + (toggle.hidden ? 0 : 5);
      return Math.ceil(Math.ceil(length / capacity) * 19.6);
    }
  };
  return {
    paragraph,
    text,
    toggle,
    classes,
    resize: (value) => {
      capacity = value;
    }
  };
}

test("long synopsis fills two lines including more, without losing its source", (t) => {
  const f = paragraphFixture(t);
  const source = "A long synopsis about a journey home. ".repeat(10);
  fitInlineSynopsis(f.paragraph, f.text, f.toggle, source);
  assert.equal(f.toggle.hidden, false);
  assert.equal(f.paragraph.scrollHeight, 40);
  assert.equal(f.classes.has("is-truncated"), true);
  const collapsed = f.text.textContent;
  fitInlineSynopsis(f.paragraph, f.text, f.toggle, source, true);
  assert.equal(f.text.textContent, source);
  assert.equal(f.paragraph.style.maxHeight, "none");
  fitInlineSynopsis(f.paragraph, f.text, f.toggle, source);
  assert.equal(f.text.textContent, collapsed);
});

test("a complete short synopsis has no more control", (t) => {
  const f = paragraphFixture(t);
  fitInlineSynopsis(f.paragraph, f.text, f.toggle, "A short synopsis.");
  assert.equal(f.toggle.hidden, true);
  assert.equal(f.text.textContent, "A short synopsis.");
  assert.equal(f.classes.has("is-truncated"), false);
});

test("resizing refits from the original text, including after a title change", (t) => {
  const f = paragraphFixture(t);
  const source = "Another journey with enough text to require more than two lines. ".repeat(5);
  fitInlineSynopsis(f.paragraph, f.text, f.toggle, source);
  const wide = f.text.textContent;
  f.resize(20);
  fitInlineSynopsis(f.paragraph, f.text, f.toggle, source);
  assert.ok(f.text.textContent.length < wide.length);
  assert.ok(f.paragraph.scrollHeight <= 40);
  f.resize(32);
  fitInlineSynopsis(f.paragraph, f.text, f.toggle, source);
  assert.equal(f.text.textContent, wide);
  fitInlineSynopsis(f.paragraph, f.text, f.toggle, "Next title.");
  assert.equal(f.toggle.hidden, true);
  assert.equal(f.text.textContent, "Next title.");
});
