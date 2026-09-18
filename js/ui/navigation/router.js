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
import { getBrowserVerticalScrollOwner } from "./browserScrollPosition.js";
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

// Navigation has one rule, for every route: a forward navigation that creates
// its own browser history entry layers the new screen *over* the one it came
// from. The outgoing screen keeps its DOM and its exact scroll position, inert
// underneath, and Back reveals it again instead of rebuilding it. The browser
// history stack and this layer stack are the same stack -- there is no list of
// blessed route pairs, because "which screen is behind this one" is already
// answered by history itself.
//
// In browser/PWA mode `.screen` is `height:auto` and the *document* is the
// scroller, so a covered screen cannot simply be hidden (display:none discards
// its layout, and the shared document scroll would move). Instead the incoming
// screen becomes its own fixed, self-scrolling layer and the document scroll is
// frozen in place -- so the bottom screen keeps its document scroll and every
// layer above keeps its own.
//
// Depth is bounded: only the most recent layers stay live. Anything evicted
// falls back to the RouteStateStore snapshot captured for its exact history
// entry, which is what that store is for.
const MAX_SUSPENDED_LAYERS = 4;

// The one screen never kept alive underneath another: its <video> holds decoder
// and network resources that must be released when it is left, never retained
// merely to preserve navigation state.
const NEVER_SUSPEND_ROUTES = new Set(["player"]);

