export const PLUGIN_STATE_VERSION = 2;

export const PLUGIN_REPOSITORY_TYPES = Object.freeze({
  NUVIO_JS: "NUVIO_JS",
  EXTERNAL_DEX: "EXTERNAL_DEX",
  LEGACY: "LEGACY",
  UNKNOWN: "UNKNOWN"
});

export const PLUGIN_PLATFORM_IDS = Object.freeze({
  WEB: "web",
  TIZEN: "tizen",
  WEBOS: "webos"
});

export const MAX_PLUGIN_REPOSITORIES = 256;

export const MAX_PLUGIN_SCRAPERS = 512;

export const MAX_MANIFEST_SCRAPERS = 128;

export function text(value, fallback = "") {
  const normalized = String(value ?? "").trim();
  return normalized || fallback;
}

export function requiredManifestText(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function validManifestStringList(value, fallback = []) {
  if (value === undefined) return fallback;
  if (value === null) return null;
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    return null;
  }
  return list(value);
}

export function optionalManifestStringList(value) {
  return value == null ? [] : validManifestStringList(value);
}

export function sanitizePluginRepositoryInput(value) {
  const trimmed = text(value);
  const schemeEnd = trimmed.indexOf("://");
  if (schemeEnd > 0) {
    const scheme = trimmed.slice(0, schemeEnd).toLowerCase();
    if (scheme !== "http" && scheme !== "https") {
      return `https://${trimmed.slice(schemeEnd + 3)}`;
    }
  }
  return trimmed;
}

export function isPluginShortCode(value) {
  const trimmed = text(value);
  if (!trimmed || trimmed.includes("://") || trimmed.includes("/") || trimmed.includes(".")) {
    return false;
  }
  return /^[A-Za-z0-9_-]+$/.test(trimmed);
}

export function isVideoEasyScraper(scraperId, scraperName = "", filename = "") {
  return [scraperId, scraperName, filename].some((value) =>
    String(value || "")
      .toLowerCase()
      .includes("videasy")
  );
}

export const LOCAL_PLUGIN_PREFIXES = new Set(["kitsu", "anilist", "mal"]);

export const ABSOLUTE_ANIME_PREFIXES = new Set(["kitsu", "mal", "anilist", "anidb"]);

export function isLocalPluginVideoId(value) {
  const prefix = text(value).split(":")[0].toLowerCase();
  return LOCAL_PLUGIN_PREFIXES.has(prefix) && text(value).toLowerCase().startsWith(`${prefix}:`);
}

export function cleanLocalPluginVideoId(value) {
  const raw = text(value);
  const parts = raw.split(":");
  const isKitsu = parts[0]?.toLowerCase() === "kitsu";
  const lastPart = parts[parts.length - 1] || "";
  return isKitsu && parts.length > 2 && parsePluginInt(lastPart) !== null
    ? parts.slice(0, -1).join(":")
    : raw;
}

export function parsePluginInt(value) {
  const number = Number(value);
  return Number.isInteger(number) && number >= -2147483648 && number <= 2147483647 ? number : null;
}

export function isSignedInteger(value) {
  return /^[+-]?\d+$/.test(value);
}

export function isAndroidLong(value) {
  if (!isSignedInteger(value)) return false;
  const negative = String(value).startsWith("-");
  const digits = String(value).replace(/^[+-]/, "").replace(/^0+/, "") || "0";
  const limit = negative ? "9223372036854775808" : "9223372036854775807";
  return digits.length < limit.length || (digits.length === limit.length && digits <= limit);
}

export function absoluteAnimeEpisodeNumber(value) {
  const parts = text(value).split(":");
  if (parts.length !== 3) return null;
  const prefix = parts[0].toLowerCase();
  if (!ABSOLUTE_ANIME_PREFIXES.has(prefix)) return null;
  if (!isAndroidLong(parts[1]) || !isSignedInteger(parts[2])) return null;
  return parsePluginInt(parts[2]);
}

export function resolvePluginSeasonEpisode(videoId, season, episode) {
  const absolute = absoluteAnimeEpisodeNumber(videoId);
  if (absolute != null) return { season: null, episode: absolute };
  const coordinates = /^(?:(?:tmdb|series|tv|imdb):)*(?:tt)?\d+:(\d+):(\d+)$/i.exec(text(videoId));
  return {
    season: season ?? (coordinates ? Number(coordinates[1]) : null),
    episode: episode ?? (coordinates ? Number(coordinates[2]) : null)
  };
}

