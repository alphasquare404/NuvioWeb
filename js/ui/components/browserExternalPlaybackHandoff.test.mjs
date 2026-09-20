import assert from "node:assert/strict";
import test from "node:test";
import {
  beginExternalPlaybackHandoff,
  collectExternalPlaybackReport,
  createOutplayerReturnCallbacks,
  createOutplayerReturnToken,
  installExternalPlaybackReturnCoordinator,
  readPendingExternalPlaybackHandoff
} from "./browserExternalPlaybackHandoff.js";

function createRuntime() {
  const values = new Map();
  return {
    crypto: { getRandomValues: (bytes) => bytes.fill(0xab) },
    location: { href: "https://nuviotest.alphasquare.my.id/player?ignored=value" },
    localStorage: {
      getItem: (key) => values.get(key) || null,
      setItem: (key, value) => values.set(key, value),
      removeItem: (key) => values.delete(key)
    }
  };
}

const progressContext = { itemId: "movie:1", itemType: "movie", title: "A title" };

async function drainTimers(timers) {
  while (timers.length) {
    await timers.shift()();
  }
}

test("Outplayer HTTPS handoff uses a cryptographic opaque token and excludes media data", () => {
  const runtime = createRuntime();
  assert.equal(createOutplayerReturnToken(runtime), "abababababababababababababababab");
  const handoff = beginExternalPlaybackHandoff({
    runtime,
    playerMode: "outplayer",
    automatic: true,
    progressContext,
    profileId: "1",
    startingPositionMs: 1234
  });
  assert.equal(handoff.token.length, 32);
  assert.equal(handoff.returnOrigin, "https://nuviotest.alphasquare.my.id");
  assert.equal(handoff.startingPositionMs, 1234);
  assert.equal(JSON.stringify(handoff).includes("https://media"), false);
  const callbacks = createOutplayerReturnCallbacks({
    token: handoff.token,
    returnOrigin: handoff.returnOrigin
  });
  const success = new URL(callbacks.success);
  assert.equal(success.searchParams.get("outcome"), "stopped");
  assert.equal(success.searchParams.get("sourceOutcome"), "finished");
  assert.equal(success.searchParams.has("position"), false);
  assert.equal(success.searchParams.has("duration"), false);
  assert.equal(
    callbacks.cancel,
    `https://nuviotest.alphasquare.my.id/api/external-return/report/${handoff.token}?outcome=stopped&provider=outplayer`
  );
  assert.equal(
    createOutplayerReturnCallbacks({ token: "bad", returnOrigin: handoff.returnOrigin }),
    null
  );
});

test("Outplayer collector leaves a report handoff available until its domain update succeeds", async () => {
  const runtime = createRuntime();
  const handoff = beginExternalPlaybackHandoff({
    runtime,
    playerMode: "outplayer",
    automatic: true,
    progressContext
  });
  const requests = [];
  const fetchImpl = async (url) => {
    requests.push(url);
    return {
      ok: true,
      json: async () => ({ found: true, outcome: "stopped", position: 42, duration: 100 })
    };
  };
  const result = await collectExternalPlaybackReport({ runtime, fetchImpl });
  assert.deepEqual(result, {
    found: true,
    handoff,
    outcome: "stopped",
    provider: "",
    sourceOutcome: "stopped",
    positionSeconds: 42,
    durationSeconds: 100,
    progressFraction: null,
    parameterNames: []
  });
  assert.equal(
    requests[0],
    `https://nuviotest.alphasquare.my.id/api/external-return/collect/${handoff.token}`
  );
  assert.equal(readPendingExternalPlaybackHandoff({ runtime })?.token, handoff.token);
});

test("Outplayer collector waits for foreground before collecting a pending handoff", async () => {
  const runtime = createRuntime();
  const documentListeners = new Map();
  const windowListeners = new Map();
  const timers = [];
  runtime.document = {
    visibilityState: "hidden",
    addEventListener: (name, listener) => documentListeners.set(name, listener)
  };
  runtime.addEventListener = (name, listener) => windowListeners.set(name, listener);
  runtime.setTimeout = (listener) => timers.push(listener);
  beginExternalPlaybackHandoff({
    runtime,
    playerMode: "outplayer",
    automatic: true,
    progressContext
  });
  let requests = 0;
  installExternalPlaybackReturnCoordinator({
    runtime,
    fetchImpl: async () => {
      requests += 1;
      return { ok: true, json: async () => ({ found: false }) };
    }
  });
  assert.equal(requests, 0);
  runtime.document.visibilityState = "visible";
  documentListeners.get("visibilitychange")();
  await drainTimers(timers);
  assert.equal(requests, 4);
});

