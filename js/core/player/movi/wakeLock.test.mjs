import assert from "node:assert/strict";
import test from "node:test";
import { createWakeLock } from "./wakeLock.js";

function fakeWakeLockApi({ refuse = false } = {}) {
  const calls = [];
  const api = {
    last: null,
    async request(kind) {
      calls.push(kind);
      if (refuse) throw new Error("NotAllowedError");
      const handlers = {};
      const sentinel = {
        kind,
        released: 0,
        addEventListener(name, fn) {
          handlers[name] = fn;
        },
        release() {
          this.released += 1;
        },
        emitRelease() {
          handlers.release?.();
        }
      };
      api.last = sentinel;
      return sentinel;
    }
  };
  return { api, calls };
}

function fakeVisibility(initial = "hidden") {
  const handlers = {};
  const source = {
    visibilityState: initial,
    addEventListener(name, fn) {
      handlers[name] = fn;
    },
    removeEventListener(name) {
      delete handlers[name];
    },
    emit(state) {
      source.visibilityState = state;
      handlers.visibilitychange?.();
    }
  };
  return source;
}

test("starting takes the lock exactly once, and only for the screen", async () => {
  const { api, calls } = fakeWakeLockApi();
  const lock = createWakeLock({ wakeLockApi: api, visibilitySource: fakeVisibility("visible") });

  assert.equal(await lock.start(), true);
  assert.equal(await lock.start(), true);
  assert.deepEqual(calls, ["screen"]);
  assert.equal(lock.isHeld(), true);
});

test("a platform without the API is a no-op, not a failure", async () => {
  const lock = createWakeLock({
    wakeLockApi: undefined,
    visibilitySource: fakeVisibility("visible")
  });
  assert.equal(await lock.start(), false);
  assert.equal(lock.isHeld(), false);
  await lock.stop();
});

test("a refused request is swallowed: playback must not depend on it", async () => {
  const { api } = fakeWakeLockApi({ refuse: true });
  const warnings = [];
  const lock = createWakeLock({
    wakeLockApi: api,
    visibilitySource: fakeVisibility("visible"),
    warn: (message) => warnings.push(message)
  });

  assert.equal(await lock.start(), false);
  assert.equal(lock.isHeld(), false);
  assert.equal(warnings.length, 1);
});

test("coming back to the tab takes the lock again", async () => {
  const { api, calls } = fakeWakeLockApi();
  const visibility = fakeVisibility("hidden");
  const lock = createWakeLock({ wakeLockApi: api, visibilitySource: visibility });

  await lock.start();
  // Safari drops it while hidden; the release event says so.
  api.last.emitRelease();
  assert.equal(lock.isHeld(), false);

  visibility.emit("visible");
  await Promise.resolve();
  assert.deepEqual(calls, ["screen", "screen"]);
  assert.equal(lock.isHeld(), true);
});

test("stopping releases the lock and stops chasing it", async () => {
  const { api, calls } = fakeWakeLockApi();
  const visibility = fakeVisibility("visible");
  const lock = createWakeLock({ wakeLockApi: api, visibilitySource: visibility });

  await lock.start();
  const held = api.last;
  await lock.stop();

  assert.equal(held.released, 1);
  assert.equal(lock.isHeld(), false);

  visibility.emit("visible");
  await Promise.resolve();
  assert.deepEqual(calls, ["screen"], "a stopped lock must not re-acquire");
});
