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
  const screen = {
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
  return screen;
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

test("Search → See All browser Back restores the actual Search history entry", async () => {
  const home = makeScreen("home");
  const search = makeScreen("search");
  const catalogSeeAll = makeScreen("catalogSeeAll");
  resetRouter({ home, search, catalogSeeAll });
  Router.init();

  await Router.navigate("search", { query: "one piece" });
  await Router.navigate("catalogSeeAll", { catalogId: "movies-search" });
  const historyCallCount = historyCalls.length;

  await dispatchPopstate({ route: "search", params: { query: "one piece" } });

  assert.equal(Router.getCurrent(), "search");
  assert.equal(historyCalls.length, historyCallCount, "popstate must not create a synthetic history entry");
  assert.equal(search.mounts.at(-1)?.context?.fromHistory, true);
});

test("valid browser history targets win over Detail origin fallbacks", async () => {
  const destinations = [
    { route: "home", params: {}, detailParams: { returnHomeOnBack: true } },
    { route: "search", params: { query: "one piece" }, detailParams: { returnToSearchOnBack: true } },
    { route: "folderDetail", params: { folderId: "collection-1" }, detailParams: {} },
    { route: "library", params: {}, detailParams: {} },
    { route: "discover", params: { tab: "popular" }, detailParams: {} },
    { route: "detail", params: { id: "movie-1" }, detailParams: { id: "movie-2" } }
  ];

  for (const destination of destinations) {
    const contexts = [];
    const home = makeScreen("home");
    const detail = makeScreen("detail", {
      consumeBackRequest(context) {
        contexts.push(context);
        // This models Detail's explicit Search/Home fallback: it is available
        // for app Back, but must not consume a valid browser-history target.
        return !context?.hasValidHistoryTarget && Boolean(this.originFallback);
      }
    });
    detail.originFallback = Boolean(
      destination.detailParams.returnHomeOnBack || destination.detailParams.returnToSearchOnBack
    );
    const target = destination.route === "detail" ? detail : makeScreen(destination.route);
    resetRouter({ home, detail, [destination.route]: target });
    Router.init();

    await Router.navigate(destination.route, destination.params);
    await Router.navigate("detail", destination.detailParams);
    const historyCallCount = historyCalls.length;

    await dispatchPopstate({ route: destination.route, params: destination.params });

    assert.equal(Router.getCurrent(), destination.route, `Back must restore ${destination.route}`);
    assert.equal(historyCalls.length, historyCallCount, `Back to ${destination.route} must not write history`);
    assert.deepEqual(contexts.at(-1), {
      source: "popstate",
      hasValidHistoryTarget: true,
      targetRoute: destination.route
    });
  }
});

test("Detail keeps origin fallback for explicit in-app Back while browser Back skips it", () => {
  const detail = Object.create(originalRoutes.detail);
  detail.seasonHoldMenu = null;
  detail.episodeHoldMenu = null;
  detail.posterOptionsController = null;
  detail.heroPlayMenu = null;
  detail.libraryListMenu = null;
  detail.desktopLibraryDestinationMenu = null;
  detail.isTrailerPlaying = false;
  detail.pendingEpisodeSelection = null;
  detail.pendingMovieSelection = null;
  detail.isLoadingDetail = false;
  let fallbackCalls = 0;
  detail.navigateBackFromDetail = () => {
    fallbackCalls += 1;
    return true;
  };

  assert.equal(
    detail.consumeBackRequest({ source: "popstate", hasValidHistoryTarget: true, targetRoute: "search" }),
    false
  );
  assert.equal(fallbackCalls, 0);
  assert.equal(detail.consumeBackRequest(), true);
  assert.equal(fallbackCalls, 1);

  assert.equal(
    detail.consumeBackRequest({ source: "popstate", hasValidHistoryTarget: false, targetRoute: null }),
    true
  );
  assert.equal(fallbackCalls, 2);

  detail.navigateBackFromDetail = () => false;
  detail.isLoadingDetail = true;
  assert.equal(
    detail.consumeBackRequest({ source: "popstate", hasValidHistoryTarget: true, targetRoute: "search" }),
    false
  );
});

test("an invalid popstate route remains eligible for Detail's existing origin fallback", async () => {
  const home = makeScreen("home");
  const contexts = [];
  const detail = makeScreen("detail", {
    consumeBackRequest(context) {
      contexts.push(context);
      return !context?.hasValidHistoryTarget;
    }
  });
  resetRouter({ home, detail });
  Router.init();
  await Router.navigate("home");
  await Router.navigate("detail", { id: "movie-1", returnHomeOnBack: true });

  await dispatchPopstate({ route: "removed-route", params: {} });

  assert.equal(Router.getCurrent(), "detail");
  assert.deepEqual(contexts.at(-1), {
    source: "popstate",
    hasValidHistoryTarget: false,
    targetRoute: null
  });
  assert.deepEqual(historyCalls.at(-1), {
    type: "push",
    state: { route: "detail", params: { id: "movie-1", returnHomeOnBack: true } }
  });
});

test("an active Detail overlay still consumes browser Back before route restoration", async () => {
  const home = makeScreen("home");
  const contexts = [];
  const detail = makeScreen("detail", {
    consumeBackRequest(context) {
      contexts.push(context);
      return true;
    }
  });
  resetRouter({ home, detail });
  Router.init();
  await Router.navigate("home");
  await Router.navigate("detail", { id: "movie-1" });

  await dispatchPopstate({ route: "home", params: {} });

  assert.equal(Router.getCurrent(), "detail");
  assert.deepEqual(contexts.at(-1), {
    source: "popstate",
    hasValidHistoryTarget: true,
    targetRoute: "home"
  });
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
