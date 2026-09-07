import { DebridSettingsStore } from "../../data/local/debridSettingsStore.js";
import { StreamBadgeSettingsStore } from "../../data/local/streamBadgeSettingsStore.js";
import {
  getCachedAddonLogoDisplayUrl,
  normalizeAddonLogoUrl,
  resolveAddonLogo
} from "../../core/media/addonLogoCache.js";
import { matchStreamBadges, normalizeStreamBadgeChipColor } from "../../core/streams/streamBadgeRules.js";
import { I18n } from "../../i18n/index.js";

const STREAM_BADGE_LIMIT = 9;

function t(key, params = {}, fallback = key) {
  return I18n.t(key, params, { fallback });
}

function escapeHtml(value = "") {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatBytes(value) {
  const size = Number(value || 0);
  if (!Number.isFinite(size) || size <= 0) return "";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let amount = size;
  let unitIndex = 0;
  while (amount >= 1024 && unitIndex < units.length - 1) {
    amount /= 1024;
    unitIndex += 1;
  }
  const precision = unitIndex >= 3 ? 2 : unitIndex >= 2 ? 1 : 0;
  return `${amount.toFixed(precision)} ${units[unitIndex]}`;
}

function getAddonBadgeLabel(name = "") {
  const cleaned = String(name || "").trim();
  if (!cleaned) return "A";
  if (/torrentio|torbox|torrent/i.test(cleaned)) return "µ";
  const letters = cleaned
    .split(/\s+/)
    .map((part) => part.charAt(0).toUpperCase())
    .join("")
    .slice(0, 2);
  return letters || cleaned.charAt(0).toUpperCase();
}

function detectQuality(text = "") {
  const value = String(text || "").toLowerCase();
  if (value.includes("2160") || value.includes("4k")) return "4k";
  if (value.includes("1080")) return "1080p";
  if (value.includes("720")) return "720p";
  if (value.includes("480")) return "480p";
  return "Auto";
}

function normalizeStreamInput(stream = {}) {
  const raw = stream?.raw && typeof stream.raw === "object" ? stream.raw : {};
  return {
    ...raw,
    ...stream,
    name: stream.name ?? raw.name ?? "",
    title: stream.title ?? raw.title ?? "",
    description: stream.description ?? raw.description ?? "",
    quality: stream.quality ?? raw.quality ?? "",
    qualityValue: stream.qualityValue ?? raw.qualityValue ?? "",
    addonName: stream.addonName ?? raw.addonName ?? "Addon",
    addonLogo: stream.addonLogo ?? raw.addonLogo ?? "",
    behaviorHints: stream.behaviorHints || raw.behaviorHints || {},
    sourceType:
      stream.sourceType || stream.mimeType || stream.type || stream.source || raw.sourceType || raw.mimeType || raw.type || raw.source || ""
  };
}

function getSourceHeadline(stream = {}) {
  const primary = [stream.name, stream.title, stream.description].find((value) =>
    String(value || "").trim()
  );
  if (!primary) return stream.addonName || "Unknown source";
  const firstLine = String(primary).split(/\r?\n/)[0].trim();
  return firstLine || stream.addonName || "Unknown source";
}

function getSourceQuality(stream = {}) {
  const qualityLines = [];
  [stream.name, stream.title, stream.description].forEach((value) => {
    String(value || "")
      .split(/\r?\n/)
      .forEach((line) => {
        const normalized = String(line || "").trim();
        if (normalized) qualityLines.push(normalized);
      });
  });
  const qualityCandidate = qualityLines.find(
    (line, index) => index > 0 && /(2160|4k|1080|720|480)/i.test(line)
  );
  if (qualityCandidate) return detectQuality(qualityCandidate);
  return detectQuality(
    [stream.name, stream.title, stream.description, stream.behaviorHints?.filename, stream.sourceType].join(" ")
  );
}

function getSourceDescriptionLines(stream = {}) {
  const displayDescription = String(stream.description || stream.title || "").trim();
  const displayName = String(stream.name || stream.title || stream.description || "").trim();
  if (!displayDescription || displayDescription === displayName) return [];
  return displayDescription
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 12);
}

function resolveBadgePlacement(settings = {}) {
  return String(settings?.badgePlacement || "BOTTOM").trim().toUpperCase() === "TOP"
    ? "TOP"
    : "BOTTOM";
}

