import { Platform } from "../../platform/index.js";

const APP_TITLE = "Nuvio";

const ROUTE_TITLES = {
  home: "",
  search: "Search",
  discover: "Discover",
  library: "Library",
  settings: "Settings",
  profileSelection: "Profiles",
  authSignIn: "Sign In",
  authQrSignIn: "Sign In",
  syncCode: "Sign In",
  account: "Account",
  plugin: "Addons",
  plugins: "Plugins",
  catalogOrder: "Catalogs",
  collectionEdit: "Collections",
  collectionFolderEdit: "Collections",
  folderDetail: "Collections",
  catalogSeeAll: "Browse",
  castDetail: "Cast",
  supportersContributors: "About",
  licensesAttributions: "About",
  debugConsole: "Console Debug",
  trakt: "Tracking",
  stream: "Select Stream",
  detail: "Details",
  player: ""
};

function normalizeTitlePart(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeYear(value) {
  const match = normalizeTitlePart(value).match(/\b(19|20)\d{2}\b/);
  return match ? match[0] : "";
}

export function setBrowserDocumentTitle(value = "") {
  if (!Platform.isBrowser() || typeof document === "undefined") {
    return;
  }
  const title = normalizeTitlePart(value);
  document.title = title ? `${title} - ${APP_TITLE}` : APP_TITLE;
}

export function setBrowserRouteTitle(routeName) {
  setBrowserDocumentTitle(ROUTE_TITLES[String(routeName || "").trim()] || "");
}

export function setBrowserMediaTitle({
  title,
  year,
  season = null,
  episode = null,
  episodeTitle = ""
} = {}) {
  const mediaTitle = normalizeTitlePart(title);
  const releaseYear = normalizeYear(year);
  const seasonNumber = Number(season);
  const episodeNumber = Number(episode);
  const episodeCode =
    Number.isFinite(seasonNumber) &&
    seasonNumber >= 0 &&
    Number.isFinite(episodeNumber) &&
    episodeNumber > 0
      ? `S${seasonNumber}E${episodeNumber}`
      : "";
  const parts = [
    [mediaTitle, releaseYear ? `(${releaseYear})` : ""].filter(Boolean).join(" "),
    episodeCode,
    normalizeTitlePart(episodeTitle)
  ].filter(Boolean);
  setBrowserDocumentTitle(parts.join(" "));
}
