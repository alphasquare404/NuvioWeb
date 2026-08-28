import test from "node:test";
import assert from "node:assert/strict";
import {
  PLAYER_GESTURE_DOUBLE_ACTIVATION_MS,
  PLAYER_GESTURE_HOLD_MS,
  PLAYER_GESTURE_HOLD_MOVE_TOLERANCE_PX,
  getBrowserPlayerGestureZone,
  isBrowserPlayerGesturePointer,
  isWithinGestureTolerance
} from "./browserPlayerGestures.js";

const surface = { left: 100, width: 400 };

test("player gesture zones use the current surface quarters", () => {
  assert.equal(getBrowserPlayerGestureZone(surface, 100), "left");
  assert.equal(getBrowserPlayerGestureZone(surface, 199), "left");
  assert.equal(getBrowserPlayerGestureZone(surface, 200), "center");
  assert.equal(getBrowserPlayerGestureZone(surface, 399), "center");
  assert.equal(getBrowserPlayerGestureZone(surface, 400), "right");
});

test("gesture timing constants keep touch interaction deliberate", () => {
  assert.equal(PLAYER_GESTURE_DOUBLE_ACTIVATION_MS, 320);
  assert.equal(PLAYER_GESTURE_HOLD_MS, 550);
});

test("movement tolerance distinguishes a hold from a drag", () => {
  assert.equal(isWithinGestureTolerance({ x: 0, y: 0 }, { x: 8, y: 8 }, PLAYER_GESTURE_HOLD_MOVE_TOLERANCE_PX), true);
  assert.equal(isWithinGestureTolerance({ x: 0, y: 0 }, { x: 13, y: 0 }, PLAYER_GESTURE_HOLD_MOVE_TOLERANCE_PX), false);
});

test("only touch, pen, and primary mouse input are gesture candidates", () => {
  assert.equal(isBrowserPlayerGesturePointer({ pointerType: "touch" }), true);
  assert.equal(isBrowserPlayerGesturePointer({ pointerType: "pen" }), true);
  assert.equal(isBrowserPlayerGesturePointer({ pointerType: "mouse", button: 0 }), true);
  assert.equal(isBrowserPlayerGesturePointer({ pointerType: "mouse", button: 2 }), false);
});
