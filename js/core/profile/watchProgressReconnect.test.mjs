import assert from "node:assert/strict";
import test from "node:test";
import {
  installWatchProgressReconnectSync,
  resetWatchProgressReconnectSyncForTests
} from "./watchProgressReconnect.js";

function createRuntime({ visibilityState = "visible", onLine = true } = {}) {
  const listeners = new Map();
  const add = (type, handler) => listeners.set(type, [...(listeners.get(type) || []), handler]);
  const runtime = {
    listeners,
    navigator: { onLine },
    addEventListener: (type, handler) => add(type, handler),
    document: {
      visibilityState,
      addEventListener: (type, handler) => add(type, handler)
    },
    fire: (type) => (listeners.get(type) || []).forEach((handler) => handler())
  };
  return runtime;
}

// The foreground path asks an async question before deciding, so the answer
// lands a few microtasks after the event.
async function settle() {
  for (let index = 0; index < 6; index += 1) await Promise.resolve();
}

test("coming back online triggers a sync", () => {
  resetWatchProgressReconnectSyncForTests();
  const runtime = createRuntime();
  let runs = 0;
  installWatchProgressReconnectSync({
    runtime,
    sync: () => (runs += 1),
    hasPendingWork: () => false
  });
  assert.equal(runs, 0, "installing alone syncs nothing when nothing is owed");
  runtime.fire("online");
  assert.equal(runs, 1);
  runtime.fire("online");
  assert.equal(runs, 2);
});

// Two listeners would run two merges against one another on every reconnect,
// each writing what the other is still reading.
test("installing twice binds one listener", () => {
  resetWatchProgressReconnectSyncForTests();
  const runtime = createRuntime();
  let runs = 0;
  assert.equal(installWatchProgressReconnectSync({ runtime, sync: () => (runs += 1) }), true);
  assert.equal(installWatchProgressReconnectSync({ runtime, sync: () => (runs += 1) }), false);
  runtime.fire("online");
  assert.equal(runs, 1);
});

test("a runtime with no events is left alone rather than failing", () => {
  resetWatchProgressReconnectSyncForTests();
  assert.equal(installWatchProgressReconnectSync({ runtime: {} }), false);
  assert.equal(installWatchProgressReconnectSync({ runtime: null }), false);
});

// A rejection escaping into the browser's own event dispatch is reported
// nowhere, so the failure has to be caught on this side of it.
test("a rejected sync is reported, not lost", async () => {
  resetWatchProgressReconnectSyncForTests();
  const runtime = createRuntime();
  const errors = [];
  installWatchProgressReconnectSync({
    runtime,
    sync: () => Promise.reject(new Error("offline still")),
    onError: (error) => errors.push(String(error.message))
  });
  runtime.fire("online");
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(errors, ["offline still"]);
});

test("a sync that throws outright is reported too", () => {
  resetWatchProgressReconnectSyncForTests();
  const runtime = createRuntime();
  const errors = [];
  installWatchProgressReconnectSync({
    runtime,
    sync: () => {
      throw new Error("threw before returning");
    },
    onError: (error) => errors.push(String(error.message))
  });
  runtime.fire("online");
  assert.deepEqual(errors, ["threw before returning"]);
});

// `online` is the obvious trigger but an installed iOS PWA may not fire it when
// Airplane Mode goes off. Returning to the app is a transition the platform does
// report, so a push still owed is retried then as well.
test("returning to the app retries a push that is still owed", async () => {
  resetWatchProgressReconnectSyncForTests();
  const runtime = createRuntime();
  let runs = 0;
  installWatchProgressReconnectSync({
    runtime,
    sync: () => (runs += 1),
    hasPendingWork: () => true
  });
  // Startup syncs once on its own now, so what this measures is the return.
  await settle();
  const afterStartup = runs;
  runtime.fire("visibilitychange");
  await settle();
  assert.equal(runs - afterStartup, 1);
});

