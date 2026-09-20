import test from "node:test";
import assert from "node:assert/strict";
import {
  CARD_TOUCH_LONG_PRESS_MS,
  CARD_TOUCH_MOVE_TOLERANCE_PX,
  exceedsCardTouchMoveTolerance,
  classifyCardTouchIntent,
  createCardTouchClickSuppressor,
  shouldTrackCardTouchPointer
} from "./browserCardTouchIntent.js";

test("quick touch interaction remains a tap", () => {
  assert.equal(classifyCardTouchIntent({ durationMs: CARD_TOUCH_LONG_PRESS_MS - 1 }), "tap");
});

test("long press is classified for activation suppression", () => {
  assert.equal(classifyCardTouchIntent({ durationMs: CARD_TOUCH_LONG_PRESS_MS }), "longpress");
});

test("a generated click after long press is consumed once", () => {
  const suppressor = createCardTouchClickSuppressor();
  const card = {};
  suppressor.suppress(card);
  assert.equal(suppressor.consume(card), true);
  assert.equal(suppressor.consume(card), false);
});

test("a separate later tap can activate normally", () => {
  const suppressor = createCardTouchClickSuppressor();
  const firstCard = {};
  const secondCard = {};
  suppressor.suppress(firstCard);
  assert.equal(suppressor.consume(secondCard), false);
  suppressor.clear();
  assert.equal(suppressor.consume(firstCard), false);
});

test("mouse interaction is not tracked by the touch guard", () => {
  assert.equal(shouldTrackCardTouchPointer("mouse"), false);
  assert.equal(shouldTrackCardTouchPointer("touch"), true);
});

// Long press must be a hold, not "a scroll that happened to last a while".
test("a still finger is a hold", () => {
  assert.equal(exceedsCardTouchMoveTolerance({ startX: 10, startY: 10, x: 10, y: 10 }), false);
});

test("small jitter still counts as a hold", () => {
  assert.equal(exceedsCardTouchMoveTolerance({ startX: 0, startY: 0, x: 3, y: 3 }), false);
});

test("scrolling past the tolerance cancels the hold", () => {
  assert.equal(
    exceedsCardTouchMoveTolerance({
      startX: 0,
      startY: 0,
      x: 0,
      y: CARD_TOUCH_MOVE_TOLERANCE_PX + 1
    }),
    true
  );
});

test("diagonal drag is measured by distance, not by either axis alone", () => {
  // 8px right and 8px down is ~11.3px of travel: a swipe, not a hold.
  assert.equal(exceedsCardTouchMoveTolerance({ startX: 0, startY: 0, x: 8, y: 8 }), true);
});
