import { HomeScreen } from "../screens/home/homeScreen.js";
import { PlayerScreen } from "../screens/player/playerScreen.js";
import { AccountScreen } from "../screens/account/accountScreen.js";
import { AuthQrSignInScreen } from "../screens/account/authQrSignInScreen.js";
import { AuthSignInScreen } from "../screens/account/authSignInScreen.js";
import { SyncCodeScreen } from "../screens/account/syncCodeScreen.js";
import { ProfileSelectionScreen } from "../../core/profile/profileSelectionScreen.js";
import { MetaDetailsScreen } from "../screens/detail/metaDetailsScreen.js";
import { LibraryScreen } from "../screens/library/libraryScreen.js";
import { SearchScreen } from "../screens/search/searchScreen.js";
import { DiscoverScreen } from "../screens/search/discoverScreen.js";
import { SettingsScreen } from "../screens/settings/settingsScreen.js";
import { ConsoleDebugScreen } from "../screens/debug/consoleDebugScreen.js";
import { TraktScreen } from "../screens/trakt/traktScreen.js";
import { SupportersContributorsScreen } from "../screens/supporters/supportersContributorsScreen.js";
import { ExperienceModeSelectionScreen } from "../screens/onboarding/experienceModeSelectionScreen.js";
import { EssentialAddonSetupScreen } from "../screens/onboarding/essentialAddonSetupScreen.js";
import { LicensesAttributionsScreen } from "../screens/settings/licensesAttributionsScreen.js";
import { PluginScreen } from "../screens/plugin/pluginScreen.js";
import { PluginsScreen } from "../screens/plugin/pluginsScreen.js";
import { CatalogOrderScreen } from "../screens/plugin/catalogOrderScreen.js";
import { StreamScreen } from "../screens/stream/streamScreen.js";
import { CastDetailScreen } from "../screens/cast/castDetailScreen.js";
import { CatalogSeeAllScreen } from "../screens/catalog/catalogSeeAllScreen.js";
import { FolderDetailScreen } from "../screens/collection/folderDetailScreen.js";
import { CollectionEditorScreen, CollectionFolderEditorScreen } from "../screens/collection/collectionEditorScreen.js";
import { Platform } from "../../platform/index.js";
import { ProfileManager } from "../../core/profile/profileManager.js";
import { RouteStateStore } from "./routeStateStore.js";
import { setBrowserRouteTitle } from "./browserDocumentTitle.js";
import { bindBrowserPullToRefresh } from "../components/browserPullToRefresh.js";

const ROUTER_PERF_DEBUG = Boolean(
  globalThis.__NUVIO_DEBUG_ROUTER_PERF__ || globalThis.__NUVIO_DEBUG_HOME_PERF__
);

function routerPerfNow() {
  return typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();
}

function logRouterPerf(stage, data = {}) {
  if (!ROUTER_PERF_DEBUG) {
    return;
  }
  try {
    console.info(`[router-perf] ${stage}`, data);
  } catch (_) {}
}

function getBrowserPullRefreshHandler(routeName, screen) {
  switch (routeName) {
    case "home":
      return () => screen.reloadHomeContent?.({ reason: "pull-to-refresh" }) || screen.loadData?.({ background: true, preserveReturnState: true });
    case "search":
      return () => screen.reloadRows?.();
    case "discover":
      return () => screen.reloadItems?.({ preserveExistingItems: true });
    case "library":
      return () => screen.controller?.refreshNow?.();
    case "detail":
      return () => screen.reloadDetailContent?.({ reason: "pull-to-refresh" }) || screen.loadDetail?.();
    case "castDetail":
      return () => screen.loadCastDetails?.();
    case "folderDetail":
      return async () => {
        const sourceTabs = (screen.tabs || []).filter((tab) => !tab?.isAllTab);
        await Promise.all(sourceTabs.map((tab) => screen.loadTab?.(screen.tabs.indexOf(tab))));
      };
    default:
      return null;
  }
}

const NON_BACKSTACK_ROUTES = new Set([
  "profileSelection",
  "authQrSignIn",
  "authSignIn",
  "syncCode"
  ,"experienceModeSelection"
  ,"essentialAddonSetup"
]);

const NUVIO_HISTORY_STATE_KEY = "__nuvioHistory";

function getNuvioHistoryIndex(state) {
  const value = state?.[NUVIO_HISTORY_STATE_KEY]?.index;
  return Number.isInteger(value) && value >= 0 ? value : null;
}

