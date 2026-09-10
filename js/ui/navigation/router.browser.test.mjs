import assert from "node:assert/strict";
import test from "node:test";

globalThis.__NUVIO_PLATFORM__ = "browser";

const listeners = new Map();
const historyCalls = [];
const history = {
  state: null,
  replaceState(state) {
    this.state = state;
    historyCalls.push({ type: "replace", state });
  },
  pushState(state) {
    this.state = state;
    historyCalls.push({ type: "push", state });
  },
  back() {
    historyCalls.push({ type: "back" });
  }
};

const testDocument = {
  body: { classList: { contains: () => false } },
  documentElement: {},
  title: "",
  addEventListener() {},
  removeEventListener() {}
};
const testWindow = {
  history,
  addEventListener(type, handler) {
    const handlers = listeners.get(type) || [];
    handlers.push(handler);
    listeners.set(type, handlers);
  },
  removeEventListener() {},
  matchMedia: () => ({ matches: false })
};

const originalDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
Object.defineProperty(globalThis, "document", {
  configurable: true,
  writable: true,
  value: testDocument
});
Object.defineProperty(globalThis, "window", {
  configurable: true,
  writable: true,
  value: testWindow
});

const { Platform } = await import("../../platform/index.js");
Platform.current = null;
const { Router } = await import("./router.js");

const originalRoutes = Router.routes;
const originalExitApp = Platform.exitApp;

function makeScreen(name, options = {}) {
  return {
    name,
    mounts: [],
    cleanupCalls: 0,
    mount(params, context) {
      this.mounts.push({ params, context });
    },
    cleanup() {
      this.cleanupCalls += 1;
    },
    consumeBackRequest: options.consumeBackRequest || (() => false),
    shouldReturnToStreamOnBack: options.shouldReturnToStreamOnBack,
    hasBackDismissableOverlay: options.hasBackDismissableOverlay
  };
}

function resetRouter(routes) {
  Router.routes = routes;
  Router.current = null;
  Router.currentParams = {};
  Router.stack = [];
  Router.historyInitialized = false;
  Router.popstateBound = false;
  Router.suppressPopstateUntil = 0;
  Router.skipConsumeNextPopstate = false;
  Router.ignoreNextPopstate = false;
  Router.browserPullToRefreshCleanup?.();
  Router.browserPullToRefreshCleanup = null;
  history.state = null;
  historyCalls.length = 0;
  listeners.clear();
}

function dispatchPopstate(state) {
  const handler = listeners.get("popstate")?.at(-1);
  assert.ok(handler, "Router.init() must attach the browser popstate handler");
  return handler({ state });
}

test("browser History restores Detail → Stream → Player route transitions", async () => {
  const home = makeScreen("home");
  const detail = makeScreen("detail");
  const stream = makeScreen("stream");
  const player = makeScreen("player", {
    shouldReturnToStreamOnBack: () => true,
    hasBackDismissableOverlay: () => false
  });
  resetRouter({ home, detail, stream, player });
  Router.init();

  await Router.navigate("home");
  await Router.navigate("detail", { id: "movie-1" });
  await Router.navigate("stream", { id: "movie-1" });
  await Router.navigate("player", { id: "movie-1" });
  assert.deepEqual(historyCalls.map((entry) => entry.type), ["replace", "push", "push", "push"]);

  await dispatchPopstate({ route: "stream", params: { id: "movie-1" } });
  assert.equal(Router.getCurrent(), "stream");
  assert.equal(stream.mounts.at(-1)?.context?.fromHistory, true);

  await dispatchPopstate({ route: "detail", params: { id: "movie-1" } });
  assert.equal(Router.getCurrent(), "detail");
  assert.equal(detail.mounts.at(-1)?.context?.isBackNavigation, true);
});

test("a modal consumes browser Back before Router changes the current route", async () => {
  const home = makeScreen("home");
  const detail = makeScreen("detail", { consumeBackRequest: () => true });
  resetRouter({ home, detail });
  Router.init();
  await Router.navigate("home");
  await Router.navigate("detail", { id: "movie-1" });

  await dispatchPopstate({ route: "home", params: {} });
  assert.equal(Router.getCurrent(), "detail");
  assert.deepEqual(historyCalls.at(-1), {
    type: "push",
    state: { route: "detail", params: { id: "movie-1" } }
  });
});

test("root browser Back does not request native app exit or install TV route guards", async () => {
  const home = makeScreen("home");
  resetRouter({ home });
  Router.init();
  await Router.navigate("home");
  let nativeExitCalls = 0;
  Platform.exitApp = () => {
    nativeExitCalls += 1;
  };
  try {
    await Router.back();
    await dispatchPopstate(null);
    assert.equal(Router.getCurrent(), "home");
    assert.equal(nativeExitCalls, 0);
    assert.equal(historyCalls.filter((entry) => entry.type === "back").length, 0);
    assert.equal("consumeWebOsResumeRoute" in Router, false);
    assert.equal("persistWebOsResumeRoute" in Router, false);
    assert.equal("beginRouteReturnBackGuard" in Router, false);
  } finally {
    Platform.exitApp = originalExitApp;
  }
});

test.after(() => {
  Router.routes = originalRoutes;
  Platform.exitApp = originalExitApp;
  if (originalDocument) Object.defineProperty(globalThis, "document", originalDocument);
  else delete globalThis.document;
  if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
  else delete globalThis.window;
  delete globalThis.__NUVIO_PLATFORM__;
});
