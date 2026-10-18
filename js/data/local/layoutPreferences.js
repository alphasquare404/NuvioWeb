import { createProfileScopedStore } from "./profileScopedStore.js";
import { LocalStore } from "../../core/storage/localStore.js";

const KEY = "layoutPreferences";

const DEFAULTS = {
  hasChosenLayout: false,
  homeLayout: "modern",
  continueWatchingCardStyle: "card",
  heroSectionEnabled: true,
  discoverLocation: "in_search",
  heroCatalogKeys: [],
  posterLabelsEnabled: true,
  catalogAddonNameEnabled: true,
  catalogTypeSuffixEnabled: true,
  modernLandscapePostersEnabled: false,
  // Which way round a catalog card is drawn. The default follows whatever the
  // addon says, because an addon that supplies wide artwork is already telling
  // you the shape it wants -- making every user set that by hand would be
  // asking them to repeat what the source already said.
  catalogCardOrientation: "source",
  modernHeroFullScreenBackdropEnabled: false,
  classicFocusGradientEnabled: false,
  focusedPosterBackdropExpandEnabled: true,
  focusedPosterBackdropExpandDelaySeconds: 3,
  focusedPosterBackdropTrailerEnabled: false,
  focusedPosterBackdropTrailerMuted: true,
  focusedPosterBackdropTrailerPlaybackTarget: "hero_media",
  posterCardWidthDp: 126,
  posterCardCornerRadiusDp: 12,
  fastHorizontalNavigationEnabled: false,
  cardDepthEnabled: false,
  cardDepthEdgeStrength: 28,
  cardDepthSheenStrength: 10,
  cardDepthEdgeCoverage: 0,
  cardDepthPostersEnabled: true,
  cardDepthContinueWatchingEnabled: true,
  cardDepthEpisodeCardsEnabled: true,
  cardDepthCastEnabled: true,
  cardDepthTrailersEnabled: true,
  detailPageTrailerButtonEnabled: true,
  preferExternalMetaAddonDetail: true,
  blurUnwatchedEpisodes: false,
  collapseSidebar: false,
  // How the browser build draws its primary navigation: a floating bar, or a
  // side rail. Where the floating bar sits is not a preference -- it follows the
  // layout, bottom on a phone and top on a desktop -- so only the shape is stored.
  browserNavigationStyle: "",
  // Which corner the side rail hangs from. Only read when the style is the rail;
  // the floating bar has no corner to put anywhere.
  browserNavigationRailCorner: "top-right",
  modernSidebar: false,
  modernSidebarBlur: false,
  hideUnreleasedContent: false,
  showFullReleaseDate: true,
  useEpisodeThumbnailsInCw: true,
  blurContinueWatchingNextUp: false,
  showUnairedNextUp: true,
  nextUpFromFurthestEpisode: true,
  continueWatchingSortMode: "default"
};

function normalizeContinueWatchingSortMode(value) {
  const normalized = String(value || "default")
    .trim()
    .toLowerCase();
  if (
    normalized === "split_upcoming" ||
    normalized === "split-upcoming" ||
    normalized === "splitupcoming"
  ) {
    return "split_upcoming";
  }
  return normalized === "streaming_style" ||
    normalized === "streaming-style" ||
    normalized === "streamingstyle"
    ? "streaming_style"
    : "default";
}

const CATALOG_CARD_ORIENTATIONS = ["source", "portrait", "landscape"];

/**
 * How catalog cards should be oriented: follow the addon, or force one way.
 *
 * Anything unreadable falls back to following the source, which is the only
 * answer that can still be right for every catalog at once.
 */
export function normalizeCatalogCardOrientation(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  return CATALOG_CARD_ORIENTATIONS.includes(normalized) ? normalized : "source";
}

/**
 * Whether one card is drawn wide.
 *
 * `sourceShape` is what the addon declared for that entry, or "" when it
 * declared nothing -- and silence is not the same as asking for portrait. An
 * addon that says nothing leaves the shape to the reader.
 */
