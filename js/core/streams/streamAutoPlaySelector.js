import { matchesReusableStream } from "./streamReusePreference.js";
import { indexOfPluginBingeMatch } from "./pluginBingeGroup.js";
import { filterFilenameStreams } from "./filenameStreamPolicy.js";
import { streamHdrStatus } from "./streamHdrPreference.js";
import { applyHdrPreference } from "./streamHdrPreference.js";

// Auto stream selection uses the same preference model as the original app. Given the list of
// streams shown in the picker and the user's auto-play settings, it returns the
// stream that should play automatically, or null to leave the picker open.

export const STREAM_AUTO_PLAY_MODE = {
  MANUAL: "MANUAL",
  FIRST_STREAM: "FIRST_STREAM",
  REGEX_MATCH: "REGEX_MATCH"
};

export const STREAM_AUTO_PLAY_SOURCE = {
  ALL_SOURCES: "ALL_SOURCES",
  INSTALLED_ADDONS_ONLY: "INSTALLED_ADDONS_ONLY",
  ENABLED_PLUGINS_ONLY: "ENABLED_PLUGINS_ONLY"
};

function normalizeMode(value) {
  const mode = String(value || "")
    .trim()
    .toUpperCase();
  return STREAM_AUTO_PLAY_MODE[mode] ? mode : STREAM_AUTO_PLAY_MODE.MANUAL;
}

function normalizeSource(value) {
  const source = String(value || "")
    .trim()
    .toUpperCase();
  return STREAM_AUTO_PLAY_SOURCE[source] ? source : STREAM_AUTO_PLAY_SOURCE.ALL_SOURCES;
}

export function isRegexSelectionConfigured(regexPattern) {
  const pattern = String(regexPattern || "").trim();
  if (!pattern || !/[a-z0-9]/i.test(pattern)) {
    return false;
  }
  try {
    new RegExp(pattern, "i");
    return true;
  } catch (_) {
    return false;
  }
}

// Whether auto-play is active for these settings. Default mode MANUAL is off, so
// existing users see no change unless they opt in.
export function isAutoPlayEffectivelyEnabled(settings = {}) {
  const mode = normalizeMode(settings.streamAutoPlayMode);
  if (mode === STREAM_AUTO_PLAY_MODE.FIRST_STREAM) {
    return true;
  }
  if (mode === STREAM_AUTO_PLAY_MODE.REGEX_MATCH) {
    return isRegexSelectionConfigured(settings.streamAutoPlayRegex);
  }
  return false;
}

// The two inputs `selectAutoPlayStream` needs that neither caller can compute
// on its own, and that both were computing identically.
//
// The stream screen built them for its own fetch; the background resolver then
// copied both, byte for byte, into the detail screen. Two copies of a rule is
// how they drift -- and this one is invisible when it does, because a wrong
// preferred binge group does not fail, it just quietly picks a worse stream.

// A remembered binge group guides the choice only when both of its settings are
// on. The saved entry is fetched through `lookup` rather than passed in, so the
// store is not consulted at all when the settings say it would be ignored --
// which is what the stream screen's own ternary was for.
export function resolvePreferredBingeGroup(settings = {}, lookup = () => null) {
  if (
    !settings?.streamAutoPlayPreferBingeGroupForNextEpisode ||
    !settings?.streamAutoPlayReuseBingeGroup
  ) {
    return "";
  }
  return String(lookup()?.bingeGroup || "").trim();
}

// Addon display names, as `selectAutoPlayStream` matches them for the
// "selected addons" source. A name is whatever the addon shows a person, since
// that is what the setting stored.
export function collectInstalledAddonNames(installedAddons = []) {
  return new Set(
    (Array.isArray(installedAddons) ? installedAddons : [])
      .map((addon) => String(addon?.displayName || addon?.name || "").trim())
      .filter(Boolean)
  );
}

// A stream is auto-playable when it can actually start playback. External-url
// only entries (e.g. an addon's "open this website" cast link) are skipped so
// auto-play never lands on a non-video page.
function isPlayableStream(stream = {}) {
  const resolve = stream?.clientResolve || stream?.raw?.clientResolve || {};
  const debridState = String(stream?.debridCacheStatus?.state || "")
    .trim()
    .toUpperCase();
  if (["CHECKING", "NOT_CACHED", "UNKNOWN"].includes(debridState)) {
    return false;
  }
  return Boolean(
    stream &&
    (stream.url ||
      stream.ytId ||
      stream.infoHash ||
      resolve.infoHash ||
      resolve.magnetUri ||
      stream.debridCacheStatus)
  );
}

function streamBingeGroup(stream = {}) {
  return String(
    stream?.behaviorHints?.bingeGroup || stream?.raw?.behaviorHints?.bingeGroup || ""
  ).trim();
}

function streamSearchableText(stream = {}) {
  const parts = [stream.addonName, stream.name, stream.title, stream.description, stream.url];
  if (stream.infoHash) {
    parts.push(stream.infoHash);
  }
  return parts.map((part) => String(part || "")).join(" ");
}