// Otherwise every foreground would mean a full pull and push for nothing.
test("returning with nothing owed syncs nothing", async () => {
  resetWatchProgressReconnectSyncForTests();
  const runtime = createRuntime();
  let runs = 0;
  installWatchProgressReconnectSync({
    runtime,
    sync: () => (runs += 1),
    hasPendingWork: () => false
  });
  runtime.fire("visibilitychange");
  await settle();
  assert.equal(runs, 0);
});

test("leaving the app is not a return", async () => {
  resetWatchProgressReconnectSyncForTests();
  const runtime = createRuntime({ visibilityState: "hidden" });
  let runs = 0;
  installWatchProgressReconnectSync({
    runtime,
    sync: () => (runs += 1),
    hasPendingWork: () => true
  });
  await settle();
  const afterStartup = runs;
  runtime.fire("visibilitychange");
  await settle();
  assert.equal(runs - afterStartup, 0);
});

// Foregrounding while still offline would only fail again and re-arm the backoff.
test("returning while still offline waits", async () => {
  resetWatchProgressReconnectSyncForTests();
  const runtime = createRuntime({ onLine: false });
  let runs = 0;
  installWatchProgressReconnectSync({
    runtime,
    sync: () => (runs += 1),
    hasPendingWork: () => true
  });
  runtime.fire("visibilitychange");
  await settle();
  assert.equal(runs, 0);
});

// `online` is unconditional: it is the event that says the outage is over.
test("coming online syncs without asking whether work is owed", () => {
  resetWatchProgressReconnectSyncForTests();
  const runtime = createRuntime();
  let runs = 0;
  installWatchProgressReconnectSync({
    runtime,
    sync: () => (runs += 1),
    hasPendingWork: () => false
  });
  runtime.fire("online");
  assert.equal(runs, 1);
});

test("a runtime with no document still binds the online trigger", () => {
  resetWatchProgressReconnectSyncForTests();
  const listeners = new Map();
  const runtime = {
    addEventListener: (type, handler) => listeners.set(type, handler)
  };
  let runs = 0;
  assert.equal(installWatchProgressReconnectSync({ runtime, sync: () => (runs += 1) }), true);
  listeners.get("online")();
  assert.equal(runs, 1);
});

// Coming back online usually happens while Nuvio is closed: the network
// returns, and the app is launched afterwards. Then there is no `online` to
// hear -- the network was up before the page existed -- and no return to the
// foreground, because the page is born visible. Startup only pulls, so viewing
// recorded offline stayed on the device until something else pushed it.
test("opening the app with viewing still unsent syncs it", async () => {
  resetWatchProgressReconnectSyncForTests();
  const runtime = createRuntime();
  const triggers = [];
  installWatchProgressReconnectSync({
    runtime,
    sync: (trigger) => triggers.push(trigger),
    hasPendingWork: () => true
  });
  await settle();
  assert.deepEqual(triggers, ["startup"]);
});

test("opening the app with nothing owed costs no sync", async () => {
  resetWatchProgressReconnectSyncForTests();
  const runtime = createRuntime();
  let runs = 0;
  installWatchProgressReconnectSync({
    runtime,
    sync: () => (runs += 1),
    hasPendingWork: () => false
  });
  await settle();
  assert.equal(runs, 0);
});

// Launching while still offline would only fail and re-arm the backoff; the
// `online` event is what covers that case.
test("opening the app while offline waits", async () => {
  resetWatchProgressReconnectSyncForTests();
  const runtime = createRuntime({ onLine: false });
  let runs = 0;
  installWatchProgressReconnectSync({
    runtime,
    sync: () => (runs += 1),
    hasPendingWork: () => true
  });
  await settle();
  assert.equal(runs, 0);
  runtime.fire("online");
  assert.equal(runs, 1);
});

// The debt is recorded before anything awaits, so the push owed from the
// offline session cannot get out ahead of the startup pull either.
test("the startup sync claims its pull before syncing", async () => {
  resetWatchProgressReconnectSyncForTests();
  const runtime = createRuntime();
  const order = [];
  installWatchProgressReconnectSync({
    runtime,
    sync: () => order.push("sync"),
    notePullOwed: () => order.push("debt"),
    hasPendingWork: () => true
  });
  await settle();
  assert.deepEqual(order, ["debt", "sync"]);
});