export function shouldDrawCardLandscape(orientation, sourceShape = "") {
  const mode = normalizeCatalogCardOrientation(orientation);
  if (mode === "landscape") return true;
  if (mode === "portrait") return false;
  return (
    String(sourceShape || "")
      .trim()
      .toLowerCase() === "landscape"
  );
}

const BROWSER_NAVIGATION_RAIL_CORNERS = ["top-right", "bottom-right", "bottom-left"];

/**
 * Where the navigation goes when nobody has said.
 *
 * An installed app on a phone is held in one hand, so the navigation belongs
 * at the bottom, within reach of the thumb that is holding it. Anywhere else
 * it stays where it has always been: a bar at the top, always visible and
 * costing nothing to reach.
 *
 * Phone-shaped is measured on the shorter side, not the width: a phone turned
 * sideways is still a phone, and a tablet held upright is still a tablet. The
 * short side of a phone is around 400 points and of a tablet around 750, so the
 * line sits between them and neither orientation moves anything.
 */
export function resolveDefaultBrowserNavigationPlacement() {
  const shortestSide = Math.min(
    Number(globalThis.innerWidth || 0) || Number.POSITIVE_INFINITY,
    Number(globalThis.innerHeight || 0) || Number.POSITIVE_INFINITY
  );
  return shortestSide <= 600 ? "bottom" : "top";
}

/**
 * The two navigation shapes the browser build offers.
 *
 * "floating" is a bar pinned to the edge the layout asks for; "rail" is the
 * collapsible side rail, which also owns its corner. Anything unrecognised reads
 * as floating, which is what every build did before the rail existed.
 */
const BROWSER_NAVIGATION_STYLES = ["floating", "rail"];

export function normalizeBrowserNavigationStyle(value, legacyPlacement = "") {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (BROWSER_NAVIGATION_STYLES.includes(normalized)) {
    return normalized;
  }
  // A profile written by a build that stored the placement instead of the shape:
  // the rail maps to the rail, and both bar positions map to the floating bar.
  const legacy = String(legacyPlacement || "")
    .trim()
    .toLowerCase();
  if (legacy === "sidebar") {
    return "rail";
  }
  if (legacy === "top" || legacy === "bottom") {
    return "floating";
  }
  return "";
}

export function resolveBrowserNavigationStyle(settings = {}) {
  return normalizeBrowserNavigationStyle(
    settings?.browserNavigationStyle,
    settings?.browserNavigationPlacement
  ) === "rail"
    ? "rail"
    : "floating";
}

/** Where the floating bar belongs on this layout, chosen by the layout itself. */
export function resolveFloatingNavigationPlacement() {
  return resolveDefaultBrowserNavigationPlacement();
}

/**
 * The corner the side rail hangs from.
 *
 * Top left is deliberately not offered: that is where Back lives, and a rail
 * button sitting on it would cover the one control every screen needs.
 */
export function normalizeBrowserNavigationRailCorner(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  return BROWSER_NAVIGATION_RAIL_CORNERS.includes(normalized) ? normalized : "top-right";
}

