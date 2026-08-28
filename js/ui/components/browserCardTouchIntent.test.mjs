import test from "node:test";
import assert from "node:assert/strict";
import {
  CARD_TOUCH_LONG_PRESS_MS,
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