test("a stale or profile-mismatched handoff is discarded before it can update another profile", () => {
  const runtime = createRuntime();
  beginExternalPlaybackHandoff({
    runtime,
    playerMode: "outplayer",
    progressContext,
    profileId: "profile-a"
  });
  assert.equal(readPendingExternalPlaybackHandoff({ runtime, profileId: "profile-b" }), null);
});

test("automatic handoffs with no report never become manual prompts", async () => {
  const runtime = createRuntime();
  const timers = [];
  runtime.document = { visibilityState: "visible", addEventListener() {} };
  runtime.addEventListener = () => {};
  runtime.setTimeout = (listener) => timers.push(listener);
  beginExternalPlaybackHandoff({
    runtime,
    playerMode: "outplayer",
    automatic: true,
    progressContext
  });
  let prompts = 0;
  installExternalPlaybackReturnCoordinator({
    runtime,
    fetchImpl: async () => ({ ok: true, json: async () => ({ found: false }) }),
    onManualFallback: () => {
      prompts += 1;
    }
  });
  await drainTimers(timers);
  assert.equal(prompts, 0);
});

test("a finished automatic report on fresh startup applies once and never prompts", async () => {
  const runtime = createRuntime();
  const timers = [];
  runtime.document = { visibilityState: "visible", addEventListener() {} };
  runtime.addEventListener = () => {};
  runtime.setTimeout = (listener) => timers.push(listener);
  beginExternalPlaybackHandoff({
    runtime,
    playerMode: "outplayer",
    automatic: true,
    progressContext
  });
  let applied = 0;
  let prompts = 0;
  installExternalPlaybackReturnCoordinator({
    runtime,
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({ found: true, outcome: "finished", duration: 120 })
    }),
    onAutomaticReport: async (report) => {
      applied += 1;
      assert.equal(report.outcome, "finished");
      assert.equal(readPendingExternalPlaybackHandoff({ runtime })?.token, report.handoff.token);
      return true;
    },
    onManualFallback: () => {
      prompts += 1;
    }
  });
  await drainTimers(timers);
  assert.equal(applied, 1);
  assert.equal(prompts, 0);
  assert.equal(readPendingExternalPlaybackHandoff({ runtime }), null);
});

test("an automatic report that arrives during the bounded retry window suppresses manual fallback", async () => {
  const runtime = createRuntime();
  const timers = [];
  runtime.document = { visibilityState: "visible", addEventListener() {} };
  runtime.addEventListener = () => {};
  runtime.setTimeout = (listener) => timers.push(listener);
  beginExternalPlaybackHandoff({
    runtime,
    playerMode: "outplayer",
    automatic: true,
    progressContext
  });
  let polls = 0;
  let prompts = 0;
  installExternalPlaybackReturnCoordinator({
    runtime,
    fetchImpl: async () => ({
      ok: true,
      json: async () =>
        ++polls < 3
          ? { found: false }
          : { found: true, outcome: "stopped", position: 30, duration: 120 }
    }),
    onAutomaticReport: async () => true,
    onManualFallback: () => {
      prompts += 1;
    }
  });
  await drainTimers(timers);
  assert.equal(polls, 3);
  assert.equal(prompts, 0);
});

test("a slow automatic report application remains protected from manual fallback", async () => {
  const runtime = createRuntime();
  const timers = [];
  runtime.document = { visibilityState: "visible", addEventListener() {} };
  runtime.addEventListener = () => {};
  runtime.setTimeout = (listener) => timers.push(listener);
  beginExternalPlaybackHandoff({
    runtime,
    playerMode: "outplayer",
    automatic: true,
    progressContext
  });
  let resolveApply;
  let signalApply;
  const enteredApply = new Promise((resolve) => {
    signalApply = resolve;
  });
  let prompts = 0;
  installExternalPlaybackReturnCoordinator({
    runtime,
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({ found: true, outcome: "finished", duration: 120 })
    }),
    onAutomaticReport: () =>
      new Promise((resolve) => {
        resolveApply = resolve;
        signalApply();
      }),
    onManualFallback: () => {
      prompts += 1;
    }
  });
  const firstTimer = timers.shift();
  const applying = firstTimer();
  await enteredApply;
  assert.equal(prompts, 0);
  resolveApply(true);
  await applying;
  assert.equal(prompts, 0);
});

