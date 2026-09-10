import test from "node:test";
import assert from "node:assert/strict";
import {
  bindBrowserPlayerGestures,
  PLAYER_GESTURE_DOUBLE_ACTIVATION_MS,
  PLAYER_GESTURE_HOLD_MS,
  PLAYER_GESTURE_HOLD_MOVE_TOLERANCE_PX,
  getBrowserPlayerVideoTapAction,
  getBrowserPlayerGestureZone,
  isBrowserPlayerGesturePointer,
  isWithinGestureTolerance
} from "./browserPlayerGestures.js";

const surface = { left: 100, width: 400 };

class GestureTestElement {
  constructor(parent = null) {
    this.parent = parent;
    this.listeners = new Map();
  }

  contains(target) {
    return target === this || target?.parent === this;
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type, listener) {
    this.listeners.set(type, (this.listeners.get(type) || []).filter((entry) => entry !== listener));
  }

  dispatch(type, event) {
    for (const listener of this.listeners.get(type) || []) listener(event);
  }

  getBoundingClientRect() {
    return { left: 0, width: 400 };
  }

  setPointerCapture() {}

  releasePointerCapture() {}
}

function createGestureEvent(target, {
  pointerId = 1,
  pointerType = "touch",
  clientX = 200,
  clientY = 100
} = {}) {
  return {
    target,
    pointerId,
    pointerType,
    clientX,
    clientY,
    button: 0,
    isPrimary: true,
    defaultPrevented: false,
    preventDefault() {
      this.defaultPrevented = true;
    },
    stopPropagation() {},
    stopImmediatePropagation() {}
  };
}

async function withGestureDom(run) {
  const previousElement = globalThis.Element;
  const previousHtmlElement = globalThis.HTMLElement;
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  const windowTarget = new GestureTestElement();
  const documentTarget = new GestureTestElement();
  documentTarget.hidden = false;
  globalThis.Element = GestureTestElement;
  globalThis.HTMLElement = GestureTestElement;
  globalThis.window = windowTarget;
  globalThis.document = documentTarget;
  try {
    return await run();
  } finally {
    globalThis.Element = previousElement;
    globalThis.HTMLElement = previousHtmlElement;
    globalThis.window = previousWindow;
    globalThis.document = previousDocument;
  }
}

function createFakeTimers() {
  let now = 0;
  let nextId = 1;
  const pending = new Map();
  return {
    schedule(callback, delay) {
      const id = nextId++;
      pending.set(id, { callback, at: now + Number(delay || 0) });
      return id;
    },
    cancel(id) {
      pending.delete(id);
    },
    now: () => now,
    advance(delay) {
      const target = now + Number(delay || 0);
      while (true) {
        const next = [...pending.entries()]
          .filter(([, entry]) => entry.at <= target)
          .sort(([, left], [, right]) => left.at - right.at)[0];
        if (!next) break;
        const [id, entry] = next;
        pending.delete(id);
        now = entry.at;
        entry.callback();
      }
      now = target;
    }
  };
}

function dispatchPointer(surfaceNode, type, pointerId, clientX = 200) {
  const pointer = { pointerId, clientX };
  const event = createGestureEvent(surfaceNode, pointer);
  surfaceNode.dispatch(type, event);
  return event;
}

function dispatchTap(surfaceNode, pointerId, clientX = 200) {
  const pointer = { pointerId, clientX };
  surfaceNode.dispatch("pointerdown", createGestureEvent(surfaceNode, pointer));
  surfaceNode.dispatch("pointerup", createGestureEvent(surfaceNode, pointer));
  const click = createGestureEvent(surfaceNode, pointer);
  surfaceNode.dispatch("click", click);
  return click;
}

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

test("single video taps reveal hidden controls before toggling playback", () => {
  assert.equal(getBrowserPlayerVideoTapAction(false), "reveal-controls");
  assert.equal(getBrowserPlayerVideoTapAction(true), "toggle-playback");
});

