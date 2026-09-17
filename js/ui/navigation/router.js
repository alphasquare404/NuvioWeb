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
const DETAIL_SUSPEND_PARENT_ROUTES = new Set(["home", "search", "discover", "library", "folderDetail"]);

function rememberInlineStyles(element, properties) {
  return Object.fromEntries(
    properties.map((property) => [property, element?.style?.getPropertyValue?.(property) || ""])
  );
}

function restoreInlineStyles(element, styles = {}) {
  Object.entries(styles || {}).forEach(([property, value]) => {
    if (!element?.style) return;
    if (value) element.style.setProperty(property, value);
    else element.style.removeProperty(property);
  });
}

function getNuvioHistoryIndex(state) {
  const value = state?.[NUVIO_HISTORY_STATE_KEY]?.index;
  return Number.isInteger(value) && value >= 0 ? value : null;
}

function getNuvioHistoryProvenance(state) {
  const marker = state?.[NUVIO_HISTORY_STATE_KEY];
  const index = getNuvioHistoryIndex(state);
  const previousIndex = marker?.previousIndex;
  const previousRoute = marker?.previousRoute;
  if (
    index == null ||
    !Number.isInteger(previousIndex) ||
    previousIndex < 0 ||
    previousIndex !== index - 1 ||
    typeof previousRoute !== "string" ||
    !previousRoute
  ) {
    return null;
  }
  return { previousIndex, previousRoute };
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
  browserHistoryProvenance: null,
  suspendedDetailParent: null,
  pendingPreviousRouteBack: null,

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
    if (window?.history && "scrollRestoration" in window.history) {
      window.history.scrollRestoration = "manual";
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
      this.browserHistoryProvenance = getNuvioHistoryProvenance(state);
      const shouldSkipConsume = Boolean(this.skipConsumeNextPopstate);
      this.skipConsumeNextPopstate = false;
      const currentScreen = this.getCurrentScreen();
      const shouldLetPlayerReturnToStream =
        this.current === "player" &&
        state?.route === "stream" &&
        currentScreen?.shouldReturnToStreamOnBack?.() !== false &&
        !currentScreen?.hasBackDismissableOverlay?.();
      // Home uses Back to open/dismiss its sidebar, but that local behavior
      // must not consume a valid Forward traversal into another Nuvio route.
      const shouldSkipHomeForwardConsume = Boolean(
        this.current === "home" && hasValidHistoryTarget && state.route !== this.current
      );
      const consumeResult =
        !shouldSkipConsume && !shouldLetPlayerReturnToStream && !shouldSkipHomeForwardConsume
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
          const previousIndex = this.browserHistoryIndex;
          const previousRoute = hasValidHistoryTarget ? state.route : null;
          this.browserHistoryIndex = Math.max(0, Number(this.browserHistoryIndex || 0)) + 1;
          this.browserHistoryProvenance = this.createBrowserHistoryProvenance(
            previousIndex,
            previousRoute
          );
          window.history.pushState(this.createBrowserHistoryState(), "");
        }
        this.settlePreviousRouteBack(false);
        return;
      }
      if (this.current === "home" && (!state?.route || NON_BACKSTACK_ROUTES.has(state.route))) {
        this.settlePreviousRouteBack(false);
        return;
      }
      if (hasValidHistoryTarget) {
        await this.navigate(state.route, state.params || {}, {
          fromHistory: true,
          skipStackPush: true,
          isBackNavigation: true,
          captureHistoryIndex: departingBrowserHistoryIndex
        });
        this.settlePreviousRouteBack({
          route: this.current,
          index: this.browserHistoryIndex
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
      this.settlePreviousRouteBack(false);
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

  createBrowserHistoryProvenance(previousIndex, previousRoute) {
    return Number.isInteger(previousIndex) && previousIndex >= 0 && typeof previousRoute === "string" && previousRoute
      ? { previousIndex, previousRoute }
      : null;
  },

  createBrowserHistoryState(
    route = this.current,
    params = this.currentParams,
    index = this.browserHistoryIndex,
    provenance = this.browserHistoryProvenance
  ) {
    const marker = {
      index: Number.isInteger(index) && index >= 0 ? index : 0
    };
    if (provenance) {
      marker.previousIndex = provenance.previousIndex;
      marker.previousRoute = provenance.previousRoute;
    }
    // forceReload is a one-time directive for the mount that consumed it when
    // this entry was first navigated to (e.g. profile activation reloading
    // Home). It must not be baked into the persisted browser history state,
    // or a later popstate landing back on this exact entry replays it and
    // force-reloads the screen instead of restoring its preserved state --
    // the same one-time-directive leak navigate()'s own stack push already
    // guards against for the non-browser-history fallback path.
    const { forceReload: _forceReload, ...persistableParams } = params || {};
    return {
      route,
      params: persistableParams,
      [NUVIO_HISTORY_STATE_KEY]: marker
    };
  },

  canBackToPreviousNuvioRoute(routeName) {
    const provenance = this.browserHistoryProvenance;
    return Boolean(
      Platform.isBrowser() &&
        this.historyInitialized &&
        Number.isInteger(this.browserHistoryIndex) &&
        provenance &&
        provenance.previousRoute === routeName &&
        provenance.previousIndex === this.browserHistoryIndex - 1
    );
  },

  backToPreviousNuvioRoute(routeName) {
    if (
      this.pendingPreviousRouteBack ||
      !this.canBackToPreviousNuvioRoute(routeName) ||
      !window?.history ||
      typeof window.history.back !== "function"
    ) {
      return { accepted: false, settled: Promise.resolve(false) };
    }
    let resolve;
    const settled = new Promise((done) => {
      resolve = done;
    });
    this.pendingPreviousRouteBack = {
      expectedRoute: routeName,
      expectedIndex: this.browserHistoryProvenance.previousIndex,
      resolve
    };
    try {
      window.history.back();
      return { accepted: true, settled };
    } catch (_) {
      this.settlePreviousRouteBack(false);
      return { accepted: false, settled: Promise.resolve(false) };
    }
  },

  settlePreviousRouteBack(result = false) {
    const pending = this.pendingPreviousRouteBack;
    if (!pending) return;
    this.pendingPreviousRouteBack = null;
    pending.resolve(
      Boolean(
        result &&
          result.route === pending.expectedRoute &&
          result.index === pending.expectedIndex
      )
    );
  },

  hasPreviousBrowserHistoryEntry() {
    return Platform.isBrowser()
      && this.historyInitialized
      && Number.isInteger(this.browserHistoryIndex)
      && this.browserHistoryIndex > 0;
  },

  suspendCurrentParentForDetail() {
    if (!Platform.isBrowser() || !DETAIL_SUSPEND_PARENT_ROUTES.has(this.current)) {
      return false;
    }
    const parentScreen = this.routes[this.current];
    const parentContainer = parentScreen?.container || document?.getElementById?.(this.current);
    const detailContainer = document?.getElementById?.("detail");
    if (!parentScreen || !parentContainer || !detailContainer) {
      return false;
    }
    const documentElement = document.documentElement;
    const body = document.body;
    this.suspendedDetailParent = {
      route: this.current,
      params: this.currentParams,
      historyIndex: this.browserHistoryIndex,
      screen: parentScreen,
      parentContainer,
      parentInert: Boolean(parentContainer.inert),
      parentAriaHidden: parentContainer.getAttribute?.("aria-hidden"),
      detailContainer,
      detailStyles: rememberInlineStyles(detailContainer, [
        "position", "inset", "z-index", "overflow-y", "overscroll-behavior", "background"
      ]),
      documentStyles: rememberInlineStyles(documentElement, ["overflow"]),
      bodyStyles: rememberInlineStyles(body, ["overflow"])
    };
    parentContainer.inert = true;
    parentContainer.setAttribute?.("aria-hidden", "true");
    documentElement?.style?.setProperty("overflow", "hidden");
    body?.style?.setProperty("overflow", "hidden");
    detailContainer.style.setProperty("position", "fixed");
    detailContainer.style.setProperty("inset", "0");
    detailContainer.style.setProperty("z-index", "1000");
    detailContainer.style.setProperty("overflow-y", "auto");
    detailContainer.style.setProperty("overscroll-behavior", "contain");
    detailContainer.style.setProperty("background", "var(--bg-color)");
    return true;
  },

  releaseSuspendedDetailParent({ cleanup = false } = {}) {
    const suspended = this.suspendedDetailParent;
    if (!suspended) return null;
    this.suspendedDetailParent = null;
    const { parentContainer, detailContainer } = suspended;
    if (parentContainer) {
      parentContainer.inert = Boolean(suspended.parentInert);
      if (suspended.parentAriaHidden == null) parentContainer.removeAttribute?.("aria-hidden");
      else parentContainer.setAttribute?.("aria-hidden", suspended.parentAriaHidden);
    }
    restoreInlineStyles(detailContainer, suspended.detailStyles);
    restoreInlineStyles(document.documentElement, suspended.documentStyles);
    restoreInlineStyles(document.body, suspended.bodyStyles);
    if (cleanup) suspended.screen?.cleanup?.();
    return suspended;
  },

  canResumeSuspendedDetailParent(routeName, options = {}) {
    const suspended = this.suspendedDetailParent;
    return Boolean(
      suspended &&
        routeName === suspended.route &&
        (options?.fromHistory || options?.isBackNavigation) &&
        Number.isInteger(this.browserHistoryIndex) &&
        this.browserHistoryIndex === suspended.historyIndex
    );
  },

  async resumeSuspendedDetailParent(routeName, params, options, previousRoute) {
    const suspended = this.releaseSuspendedDetailParent();
    this.routes[previousRoute]?.cleanup?.();
    this.current = routeName;
    this.currentParams = params || {};
    setBrowserRouteTitle(routeName);
    if (suspended?.parentContainer?.style) {
      suspended.parentContainer.style.display = "block";
    }
    const pullRefreshHandler = Platform.isBrowser()
      ? getBrowserPullRefreshHandler(routeName, this.routes[routeName])
      : null;
    if (pullRefreshHandler) {
      this.browserPullToRefreshCleanup = bindBrowserPullToRefresh({ onRefresh: pullRefreshHandler });
    }
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

    const previousRoute = this.current;
    if (this.canResumeSuspendedDetailParent(routeName, options)) {
      await this.resumeSuspendedDetailParent(routeName, targetParams, options, previousRoute);
      this.settlePreviousRouteBack({ route: this.current, index: this.browserHistoryIndex });
      return;
    }
    if (previousRoute === "detail" && this.suspendedDetailParent) {
      this.releaseSuspendedDetailParent({ cleanup: true });
    }

    // Cleanup current
    const shouldSkipPush = skipStackPush || NON_BACKSTACK_ROUTES.has(previousRoute);
    this.browserPullToRefreshCleanup?.();
    this.browserPullToRefreshCleanup = null;
    if (this.current && this.current !== routeName) {
      this.captureCurrentRouteState(routeName, options?.captureHistoryIndex);
      const suspendParent = routeName === "detail" && this.suspendCurrentParentForDetail();
      if (!suspendParent) {
        this.routes[this.current].cleanup?.();
      }
      if (!shouldSkipPush) {
        // forceReload is a one-time directive for the mount that consumed it
        // (e.g. profile activation reloading Home). It must not be replayed
        // by a later back() to this stack entry, or every return trip
        // force-reloads the screen instead of restoring its preserved state.
        const { forceReload: _forceReload, ...persistableParams } = this.currentParams || {};
        this.stack.push({
          route: this.current,
          params: persistableParams
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
        this.browserHistoryProvenance = null;
        const state = this.createBrowserHistoryState();
        window.history.replaceState(state, "");
        this.historyInitialized = true;
      } else if (!fromHistory) {
        if (replaceHistory || NON_BACKSTACK_ROUTES.has(previousRoute)) {
          RouteStateStore.clearByHistoryEntry(this.browserHistoryIndex);
          const state = this.createBrowserHistoryState();
          window.history.replaceState(state, "");
        } else {
          const previousIndex = this.browserHistoryIndex;
          this.browserHistoryIndex = Math.max(0, Number(this.browserHistoryIndex || 0)) + 1;
          this.browserHistoryProvenance = this.createBrowserHistoryProvenance(
            previousIndex,
            previousRoute
          );
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
