import assert from "node:assert/strict";
import test from "node:test";
import { updateBrowserHeroGeometry } from "./browserHeroGeometry.js";

function measure(top, height, cardTop, cardHeight, extend) {
  const values = {};
  updateBrowserHeroGeometry(
    { getBoundingClientRect: () => ({ top, bottom: top + height }) },
    { style: { setProperty: (k, v) => (values[k] = v) } },
    { getBoundingClientRect: () => ({ top: cardTop, height: cardHeight }) },
    extend
  );
  return values;
}
test("desktop media reaches a third of CW without changing hero layout", () => {
  assert.deepEqual(measure(0, 918, 994, 210, true), {
    "--browser-hero-media-height": "1064px",
    "--browser-hero-tail": "146px"
  });
});
test("scroll position cannot change the decorative extension", () => {
  assert.deepEqual(measure(-300, 918, 694, 210, true), measure(0, 918, 994, 210, true));
});
test("touch rotation anchors fade to the actual artwork, never the old 85vh", () => {
  assert.deepEqual(measure(0, 820, 1100, 210, false), {
    "--browser-hero-media-height": "820px",
    "--browser-hero-tail": "0px"
  });
  assert.equal(measure(0, 720, 1000, 210, false)["--browser-hero-media-height"], "720px");
});
test("no next rail keeps the fade at the artwork boundary", () => {
  const values = {};
  updateBrowserHeroGeometry(
    { getBoundingClientRect: () => ({ top: 50, bottom: 968 }) },
    { style: { setProperty: (k, v) => (values[k] = v) } },
    null,
    true
  );
  assert.equal(values["--browser-hero-media-height"], "918px");
});