export const Router = {
  current: null,
  currentParams: {},
  stack: [],
  historyInitialized: false,
  popstateBound: false,
  suppressPopstateUntil: 0,
  skipConsumeNextPopstate: false,
  ignoreNextPopstate: false,
  browserHistoryIndex: null,

  routes: {
    home: HomeScreen,
    player: PlayerScreen,
    account: AccountScreen,
    authQrSignIn: AuthQrSignInScreen,
    authSignIn: AuthSignInScreen,
    syncCode: SyncCodeScreen,
    profileSelection: ProfileSelectionScreen,
    experienceModeSelection: ExperienceModeSelectionScreen,
    essentialAddonSetup: EssentialAddonSetupScreen,
    detail: MetaDetailsScreen,
    library: LibraryScreen,
    search: SearchScreen,
    discover: DiscoverScreen,
    settings: SettingsScreen,
    debugConsole: ConsoleDebugScreen,
    trakt: TraktScreen,
    supportersContributors: SupportersContributorsScreen,
    licensesAttributions: LicensesAttributionsScreen,
    plugin: PluginScreen,
    plugins: PluginsScreen,
    catalogOrder: CatalogOrderScreen,
    stream: StreamScreen,
    castDetail: CastDetailScreen,
    catalogSeeAll: CatalogSeeAllScreen,
    folderDetail: FolderDetailScreen,
    collectionEdit: CollectionEditorScreen,
    collectionFolderEdit: CollectionFolderEditorScreen
  },

  getRouteStateKey(routeName, params = {}) {
    const screen = this.routes[routeName];
    if (!screen?.getRouteStateKey) {
      return null;
    }
    try {
      return screen.getRouteStateKey(params || {});
    } catch (error) {
      console.warn("Failed to resolve route state key", routeName, error);
      return null;
    }
  },

  getRouteStateStorageKey(routeName, params = {}, historyIndex = this.browserHistoryIndex) {
    const routeStateKey = this.getRouteStateKey(routeName, params);
    if (!routeStateKey) {
      return null;
    }
    const profileId = globalThis.window?.localStorage
      ? String(ProfileManager.getActiveProfileId?.() || "1")
      : "1";
    if (Number.isInteger(historyIndex) && historyIndex >= 0) {
      return `profile:${profileId}:entry:${historyIndex}:${routeStateKey}`;
    }
    return `profile:${profileId}:fallback:${routeStateKey}`;
  },

  captureCurrentRouteState(nextRoute = null, historyIndex = this.browserHistoryIndex) {
    if (!this.current) {
      return;
    }
    const screen = this.routes[this.current];
    if (!screen?.captureRouteState) {
      return;
    }
    const key = this.getRouteStateStorageKey(this.current, this.currentParams, historyIndex);
    if (!key) {
      return;
    }
    try {
      RouteStateStore.set(key, screen.captureRouteState({ nextRoute }));
    } catch (error) {
      console.warn("Failed to capture route state", this.current, error);
    }
  },

  resolveNavigationContext(routeName, params = {}, options = {}) {
    const screen = this.routes[routeName];
    const key = this.getRouteStateStorageKey(routeName, params);
    const restoreRouteState = Boolean(options?.restoreRouteState ?? (options?.fromHistory || options?.isBackNavigation));
    const shouldClear = Boolean(screen?.clearRouteStateOnMount?.(params || {}));
    if (shouldClear && key) {
      RouteStateStore.clear(key);
    }
    return {
      restoredState: restoreRouteState && !shouldClear && key ? RouteStateStore.get(key) : null,
      routeStateKey: key,
      restoreRouteState,
      fromHistory: Boolean(options?.fromHistory),
      isBackNavigation: Boolean(options?.isBackNavigation),
      previousRoute: String(options?.previousRoute || "")
    };
  },

  init() {
    if (this.popstateBound) {
      return;
    }
    this.popstateBound = true;
    window.addEventListener("popstate", async (event) => {
      if (this.ignoreNextPopstate) {
        this.ignoreNextPopstate = false;
        return;
      }
      if (Date.now() < Number(this.suppressPopstateUntil || 0)) {
        if (window?.history && typeof window.history.pushState === "function") {
          window.history.pushState(this.createBrowserHistoryState(), "");
        }
        return;
      }
      const state = event?.state || null;
      const hasValidHistoryTarget = Boolean(state?.route && this.routes[state.route]);
      const departingBrowserHistoryIndex = this.browserHistoryIndex;
      this.browserHistoryIndex = getNuvioHistoryIndex(state);
      const shouldSkipConsume = Boolean(this.skipConsumeNextPopstate);
      this.skipConsumeNextPopstate = false;
      const currentScreen = this.getCurrentScreen();
      const shouldLetPlayerReturnToStream =
        this.current === "player" &&
        state?.route === "stream" &&
        currentScreen?.shouldReturnToStreamOnBack?.() !== false &&
        !currentScreen?.hasBackDismissableOverlay?.();
      const consumeResult =
        !shouldSkipConsume && !shouldLetPlayerReturnToStream
          ? currentScreen?.consumeBackRequest?.({
              source: "popstate",
              hasValidHistoryTarget,
              targetRoute: hasValidHistoryTarget ? state.route : null
            })
          : false;
      if (consumeResult) {
        if (
          consumeResult !== "history" &&
          window?.history &&
          typeof window.history.pushState === "function"
        ) {
          this.browserHistoryIndex = Math.max(0, Number(this.browserHistoryIndex || 0)) + 1;
          window.history.pushState(this.createBrowserHistoryState(), "");
        }
        return;
      }
      if (this.current === "home" && (!state?.route || NON_BACKSTACK_ROUTES.has(state.route))) {
        return;
      }
      if (hasValidHistoryTarget) {
        await this.navigate(state.route, state.params || {}, {
          fromHistory: true,
          skipStackPush: true,
          isBackNavigation: true,
          captureHistoryIndex: departingBrowserHistoryIndex
        });
        return;
      }
      if (this.current && this.current !== "home" && this.routes.home) {
        await this.navigate(
          "home",
          {},
          {
            fromHistory: true,
            skipStackPush: true,
            isBackNavigation: true
          }
        );
      }
    });
  },

  suppressNextPopstate(durationMs = 700) {
    this.suppressPopstateUntil = Math.max(
      Number(this.suppressPopstateUntil || 0),
      Date.now() + Math.max(0, Number(durationMs || 0))
    );
  },

  ignoreSinglePopstate() {
    this.ignoreNextPopstate = true;
  },

  createBrowserHistoryState(route = this.current, params = this.currentParams, index = this.browserHistoryIndex) {
    return {
      route,
      params,
      [NUVIO_HISTORY_STATE_KEY]: {
        index: Number.isInteger(index) && index >= 0 ? index : 0
      }
    };
  },

  hasPreviousBrowserHistoryEntry() {
    return Platform.isBrowser()
      && this.historyInitialized
      && Number.isInteger(this.browserHistoryIndex)
      && this.browserHistoryIndex > 0;
  },

  async navigate(routeName, params = {}, options = {}) {
    const navigationStart = ROUTER_PERF_DEBUG ? routerPerfNow() : 0;

    const fromHistory = Boolean(options?.fromHistory);
    const skipStackPush = Boolean(options?.skipStackPush);
    const replaceHistory = Boolean(options?.replaceHistory);
    const targetParams = params || {};
    const Screen = this.routes[routeName];

    if (!Screen) {
      setBrowserRouteTitle("");
      console.error("Route not found:", routeName);
      return;
    }

    const bootGuard = globalThis.NuvioBootGuard;
    if (bootGuard && typeof bootGuard.stage === "function") {
      bootGuard.stage(`Opening ${routeName} screen`);
    }

    // Cleanup current
    const previousRoute = this.current;
    const shouldSkipPush = skipStackPush || NON_BACKSTACK_ROUTES.has(previousRoute);
    this.browserPullToRefreshCleanup?.();
    this.browserPullToRefreshCleanup = null;
    if (this.current && this.current !== routeName) {
      this.captureCurrentRouteState(routeName, options?.captureHistoryIndex);
      this.routes[this.current].cleanup?.();
      if (!shouldSkipPush) {
        this.stack.push({
          route: this.current,
          params: this.currentParams || {}
        });
      }
    } else if (this.current === routeName) {
      this.captureCurrentRouteState(routeName, options?.captureHistoryIndex);
      this.routes[this.current].cleanup?.();
    }

    this.current = routeName;
    this.currentParams = targetParams;
    setBrowserRouteTitle(routeName);
    const navigationContext = this.resolveNavigationContext(routeName, this.currentParams, {
      ...options,
      previousRoute
    });

    await Screen.mount(this.currentParams, navigationContext);
    logRouterPerf("navigate", {
      ms: Number((routerPerfNow() - navigationStart).toFixed(2)),
      route: routeName,
      previousRoute,
      fromHistory,
      skipStackPush,
      replaceHistory
    });

    // If another navigation happened while this screen was mounting, this
    // navigation is stale and must not write an extra history entry.
    if (this.current !== routeName || this.currentParams !== targetParams) {
      return;
    }

    const pullRefreshHandler = Platform.isBrowser()
      ? getBrowserPullRefreshHandler(routeName, Screen)
      : null;
    if (pullRefreshHandler) {
      this.browserPullToRefreshCleanup = bindBrowserPullToRefresh({
        onRefresh: pullRefreshHandler
      });
    }

    if (bootGuard && typeof bootGuard.ready === "function") {
      bootGuard.ready();
    }

    if (window?.history && typeof window.history.pushState === "function") {
      if (!this.historyInitialized) {
        this.browserHistoryIndex = getNuvioHistoryIndex(window.history.state) ?? 0;
        const state = this.createBrowserHistoryState();
        window.history.replaceState(state, "");
        this.historyInitialized = true;
      } else if (!fromHistory) {
        if (replaceHistory || NON_BACKSTACK_ROUTES.has(previousRoute)) {
          RouteStateStore.clearByHistoryEntry(this.browserHistoryIndex);
          const state = this.createBrowserHistoryState();
          window.history.replaceState(state, "");
        } else {
          this.browserHistoryIndex = Math.max(0, Number(this.browserHistoryIndex || 0)) + 1;
          const state = this.createBrowserHistoryState();
          window.history.pushState(state, "");
        }
      }
    }

    // Screens that must immediately replace their own committed route (for
    // example Continue Watching's transient Detail) run only after Router has
    // written the browser history entry. This keeps History API ownership here
    // while avoiding a later task that could paint the transient screen.
    await Screen.afterNavigationCommit?.(this.currentParams, navigationContext);
  },

  async backFromPendingNavigation() {
    // The current history entry still represents the caller until mount completes.
    // Restore that entry in place so a fast Back neither skips it nor records a stale route.
    const historyState = window?.history?.state || null;
    const targetRoute = String(historyState?.route || "");

    if (targetRoute && this.routes[targetRoute]) {
      const previous = this.stack[this.stack.length - 1];
      const previousRoute = typeof previous === "string" ? previous : previous?.route;
      if (previousRoute === targetRoute) {
        this.stack.pop();
      }
      await this.navigate(targetRoute, historyState.params || {}, {
        fromHistory: true,
        skipStackPush: true,
        isBackNavigation: true
      });
      return;
    }

    await this.back({ skipConsume: true, skipHistory: true });
  },

  async back(options = {}) {
    const currentScreen = this.getCurrentScreen();
    const consumeResult = !options?.skipConsume
      ? currentScreen?.consumeBackRequest?.({
          source: "app",
          hasPreviousBrowserHistoryEntry: this.hasPreviousBrowserHistoryEntry()
        })
      : false;
    if (consumeResult) {
      return;
    }

    if (this.current === "home") {
      return;
    }

    if (
      !options?.skipHistory &&
      window?.history &&
      typeof window.history.back === "function" &&
      this.hasPreviousBrowserHistoryEntry()
    ) {
      if (options?.skipConsume) {
        this.skipConsumeNextPopstate = true;
      }
      window.history.back();
      return;
    }

    if (this.stack.length === 0) {
      if (this.current && this.current !== "home" && this.routes.home) {
        const departingRoute = this.current;
        this.routes[this.current].cleanup?.();
        this.current = "home";
        this.currentParams = {};
        setBrowserRouteTitle("home");
        await this.routes.home.mount({}, {
          isBackNavigation: true,
          previousRoute: departingRoute
        });
        return;
      }

      return;
    }

    const previous = this.stack.pop();
    const previousRoute = typeof previous === "string" ? previous : previous?.route;
    const previousParams = typeof previous === "string" ? {} : previous?.params || {};

    if (!previousRoute || !this.routes[previousRoute]) {
      return;
    }

    const departingRoute = this.current;
    this.captureCurrentRouteState(previousRoute);
    this.routes[this.current].cleanup?.();
    this.current = previousRoute;
    this.currentParams = previousParams;
    setBrowserRouteTitle(previousRoute);
    const navigationContext = this.resolveNavigationContext(previousRoute, previousParams, {
      isBackNavigation: true,
      previousRoute: departingRoute
    });

    await this.routes[previousRoute].mount(previousParams, navigationContext);
  },

  getCurrent() {
    return this.current;
  },

  getCurrentScreen() {
    if (!this.current) {
      return null;
    }
    return this.routes[this.current] || null;
  }
};