export function list(value) {
  const values = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/[,;]+/)
      : [];
  return values
    .map((entry) => text(entry).toLowerCase())
    .filter(Boolean)
    .filter((entry, index, entries) => entries.indexOf(entry) === index);
}

export function normalizePluginRepositoryType(value, fallback = PLUGIN_REPOSITORY_TYPES.UNKNOWN) {
  const normalized = text(value)
    .toUpperCase()
    .replace(/[\s-]+/g, "_");
  if (normalized === PLUGIN_REPOSITORY_TYPES.NUVIO_JS || normalized === "JS") {
    return PLUGIN_REPOSITORY_TYPES.NUVIO_JS;
  }
  if (
    normalized === PLUGIN_REPOSITORY_TYPES.EXTERNAL_DEX ||
    normalized === "DEX" ||
    normalized === "CLOUDSTREAM" ||
    normalized === "CLOUDSTREAM_DEX" ||
    normalized === "EXTERNAL"
  ) {
    return PLUGIN_REPOSITORY_TYPES.EXTERNAL_DEX;
  }
  if (normalized === PLUGIN_REPOSITORY_TYPES.LEGACY || normalized === "URL_TEMPLATE") {
    return PLUGIN_REPOSITORY_TYPES.LEGACY;
  }
  return fallback;
}

export function isExternalDexRepository(repository) {
  return (
    normalizePluginRepositoryType(repository?.type) === PLUGIN_REPOSITORY_TYPES.EXTERNAL_DEX ||
    /\.cs3(?:$|[?#])/i.test(String(repository?.url || ""))
  );
}

export function stripDefaultPort(url) {
  try {
    const parsed = new URL(url);
    if (
      (parsed.protocol === "http:" && parsed.port === "80") ||
      (parsed.protocol === "https:" && parsed.port === "443")
    ) {
      parsed.port = "";
    }
    parsed.hash = "";
    return parsed.toString().replace(/\/$/, "");
  } catch (_) {
    return String(url || "")
      .trim()
      .replace(/[?#].*$/, "")
      .replace(/\/$/, "");
  }
}

export function canonicalizePluginUrl(value, { manifest = false } = {}) {
  const raw = sanitizePluginRepositoryInput(value);
  if (!raw) {
    return "";
  }
  const normalized = stripDefaultPort(raw);
  if (!normalized) {
    return "";
  }
  if (manifest) {
    try {
      const parsed = new URL(normalized);
      if (/\.json$/i.test(parsed.pathname)) {
        return parsed.toString().replace(/\/$/, "");
      }
      parsed.pathname = `${parsed.pathname.replace(/\/$/, "")}/manifest.json`;
      return parsed.toString().replace(/\/$/, "");
    } catch (_) {
      if (/\.json(?:[?#].*)?$/i.test(normalized)) {
        return normalized;
      }
      return `${normalized.replace(/\/$/, "")}/manifest.json`;
    }
  }
  return normalized;
}

export function resolvePluginUrl(value, baseUrl = "") {
  const raw = text(value);
  if (!raw) {
    return "";
  }
  try {
    return new URL(raw, baseUrl || undefined).toString();
  } catch (_) {
    return raw;
  }
}

export function stablePluginHash(value) {
  // Keep IDs deterministic without relying on array positions. Two independent
  // 32-bit hashes make accidental collisions materially less likely while
  // remaining compatible with the old TV JavaScript engines.
  let first = 2166136261;
  let second = 2246822519;
  const input = String(value || "");
  for (let index = 0; index < input.length; index += 1) {
    const code = input.charCodeAt(index);
    first ^= code;
    first = Math.imul(first, 16777619);
    second ^= code + 0x9e3779b9;
    second = Math.imul(second, 3266489917);
  }
  return `${(first >>> 0).toString(36).padStart(7, "0")}-${(second >>> 0).toString(36).padStart(7, "0")}`;
}

export function safePluginId(value, fallback = "plugin", maxLength = 128) {
  const normalized = text(value, fallback)
    .replace(/[^a-z0-9_-]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, Math.max(16, Number(maxLength) || 128));
  return normalized || fallback;
}