function renderBadgeImage(badge = {}) {
  const imageUrl = normalizeAddonLogoUrl(badge.imageURL);
  if (!imageUrl) return "";
  const backgroundColor = normalizeStreamBadgeChipColor(badge.tagColor);
  const outlineColor = normalizeStreamBadgeChipColor(badge.borderColor);
  const textColor = normalizeStreamBadgeChipColor(badge.textColor);
  const filled = String(badge.tagStyle || "").trim().toLowerCase() === "filled";
  const style = [
    filled && backgroundColor ? `background:${backgroundColor};` : "",
    outlineColor ? `border-color:${outlineColor};` : "",
    textColor ? `color:${textColor};` : ""
  ].join("");
  return `<span class="stream-route-stream-badge image${filled ? " filled" : ""}"${style ? ` style="${escapeHtml(style)}"` : ""}><img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(badge.name || "")}" loading="lazy" decoding="async" referrerpolicy="no-referrer" /></span>`;
}

function renderBadges(stream, settings, enabled) {
  if (!enabled) return "";
  const chips = matchStreamBadges(stream, settings?.rules)
    .slice(0, STREAM_BADGE_LIMIT)
    .map(renderBadgeImage)
    .filter(Boolean);
  if (settings?.showFileSizeBadges !== false && stream.behaviorHints?.videoSize != null) {
    const size = formatBytes(stream.behaviorHints.videoSize);
    if (size) chips.push(`<span class="stream-route-stream-badge size">${escapeHtml(t("streams_size", [size], `SIZE ${size}`))}</span>`);
  }
  return chips.length
    ? `<div class="stream-route-card-badges" aria-label="${escapeHtml(t("settings_stream_badges_section", {}, "Fusion Style"))}">${chips.join("")}</div>`
    : "";
}

/**
 * Shared browser source-display model. Stream Selection and Season Download
 * intentionally use this exact normalization so raw internal values never
 * leak into one UI but not the other.
 */
export function normalizeSourceForDisplay(
  stream = {},
  { badgeSettings = StreamBadgeSettingsStore.snapshot(), streamBadgesEnabled = DebridSettingsStore.get().streamBadgesEnabled !== false, addonLogoLookup = {} } = {}
) {
  const source = normalizeStreamInput(stream);
  const headline = getSourceHeadline(source);
  const quality = getSourceQuality(source);
  const badges = renderBadges(source, badgeSettings, streamBadgesEnabled);
  const addonName = String(source.addonName || "Addon").trim() || "Addon";
  const addonLogoUrl =
    normalizeAddonLogoUrl(source.addonLogo) || resolveAddonLogo(addonName, addonLogoLookup);
  const displayAddonLogoUrl = getCachedAddonLogoDisplayUrl(addonLogoUrl) || addonLogoUrl;
  const descriptionLines = getSourceDescriptionLines(source);
  const filename = String(source.behaviorHints?.filename || "").trim();
  return {
    source,
    headline,
    quality,
    badges,
    topBadges: resolveBadgePlacement(badgeSettings) === "TOP" ? badges : "",
    bottomBadges: resolveBadgePlacement(badgeSettings) === "BOTTOM" ? badges : "",
    descriptionLines,
    addonName,
    addonLogoUrl: displayAddonLogoUrl,
    addonBadgeLabel: getAddonBadgeLabel(addonName),
    showAddonLogo: badgeSettings?.showAddonLogo === true,
    accessibleLabel: [headline, quality, addonName, filename].filter(Boolean).join(" · ")
  };
}

/** Renders the shared card body; callers own the outer card action. */
export function renderBrowserSourceCardContent(model = {}) {
  const badges = model.badges || "";
  const addonIdentity = model.showAddonLogo
    ? `<div class="stream-route-card-side"><div class="stream-route-addon-badge">${model.addonLogoUrl ? `<img src="${escapeHtml(model.addonLogoUrl)}" alt="${escapeHtml(model.addonName || "Addon")}" decoding="async" loading="lazy" referrerpolicy="no-referrer" /><span hidden>${escapeHtml(model.addonBadgeLabel || "A")}</span>` : `<span>${escapeHtml(model.addonBadgeLabel || "A")}</span>`}</div><div class="stream-route-addon-name" title="${escapeHtml(model.addonName || "Addon")}">${escapeHtml(model.addonName || "Addon")}</div></div>`
    : "";
  return `<div class="stream-route-card-copy"><div class="stream-route-card-heading">${escapeHtml(model.headline || "Unknown source")}</div>${model.topBadges || ""}${!badges ? `<div class="stream-route-card-quality">${escapeHtml(model.quality || "Auto")}</div>` : ""}${(model.descriptionLines || []).map((line, index) => `<div class="stream-route-card-line${index > 0 ? " secondary" : ""}" title="${escapeHtml(line)}">${escapeHtml(line)}</div>`).join("")}${model.bottomBadges || ""}</div>${addonIdentity}`;
}
