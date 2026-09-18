import assert from "node:assert/strict";
import test from "node:test";

globalThis.__NUVIO_PLATFORM__ = "browser";

const listeners = new Map();
const historyCalls = [];
const screenContainers = new Map();

function makeStyle() {
  const values = new Map();
  return {
    display: "",
    getPropertyValue: (name) => values.get(name) || "",
    setProperty(name, value) {
      values.set(name, String(value));
      if (name === "display") this.display = String(value);
    },
    removeProperty(name) {
      values.delete(name);
      if (name === "display") this.display = "";
    }
  };
}

function makeContainer() {
  const attributes = new Map();
  return {
    style: makeStyle(),
    inert: false,
    getAttribute: (name) => attributes.get(name) ?? null,
    setAttribute: (name, value) => attributes.set(name, String(value)),
    removeAttribute: (name) => attributes.delete(name)
  };
}
const history = {
  entries: [{ state: null }],
  index: 0,
  pendingTraversal: Promise.resolve(),

  get state() {
    return this.entries[this.index]?.state ?? null;
  },

  replaceState(state) {
    this.entries[this.index] = { state };
    historyCalls.push({ type: "replace", state });
  },

  pushState(state) {
    this.entries.splice(this.index + 1);
    this.entries.push({ state });
    this.index = this.entries.length - 1;
    historyCalls.push({ type: "push", state });
  },

  back() {
    historyCalls.push({ type: "back" });
    if (this.index === 0) return;
    this.index -= 1;
    this.pendingTraversal = dispatchPopstate(this.state);
  },

  forward() {
    historyCalls.push({ type: "forward" });
    if (this.index >= this.entries.length - 1) return;
    this.index += 1;
    this.pendingTraversal = dispatchPopstate(this.state);
  },

  async whenSettled() {
    await this.pendingTraversal;
  },

  reset() {
    this.entries = [{ state: null }];
    this.index = 0;
    this.pendingTraversal = Promise.resolve();
  }
};

