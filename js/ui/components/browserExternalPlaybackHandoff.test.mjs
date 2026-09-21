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

// The first collection attempt runs in the same task as the wake-up rather
// than through a timer, so the queue has to be given a chance to fill before
// it is drained, and again after each retry schedules the next one.
async function settle() {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
}

async function drainTimers(timers) {
  await settle();
  while (timers.length) {
    await timers.shift()();
    await settle();
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
  // The page is already visible, so the first attempt goes out during install
  // rather than waiting on a timer.
  await enteredApply;
  assert.equal(timers.length, 0, "a report found immediately schedules no retry");
  assert.equal(prompts, 0);
  resolveApply(true);
  await settle();
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

test("the first collection attempt does not wait on a timer", async () => {
  // Coming back wakes the rest of the app too, and a queued first attempt sat
  // behind all of it -- measured at 1.6s on a device before a request had even
  // left. Only the retries are allowed to wait.
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
  let requests = 0;
  installExternalPlaybackReturnCoordinator({
    runtime,
    fetchImpl: async () => {
      requests += 1;
      return { ok: true, json: async () => ({ found: false }) };
    }
  });
  await settle();
  assert.equal(requests, 1, "asked before any timer ran");
  assert.equal(timers.length, 1, "the retry after it is still scheduled");
});

test("a report that arrives after the prompt is still collected and takes it away", async () => {
  // The dead end this replaces: once the prompt had gone up, the handoff was
  // marked manual-required and every later return was refused for the ten
  // minutes it lives -- even with the report sitting on the relay by then. The
  // progress stayed lost until the page was reloaded.
  const runtime = createRuntime();
  const timers = [];
  const documentListeners = new Map();
  runtime.document = {
    visibilityState: "hidden",
    addEventListener: (name, listener) => documentListeners.set(name, listener)
  };
  runtime.addEventListener = () => {};
  runtime.setTimeout = (listener) => timers.push(listener);
  runtime.clearTimeout = () => {};
  // Lenna is the player that offers the prompt when its callback cannot be read.
  beginExternalPlaybackHandoff({
    runtime,
    playerMode: "lenna",
    automatic: true,
    manualPromptEligible: true,
    progressContext
  });
  let hasReport = false;
  let prompts = 0;
  let dismissals = 0;
  let applied = 0;
  installExternalPlaybackReturnCoordinator({
    runtime,
    fetchImpl: async () => ({
      ok: true,
      json: async () =>
        hasReport
          ? { found: true, outcome: "stopped", position: 30, duration: 60 }
          : { found: false }
    }),
    onAutomaticReport: async () => {
      applied += 1;
      return true;
    },
    onManualFallback: () => {
      prompts += 1;
    },
    onManualFallbackResolved: () => {
      dismissals += 1;
    }
  });

  // First return: the report has not landed, so all attempts come up empty.
  runtime.document.visibilityState = "visible";
  documentListeners.get("visibilitychange")();
  await drainTimers(timers);
  assert.equal(prompts, 1, "the prompt appears once");
  assert.equal(applied, 0);

  // The report lands, and the viewer comes back again.
  hasReport = true;
  runtime.document.visibilityState = "hidden";
  documentListeners.get("visibilitychange")();
  runtime.document.visibilityState = "visible";
  documentListeners.get("visibilitychange")();
  await drainTimers(timers);
  assert.equal(applied, 1, "the late report is collected, not refused");
  assert.equal(dismissals, 1, "and the prompt is taken away");
  assert.equal(prompts, 1, "without ever asking twice");
});

// Handing a downloaded file to another app navigates this page away, so the app
// comes back as a cold start. Waiting for a visibility transition that the
// destroyed JS context never saw meant the watch was silently never recorded.
test("a handoff that navigated the page away prompts on the reload that follows", () => {
  const runtime = createRuntime();
  runtime.document = { visibilityState: "visible", addEventListener() {} };
  runtime.addEventListener = () => {};
  runtime.setTimeout = () => {};
  beginExternalPlaybackHandoff({
    runtime,
    playerMode: "offline-file",
    automatic: false,
    navigationLaunch: true,
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
  assert.equal(prompts, 1);
});

// A URL-scheme launch leaves the page alive, so a pending manual handoff seen at
// startup means an ordinary later launch, not a return -- prompting there would
// ask about a playback the viewer never started.
test("an ordinary manual handoff still stays silent at startup", () => {
  const runtime = createRuntime();
  runtime.document = { visibilityState: "visible", addEventListener() {} };
  runtime.addEventListener = () => {};
  runtime.setTimeout = () => {};
  beginExternalPlaybackHandoff({
    runtime,
    playerMode: "vlc",
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
  assert.equal(prompts, 0);
});
