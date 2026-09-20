import { I18n } from "../../../i18n/index.js";

export function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function escapeAttribute(value) {
  return escapeHtml(value).replace(/'/g, "&#39;");
}

export function toTitleCase(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return "";
  }
  return raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase();
}

function normalizedCatalogType(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "");
  if (normalized === "tv" || normalized === "show" || normalized === "shows") {
    return "series";
  }
  if (normalized === "movies") {
    return "movie";
  }
  if (["channel", "channels", "live", "tvchannel", "tvchannels"].includes(normalized)) {
    return "channel";
  }
  return normalized;
}

export function formatContentTypeLabel(type, fallback = "") {
  const normalized = normalizedCatalogType(type || fallback || "movie");
  const fallbackLabel = toTitleCase(type || fallback || "movie") || "Movie";
  if (normalized === "movie") {
    return I18n.t("type_movie", {}, { fallback: "Movie" });
  }
  if (normalized === "series") {
    return I18n.t("type_series", {}, { fallback: "Series" });
  }
  if (normalized === "channel") {
    return I18n.t("stream_info_channels", {}, { fallback: "Channels" });
  }
  if (normalized === "anime") {
    return I18n.t("profile_avatar_category_anime", {}, { fallback: "Anime" });
  }
  return fallbackLabel;
}

function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function formatCatalogRowTitle(catalogName, type, showTypeSuffix = true) {
  const rawBase = String(catalogName || "").trim();
  const base = rawBase ? rawBase.charAt(0).toUpperCase() + rawBase.slice(1) : "";
  const typeLabel = formatContentTypeLabel(type || "movie", "movie");
  if (!base) {
    return typeLabel;
  }
  if (!showTypeSuffix) {
    return base;
  }
  const rawTypeLabel = toTitleCase(type || "movie") || "Movie";
  const suffixPattern = new RegExp(
    `\\b(${escapeRegExp(typeLabel)}|${escapeRegExp(rawTypeLabel)})$`,
    "i"
  );
  return suffixPattern.test(base) ? base : `${base} - ${typeLabel}`;
}

export function prettyId(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return "Untitled";
  }
  if (raw.includes(":")) {
    return raw.split(":").pop() || raw;
  }
  return raw;
}

export function firstNonEmpty(...values) {
  for (const value of values) {
    const normalized = String(value || "").trim();
    if (normalized) {
      return normalized;
    }
  }
  return "";
}

export function uniqueNonEmptyValues(values = []) {
  const seen = new Set();
  const result = [];
  values.forEach((value) => {
    const normalized = String(value || "").trim();
    if (!normalized || seen.has(normalized)) {
      return;
    }
    seen.add(normalized);
    result.push(normalized);
  });
  return result;
}

export function limitTextToWordCount(value, maxWords = 0) {
  const text = String(value || "").trim();
  if (!text || !Number.isFinite(maxWords) || maxWords <= 0) {
    return { text, truncated: false };
  }
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length <= maxWords) {
    return { text, truncated: false };
  }
  return {
    text: words.slice(0, maxWords).join(" "),
    truncated: true
  };
}

export function parseCssPx(value, fallback = 0) {
  const parsed = parseFloat(String(value || "").trim());
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * The episode still a Continue Watching card may use.
 *
 * Only a series has one. A film reaching this chain would fall through to
 * `thumbnail`, which enrichment fills from the poster whenever a title has no
 * landscape still of its own -- and the Use Episode Thumbnails preference puts
 * this value first, so a portrait poster ended up stretched across a landscape
 * card whenever that preference was on.
 */
export function resolveContinueWatchingEpisodeStill(item = {}, isSeries = false) {
  if (!isSeries) {
    return "";
  }
  return firstNonEmpty(
    item?.episodeThumbnail,
    item?.thumbnail,
    item?.backdrop,
    item?.background,
    item?.poster
  );
}

/**
 * Whether a Continue Watching card should render its progress element at all.
 *
 * A Next Up card is the next episode you have not started, so it is built with
 * `progressFraction: 0` deliberately. The track is the visible part of the bar
 * -- the inner span is only the fill -- so emitting it at 0% drew an empty bar
 * across a card that has no playback behind it.
 *
 * Only Next Up is excluded. A normal Continue Watching item keeps exactly what
 * it renders today, including the case where its fraction is 0 because the
 * duration is not known yet; that is not this rule's business.
 */
export function shouldRenderContinueWatchingProgress(item = {}) {
  return !item?.isNextUp;
}
