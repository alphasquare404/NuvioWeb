import assert from "node:assert/strict";
import test from "node:test";
import {
  hasActivePlayback,
  shouldReloadForNewWorker,
  watchServiceWorkerTakeover
} from "./serviceWorkerReload.js";

function fakeServiceWorker() {
  const listeners = new Map();
  return {
    controller: null,
    addEventListener(type, handler) {
      listeners.set(type, [...(listeners.get(type) || []), handler]);
    },
    removeEventListener(type, handler) {
      listeners.set(
        type,
        (listeners.get(type) || []).filter((entry) => entry !== handler)
      );
    },
    emit(type) {
      for (const handler of listeners.get(type) || []) {
        handler({ type });
      }
    },
    listenerCount(type) {
      return (listeners.get(type) || []).length;
    }
  };
}

function fakeDocument(media) {
  return {
    querySelectorAll(selector) {
      assert.equal(selector, "video, audio");
      return media;
    }
  };
}

test("a page that was never controlled does not reload on the first install", () => {
  assert.equal(shouldReloadForNewWorker({ hadController: false }), false);
});

test("a controlled page reloads once for the worker that replaces its own", () => {
  assert.equal(shouldReloadForNewWorker({ hadController: true }), true);
});

test("the reload is refused while media is playing, so a fix never stops playback", () => {
  assert.equal(shouldReloadForNewWorker({ hadController: true, playbackActive: true }), false);
});

test("the reload never repeats, even if the worker changes again", () => {
  assert.equal(shouldReloadForNewWorker({ hadController: true, reloading: true }), false);
});

test("playing media counts as active playback and paused or ended media does not", () => {
  assert.equal(hasActivePlayback(fakeDocument([{ paused: true, ended: false }])), false);
  assert.equal(hasActivePlayback(fakeDocument([{ paused: false, ended: true }])), false);
  assert.equal(hasActivePlayback(fakeDocument([{ paused: false, ended: false }])), true);
});

test("a document without media elements has nothing playing", () => {
  assert.equal(hasActivePlayback({}), false);
  assert.equal(hasActivePlayback(undefined), false);
});

test("takeover reloads exactly once, and only when the page was already controlled", () => {
  let reloads = 0;
  const controlled = fakeServiceWorker();
  watchServiceWorkerTakeover(controlled, {
    hadController: true,
    reload: () => {
      reloads += 1;
    },
    documentRef: fakeDocument([])
  });

  controlled.emit("controllerchange");
  controlled.emit("controllerchange");

  assert.equal(reloads, 1);
});

test("a first controller taking over never reloads the page", () => {
  let reloads = 0;
  const fresh = fakeServiceWorker();
  watchServiceWorkerTakeover(fresh, {
    hadController: false,
    reload: () => {
      reloads += 1;
    },
    documentRef: fakeDocument([])
  });

  fresh.emit("controllerchange");

  assert.equal(reloads, 0);
});

test("a takeover during playback waits instead of interrupting it", () => {
  let reloads = 0;
  const worker = fakeServiceWorker();
  const playing = fakeDocument([{ paused: false, ended: false }]);
  watchServiceWorkerTakeover(worker, {
    hadController: true,
    reload: () => {
      reloads += 1;
    },
    documentRef: playing
  });

  worker.emit("controllerchange");

  assert.equal(reloads, 0);
});

test("the returned teardown detaches the listener", () => {
  const worker = fakeServiceWorker();
  const teardown = watchServiceWorkerTakeover(worker, {
    hadController: true,
    reload: () => {},
    documentRef: fakeDocument([])
  });

  assert.equal(worker.listenerCount("controllerchange"), 1);
  teardown();
  assert.equal(worker.listenerCount("controllerchange"), 0);
});

test("an environment without a service worker is left alone", () => {
  assert.doesNotThrow(() => watchServiceWorkerTakeover(null, { hadController: true })());
  assert.doesNotThrow(() => watchServiceWorkerTakeover({}, { hadController: true })());
});
