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
  // Where the browser build puts its primary navigation. Empty means nobody
  // has chosen, and the choice is then made from the shape of the thing it is
  // running on -- see resolveDefaultBrowserNavigationPlacement.
  browserNavigationPlacement: "",
  // Which corner the side rail hangs from. Only read when the placement is
  // the rail; the other two placements have nowhere to put it.
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
  return String(sourceShape || "").trim().toLowerCase() === "landscape";
}

const BROWSER_NAVIGATION_PLACEMENTS = ["top", "bottom", "sidebar"];
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

/**
 * Anything that is not one of the three placements is the one this has always
 * been. A stored value from a newer build, or a hand-edited one, moves the
 * navigation somewhere nobody can see rather than failing visibly, so it is
 * read as the default instead.
 */
export function normalizeBrowserNavigationPlacement(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  return BROWSER_NAVIGATION_PLACEMENTS.includes(normalized) ? normalized : "top";
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
  const continueWatchingCardStyle = String(merged.continueWatchingCardStyle || "card").toLowerCase();

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
    heroCatalogKeys: [...new Set((Array.isArray(merged.heroCatalogKeys) ? merged.heroCatalogKeys : []).map(String).filter(Boolean))],
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
    cardDepthEdgeStrength: Math.min(100, Math.max(0, Number(merged.cardDepthEdgeStrength ?? 28) || 0)),
    cardDepthSheenStrength: Math.min(100, Math.max(0, Number(merged.cardDepthSheenStrength ?? 10) || 0)),
    cardDepthEdgeCoverage: Math.min(100, Math.max(0, Number(merged.cardDepthEdgeCoverage ?? 0) || 0)),
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
    // Empty stays empty: it means nobody has chosen, and that is worth
    // storing as such rather than as whatever this device would pick today.
    browserNavigationPlacement: merged.browserNavigationPlacement
      ? normalizeBrowserNavigationPlacement(merged.browserNavigationPlacement)
      : "",
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

function applyLayoutPresentation(settings) {
  const root = globalThis?.document?.documentElement;
  if (!root) return;
  root.dataset.cardDepth = settings.cardDepthEnabled ? "true" : "false";
  root.dataset.cardDepthPosters = settings.cardDepthPostersEnabled !== false ? "true" : "false";
  root.dataset.cardDepthContinueWatching = settings.cardDepthContinueWatchingEnabled !== false ? "true" : "false";
  root.dataset.cardDepthEpisodes = settings.cardDepthEpisodeCardsEnabled !== false ? "true" : "false";
  root.dataset.cardDepthCast = settings.cardDepthCastEnabled !== false ? "true" : "false";
  root.dataset.cardDepthTrailers = settings.cardDepthTrailersEnabled !== false ? "true" : "false";
  root.style.setProperty("--card-depth-edge", String(settings.cardDepthEdgeStrength / 100));
  root.style.setProperty("--card-depth-sheen", String(settings.cardDepthSheenStrength / 100));
  root.style.setProperty("--card-depth-coverage", String(settings.cardDepthEdgeCoverage / 100));
  root.style.setProperty(
    "--card-depth-coverage-size",
    `${12 + Math.round(18 * settings.cardDepthEdgeCoverage / 100)}px`
  );
  // One attribute drives every rule that moves the navigation, because the bar
  // is fixed and each screen only pads itself clear of it. Written here so it
  // follows the preference wherever it is read or changed, including a profile
  // switch, rather than needing a screen to remember to apply it.
  root.dataset.navPlacement = settings.browserNavigationPlacement;
  root.dataset.navRailCorner = settings.browserNavigationRailCorner;
}

export const LayoutPreferences = {
  getForProfile(profileId) {
    return store.getForProfile(profileId);
  },

  get() {
    const stored = store.get();
    // The one preference with no fixed default: an unanswered placement is
    // answered by the device, every time it is read.
    const settings = stored.browserNavigationPlacement
      ? stored
      : {
          ...stored,
          browserNavigationPlacement: resolveDefaultBrowserNavigationPlacement()
        };
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