test("duplicate foreground events use one manual prompt for a manual handoff", async () => {
  const runtime = createRuntime();
  const timers = [];
  const documentListeners = new Map();
  const windowListeners = new Map();
  runtime.document = {
    visibilityState: "hidden",
    addEventListener: (name, listener) => documentListeners.set(name, listener)
  };
  runtime.addEventListener = (name, listener) => windowListeners.set(name, listener);
  runtime.setTimeout = (listener) => timers.push(listener);
  beginExternalPlaybackHandoff({
    runtime,
    playerMode: "outplayer",
    automatic: false,
    progressContext
  });
  let prompts = 0;
  installExternalPlaybackReturnCoordinator({
    runtime,
    fetchImpl: async () => ({ ok: true, json: async () => ({ found: false }) }),
    onManualFallback: () => {
      prompts += 1;
    }
  });
  runtime.document.visibilityState = "visible";
  documentListeners.get("visibilitychange")();
  windowListeners.get("focus")();
  windowListeners.get("pageshow")();
  await drainTimers(timers);
  assert.equal(prompts, 1);
});

test("duplicate foreground events cannot promote an automatic handoff to manual", async () => {
  const runtime = createRuntime();
  const timers = [];
  const documentListeners = new Map();
  const windowListeners = new Map();
  runtime.document = {
    visibilityState: "hidden",
    addEventListener: (name, listener) => documentListeners.set(name, listener)
  };
  runtime.addEventListener = (name, listener) => windowListeners.set(name, listener);
  runtime.setTimeout = (listener) => timers.push(listener);
  beginExternalPlaybackHandoff({
    runtime,
    playerMode: "outplayer",
    automatic: true,
    progressContext
  });
  let prompts = 0;
  installExternalPlaybackReturnCoordinator({
    runtime,
    fetchImpl: async () => ({ ok: true, json: async () => ({ found: false }) }),
    onManualFallback: () => {
      prompts += 1;
    }
  });
  runtime.document.visibilityState = "visible";
  documentListeners.get("visibilitychange")();
  windowListeners.get("focus")();
  windowListeners.get("pageshow")();
  await drainTimers(timers);
  assert.equal(prompts, 0);
});

test("an invalid automatic Lenna callback opens the shared manual fallback", async () => {
  const runtime = createRuntime();
  const timers = [];
  runtime.document = { visibilityState: "visible", addEventListener() {} };
  runtime.addEventListener = () => {};
  runtime.setTimeout = (listener) => timers.push(listener);
  beginExternalPlaybackHandoff({
    runtime,
    playerMode: "lenna",
    automatic: true,
    callbackCapable: false,
    manualPromptEligible: true,
    progressContext
  });
  let reports = 0;
  let prompts = 0;
  installExternalPlaybackReturnCoordinator({
    runtime,
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        found: true,
        outcome: "stopped",
        provider: "lenna",
        sourceOutcome: "error",
        position: null,
        duration: null
      })
    }),
    onAutomaticReport: async () => {
      reports += 1;
      return false;
    },
    onManualFallback: () => {
      prompts += 1;
    }
  });
  await drainTimers(timers);
  assert.equal(reports, 1);
  assert.equal(prompts, 1);
});

test("a valid automatic Lenna callback is consumed without a manual prompt", async () => {
  const runtime = createRuntime();
  const timers = [];
  runtime.document = { visibilityState: "visible", addEventListener() {} };
  runtime.addEventListener = () => {};
  runtime.setTimeout = (listener) => timers.push(listener);
  beginExternalPlaybackHandoff({
    runtime,
    playerMode: "lenna",
    automatic: true,
    callbackCapable: true,
    manualPromptEligible: true,
    knownDurationMs: 1_440_000,
    progressContext
  });
  let prompts = 0;
  installExternalPlaybackReturnCoordinator({
    runtime,
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        found: true,
        outcome: "stopped",
        provider: "lenna",
        sourceOutcome: "success",
        position: 30,
        duration: null
      })
    }),
    onAutomaticReport: async (report) =>
      report.provider === "lenna" &&
      report.positionSeconds === 30 &&
      report.handoff.knownDurationMs === 1_440_000,
    onManualFallback: () => {
      prompts += 1;
    }
  });
  await drainTimers(timers);
  assert.equal(prompts, 0);
});