test("gesture binder defers single taps and cancels them for double seek, hold, and controls", async () => {
  await withGestureDom(async () => {
    const surfaceNode = new GestureTestElement();
    const controlNode = new GestureTestElement(surfaceNode);
    const timers = createFakeTimers();
    let controlsVisible = false;
    let paused = false;
    const seeks = [];
    const holds = [];
    const cleanup = bindBrowserPlayerGestures(surfaceNode, {
      isInteractiveTarget: (target) => target === controlNode,
      getSingleTapContext: () => ({ controlsWereVisible: controlsVisible }),
      onSingleTap: ({ controlsWereVisible }) => {
        if (controlsWereVisible) {
          paused = !paused;
        } else {
          controlsVisible = true;
        }
      },
      onSeek: (zone) => seeks.push({ zone, controlsVisible, paused }),
      onHoldChange: (active) => holds.push(active),
      schedule: (callback, delay) => timers.schedule(callback, delay),
      cancelScheduled: (id) => timers.cancel(id),
      getNow: timers.now
    });

    dispatchTap(surfaceNode, 1);
    assert.equal(controlsVisible, false);
    assert.equal(paused, false);
    timers.advance(PLAYER_GESTURE_DOUBLE_ACTIVATION_MS - 1);
    assert.equal(controlsVisible, false);
    timers.advance(1);
    assert.equal(controlsVisible, true);
    assert.equal(paused, false);

    controlsVisible = false;
    paused = false;
    dispatchTap(surfaceNode, 2, 20);
    const secondHiddenDoubleClick = dispatchTap(surfaceNode, 3, 20);
    assert.deepEqual(seeks, [{ zone: "left", controlsVisible: false, paused: false }]);
    assert.equal(secondHiddenDoubleClick.defaultPrevented, true);
    timers.advance(PLAYER_GESTURE_DOUBLE_ACTIVATION_MS);
    assert.equal(controlsVisible, false);
    assert.equal(paused, false);

    controlsVisible = true;
    paused = false;
    dispatchTap(surfaceNode, 4);
    assert.equal(paused, false);
    timers.advance(PLAYER_GESTURE_DOUBLE_ACTIVATION_MS);
    assert.equal(paused, true);

    paused = false;
    dispatchTap(surfaceNode, 5, 20);
    dispatchTap(surfaceNode, 6, 20);
    timers.advance(PLAYER_GESTURE_DOUBLE_ACTIVATION_MS);
    assert.deepEqual(seeks.at(-1), { zone: "left", controlsVisible: true, paused: false });
    assert.equal(controlsVisible, true);
    assert.equal(paused, false);

    paused = true;
    dispatchTap(surfaceNode, 7, 20);
    dispatchTap(surfaceNode, 8, 20);
    timers.advance(PLAYER_GESTURE_DOUBLE_ACTIVATION_MS);
    assert.deepEqual(seeks.at(-1), { zone: "left", controlsVisible: true, paused: true });
    assert.equal(paused, true);

    controlsVisible = false;
    paused = false;
    dispatchPointer(surfaceNode, "pointerdown", 9);
    timers.advance(PLAYER_GESTURE_HOLD_MS);
    dispatchPointer(surfaceNode, "pointerup", 9);
    const heldClick = createGestureEvent(surfaceNode, { pointerId: 9 });
    surfaceNode.dispatch("click", heldClick);
    assert.deepEqual(holds, [true, false]);
    assert.equal(heldClick.defaultPrevented, true);
    timers.advance(PLAYER_GESTURE_DOUBLE_ACTIVATION_MS);
    assert.equal(controlsVisible, false);
    assert.equal(paused, false);

    const controlClick = createGestureEvent(controlNode);
    surfaceNode.dispatch("click", controlClick);
    timers.advance(PLAYER_GESTURE_DOUBLE_ACTIVATION_MS);
    assert.equal(controlsVisible, false);
    assert.equal(paused, false);

    cleanup();
  });
});
