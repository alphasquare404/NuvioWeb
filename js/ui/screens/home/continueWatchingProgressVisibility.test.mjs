import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const { shouldRenderContinueWatchingProgress } = await import("./homeUtils.js");

// A Continue Watching card's progress bar is two elements: the track, which is
// the visible bar, and a span inside it that is only the fill. Rendering the
// track at 0% therefore draws a full-width empty bar rather than nothing.
//
// Next Up cards are built with `progressFraction: 0` on purpose -- they are the
// next episode you have not started -- so every one of them carried that empty
// bar. The fix is to not emit the element for them at all.

test("a Next Up card renders no progress element", () => {
  assert.equal(shouldRenderContinueWatchingProgress({ isNextUp: true }), false);
});

test("a Next Up card is excluded regardless of what its fraction says", () => {
  // buildProgressFraction already forces 0 for Next Up, but the rule is about
  // what kind of card this is, not about the number it happens to carry.
  assert.equal(
    shouldRenderContinueWatchingProgress({ isNextUp: true, progressFraction: 0.4 }),
    false
  );
});

test("an ordinary Continue Watching item still renders its progress element", () => {
  assert.equal(shouldRenderContinueWatchingProgress({ progressFraction: 0.35 }), true);
  assert.equal(
    shouldRenderContinueWatchingProgress({ isNextUp: false, progressFraction: 1 }),
    true
  );
});

test("an ordinary item with no usable fraction keeps today's behavior", () => {
  // Deliberately unchanged: an item whose duration is not known yet resolves to
  // a fraction of 0 and still renders what it renders today. That is a separate
  // question from the Next Up bug and is not this rule's business.
  assert.equal(shouldRenderContinueWatchingProgress({ progressFraction: 0 }), true);
  assert.equal(shouldRenderContinueWatchingProgress({ positionMs: 1000, durationMs: 0 }), true);
});

test("a missing or malformed item never throws", () => {
  assert.equal(shouldRenderContinueWatchingProgress(), true);
  assert.equal(shouldRenderContinueWatchingProgress({}), true);
  assert.equal(shouldRenderContinueWatchingProgress(null), true);
});

test("the card template actually guards the progress element with this rule", async () => {
  // The rule above is only worth anything if the renderer asks it. Matched on
  // identifiers rather than layout, so reformatting the template cannot break
  // this the way an exact-spacing assertion would.
  const source = await readFile(new URL("./homeScreen.js", import.meta.url), "utf8");
  assert.match(source, /shouldRenderContinueWatchingProgress[\s\S]{0,80}from "\.\/homeUtils\.js"/);
  assert.match(
    source,
    /shouldRenderContinueWatchingProgress\(normalized\)[\s\S]{0,120}?home-continue-progress/
  );
});