function normalizeLayoutPreferences(value = {}) {
  const merged = {
    ...DEFAULTS,
    ...(value || {})
  };
  const modernSidebar = Boolean(merged.modernSidebar);
  const discoverLocation = String(
    value?.discoverLocation ?? (value?.searchDiscoverEnabled === false ? "off" : "in_search")
  ).toLowerCase();
  const continueWatchingCardStyle = String(
    merged.continueWatchingCardStyle || "card"
  ).toLowerCase();

  return {
    ...merged,
    hasChosenLayout:
      typeof value?.hasChosenLayout === "boolean"
        ? value.hasChosenLayout
        : Object.keys(value || {}).length > 0,
    continueWatchingCardStyle: ["card", "wide", "poster"].includes(continueWatchingCardStyle)
      ? continueWatchingCardStyle
      : "card",
    discoverLocation: ["in_search", "in_sidebar", "off"].includes(discoverLocation)
      ? discoverLocation
      : "in_search",
    searchDiscoverEnabled: discoverLocation !== "off",
    heroCatalogKeys: [
      ...new Set(
        (Array.isArray(merged.heroCatalogKeys) ? merged.heroCatalogKeys : [])
          .map(String)
          .filter(Boolean)
      )
    ],
    modernLandscapePostersEnabled: Boolean(merged.modernLandscapePostersEnabled),
    modernHeroFullScreenBackdropEnabled: Boolean(merged.modernHeroFullScreenBackdropEnabled),
    focusedPosterBackdropExpandEnabled: Boolean(merged.focusedPosterBackdropExpandEnabled),
    focusedPosterBackdropExpandDelaySeconds: Math.max(
      0,
      Number(merged.focusedPosterBackdropExpandDelaySeconds ?? 3) || 0
    ),
    focusedPosterBackdropTrailerEnabled: Boolean(merged.focusedPosterBackdropTrailerEnabled),
    focusedPosterBackdropTrailerMuted: merged.focusedPosterBackdropTrailerMuted !== false,
    focusedPosterBackdropTrailerPlaybackTarget:
      String(merged.focusedPosterBackdropTrailerPlaybackTarget || "hero_media").toLowerCase() ===
      "expanded_card"
        ? "expanded_card"
        : "hero_media",
    posterCardWidthDp: Math.max(72, Number(merged.posterCardWidthDp ?? 126) || 126),
    posterCardCornerRadiusDp: Math.max(0, Number(merged.posterCardCornerRadiusDp ?? 12) || 12),
    fastHorizontalNavigationEnabled: Boolean(
      value?.fastHorizontalNavigationEnabled ??
      LocalStore.get("fastHorizontalNavigationEnabled", false)
    ),
    cardDepthEnabled: Boolean(merged.cardDepthEnabled),
    cardDepthEdgeStrength: Math.min(
      100,
      Math.max(0, Number(merged.cardDepthEdgeStrength ?? 28) || 0)
    ),
    cardDepthSheenStrength: Math.min(
      100,
      Math.max(0, Number(merged.cardDepthSheenStrength ?? 10) || 0)
    ),
    cardDepthEdgeCoverage: Math.min(
      100,
      Math.max(0, Number(merged.cardDepthEdgeCoverage ?? 0) || 0)
    ),
    cardDepthPostersEnabled: merged.cardDepthPostersEnabled !== false,
    cardDepthContinueWatchingEnabled: merged.cardDepthContinueWatchingEnabled !== false,
    cardDepthEpisodeCardsEnabled: merged.cardDepthEpisodeCardsEnabled !== false,
    cardDepthCastEnabled: merged.cardDepthCastEnabled !== false,
    cardDepthTrailersEnabled: merged.cardDepthTrailersEnabled !== false,
    preferExternalMetaAddonDetail: merged.preferExternalMetaAddonDetail !== false,
    showFullReleaseDate: merged.showFullReleaseDate !== false,
    detailPageTrailerButtonEnabled: Boolean(merged.detailPageTrailerButtonEnabled),
    blurUnwatchedEpisodes: Boolean(merged.blurUnwatchedEpisodes),
    useEpisodeThumbnailsInCw: merged.useEpisodeThumbnailsInCw !== false,
    blurContinueWatchingNextUp: Boolean(merged.blurContinueWatchingNextUp),
    showUnairedNextUp: merged.showUnairedNextUp !== false,
    nextUpFromFurthestEpisode: merged.nextUpFromFurthestEpisode !== false,
    continueWatchingSortMode: normalizeContinueWatchingSortMode(merged.continueWatchingSortMode),
    collapseSidebar: modernSidebar ? false : Boolean(merged.collapseSidebar),
    // Empty stays empty: it means nobody has chosen, and a profile written before
    // the two shapes existed is read from its stored placement instead.
    browserNavigationStyle: normalizeBrowserNavigationStyle(
      merged.browserNavigationStyle,
      merged.browserNavigationPlacement
    ),
    catalogCardOrientation: normalizeCatalogCardOrientation(merged.catalogCardOrientation),
    browserNavigationRailCorner: normalizeBrowserNavigationRailCorner(
      merged.browserNavigationRailCorner
    ),
    modernSidebar,
    modernSidebarBlur: modernSidebar
      ? Boolean(merged.modernSidebarBlur)
      : Boolean(merged.modernSidebarBlur)
  };
}