const testDocument = {
  body: { classList: { contains: () => false }, style: makeStyle() },
  documentElement: { style: makeStyle() },
  title: "",
  getElementById: (id) => screenContainers.get(id) || null,
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
Object.defineProperty(globalThis, "document", { configurable: true, writable: true, value: testDocument });
Object.defineProperty(globalThis, "window", { configurable: true, writable: true, value: testWindow });

const { Platform } = await import("../../platform/index.js");
Platform.current = null;
const { Router } = await import("./router.js");
const { RouteStateStore } = await import("./routeStateStore.js");

const originalRoutes = Router.routes;
const originalExitApp = Platform.exitApp;

function makeScreen(name, options = {}) {
  return {
    name,
    mounts: [],
    cleanupCalls: 0,
    async mount(params, context) {
      this.params = params;
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

function makeRouteStateScreen(name, routeStateKey) {
  const screen = makeScreen(name);
  screen.value = "";
  screen.getRouteStateKey = () => routeStateKey;
  screen.captureRouteState = () => ({ value: screen.value });
  screen.mount = async function mount(params, context) {
    this.params = params;
    this.value = context?.restoreRouteState && context?.restoredState
      ? String(context.restoredState.value || "")
      : String(params?.value || "");
    this.mounts.push({ params, context, value: this.value });
  };
  return screen;
}

function makeVisualRouteStateScreen(name, routeStateKey) {
  const screen = makeRouteStateScreen(name, routeStateKey);
  screen.visualState = { scrollTop: 0, railLeft: 0, focusId: null };
  screen.captureRouteState = () => ({
    value: screen.value,
    visualState: { ...screen.visualState }
  });
  screen.mount = async function mount(params, context) {
    this.params = params;
    const restored = context?.restoreRouteState ? context?.restoredState || null : null;
    this.value = restored ? String(restored.value || "") : String(params?.value || "");
    this.visualState = restored?.visualState
      ? { ...restored.visualState }
      : { scrollTop: 0, railLeft: 0, focusId: null };
    this.mounts.push({ params, context, value: this.value, visualState: this.visualState });
  };
  return screen;
}

function makeFolderRouteStateScreen() {
  const screen = makeRouteStateScreen("folderDetail", "");
  screen.getRouteStateKey = (params = {}) => {
    const collectionId = String(params.collectionId || "");
    const folderId = String(params.folderId || "");
    return collectionId && folderId ? `folderDetail:${collectionId}:${folderId}` : null;
  };
  screen.tab = 0;
  screen.captureRouteState = () => ({ tab: screen.tab });
  screen.mount = async function mount(params, context) {
    this.params = params;
    this.tab = context?.restoreRouteState && context?.restoredState
      ? Number(context.restoredState.tab || 0)
      : 0;
    this.mounts.push({ params, context, tab: this.tab });
  };
  return screen;
}

function makeDetailScreen() {
  const screen = Object.create(originalRoutes.detail);
  screen.mounts = [];
  screen.seasonHoldMenu = null;
  screen.episodeHoldMenu = null;
  screen.posterOptionsController = null;
  screen.heroPlayMenu = null;
  screen.libraryListMenu = null;
  screen.desktopLibraryDestinationMenu = null;
  screen.isTrailerPlaying = false;
  screen.pendingEpisodeSelection = null;
  screen.pendingMovieSelection = null;
  screen.isLoadingDetail = false;
  screen.mount = async function mount(params, context) {
    this.params = params;
    this.mounts.push({ params, context });
  };
  screen.cleanup = () => {};
  return screen;
}

function makeDeferredContinueWatchingDetailScreen() {
  const screen = makeDetailScreen();
  screen.committedContinueWatchingRoutes = [];
  screen.mount = async function mount(params, context) {
    this.params = params;
    this.isBackNavigation = Boolean(context?.isBackNavigation);
    this.mounts.push({ params, context });
  };
  screen.afterNavigationCommit = function afterNavigationCommit(params, context) {
    if (!params.autoOpenContinueWatching || context?.isBackNavigation) return;
    this.committedContinueWatchingRoutes.push({
      route: history.state?.route,
      index: history.state?.__nuvioHistory?.index
    });
    void Router.navigate(
      "stream",
      {
        itemId: params.itemId,
        itemType: params.itemType,
        returnToDetail: true,
        continueWatchingBackHome: true
      },
      { skipStackPush: true, replaceHistory: true }
    );
  };
  screen.cleanup = () => {};
  return screen;
}

function makeStreamScreen() {
  const screen = Object.create(originalRoutes.stream);
  screen.mounts = [];
  screen.mount = async function mount(params, context) {
    this.params = params;
    this.mounts.push({ params, context });
  };
  screen.cleanup = () => {};
  return screen;
}

function makePlayerBackScreen() {
  const screen = Object.create(originalRoutes.player);
  screen.mounts = [];
  screen.playerBackNavigationInProgress = false;
  screen.episodes = [];
  screen.controlsVisible = false;
  screen.loadingVisible = false;
  screen.hasPresentedPlaybackFrame = true;
  screen.nextEpisodeBackExitArmed = false;
  screen.mount = async function mount(params, context) {
    this.params = params;
    this.mounts.push({ params, context });
  };
  screen.cleanup = () => {};
  screen.getPlaybackCurrentSeconds = () => 0;
  screen.resolveCurrentEpisodeEntry = () => null;
  screen.resolveNextEpisodeInfo = () => null;
  screen.isStartupErrorVisible = () => false;
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
  Router.browserHistoryIndex = null;
  Router.browserHistoryProvenance = null;
  Router.suspendedRouteStack = [];
  Router.suspendedDocumentChrome = null;
  Router.pendingPreviousRouteBack = null;
  Router.browserPullToRefreshCleanup?.();
  Router.browserPullToRefreshCleanup = null;
  RouteStateStore.clearAll();
  history.reset();
  historyCalls.length = 0;
  listeners.clear();
  screenContainers.clear();
}

test("route snapshots are scoped to each Search history entry and fresh Search stays fresh", async () => {
  const home = makeScreen("home");
  const search = makeRouteStateScreen("search", "route:search");
  const detail = makeScreen("detail");
  resetRouter({ home, search, detail });
  Router.init();

  await Router.navigate("home");
  await Router.navigate("search");
  search.value = "batman";
  await Router.navigate("detail", { itemId: "movie-a" });
  await Router.back();
  await history.whenSettled();
  assert.equal(search.value, "batman");

  await Router.navigate("home");
  await Router.navigate("search");
  assert.equal(search.value, "", "a fresh Search entry must not receive Search entry #1 state");
  search.value = "superman";
  await Router.navigate("detail", { itemId: "movie-b" });
  await Router.back();
  await history.whenSettled();
  assert.equal(search.value, "superman");

  history.back();
  await history.whenSettled();
  history.back();
  await history.whenSettled();
  assert.equal(Router.getCurrent(), "search");
  assert.equal(search.value, "batman", "the earlier Search entry restores its own snapshot");
});

test("visual route state restores only on the same history entry and ignores a missing focus target", async () => {
  const home = makeScreen("home");
  const search = makeRouteStateScreen("search", "route:search");
  const detail = makeScreen("detail");
  search.visual = { scrollTop: 0, railLeft: 0, focusId: null };
  search.captureRouteState = () => ({ value: search.value, visualState: search.visual });
  search.mount = async function mount(params, context) {
    this.params = params;
    this.value = context?.restoreRouteState && context?.restoredState
      ? String(context.restoredState.value || "")
      : String(params?.value || "");
    this.visual = context?.restoreRouteState && context?.restoredState?.visualState
      ? context.restoredState.visualState
      : { scrollTop: 0, railLeft: 0, focusId: null };
    this.mounts.push({ params, context, value: this.value, visual: this.visual });
  };
  resetRouter({ home, search, detail });
  Router.init();

  await Router.navigate("home");
  await Router.navigate("search");
  search.value = "batman";
  search.visual = { scrollTop: 640, railLeft: 180, focusId: "missing-card" };
  await Router.navigate("detail", { itemId: "movie-a" });
  await Router.back();
  await history.whenSettled();
  assert.deepEqual(search.visual, { scrollTop: 640, railLeft: 180, focusId: "missing-card" });

  await Router.navigate("home");
  await Router.navigate("search");
  assert.deepEqual(search.visual, { scrollTop: 0, railLeft: 0, focusId: null }, "a fresh entry must not reuse visual state");

  search.value = "superman";
  search.visual = { scrollTop: 240, railLeft: 80, focusId: "missing-card" };
  await Router.navigate("detail", { itemId: "movie-b" });
  history.back();
  await history.whenSettled();
  assert.equal(search.value, "superman", "logical Issue #5 state and visual Issue #6 state restore together");
  assert.deepEqual(search.visual, { scrollTop: 240, railLeft: 80, focusId: "missing-card" });
});

test("Home, Search, and Discover restore their visual snapshots on browser Back", async () => {
  const home = makeVisualRouteStateScreen("home", "route:home");
  const search = makeVisualRouteStateScreen("search", "route:search");
  const discover = makeVisualRouteStateScreen("discover", "route:discover");
  const detail = makeScreen("detail");
  resetRouter({ home, search, discover, detail });
  Router.init();

  await Router.navigate("home");
  home.visualState = { scrollTop: 540, railLeft: 170, focusId: null };
  await Router.navigate("detail", { itemId: "home-item" });
  history.back();
  await history.whenSettled();
  assert.deepEqual(home.visualState, { scrollTop: 540, railLeft: 170, focusId: null });

  await Router.navigate("search");
  search.value = "batman";
  search.visualState = { scrollTop: 720, railLeft: 0, focusId: "missing-card" };
  await Router.navigate("detail", { itemId: "search-item" });
  history.back();
  await history.whenSettled();
  assert.equal(search.value, "batman");
  assert.deepEqual(search.visualState, { scrollTop: 720, railLeft: 0, focusId: "missing-card" });

  await Router.navigate("discover");
  discover.visualState = { scrollTop: 960, railLeft: 0, focusId: "missing-card" };
  await Router.navigate("detail", { itemId: "discover-item" });
  history.back();
  await history.whenSettled();
  assert.deepEqual(discover.visualState, { scrollTop: 960, railLeft: 0, focusId: "missing-card" });
});

test("replaceHistory clears obsolete entry snapshots before a different route occupies that entry", async () => {
  const home = makeScreen("home");
  const search = makeRouteStateScreen("search", "route:search");
  const detail = makeRouteStateScreen("detail", "detail:movie-1");
  resetRouter({ home, search, detail });
  Router.init();

  await Router.navigate("home");
  await Router.navigate("search");
  search.value = "old search";
  await Router.navigate("detail", { itemId: "movie-1" }, { replaceHistory: true });
  history.back();
  await history.whenSettled();
  history.forward();
  await history.whenSettled();

  assert.equal(Router.getCurrent(), "detail");
  assert.equal(detail.value, "", "a replacement route must not inherit the replaced Search snapshot");
});

test("browser Forward restores the snapshot captured for the forward entry", async () => {
  const home = makeScreen("home");
  const search = makeRouteStateScreen("search", "route:search");
  const detail = makeRouteStateScreen("detail", "detail:movie-1");
  resetRouter({ home, search, detail });
  Router.init();

  await Router.navigate("home");
  await Router.navigate("search");
  search.value = "batman";
  await Router.navigate("detail", { itemId: "movie-1" });
  detail.value = "movie metadata";

  history.back();
  await history.whenSettled();
  assert.equal(search.value, "batman");
  history.forward();
  await history.whenSettled();
  assert.equal(Router.getCurrent(), "detail");
  assert.equal(detail.value, "movie metadata");
});

test("folder route state restores only the matching historical folder entry", async () => {
  const home = makeScreen("home");
  const folderDetail = makeFolderRouteStateScreen();
  const detail = makeScreen("detail");
  resetRouter({ home, folderDetail, detail });
  Router.init();

  const folderA = { collectionId: "collection-1", folderId: "folder-a" };
  const folderB = { collectionId: "collection-1", folderId: "folder-b" };
  await Router.navigate("home");
  await Router.navigate("folderDetail", folderA);
  folderDetail.tab = 2;
  await Router.navigate("detail", { itemId: "movie-1" });
  await Router.back();
  await history.whenSettled();
  assert.equal(folderDetail.tab, 2);

  await Router.navigate("home");
  await Router.navigate("folderDetail", folderA);
  assert.equal(folderDetail.tab, 0, "a fresh folder entry must not consume an earlier visit");
  await Router.navigate("folderDetail", folderB);
  assert.equal(folderDetail.tab, 0, "folder A state must not restore into folder B");
});

function dispatchPopstate(state) {
  const handler = listeners.get("popstate")?.at(-1);
  assert.ok(handler, "Router.init() must attach the browser popstate handler");
  return handler({ state });
}

async function flushNavigation() {
  await Promise.resolve();
  await Promise.resolve();
}

function historyRoutes() {
  return history.entries.map((entry) => entry.state?.route || null);
}

test("Detail app Back reuses Search, then browser Back reaches Home without a duplicate Search entry", async () => {
  const home = makeScreen("home");
  const search = makeScreen("search");
  const detail = makeDetailScreen();
  resetRouter({ home, search, detail });
  Router.init();

  await Router.navigate("home");
  await Router.navigate("search", { query: "one piece" });
  await Router.navigate("detail", { id: "movie-1", returnToSearchOnBack: true });

  await Router.back();
  await history.whenSettled();
  assert.equal(Router.getCurrent(), "search");
  assert.deepEqual(historyRoutes(), ["home", "search", "detail"]);

  history.back();
  await history.whenSettled();
  assert.equal(Router.getCurrent(), "home");
  assert.deepEqual(historyRoutes(), ["home", "search", "detail"]);
});

test("browser Back and Forward keep Search and Detail entries structurally usable", async () => {
  const home = makeScreen("home");
  const search = makeScreen("search");
  const detail = makeDetailScreen();
  resetRouter({ home, search, detail });
  Router.init();

  await Router.navigate("home");
  await Router.navigate("search", { query: "one piece" });
  await Router.navigate("detail", { id: "movie-1", returnToSearchOnBack: true });

  history.back();
  await history.whenSettled();
  assert.equal(Router.getCurrent(), "search");
  history.back();
  await history.whenSettled();
  assert.equal(Router.getCurrent(), "home");
  history.forward();
  await history.whenSettled();
  assert.equal(Router.getCurrent(), "search");
  history.forward();
  await history.whenSettled();
  assert.equal(Router.getCurrent(), "detail");
  assert.deepEqual(historyRoutes(), ["home", "search", "detail"]);
});

test("Search → Catalog See All browser Back restores the original Search entry and query", async () => {
  const home = makeScreen("home");
  const search = makeScreen("search");
  const catalogSeeAll = makeScreen("catalogSeeAll");
  resetRouter({ home, search, catalogSeeAll });
  Router.init();

  await Router.navigate("home");
  await Router.navigate("search", { query: "one piece" });
  await Router.navigate("catalogSeeAll", { catalogId: "movies-search" });

  history.back();
  await history.whenSettled();
  assert.equal(Router.getCurrent(), "search");
  assert.deepEqual(Router.currentParams, { query: "one piece" });
  assert.deepEqual(historyRoutes(), ["home", "search", "catalogSeeAll"]);

  history.back();
  await history.whenSettled();
  assert.equal(Router.getCurrent(), "home");
  assert.deepEqual(historyRoutes(), ["home", "search", "catalogSeeAll"]);
});

test("browser Back restores Player → Stream → Detail through existing entries", async () => {
  const detail = makeDetailScreen();
  const stream = makeStreamScreen();
  const player = makeScreen("player", {
    shouldReturnToStreamOnBack: () => true,
    hasBackDismissableOverlay: () => false
  });
  resetRouter({ detail, stream, player });
  Router.init();

  await Router.navigate("detail", { itemId: "movie-1", itemType: "movie" });
  await Router.navigate("stream", { itemId: "movie-1", itemType: "movie" });
  await Router.navigate("player", { itemId: "movie-1", itemType: "movie" });
  const writesBeforeBack = historyCalls.filter((call) => call.type === "push" || call.type === "replace").length;

  history.back();
  await history.whenSettled();
  assert.equal(Router.getCurrent(), "stream");
  assert.equal(Router.browserHistoryIndex, 1);
  assert.deepEqual(Router.browserHistoryProvenance, {
    previousIndex: 0,
    previousRoute: "detail"
  });
  history.back();
  await history.whenSettled();
  assert.equal(Router.getCurrent(), "detail");
  assert.equal(historyCalls.filter((call) => call.type === "push" || call.type === "replace").length, writesBeforeBack);
  assert.deepEqual(historyRoutes(), ["detail", "stream", "player"]);
});

test("Router push records immediate prior-route provenance and initial state has none", async () => {
  const detail = makeDetailScreen();
  const stream = makeStreamScreen();
  const player = makePlayerBackScreen();
  resetRouter({ detail, stream, player });
  Router.init();

  await Router.navigate("detail", { itemId: "movie-1" });
  assert.deepEqual(history.state.__nuvioHistory, { index: 0 });
  assert.equal(Router.canBackToPreviousNuvioRoute("stream"), false);

  await Router.navigate("stream", { itemId: "movie-1" });
  assert.deepEqual(history.state.__nuvioHistory, {
    index: 1,
    previousIndex: 0,
    previousRoute: "detail"
  });
  await Router.navigate("player", {
    itemId: "movie-1",
    itemType: "movie",
    returnToStreamOnBack: true,
    streamRouteParams: { itemId: "movie-1", itemType: "movie" }
  });
  assert.deepEqual(history.state.__nuvioHistory, {
    index: 2,
    previousIndex: 1,
    previousRoute: "stream"
  });
  assert.equal(Router.canBackToPreviousNuvioRoute("stream"), true);
});

test("Router replaceHistory preserves the current entry provenance", async () => {
  const home = makeScreen("home");
  const detail = makeDetailScreen();
  const stream = makeStreamScreen();
  const player = makePlayerBackScreen();
  resetRouter({ home, detail, stream, player });
  Router.init();

  await Router.navigate("home");
  await Router.navigate("detail", { itemId: "movie-1" });
  await Router.navigate("stream", { itemId: "movie-1" }, { replaceHistory: true });
  assert.deepEqual(history.state.__nuvioHistory, {
    index: 1,
    previousIndex: 0,
    previousRoute: "home"
  });

  await Router.navigate("player", {
    itemId: "movie-1",
    itemType: "movie",
    returnToStreamOnBack: true,
    streamRouteParams: { itemId: "movie-1", itemType: "movie" }
  });
  assert.deepEqual(history.state.__nuvioHistory, {
    index: 2,
    previousIndex: 1,
    previousRoute: "stream"
  });
});

test("Player app Back returns to the original Stream entry, then Detail", async () => {
  const detail = makeDetailScreen();
  const stream = makeStreamScreen();
  const player = makePlayerBackScreen();
  resetRouter({ detail, stream, player });
  Router.init();

  await Router.navigate("detail", { itemId: "movie-1", itemType: "movie" });
  await Router.navigate("stream", { itemId: "movie-1", itemType: "movie" });
  await Router.navigate("player", {
    itemId: "movie-1",
    itemType: "movie",
    returnToStreamOnBack: true,
    streamRouteParams: { itemId: "movie-1", itemType: "movie" }
  });
  const writesBeforeBack = historyCalls.filter((call) => call.type === "push" || call.type === "replace").length;

  await Router.back();
  await history.whenSettled();
  await flushNavigation();
  assert.equal(Router.getCurrent(), "stream");
  assert.equal(history.index, 1);
  assert.equal(history.state.__nuvioHistory.index, 1);
  assert.deepEqual(historyRoutes(), ["detail", "stream", "player"]);
  assert.equal(historyCalls.filter((call) => call.type === "push" || call.type === "replace").length, writesBeforeBack);

  await Router.back();
  await history.whenSettled();
  assert.equal(Router.getCurrent(), "detail");
  assert.equal(history.index, 0);
});

test("Player app and browser Back both reuse the existing Stream entry", async () => {
  for (const secondBack of ["app", "browser"]) {
    const detail = makeDetailScreen();
    const stream = makeStreamScreen();
    const player = makePlayerBackScreen();
    resetRouter({ detail, stream, player });
    Router.init();
    await Router.navigate("detail", { itemId: "movie-1", itemType: "movie" });
    await Router.navigate("stream", { itemId: "movie-1", itemType: "movie" });
    await Router.navigate("player", {
      itemId: "movie-1",
      itemType: "movie",
      returnToStreamOnBack: true,
      streamRouteParams: { itemId: "movie-1", itemType: "movie" }
    });

    await Router.back();
    await history.whenSettled();
    if (secondBack === "app") await Router.back();
    else history.back();
    await history.whenSettled();
    assert.equal(Router.getCurrent(), "detail", `${secondBack} Back must reach original Detail`);
    assert.deepEqual(historyRoutes(), ["detail", "stream", "player"]);
  }
});

test("browser Player Back still reuses Stream before app or browser Back reaches Detail", async () => {
  for (const secondBack of ["app", "browser"]) {
    const detail = makeDetailScreen();
    const stream = makeStreamScreen();
    const player = makePlayerBackScreen();
    resetRouter({ detail, stream, player });
    Router.init();
    await Router.navigate("detail", { itemId: "movie-1", itemType: "movie" });
    await Router.navigate("stream", { itemId: "movie-1", itemType: "movie" });
    await Router.navigate("player", {
      itemId: "movie-1",
      itemType: "movie",
      returnToStreamOnBack: true,
      streamRouteParams: { itemId: "movie-1", itemType: "movie" }
    });

    history.back();
    await history.whenSettled();
    assert.equal(Router.getCurrent(), "stream");
    if (secondBack === "app") await Router.back();
    else history.back();
    await history.whenSettled();
    assert.equal(Router.getCurrent(), "detail", `${secondBack} Back must reach original Detail`);
  }
});

test("ten rapid Player Back requests accept one settled browser history movement", async () => {
  const detail = makeDetailScreen();
  const stream = makeStreamScreen();
  const player = makePlayerBackScreen();
  resetRouter({ detail, stream, player });
  Router.init();
  await Router.navigate("detail", { itemId: "movie-1", itemType: "movie" });
  await Router.navigate("stream", { itemId: "movie-1", itemType: "movie" });
  await Router.navigate("player", {
    itemId: "movie-1",
    itemType: "movie",
    returnToStreamOnBack: true,
    streamRouteParams: { itemId: "movie-1", itemType: "movie" }
  });
  // Simulate ten queued Player-origin controls, which can outlive the first
  // popstate's synchronous route switch before Stream has fully mounted.
  for (let count = 0; count < 10; count += 1) player.consumeBackRequest();
  await history.whenSettled();
  await flushNavigation();

  assert.equal(historyCalls.filter((call) => call.type === "back").length, 1);
  assert.equal(Router.getCurrent(), "stream");
  assert.deepEqual(historyRoutes(), ["detail", "stream", "player"]);
  await Router.back();
  await history.whenSettled();
  assert.equal(Router.getCurrent(), "detail");
});

test("browser Forward renders a valid target instead of letting Home consume it", async () => {
  const home = makeScreen("home", { consumeBackRequest: () => true });
  const detail = makeScreen("detail");
  resetRouter({ home, detail });
  Router.init();

  await Router.navigate("home");
  await Router.navigate("detail", { itemId: "movie-a" });
  history.back();
  await history.whenSettled();
  assert.equal(Router.getCurrent(), "home");

  history.forward();
  await history.whenSettled();
  assert.equal(Router.getCurrent(), "detail");
  assert.equal(detail.mounts.length, 2, "the Forward target must mount again");
});

test("Detail suspends and resumes each supported parent without remounting it", async () => {
  for (const routeName of ["home", "search", "discover", "library", "folderDetail"]) {
    const parent = makeScreen(routeName);
    const detail = makeScreen("detail");
    parent.container = makeContainer();
    detail.container = makeContainer();
    screenContainers.set(routeName, parent.container);
    screenContainers.set("detail", detail.container);
    resetRouter({ [routeName]: parent, detail });
    screenContainers.set(routeName, parent.container);
    screenContainers.set("detail", detail.container);
    Router.init();

    await Router.navigate(routeName, { entry: routeName });
    await Router.navigate("detail", { itemId: `${routeName}-item` });
    assert.equal(parent.cleanupCalls, 0, `${routeName} stays mounted under Detail`);
    assert.equal(parent.container.inert, true);
    assert.equal(detail.container.style.getPropertyValue("position"), "fixed");

    history.back();
    await history.whenSettled();
    assert.equal(Router.getCurrent(), routeName);
    assert.equal(parent.mounts.length, 1, `${routeName} resumes its existing DOM`);
    assert.equal(parent.cleanupCalls, 0);
    assert.equal(parent.container.inert, false);

    history.forward();
    await history.whenSettled();
    assert.equal(Router.getCurrent(), "detail");
    assert.equal(detail.mounts.length, 2, "Forward mounts Detail again over the parent");
    history.back();
    await history.whenSettled();
    assert.equal(Router.getCurrent(), routeName);
  }
});

test("fresh parent navigation never reuses an unrelated suspended Detail parent", async () => {
  const home = makeScreen("home");
  const detail = makeScreen("detail");
  home.container = makeContainer();
  detail.container = makeContainer();
  resetRouter({ home, detail });
  screenContainers.set("home", home.container);
  screenContainers.set("detail", detail.container);
  Router.init();

  await Router.navigate("home", { entry: "first" });
  await Router.navigate("detail", { itemId: "movie-a" });
  await Router.navigate("home", { entry: "fresh" });

  assert.equal(home.mounts.length, 2, "fresh navigation mounts a fresh Home route");
  assert.equal(home.params.entry, "fresh");
  assert.equal(home.cleanupCalls, 1, "the old suspended parent is released normally");
});

test("Home -> Detail -> Stream -> Detail -> Home keeps both Home and Detail suspended through the whole detour", async () => {
  const home = makeScreen("home");
  const detail = makeScreen("detail");
  const stream = makeScreen("stream");
  home.container = makeContainer();
  detail.container = makeContainer();
  stream.container = makeContainer();
  resetRouter({ home, detail, stream });
  screenContainers.set("home", home.container);
  screenContainers.set("detail", detail.container);
  screenContainers.set("stream", stream.container);
  Router.init();

  // Comparison A: Home -> Detail -> back -> Home. Home is only ever
  // suspended, never cleaned up, and its second appearance is a resume of
  // the same instance, not a fresh mount.
  await Router.navigate("home", { entry: "first" });
  await Router.navigate("detail", { itemId: "movie-a" });
  assert.equal(home.cleanupCalls, 0, "Home stays suspended under Detail");
  history.back();
  await history.whenSettled();
  assert.equal(Router.getCurrent(), "home");
  assert.equal(home.mounts.length, 1, "returning directly from Detail resumes Home instead of remounting it");
  assert.equal(home.cleanupCalls, 0);

  // Comparison B: from that same suspended arrangement, detour through
  // Stream Selection before coming back. Detail -> Stream now extends the
  // suspended-layer stack by one more level (Detail joins Home) instead of
  // releasing it, so both stay suspended -- never cleaned up, never
  // remounted -- all the way through the detour. This is the fix for the
  // visible "paints at top, then jumps" glitch on exactly this path: a
  // resumed layer's DOM was never touched, so there is nothing to correct
  // after paint.
  await Router.navigate("detail", { itemId: "movie-b" });
  assert.equal(home.cleanupCalls, 0, "Home is suspended again under this second Detail visit");
  await Router.navigate("stream", { itemId: "movie-b" });
  assert.equal(home.cleanupCalls, 0, "leaving Detail for Stream must not release the suspended Home parent");
  assert.equal(stream.container.style.getPropertyValue("z-index"), "1001", "Stream layers above the already-suspended Home/Detail pair");
  history.back();
  await history.whenSettled();
  assert.equal(Router.getCurrent(), "detail");
  assert.equal(detail.mounts.length, 2, "Detail resumes the suspended instance, it is not remounted a third time");
  history.back();
  await history.whenSettled();
  assert.equal(Router.getCurrent(), "home");
  assert.equal(home.mounts.length, 1, "Home resumes the same suspended instance after the Stream Selection detour, it is never remounted");
  assert.equal(home.cleanupCalls, 0);
});

test("leaving a chain for an unrelated route keeps every entry behind it live, because Back still goes there", async () => {
  const home = makeScreen("home");
  const detail = makeScreen("detail");
  const stream = makeScreen("stream");
  const library = makeScreen("library");
  for (const [name, screen] of [["home", home], ["detail", detail], ["stream", stream], ["library", library]]) {
    screen.container = makeContainer();
    screenContainers.set(name, screen.container);
  }
  resetRouter({ home, detail, stream, library });
  for (const [name, screen] of [["home", home], ["detail", detail], ["stream", stream], ["library", library]]) {
    screenContainers.set(name, screen.container);
  }
  Router.init();

  await Router.navigate("home");
  await Router.navigate("detail", { itemId: "movie-a" });
  await Router.navigate("stream", { itemId: "movie-a" });
  // A bottom-nav tap is still a forward push, so Back from Library genuinely
  // returns to Stream, then Detail, then Home. The layer stack mirrors that
  // rather than second-guessing which transitions "belong" to a flow.
  await Router.navigate("library");
  assert.deepEqual(
    Router.suspendedRouteStack.map((layer) => layer.route),
    ["home", "detail", "stream"]
  );
  assert.equal(home.cleanupCalls, 0);
  assert.equal(detail.cleanupCalls, 0);
  assert.equal(stream.cleanupCalls, 0);

  for (const expected of ["stream", "detail", "home"]) {
    history.back();
    await history.whenSettled();
    assert.equal(Router.getCurrent(), expected);
  }
  assert.equal(home.mounts.length, 1, "every step back revealed a live screen, none were rebuilt");
  assert.equal(detail.mounts.length, 1);
  assert.equal(stream.mounts.length, 1);
  assert.equal(Router.suspendedRouteStack.length, 0);
});

test("the layer stack is bounded: the oldest entry is evicted and falls back to its own snapshot", async () => {
  const screens = {
    home: makeScreen("home"),
    detail: makeScreen("detail"),
    stream: makeScreen("stream"),
    castDetail: makeScreen("castDetail"),
    library: makeScreen("library"),
    search: makeScreen("search")
  };
  resetRouter(screens);
  for (const [name, screen] of Object.entries(screens)) {
    screen.container = makeContainer();
    screenContainers.set(name, screen.container);
  }
  Router.init();

  await Router.navigate("home");
  await Router.navigate("detail", { itemId: "movie-a" });
  await Router.navigate("stream", { itemId: "movie-a" });
  await Router.navigate("castDetail", { castId: "42" });
  await Router.navigate("library");
  assert.deepEqual(
    Router.suspendedRouteStack.map((layer) => layer.route),
    ["home", "detail", "stream", "castDetail"],
    "four layers is the cap, still all live"
  );
  assert.equal(screens.home.cleanupCalls, 0);

  await Router.navigate("search");
  assert.deepEqual(
    Router.suspendedRouteStack.map((layer) => layer.route),
    ["detail", "stream", "castDetail", "library"],
    "the fifth push evicts the oldest layer rather than growing without limit"
  );
  assert.equal(screens.home.cleanupCalls, 1, "the evicted layer is cleaned up, not merely dropped");
});

test("Stream suspends under Player and resumes on Back, without suspending Player itself", async () => {
  const detail = makeScreen("detail");
  const stream = makeScreen("stream");
  const player = makeScreen("player", {
    shouldReturnToStreamOnBack: () => true,
    hasBackDismissableOverlay: () => false
  });
  detail.container = makeContainer();
  stream.container = makeContainer();
  player.container = makeContainer();
  resetRouter({ detail, stream, player });
  screenContainers.set("detail", detail.container);
  screenContainers.set("stream", stream.container);
  screenContainers.set("player", player.container);
  Router.init();

  await Router.navigate("detail", { itemId: "movie-1", itemType: "movie" });
  await Router.navigate("stream", { itemId: "movie-1", itemType: "movie" });
  await Router.navigate("player", { itemId: "movie-1", itemType: "movie" });
  assert.equal(stream.cleanupCalls, 0, "Stream stays suspended under Player");
  assert.equal(player.container.inert, false, "Player itself is never the one made inert");

  history.back();
  await history.whenSettled();
  assert.equal(Router.getCurrent(), "stream");
  assert.equal(stream.mounts.length, 1, "Stream resumes the same suspended instance");
  assert.equal(stream.cleanupCalls, 0);
  assert.equal(player.cleanupCalls, 1, "Player's own DOM/decoders are torn down like any other plain route");

  history.back();
  await history.whenSettled();
  assert.equal(Router.getCurrent(), "detail");
});

test("castDetail (Actor/Person) suspends Detail and resumes it on Back without remounting", async () => {
  const detail = makeScreen("detail");
  const castDetail = makeScreen("castDetail");
  detail.container = makeContainer();
  castDetail.container = makeContainer();
  resetRouter({ detail, castDetail });
  screenContainers.set("detail", detail.container);
  screenContainers.set("castDetail", castDetail.container);
  Router.init();

  await Router.navigate("detail", { itemId: "movie-1" });
  await Router.navigate("castDetail", { castId: "42" });
  assert.equal(detail.cleanupCalls, 0, "Detail stays suspended under Actor/Person");

  history.back();
  await history.whenSettled();
  assert.equal(Router.getCurrent(), "detail");
  assert.equal(detail.mounts.length, 1, "Detail resumes the same suspended instance, unaffected by the Actor detour");
  assert.equal(detail.cleanupCalls, 0);
});

test("a route can never be layered under itself: one live layer per screen container", async () => {
  const detail = makeScreen("detail");
  const castDetail = makeScreen("castDetail");
  detail.container = makeContainer();
  castDetail.container = makeContainer();
  resetRouter({ detail, castDetail });
  screenContainers.set("detail", detail.container);
  screenContainers.set("castDetail", castDetail.container);
  Router.init();

  await Router.navigate("detail", { itemId: "movie-1" });
  await Router.navigate("castDetail", { castId: "42" });
  // Opening a filmography credit mounts a different title into the one and
  // only #detail container, so the layer still holding it must be released
  // first -- this is what forces Detail A -> Detail B to be a real remount
  // rather than a policy choice.
  await Router.navigate("detail", { itemId: "movie-2" });

  assert.equal(detail.cleanupCalls, 1, "the layer holding #detail is released before the new title mounts into it");
  assert.equal(detail.mounts.length, 2, "the new title is a genuine fresh mount");
  assert.deepEqual(
    Router.suspendedRouteStack.map((layer) => layer.route),
    ["castDetail"],
    "the Actor page it was opened from stays live behind it"
  );
});

for (const [from, to] of [
  ["home", "settings"],
  ["search", "catalogSeeAll"],
  ["library", "collectionEdit"],
  ["discover", "detail"],
  ["settings", "plugins"]
]) {
  test(`${from} -> ${to} -> Back reveals the live ${from}, like every other pair`, async () => {
    const source = makeScreen(from);
    const target = makeScreen(to);
    source.container = makeContainer();
    target.container = makeContainer();
    resetRouter({ [from]: source, [to]: target });
    screenContainers.set(from, source.container);
    screenContainers.set(to, target.container);
    Router.init();

    await Router.navigate(from, { entry: from });
    await Router.navigate(to, { entry: to });
    assert.equal(source.cleanupCalls, 0, `${from} is layered under ${to}, not torn down`);
    assert.equal(source.container.inert, true);

    history.back();
    await history.whenSettled();
    assert.equal(Router.getCurrent(), from);
    assert.equal(source.mounts.length, 1, `${from} is revealed, never rebuilt`);
    assert.equal(source.container.inert, false);
    assert.equal(target.cleanupCalls, 1);
  });
}

test("paint order always matches stack order, so the current screen is never covered by a suspended one", async () => {
  const screens = {
    home: makeScreen("home"),
    library: makeScreen("library"),
    settings: makeScreen("settings")
  };
  resetRouter(screens);
  for (const [name, screen] of Object.entries(screens)) {
    screen.container = makeContainer();
    screenContainers.set(name, screen.container);
  }
  Router.init();

  // Returning to a route already in the stack frees the depth it occupied.
  // Reusing that depth for the next layer once put two containers on the same
  // z-index, and the one later in the app shell's markup covered the screen
  // that was actually current -- tapping Home still showed Settings.
  await Router.navigate("home");
  await Router.navigate("library");
  await Router.navigate("settings");
  await Router.navigate("home");

  const zIndexOf = (name) => screens[name].container.style.getPropertyValue("z-index");
  assert.deepEqual(
    Router.suspendedRouteStack.map((layer) => layer.route),
    ["library", "settings"]
  );
  assert.equal(zIndexOf("settings"), "1000", "the layer below sits under the current screen");
  assert.equal(zIndexOf("home"), "1001", "the current screen paints above every suspended layer");
  assert.notEqual(zIndexOf("home"), zIndexOf("settings"));
});

test("replacing the current entry while layers are live still puts the new screen on top, not under them", async () => {
  const screens = {
    home: makeScreen("home"),
    detail: makeScreen("detail"),
    stream: makeScreen("stream")
  };
  resetRouter(screens);
  for (const [name, screen] of Object.entries(screens)) {
    screen.container = makeContainer();
    screenContainers.set(name, screen.container);
  }
  Router.init();

  await Router.navigate("home");
  await Router.navigate("detail", { itemId: "movie-1", autoOpenContinueWatching: true });
  assert.equal(screens.detail.container.style.getPropertyValue("position"), "fixed");

  // Continue Watching replaces its transient Detail with Stream. Detail's entry
  // is being overwritten so there is correctly nothing to suspend -- but Home is
  // still layered underneath with the document scroll locked, so Stream must
  // take Detail's place as the screen on top. It previously stayed unstyled and
  // was laid out below the suspended Home, which covered the viewport: the
  // viewer was left staring at an inert Home with no way to scroll or tap out.
  await Router.navigate(
    "stream",
    { itemId: "movie-1", continueWatchingBackHome: true },
    { skipStackPush: true, replaceHistory: true }
  );

  assert.equal(Router.getCurrent(), "stream");
  assert.equal(screens.stream.container.style.getPropertyValue("position"), "fixed", "Stream must be the layer on top");
  assert.equal(screens.stream.container.style.getPropertyValue("z-index"), "1000");
  assert.equal(
    screens.detail.container.style.getPropertyValue("position"),
    "",
    "the screen it replaced gets its own styles back"
  );
  assert.deepEqual(
    Router.suspendedRouteStack.map((layer) => layer.route),
    ["home"],
    "Home stays suspended -- the replacement swapped what is above it, not the stack"
  );
  assert.equal(Router.suspendedRouteStack[0].childContainer, screens.stream.container);

  // Back must still reveal the live Home and unlock the document.
  history.back();
  await history.whenSettled();
  assert.equal(Router.getCurrent(), "home");
  assert.equal(screens.home.mounts.length, 1, "Home is revealed, not rebuilt");
  assert.equal(screens.home.container.inert, false);
  assert.equal(Router.suspendedRouteStack.length, 0);
});

test("a screen that clears its own container styles while mounting cannot drop out of the layer stack", async () => {
  const home = makeScreen("home");
  const detail = makeScreen("detail");
  home.container = makeContainer();
  detail.container = makeContainer();
  // Reproduces the real failure: a screen stripping inline position/inset on
  // mount kept its z-index but lost `position: fixed`, so it sat in a frozen
  // document and could not scroll at all.
  detail.mount = async function mount(params, context) {
    this.params = params;
    this.mounts.push({ params, context });
    for (const property of ["position", "inset", "top", "left"]) {
      this.container.style.removeProperty(property);
    }
  };
  resetRouter({ home, detail });
  screenContainers.set("home", home.container);
  screenContainers.set("detail", detail.container);
  Router.init();

  await Router.navigate("home");
  await Router.navigate("detail", { itemId: "movie-a" });

  assert.equal(detail.container.style.getPropertyValue("position"), "fixed");
  assert.equal(detail.container.style.getPropertyValue("inset"), "0");
  assert.equal(detail.container.style.getPropertyValue("z-index"), "1000");
});

test("a multi-entry Back jump reveals its target and tears down only the layers it skipped", async () => {
  const screens = {
    home: makeScreen("home"),
    detail: makeScreen("detail"),
    stream: makeScreen("stream")
  };
  resetRouter(screens);
  for (const [name, screen] of Object.entries(screens)) {
    screen.container = makeContainer();
    screenContainers.set(name, screen.container);
  }
  Router.init();

  await Router.navigate("home");
  await Router.navigate("detail", { itemId: "movie-a" });
  await Router.navigate("stream", { itemId: "movie-a" });

  // The browser's own history menu can skip entries; landing two back must
  // still reveal the live Home rather than rebuilding it.
  history.index = 0;
  await dispatchPopstate(history.state);
  assert.equal(Router.getCurrent(), "home");
  assert.equal(screens.home.mounts.length, 1, "the jump target is revealed, not remounted");
  assert.equal(screens.detail.cleanupCalls, 1, "the skipped layer is torn down");
  assert.equal(Router.suspendedRouteStack.length, 0);
});

test("Home's scroll position survives a Detail -> Stream Selection detour, not just a direct Detail -> Home return", async () => {
  const home = makeVisualRouteStateScreen("home", "route:home");
  const detail = makeScreen("detail");
  const stream = makeScreen("stream");
  home.container = makeContainer();
  detail.container = makeContainer();
  resetRouter({ home, detail, stream });
  screenContainers.set("home", home.container);
  screenContainers.set("detail", detail.container);
  Router.init();

  await Router.navigate("home");
  home.visualState = { scrollTop: 1200, railLeft: 0, focusId: null };
  await Router.navigate("detail", { itemId: "movie-a" });
  await Router.navigate("stream", { itemId: "movie-a" });
  history.back();
  await history.whenSettled();
  assert.equal(Router.getCurrent(), "detail");
  history.back();
  await history.whenSettled();
  assert.equal(Router.getCurrent(), "home");
  assert.equal(
    home.visualState.scrollTop,
    1200,
    "Home must restore the scroll it had before the Stream Selection detour, not reset to the top"
  );
});

test("the same nested-history restoration applies to Library, not just Home", async () => {
  const library = makeVisualRouteStateScreen("library", "route:library");
  const detail = makeScreen("detail");
  const stream = makeScreen("stream");
  library.container = makeContainer();
  detail.container = makeContainer();
  resetRouter({ library, detail, stream });
  screenContainers.set("library", library.container);
  screenContainers.set("detail", detail.container);
  Router.init();

  await Router.navigate("library");
  library.visualState = { scrollTop: 800, railLeft: 0, focusId: null };
  await Router.navigate("detail", { itemId: "movie-a" });
  await Router.navigate("stream", { itemId: "movie-a" });
  history.back();
  await history.whenSettled();
  history.back();
  await history.whenSettled();
  assert.equal(Router.getCurrent(), "library");
  assert.equal(library.visualState.scrollTop, 800, "Library restores its own scroll the same way Home does");
});

test("Detail A -> Detail B -> Back restores Detail A's own captured scroll position", async () => {
  const home = makeScreen("home");
  const detail = makeVisualRouteStateScreen("detail", "");
  detail.getRouteStateKey = (params = {}) => {
    const itemId = String(params?.itemId || "");
    return itemId ? `detail:movie:${itemId}` : null;
  };
  resetRouter({ home, detail });
  Router.init();

  await Router.navigate("home");
  await Router.navigate("detail", { itemId: "movie-a" });
  detail.visualState = { scrollTop: 650, railLeft: 0, focusId: null };
  await Router.navigate("detail", { itemId: "movie-b" });
  assert.equal(
    detail.visualState.scrollTop,
    0,
    "a fresh Detail entry (movie-b) must not inherit movie-a's scroll"
  );
  history.back();
  await history.whenSettled();
  assert.equal(Router.getCurrent(), "detail");
  assert.equal(detail.params.itemId, "movie-a");
  assert.equal(
    detail.visualState.scrollTop,
    650,
    "returning to Detail A must restore the scroll captured for that exact item, not the top"
  );
});

test("forceReload is a one-time directive and is not replayed by a later popstate return to Home", async () => {
  const screens = {
    home: makeScreen("home"),
    detail: makeScreen("detail"),
    stream: makeScreen("stream"),
    castDetail: makeScreen("castDetail"),
    library: makeScreen("library"),
    search: makeScreen("search")
  };
  const home = screens.home;
  resetRouter(screens);
  for (const [name, screen] of Object.entries(screens)) {
    screen.container = makeContainer();
    screenContainers.set(name, screen.container);
  }
  Router.init();

  // Simulate profile activation entering Home with a one-time reload
  // directive. This is the very first navigation, so it goes through
  // history.replaceState (createBrowserHistoryState), not pushState -- the
  // leak this test guards against lived in that state object.
  await Router.navigate("home", { forceReload: true });
  assert.equal(home.mounts[0].params.forceReload, true, "the original mount still consumes it");
  assert.equal(
    history.entries[history.index].state.params.forceReload,
    undefined,
    "forceReload must not be persisted into the stored history entry"
  );

  // Push past the layer cap so Home's own layer is evicted. Its return is then
  // a genuine popstate-driven fresh mount from its entry snapshot -- exactly
  // the scenario where a stale forceReload could otherwise force Home into a
  // full cold reload on every later return, not just the first one.
  await Router.navigate("detail", { itemId: "movie-a" });
  await Router.navigate("stream", { itemId: "movie-a" });
  await Router.navigate("castDetail", { castId: "42" });
  await Router.navigate("library");
  await Router.navigate("search");
  assert.equal(home.cleanupCalls, 1, "Home's layer was evicted once the cap was exceeded");

  for (const expected of ["library", "castDetail", "stream", "detail", "home"]) {
    history.back();
    await history.whenSettled();
    assert.equal(Router.getCurrent(), expected);
  }
  assert.equal(home.mounts.length, 2, "Home really was rebuilt, not revealed");

  const secondMount = home.mounts[home.mounts.length - 1];
  assert.equal(
    secondMount.params.forceReload,
    undefined,
    "a popstate return to this history entry must not replay forceReload"
  );
});

test("Player Back safely synthesizes Stream only without a proven Stream predecessor", async () => {
  const detail = makeDetailScreen();
  const stream = makeStreamScreen();
  const player = makePlayerBackScreen();
  resetRouter({ detail, stream, player });
  Router.init();

  await Router.navigate("player", {
    itemId: "movie-1",
    itemType: "movie",
    returnToStreamOnBack: true,
    streamRouteParams: { itemId: "movie-1", itemType: "movie" }
  });
  await Router.back();
  await flushNavigation();
  assert.equal(Router.getCurrent(), "stream");
  assert.equal(historyCalls.filter((call) => call.type === "back").length, 0);

  resetRouter({ detail, stream, player });
  Router.init();
  await Router.navigate("detail", { itemId: "movie-1", itemType: "movie" });
  await Router.navigate("player", {
    itemId: "movie-1",
    itemType: "movie",
    returnToStreamOnBack: true,
    streamRouteParams: { itemId: "movie-1", itemType: "movie" }
  });
  await Router.back();
  await flushNavigation();
  assert.equal(Router.getCurrent(), "stream");
  assert.deepEqual(historyRoutes(), ["detail", "stream"]);
  assert.equal(historyCalls.filter((call) => call.type === "back").length, 0);
});

for (const parent of [
  { route: "folderDetail", params: { folderId: "collection-1" } },
  { route: "discover", params: { tab: "popular" } },
  { route: "library", params: {} }
]) {
  test(`${parent.route} → Detail → Stream reuses both existing parent entries on app Back`, async () => {
    const home = makeScreen("home");
    const parentScreen = makeScreen(parent.route);
    const detail = makeDetailScreen();
    const stream = makeStreamScreen();
    resetRouter({ home, [parent.route]: parentScreen, detail, stream });
    Router.init();

    await Router.navigate("home");
    await Router.navigate(parent.route, parent.params);
    await Router.navigate("detail", { itemId: "movie-1", itemType: "movie" });
    await Router.navigate("stream", {
      itemId: "movie-1",
      itemType: "movie",
      returnToDetail: true,
      fromDetailRoute: true
    });

    await Router.back();
    await history.whenSettled();
    assert.equal(Router.getCurrent(), "detail");
    await Router.back();
    await history.whenSettled();
    assert.equal(Router.getCurrent(), parent.route);
    assert.deepEqual(Router.currentParams, parent.params);
    assert.deepEqual(historyRoutes(), ["home", parent.route, "detail", "stream"]);
  });
}

test("Library → Detail direct app Back remains a real History transition", async () => {
  const library = makeScreen("library");
  const detail = makeDetailScreen();
  resetRouter({ library, detail });
  Router.init();

  await Router.navigate("library");
  await Router.navigate("detail", { itemId: "movie-1", itemType: "movie" });
  await Router.back();
  await history.whenSettled();

  assert.equal(Router.getCurrent(), "library");
  assert.deepEqual(historyRoutes(), ["library", "detail"]);
});

test("Home → Detail app Back prefers the durable Home entry over returnHomeOnBack", async () => {
  const home = makeScreen("home");
  const detail = makeDetailScreen();
  resetRouter({ home, detail });
  Router.init();

  await Router.navigate("home");
  await Router.navigate("detail", { itemId: "movie-1", itemType: "movie", returnHomeOnBack: true });
  await Router.back();
  await history.whenSettled();

  assert.equal(Router.getCurrent(), "home");
  assert.deepEqual(historyRoutes(), ["home", "detail"]);
});

test("Detail → Detail app Back restores the existing first Detail entry", async () => {
  const detail = makeDetailScreen();
  resetRouter({ detail });
  Router.init();

  await Router.navigate("detail", { itemId: "movie-a", itemType: "movie" });
  await Router.navigate("detail", { itemId: "movie-b", itemType: "movie" });
  await Router.back();
  await history.whenSettled();

  assert.equal(Router.getCurrent(), "detail");
  assert.equal(Router.currentParams.itemId, "movie-a");
  assert.deepEqual(historyRoutes(), ["detail", "detail"]);
});

test("Detail overlays consume the first app Back without moving the route", async () => {
  const home = makeScreen("home");
  let overlayVisible = true;
  const detail = makeScreen("detail", {
    consumeBackRequest() {
      if (!overlayVisible) return false;
      overlayVisible = false;
      return true;
    }
  });
  resetRouter({ home, detail });
  Router.init();

  await Router.navigate("home");
  await Router.navigate("detail", { id: "movie-1" });
  await Router.back();
  assert.equal(Router.getCurrent(), "detail");
  assert.deepEqual(historyRoutes(), ["home", "detail"]);

  await Router.back();
  await history.whenSettled();
  assert.equal(Router.getCurrent(), "home");
});

test("Detail overlays restore Detail on browser Back, then allow the next browser Back", async () => {
  const home = makeScreen("home");
  let overlayVisible = true;
  const detail = makeScreen("detail", {
    consumeBackRequest() {
      if (!overlayVisible) return false;
      overlayVisible = false;
      return true;
    }
  });
  resetRouter({ home, detail });
  Router.init();

  await Router.navigate("home");
  await Router.navigate("detail", { id: "movie-1" });
  history.back();
  await history.whenSettled();
  assert.equal(Router.getCurrent(), "detail");
  assert.equal(history.state.__nuvioHistory.index, 1);
  assert.deepEqual(historyRoutes(), ["home", "detail"]);

  history.back();
  await history.whenSettled();
  assert.equal(Router.getCurrent(), "home");
  assert.equal(Router.suppressPopstateUntil, 0);
});

test("browser Back from Stream restores the existing Detail without a synthetic write", async () => {
  const detail = makeDetailScreen();
  const stream = makeStreamScreen();
  resetRouter({ detail, stream });
  Router.init();

  await Router.navigate("detail", { itemId: "movie-1", itemType: "movie" });
  await Router.navigate("stream", { itemId: "movie-1", itemType: "movie", returnToDetail: true });
  const writesBeforeBack = historyCalls.filter((call) => call.type === "push" || call.type === "replace").length;

  history.back();
  await history.whenSettled();
  assert.equal(Router.getCurrent(), "detail");
  assert.equal(historyCalls.filter((call) => call.type === "push" || call.type === "replace").length, writesBeforeBack);
});

test("valid popstate targets remain authoritative for Detail and Stream", async () => {
  const home = makeScreen("home");
  const detail = makeDetailScreen();
  const stream = makeStreamScreen();
  resetRouter({ home, detail, stream });
  Router.init();

  await Router.navigate("home");
  await Router.navigate("detail", { itemId: "movie-1", returnHomeOnBack: true });
  await dispatchPopstate({ route: "home", params: {} });
  assert.equal(Router.getCurrent(), "home");

  await Router.navigate("detail", { itemId: "movie-1", itemType: "movie" });
  await Router.navigate("stream", { itemId: "movie-1", itemType: "movie", returnToDetail: true });
  await dispatchPopstate({ route: "detail", params: { itemId: "movie-1", itemType: "movie" } });
  assert.equal(Router.getCurrent(), "detail");
});

test("direct-entry fallbacks never use browser history merely because it has external entries", async () => {
  const home = makeScreen("home");
  const detail = makeDetailScreen();
  resetRouter({ home, detail });
  Router.init();

  await Router.navigate("detail", { itemId: "movie-1", returnHomeOnBack: true });
  await Router.back();
  await flushNavigation();

  assert.equal(Router.getCurrent(), "home");
  assert.equal(historyCalls.filter((call) => call.type === "back").length, 0);
});

test("replaceHistory preserves the current Nuvio index before the next normal push", async () => {
  const home = makeScreen("home");
  const search = makeScreen("search");
  const detail = makeDetailScreen();
  const stream = makeStreamScreen();
  resetRouter({ home, search, detail, stream });
  Router.init();

  await Router.navigate("home");
  assert.equal(history.state.__nuvioHistory.index, 0);
  await Router.navigate("search", { query: "one piece" });
  assert.equal(history.state.__nuvioHistory.index, 1);
  await Router.navigate("detail", { itemId: "movie-1" }, { replaceHistory: true });
  assert.equal(history.state.__nuvioHistory.index, 1);
  await Router.navigate("stream", { itemId: "movie-1" });
  assert.equal(history.state.__nuvioHistory.index, 2);
});

test("legacy and malformed route markers restore routes but never prove browser Back depth", async () => {
  const home = makeScreen("home");
  const search = makeScreen("search");
  const detail = makeDetailScreen();
  resetRouter({ home, search, detail });
  Router.init();

  await Router.navigate("home");
  await Router.navigate("search", { query: "one piece" });
  await Router.navigate("detail", { itemId: "movie-1" });
  await dispatchPopstate({ route: "search", params: { query: "legacy" } });
  assert.equal(Router.getCurrent(), "search");
  assert.equal(Router.browserHistoryIndex, null);
  assert.equal(Router.canBackToPreviousNuvioRoute("stream"), false);
  const browserBackCalls = historyCalls.filter((call) => call.type === "back").length;
  await Router.back();
  assert.equal(historyCalls.filter((call) => call.type === "back").length, browserBackCalls);

  await dispatchPopstate({
    route: "search",
    params: { query: "malformed" },
    __nuvioHistory: { index: "2" }
  });
  assert.equal(Router.getCurrent(), "search");
  assert.equal(Router.browserHistoryIndex, null);
  assert.equal(Router.canBackToPreviousNuvioRoute("stream"), false);
});

test("direct Continue Watching movie and episode routes safely fall back to Home", async () => {
  const home = makeScreen("home");
  const detail = makeDetailScreen();
  const stream = makeStreamScreen();
  resetRouter({ home, detail, stream });
  Router.init();

  await Router.navigate("home");
  await Router.navigate("stream", {
    itemId: "movie-1",
    itemType: "movie",
    continueWatchingBackHome: true
  }, { skipStackPush: true, replaceHistory: true });
  await Router.back();
  await flushNavigation();
  assert.equal(Router.getCurrent(), "home");
  assert.deepEqual(historyRoutes(), ["home"]);

  await Router.navigate("stream", {
    itemId: "series-1",
    itemType: "series",
    continueWatchingBackHome: true
  }, { skipStackPush: true, replaceHistory: true });
  await Router.back();
  await flushNavigation();
  assert.equal(Router.getCurrent(), "home");
  assert.deepEqual(historyRoutes(), ["home"]);
});

test("Continue Watching replaces committed transient Detail without a timer task", async () => {
  const library = makeScreen("library");
  const home = makeScreen("home");
  const detail = makeDeferredContinueWatchingDetailScreen();
  const stream = makeStreamScreen();
  resetRouter({ library, home, detail, stream });
  Router.init();

  await Router.navigate("library");
  await Router.navigate("home");
  await Router.navigate("detail", {
    itemId: "movie-1",
    itemType: "movie",
    autoOpenContinueWatching: true,
    returnHomeOnBack: true
  });
  await flushNavigation();

  assert.equal(Router.getCurrent(), "stream");
  assert.deepEqual(detail.committedContinueWatchingRoutes, [{ route: "detail", index: 2 }]);
  assert.deepEqual(historyRoutes(), ["library", "home", "stream"]);
  assert.deepEqual(
    history.entries.map((entry) => entry.state?.__nuvioHistory?.index),
    [0, 1, 2]
  );

  await Router.back();
  await flushNavigation();
  assert.equal(Router.getCurrent(), "home");
});

test("browser Back from a Continue Watching movie returns to the preserved Home entry", async () => {
  const library = makeScreen("library");
  const home = makeScreen("home");
  const detail = makeDeferredContinueWatchingDetailScreen();
  const stream = makeStreamScreen();
  resetRouter({ library, home, detail, stream });
  Router.init();

  await Router.navigate("library");
  await Router.navigate("home");
  await Router.navigate("detail", {
    itemId: "movie-1",
    itemType: "movie",
    autoOpenContinueWatching: true,
    returnHomeOnBack: true
  });
  await flushNavigation();

  history.back();
  await history.whenSettled();
  assert.equal(Router.getCurrent(), "home");
  assert.deepEqual(historyRoutes(), ["library", "home", "stream"]);
});

test("Continue Watching episode app Back reuses Home without synthesizing Detail", async () => {
  const library = makeScreen("library");
  const home = makeScreen("home");
  const detail = makeDeferredContinueWatchingDetailScreen();
  const stream = makeStreamScreen();
  resetRouter({ library, home, detail, stream });
  Router.init();

  await Router.navigate("library");
  await Router.navigate("home");
  await Router.navigate("detail", {
    itemId: "series-1",
    itemType: "series",
    autoOpenContinueWatching: true,
    returnHomeOnBack: true
  });
  await flushNavigation();
  assert.deepEqual(historyRoutes(), ["library", "home", "stream"]);
  assert.deepEqual(
    history.entries.map((entry) => entry.state?.__nuvioHistory?.index),
    [0, 1, 2]
  );

  await Router.back();
  await history.whenSettled();
  assert.equal(Router.getCurrent(), "home");
  assert.equal(detail.mounts.filter((mount) => mount.context?.isBackNavigation).length, 0);
  assert.deepEqual(historyRoutes(), ["library", "home", "stream"]);
});

test("browser Back from a Continue Watching episode returns to Home without exposing transient Detail", async () => {
  const library = makeScreen("library");
  const home = makeScreen("home");
  const detail = makeDeferredContinueWatchingDetailScreen();
  const stream = makeStreamScreen();
  resetRouter({ library, home, detail, stream });
  Router.init();

  await Router.navigate("library");
  await Router.navigate("home");
  await Router.navigate("detail", {
    itemId: "series-1",
    itemType: "series",
    autoOpenContinueWatching: true,
    returnHomeOnBack: true
  });
  await flushNavigation();

  history.back();
  await history.whenSettled();
  assert.equal(Router.getCurrent(), "home");
  assert.deepEqual(historyRoutes(), ["library", "home", "stream"]);
});

test("Continue Watching episode keeps Home as its semantic parent after a Search prefix", async () => {
  const search = makeScreen("search");
  const home = makeScreen("home");
  const detail = makeDeferredContinueWatchingDetailScreen();
  const stream = makeStreamScreen();
  resetRouter({ search, home, detail, stream });
  Router.init();

  await Router.navigate("search", { query: "one piece" });
  await Router.navigate("home");
  await Router.navigate("detail", {
    itemId: "series-1",
    itemType: "series",
    autoOpenContinueWatching: true,
    returnHomeOnBack: true
  });
  await flushNavigation();

  await Router.back();
  await history.whenSettled();
  assert.equal(Router.getCurrent(), "home");
  assert.equal(detail.mounts.filter((mount) => mount.context?.isBackNavigation).length, 0);
  assert.deepEqual(historyRoutes(), ["search", "home", "stream"]);
});

test("browser Back from a Search-prefixed Continue Watching episode returns to Home", async () => {
  const search = makeScreen("search");
  const home = makeScreen("home");
  const detail = makeDeferredContinueWatchingDetailScreen();
  const stream = makeStreamScreen();
  resetRouter({ search, home, detail, stream });
  Router.init();

  await Router.navigate("search", { query: "one piece" });
  await Router.navigate("home");
  await Router.navigate("detail", {
    itemId: "series-1",
    itemType: "series",
    autoOpenContinueWatching: true,
    returnHomeOnBack: true
  });
  await flushNavigation();

  history.back();
  await history.whenSettled();
  assert.equal(Router.getCurrent(), "home");
  assert.deepEqual(historyRoutes(), ["search", "home", "stream"]);
});

test("invalid popstate remains eligible for Detail's safe origin fallback", async () => {
  const home = makeScreen("home");
  const detail = makeDetailScreen();
  resetRouter({ home, detail });
  Router.init();
  await Router.navigate("home");
  await Router.navigate("detail", { itemId: "movie-1", returnHomeOnBack: true });

  await dispatchPopstate({ route: "removed-route", params: {} });
  await flushNavigation();
  assert.equal(Router.getCurrent(), "home");
});

test("root browser Back does not request native app exit", async () => {
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
    assert.equal(Router.getCurrent(), "home");
    assert.equal(nativeExitCalls, 0);
    assert.equal(historyCalls.filter((entry) => entry.type === "back").length, 0);
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