function scopeStreamsBySource(streams, source, installedAddonNames) {
  const installed =
    installedAddonNames instanceof Set
      ? installedAddonNames
      : new Set(Array.isArray(installedAddonNames) ? installedAddonNames : []);
  if (source === STREAM_AUTO_PLAY_SOURCE.INSTALLED_ADDONS_ONLY) {
    return streams.filter((stream) => installed.has(String(stream.addonName || "")));
  }
  if (source === STREAM_AUTO_PLAY_SOURCE.ENABLED_PLUGINS_ONLY) {
    return streams.filter((stream) => !installed.has(String(stream.addonName || "")));
  }
  return streams;
}

// Extract excluded words from negative lookaheads like (?!.*(CAM|TS)) so a
// pattern can both include and exclude.
function buildExcludeRegex(pattern) {
  const matches = String(pattern || "").match(/\(\?![^)]*?\(([^)]+)\)/g) || [];
  const words = matches
    .map((match) => {
      const inner = /\(\?![^)]*?\(([^)]+)\)/.exec(match);
      return inner ? inner[1] : "";
    })
    .join("|")
    .split("|")
    .map((word) => word.trim())
    .filter(Boolean);
  if (!words.length) {
    return null;
  }
  try {
    return new RegExp(`\\b(${words.join("|")})\\b`, "i");
  } catch (_) {
    return null;
  }
}

export function filterAutoPlaySourceStreams(streams, options = {}) {
  const list = Array.isArray(streams) ? streams.filter(Boolean) : [];
  if (!list.length) {
    return [];
  }
  const source = normalizeSource(options.source);
  const installedAddonNames =
    options.installedAddonNames instanceof Set
      ? options.installedAddonNames
      : new Set(Array.isArray(options.installedAddonNames) ? options.installedAddonNames : []);
  const selectedAddons =
    options.selectedAddons instanceof Set
      ? options.selectedAddons
      : new Set(Array.isArray(options.selectedAddons) ? options.selectedAddons : []);
  const selectedPlugins =
    options.selectedPlugins instanceof Set
      ? options.selectedPlugins
      : new Set(Array.isArray(options.selectedPlugins) ? options.selectedPlugins : []);
  return scopeStreamsBySource(list, source, installedAddonNames).filter((stream) => {
    const addonName = String(stream?.addonName || "");
    const isAddonStream = installedAddonNames.has(addonName);
    return isAddonStream
      ? !selectedAddons.size || selectedAddons.has(addonName)
      : !selectedPlugins.size || selectedPlugins.has(addonName);
  });
}

// The same hard source/regex constraints and preference order serve discovery,
// compatibility inspection, resume and final selection.
export function autoPlayCandidates(streams, options = {}) {
  const mode = normalizeMode(options.mode);
  if (mode === STREAM_AUTO_PLAY_MODE.MANUAL) return [];
  let scoped = filterFilenameStreams(
    filterAutoPlaySourceStreams(streams, options),
    options,
    options.capabilities
  ).filter(isPlayableStream);
  if (mode === STREAM_AUTO_PLAY_MODE.REGEX_MATCH) {
    const pattern = String(options.regexPattern || "").trim();
    let include;
    try {
      include = new RegExp(pattern, "i");
    } catch {
      return [];
    }
    const exclude = buildExcludeRegex(pattern);
    scoped = scoped.filter(
      (stream) =>
        include.test(streamSearchableText(stream)) &&
        (!exclude || !exclude.test(streamSearchableText(stream)))
    );
  }
  const candidates =
    mode === STREAM_AUTO_PLAY_MODE.FIRST_STREAM ? applyHdrPreference(scoped, options) : scoped;
  const group = String(options.preferredBingeGroup || "").trim();
  if (!options.preferBingeGroupInSelection || !group)
    return options.bingeGroupOnly ? [] : candidates;
  const preferredHdr =
    mode === STREAM_AUTO_PLAY_MODE.FIRST_STREAM &&
    options.hdrPreference === "PREFER" &&
    candidates.some((stream) => streamHdrStatus(stream, options) === true);
  const eligible = preferredHdr
    ? candidates.filter((stream) => streamHdrStatus(stream, options) === true)
    : candidates;
  const groups = eligible.map(streamBingeGroup);
  const exact = eligible.filter((_, index) => groups[index] === group);
  const variantIndex = exact.length ? null : indexOfPluginBingeMatch(group, groups);
  const matches = variantIndex == null ? exact : [eligible[variantIndex]];
  return options.bingeGroupOnly
    ? matches
    : [...matches, ...candidates.filter((stream) => !matches.includes(stream))];
}

export function selectAutoPlayStream(streams, options = {}) {
  const candidates = autoPlayCandidates(streams, options);
  return (
    candidates.find((stream) => matchesReusableStream(stream, options.reusableStream)) ||
    candidates[0] ||
    null
  );
}