const store = createProfileScopedStore({
  key: KEY,
  normalize: normalizeLayoutPreferences
});

// The floating bar's edge follows the viewport, so a resize that crosses the
// phone line has to move it. Re-applying the stored settings is enough: nothing
// is stored about the edge itself.
if (typeof globalThis.addEventListener === "function") {
  globalThis.addEventListener("resize", () => {
    if (typeof document === "undefined") {
      return;
    }
    applyLayoutPresentation(store.get());
  });
}
function applyLayoutPresentation(settings) {
  const root = globalThis?.document?.documentElement;
  if (!root) return;
  root.dataset.cardDepth = settings.cardDepthEnabled ? "true" : "false";
  root.dataset.cardDepthPosters = settings.cardDepthPostersEnabled !== false ? "true" : "false";
  root.dataset.cardDepthContinueWatching =
    settings.cardDepthContinueWatchingEnabled !== false ? "true" : "false";
  root.dataset.cardDepthEpisodes =
    settings.cardDepthEpisodeCardsEnabled !== false ? "true" : "false";
  root.dataset.cardDepthCast = settings.cardDepthCastEnabled !== false ? "true" : "false";
  root.dataset.cardDepthTrailers = settings.cardDepthTrailersEnabled !== false ? "true" : "false";
  root.style.setProperty("--card-depth-edge", String(settings.cardDepthEdgeStrength / 100));
  root.style.setProperty("--card-depth-sheen", String(settings.cardDepthSheenStrength / 100));
  root.style.setProperty("--card-depth-coverage", String(settings.cardDepthEdgeCoverage / 100));
  root.style.setProperty(
    "--card-depth-coverage-size",
    `${12 + Math.round((18 * settings.cardDepthEdgeCoverage) / 100)}px`
  );
  // One attribute drives every rule that moves the navigation, because the bar
  // is fixed and each screen only pads itself clear of it. Written here so it
  // follows the preference wherever it is read or changed, including a profile
  // switch, rather than needing a screen to remember to apply it.
  // Only the shape is stored. A floating bar sits on the edge the layout asks
  // for -- bottom on a phone, top on a desktop -- so the placement is derived
  // here, every time, instead of being a third thing to choose and keep in sync.
  const navStyle = resolveBrowserNavigationStyle(settings);
  root.dataset.navStyle = navStyle;
  root.dataset.navPlacement =
    navStyle === "rail" ? "sidebar" : resolveFloatingNavigationPlacement();
  root.dataset.navRailCorner = settings.browserNavigationRailCorner;
}

export const LayoutPreferences = {
  getForProfile(profileId) {
    return store.getForProfile(profileId);
  },

  get() {
    const settings = store.get();
    // The floating bar's edge is derived, so it is re-derived on every read:
    // the layout can cross the phone line while the app is running.
    applyLayoutPresentation(settings);
    return settings;
  },

  replaceForProfile(profileId, nextValue, options = {}) {
    return store.replaceForProfile(profileId, nextValue, options);
  },

  setForProfile(profileId, partial, options = {}) {
    return store.setForProfile(profileId, partial, options);
  },

  set(partial, options = {}) {
    const result = store.set(partial, options);
    applyLayoutPresentation(store.get());
    return result;
  },

  subscribe(listener) {
    return store.subscribe(listener);
  }
};