// The inline styles the router owns on whichever screen is drawn as a layer.
const LAYER_CHROME_PROPERTIES = [
  "position", "inset", "z-index", "overflow-y", "overscroll-behavior", "background"
];

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
  // Bounded stack of live layers still sitting behind the current screen --
  // e.g. [Home, Detail] while Stream is open over both. It mirrors the browser
  // history entries directly behind the current one, capped at
  // MAX_SUSPENDED_LAYERS.
  suspendedRouteStack: [],
  // The document's own scroll-lock state from before the first layer went up.
  suspendedDocumentChrome: null,
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
      const captured = screen.captureRouteState({ nextRoute });
      RouteStateStore.set(key, captured);
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
    const restoredState = restoreRouteState && !shouldClear && key ? RouteStateStore.get(key) : null;
    return {
      restoredState,
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

  // A screen can only be layered under another when the entry it occupies is
  // still reachable by Back, and when it is not about to have its own DOM
  // reused. Every route shares one container per route name, so a route can
  // never be layered under itself -- that is what makes Detail A -> Detail B a
  // genuine remount rather than a preference.
  canSuspendOutgoingRoute(routeName, outgoingHistoryIndex, options = {}) {
    return Boolean(
      Platform.isBrowser() &&
        this.current &&
        this.current !== routeName &&
        !NEVER_SUSPEND_ROUTES.has(this.current) &&
        !options?.replaceHistory &&
        !NON_BACKSTACK_ROUTES.has(this.current) &&
        Number.isInteger(outgoingHistoryIndex)
    );
  },

  suspendCurrentRouteUnder(routeName, outgoingHistoryIndex, options = {}) {
    if (!this.canSuspendOutgoingRoute(routeName, outgoingHistoryIndex, options)) {
      return false;
    }
    const parentScreen = this.routes[this.current];
    const parentContainer = parentScreen?.container || document?.getElementById?.(this.current);
    const childContainer = document?.getElementById?.(routeName);
    if (!parentScreen || !parentContainer || !childContainer) {
      return false;
    }
    const documentElement = document.documentElement;
    const body = document.body;
    const depth = this.suspendedRouteStack.length;
    this.suspendedRouteStack.push({
      route: this.current,
      params: this.currentParams,
      historyIndex: outgoingHistoryIndex,
      screen: parentScreen,
      parentContainer,
      parentInert: Boolean(parentContainer.inert),
      parentAriaHidden: parentContainer.getAttribute?.("aria-hidden"),
      childContainer,
      childStyles: rememberInlineStyles(childContainer, LAYER_CHROME_PROPERTIES)
    });
    // The document scroll lock belongs to the stack as a whole, not to any one
    // layer -- layers can be evicted from the bottom, so a per-layer snapshot
    // would strand the lock on. Take it once, on the way in, and put it back
    // once nothing is layered any more.
    if (!this.suspendedDocumentChrome) {
      this.suspendedDocumentChrome = {
        documentStyles: rememberInlineStyles(documentElement, ["overflow"]),
        bodyStyles: rememberInlineStyles(body, ["overflow"])
      };
    }
    parentContainer.inert = true;
    parentContainer.setAttribute?.("aria-hidden", "true");
    documentElement?.style?.setProperty("overflow", "hidden");
    body?.style?.setProperty("overflow", "hidden");
    this.applyLayerChrome(childContainer, depth);
    this.evictSuspendedLayersBeyondLimit();
    this.normalizeLayerZIndices();
    return true;
  },

  // Each layer records which screen is drawn directly above it, so releasing it
  // can hand that screen its own styles back. A navigation that replaces the
  // current history entry swaps that screen without adding a layer -- Continue
  // Watching does exactly this, replacing its transient Detail with Stream --
  // so the record has to follow the swap. Without this the incoming screen
  // never becomes a layer at all: it lands in normal document flow *below* the
  // suspended screens, which are still covering the viewport with the document
  // scroll locked, leaving the viewer looking at an inert screen they cannot
  // scroll, tap, or navigate out of.
  retargetTopLayerChild(routeName) {
    const top = this.suspendedRouteStack[this.suspendedRouteStack.length - 1];
    if (!top) {
      return false;
    }
    const container = this.routes[routeName]?.container || document?.getElementById?.(routeName);
    if (!container || top.childContainer === container) {
      return false;
    }
    restoreInlineStyles(top.childContainer, top.childStyles);
    top.childContainer = container;
    top.childStyles = rememberInlineStyles(container, LAYER_CHROME_PROPERTIES);
    this.applyLayerChrome(container, this.suspendedRouteStack.length - 1);
    this.normalizeLayerZIndices();
    return true;
  },

  applyLayerChrome(childContainer, depth) {
    if (!childContainer?.style) {
      return;
    }
    childContainer.style.setProperty("position", "fixed");
    childContainer.style.setProperty("inset", "0");
    childContainer.style.setProperty("z-index", String(1000 + depth));
    childContainer.style.setProperty("overflow-y", "auto");
    childContainer.style.setProperty("overscroll-behavior", "contain");
    childContainer.style.setProperty("background", "var(--bg-color)");
  },

  // Paint order must always match stack order. Depth alone is not enough: a
  // layer removed from the middle frees a depth that the next push reuses,
  // leaving two containers on the same z-index -- and the one later in the
  // shell's markup then covers the screen that is actually current. Restating
  // the whole ladder after every change keeps that impossible.
  normalizeLayerZIndices() {
    this.suspendedRouteStack.forEach((layer, index) => {
      layer.childContainer?.style?.setProperty("z-index", String(1000 + index));
    });
  },

  // Layer chrome belongs to the router, not to the screens. A screen that
  // clears its own container's inline styles while mounting would otherwise
  // silently drop out of the layer stack -- keeping its z-index but losing
  // `position: fixed`, so it cannot scroll and the screen behind it is frozen.
  // That failure is invisible until someone tries to scroll, so the invariant
  // is re-stated after mount rather than trusted.
  reassertTopLayerChrome(routeName) {
    const top = this.suspendedRouteStack[this.suspendedRouteStack.length - 1];
    const container = this.routes[routeName]?.container || document?.getElementById?.(routeName);
    if (!top || !container || top.childContainer !== container) {
      return;
    }
    this.applyLayerChrome(container, this.suspendedRouteStack.length - 1);
  },

  // Keeps the live-layer depth bounded. The oldest layers go first: they are
  // the furthest from the current screen, so they are the least likely to be
  // revealed next, and the RouteStateStore snapshot for their entry still
  // rebuilds them correctly if Back ever reaches that far.
  evictSuspendedLayersBeyondLimit() {
    while (this.suspendedRouteStack.length > MAX_SUSPENDED_LAYERS) {
      const evicted = this.suspendedRouteStack.shift();
      this.restoreSuspendedLayerChrome(evicted);
      evicted?.screen?.cleanup?.();
    }
    this.normalizeLayerZIndices();
  },

  // Releases any live layer that owns the container `routeName` is about to
  // mount into. One container per route name means the incoming mount would
  // wipe that layer's DOM anyway; cleaning it up first keeps the stack honest
  // about what is actually still alive.
  releaseSuspendedLayersForRoute(routeName) {
    for (let index = this.suspendedRouteStack.length - 1; index >= 0; index -= 1) {
      const layer = this.suspendedRouteStack[index];
      if (layer.route !== routeName) {
        continue;
      }
      this.suspendedRouteStack.splice(index, 1);
      this.restoreSuspendedLayerChrome(layer);
      layer.screen?.cleanup?.();
    }
    this.normalizeLayerZIndices();
  },

  // Puts a removed layer's own chrome back: its parent becomes interactive
  // again and the screen that was layered over it stops being a fixed overlay.
  // Must run after the layer has left the stack, so the emptiness check below
  // sees the post-removal state.
  restoreSuspendedLayerChrome(layer) {
    if (!layer) {
      return null;
    }
    const { parentContainer, childContainer } = layer;
    if (parentContainer) {
      parentContainer.inert = Boolean(layer.parentInert);
      if (layer.parentAriaHidden == null) parentContainer.removeAttribute?.("aria-hidden");
      else parentContainer.setAttribute?.("aria-hidden", layer.parentAriaHidden);
    }
    restoreInlineStyles(childContainer, layer.childStyles);
    if (!this.suspendedRouteStack.length && this.suspendedDocumentChrome) {
      restoreInlineStyles(document.documentElement, this.suspendedDocumentChrome.documentStyles);
      restoreInlineStyles(document.body, this.suspendedDocumentChrome.bodyStyles);
      this.suspendedDocumentChrome = null;
    }
    return layer;
  },

  releaseTopSuspendedLayer({ cleanup = false } = {}) {
    const suspended = this.suspendedRouteStack.pop();
    if (!suspended) return null;
    this.restoreSuspendedLayerChrome(suspended);
    this.normalizeLayerZIndices();
    if (cleanup) suspended.screen?.cleanup?.();
    return suspended;
  },

  // Hard reset for state that outlives navigation itself (profile switch),
  // where no layer may survive into the next session's data.
  releaseAllSuspendedLayers({ cleanup = false } = {}) {
    while (this.suspendedRouteStack.length) {
      this.releaseTopSuspendedLayer({ cleanup });
    }
  },

  // Back and Forward are the same question: does the entry we just landed on
  // still have its screen alive? Searching the whole stack (not just its top)
  // means a multi-entry jump -- the browser's own history menu, or several
  // rapid Backs -- reveals its target the same way a single step does.
  findResumableSuspendedLayer(routeName, options = {}) {
    if (!(options?.fromHistory || options?.isBackNavigation)) {
      return -1;
    }
    if (!Number.isInteger(this.browserHistoryIndex)) {
      return -1;
    }
    for (let index = this.suspendedRouteStack.length - 1; index >= 0; index -= 1) {
      const layer = this.suspendedRouteStack[index];
      if (layer.route === routeName && layer.historyIndex === this.browserHistoryIndex) {
        return index;
      }
    }
    return -1;
  },

  async resumeSuspendedLayer(depth, routeName, params, previousRoute) {
    // Anything layered above the entry we landed on belongs to the future now:
    // those screens are no longer behind anything, so they are torn down and
    // left to their own entry snapshots if Forward ever returns to them.
    while (this.suspendedRouteStack.length - 1 > depth) {
      this.releaseTopSuspendedLayer({ cleanup: true });
    }
    const suspended = this.releaseTopSuspendedLayer();
    this.routes[previousRoute]?.cleanup?.();
    // The screen being left owned a pull-to-refresh binding, with its own
    // touch listeners and its own indicator element. Rebinding without
    // releasing it first leaves both behind, and every Back adds another set.
    this.browserPullToRefreshCleanup?.();
    this.browserPullToRefreshCleanup = null;
    this.current = routeName;
    window.__NUVIO_CURRENT_ROUTE__ = routeName;
    this.currentParams = params || {};
    setBrowserRouteTitle(routeName);
    if (suspended?.parentContainer?.style) {
      suspended.parentContainer.style.display = "block";
    }
    const pullRefreshHandler = Platform.isBrowser()
      ? getBrowserPullRefreshHandler(routeName, this.routes[routeName])
      : null;
    if (pullRefreshHandler) {
      this.browserPullToRefreshCleanup = bindBrowserPullToRefresh({
        onRefresh: pullRefreshHandler,
        resolveScrollOwner: () => getBrowserVerticalScrollOwner(this.routes[routeName]?.container)
      });
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
    // The entry the outgoing screen occupies. On a Back/Forward the popstate
    // handler has already moved browserHistoryIndex to the target, so the
    // departing index arrives separately -- the same value route-state capture
    // keys itself by, because they describe the same entry.
    const outgoingHistoryIndex = Number.isInteger(options?.captureHistoryIndex)
      ? options.captureHistoryIndex
      : this.browserHistoryIndex;

    const resumableDepth = this.findResumableSuspendedLayer(routeName, options);
    if (resumableDepth >= 0) {
      await this.resumeSuspendedLayer(resumableDepth, routeName, targetParams, previousRoute);
      this.settlePreviousRouteBack({ route: this.current, index: this.browserHistoryIndex });
      return;
    }
    // Mounting rebuilds this route's container from scratch, so any layer still
    // holding that same container has to go first.
    this.releaseSuspendedLayersForRoute(routeName);

    // Cleanup current
    const shouldSkipPush = skipStackPush || NON_BACKSTACK_ROUTES.has(previousRoute);
    this.browserPullToRefreshCleanup?.();
    this.browserPullToRefreshCleanup = null;
    if (this.current && this.current !== routeName) {
      this.captureCurrentRouteState(routeName, options?.captureHistoryIndex);
      const suspendParent = this.suspendCurrentRouteUnder(routeName, outgoingHistoryIndex, options);
      if (!suspendParent) {
        this.routes[this.current].cleanup?.();
        // Not suspending the outgoing screen says nothing about whether the
        // incoming one needs to be a layer -- that depends only on whether
        // anything is still layered beneath it.
        this.retargetTopLayerChild(routeName);
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
    window.__NUVIO_CURRENT_ROUTE__ = routeName;
    this.currentParams = targetParams;
    setBrowserRouteTitle(routeName);
    const navigationContext = this.resolveNavigationContext(routeName, this.currentParams, {
      ...options,
      previousRoute
    });

    await Screen.mount(this.currentParams, navigationContext);
    this.reassertTopLayerChrome(routeName);
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
        onRefresh: pullRefreshHandler,
        resolveScrollOwner: () => getBrowserVerticalScrollOwner(Screen.container)
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
        window.__NUVIO_CURRENT_ROUTE__ = "home";
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
    window.__NUVIO_CURRENT_ROUTE__ = previousRoute;
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
