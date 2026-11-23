import { I18n } from "../../i18n/index.js";
import { watchedItemIdentityValues } from "../../data/repository/watchedIdentity.js";

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function watchedBadgeLabel() {
  return I18n.t("episodes_cd_watched", {}, { fallback: "Watched" });
}

export function buildWatchedTitleIdSet(watchedItems = []) {
  const ids = new Set();
  (Array.isArray(watchedItems) ? watchedItems : [])
    .filter((item) => item?.season == null && item?.episode == null)
    .forEach((item) => {
      watchedItemIdentityValues(item).forEach((identity) => ids.add(identity));
    });
  return ids;
}

export function isTitleItemWatched(item = {}, watchedTitleIds = null) {
  const id = String(item?.id || item?.contentId || "").trim();
  if (!id || !watchedTitleIds || typeof watchedTitleIds.has !== "function") {
    return false;
  }
  // The title can be opened under a different id than the one the watched row
  // was recorded with. Every verified alias is part of the set.
  return Array.from(watchedItemIdentityValues(item)).some((identity) =>
    watchedTitleIds.has(identity)
  );
}

export function renderWatchedBadgeGlyph(className = "title-watched-badge-svg") {
  return `<svg class="${className}" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41L9 16.17Z" fill="currentColor"/></svg>`;
}

export function renderTitleWatchedBadge({
  className = "title-watched-badge",
  iconClassName = "title-watched-badge-svg"
} = {}) {
  return `<span class="${className}" aria-label="${escapeHtml(watchedBadgeLabel())}">${renderWatchedBadgeGlyph(iconClassName)}</span>`;
}
