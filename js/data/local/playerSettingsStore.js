import { createProfileScopedStore } from "./profileScopedStore.js";
import {
  SUBTITLE_VERTICAL_OFFSET_CONTRACT,
  SUBTITLE_VERTICAL_OFFSET_DEFAULT,
  normalizeSubtitleVerticalOffset
} from "../../core/player/subtitleVerticalOffset.js";

const KEY = "playerSettings";

const DEFAULTS = {
  autoplayNextEpisode: false,
  // Legacy Web-only switch. Subtitle startup is controlled by the preferred
  // language ("off" = Android "None") plus useForcedSubtitles.
  subtitlesEnabled: true,
  subtitleLanguage: "en",
  secondarySubtitleLanguage: "off",
  preferredAudioLanguage: "system",
  secondaryPreferredAudioLanguage: "none",
  trailerAutoplay: true,
  trailerDelaySeconds: 7,
  skipIntroEnabled: true,
  loadingOverlayEnabled: true,
  showPlayerLoadingStatus: true,
  pauseOverlayEnabled: true,
  parentalGuideEnabled: true,
  autoSkipSegmentTypes: [],
  addonSubtitleStartupMode: "ALL_SUBTITLES",
  addonSubtitleStartupModeAutoPreferred: false,
  nextEpisodeThresholdMode: "PERCENTAGE",
  nextEpisodeThresholdPercent: 99,
  nextEpisodeThresholdMinutesBeforeEnd: 2,
  stillWatchingEnabled: false,
  stillWatchingEpisodeThreshold: 3,
  osdClockEnabled: true,
  subtitleRenderMode: "native",
  subtitleStyle: {
    fontSize: 100,
    textColor: "#FFFFFF",
    bold: false,
    outlineEnabled: true,
    outlineColor: "#000000",
    backgroundColor: "#00000000",
    verticalOffset: SUBTITLE_VERTICAL_OFFSET_DEFAULT,
    verticalOffsetContract: SUBTITLE_VERTICAL_OFFSET_CONTRACT,
    preferredLanguage: "en",
    secondaryPreferredLanguage: "off",
    useForcedSubtitles: false,
    showOnlyPreferredLanguages: false
  },
  audioAmplificationDb: 0,
  persistAudioAmplification: false,
  // Auto stream selection (matches the Android TV app). When the mode is not
  // MANUAL, pressing play auto-selects a stream and plays it after a countdown.
  streamAutoPlayMode: "MANUAL",
  streamAutoPlaySource: "ALL_SOURCES",
  streamAutoPlaySelectedAddons: [],
  streamAutoPlaySelectedPlugins: [],
  streamAutoPlayRegex: "",
  streamAutoPlayPreferBingeGroupForNextEpisode: true,
  streamAutoPlayReuseBingeGroup: true,
  streamReuseLastLinkEnabled: false,
  streamReuseLastLinkCacheHours: 24,
  streamAutoPlayTimeoutSeconds: 3,
  // External playback requires the user to choose an installed player.
  browserExternalPlayer: "disabled",
  externalPlayerProgress: "automatic"
};

const STREAM_AUTO_PLAY_MODES = ["MANUAL", "FIRST_STREAM", "REGEX_MATCH"];
const STREAM_AUTO_PLAY_SOURCES = ["ALL_SOURCES", "INSTALLED_ADDONS_ONLY", "ENABLED_PLUGINS_ONLY"];
const STREAM_AUTO_PLAY_TIMEOUT_UNLIMITED = 2147483647;
const STREAM_AUTO_PLAY_TIMEOUT_VALUES = [
  0,
  1,
  2,
  3,
  4,
  5,
  6,
  7,
  8,
  9,
  10,
  15,
  20,
  25,
  30,
  STREAM_AUTO_PLAY_TIMEOUT_UNLIMITED
];
const NEXT_EPISODE_THRESHOLD_MODES = ["PERCENTAGE", "MINUTES_BEFORE_END"];

function normalizeStreamAutoPlayMode(value) {
  const normalized = String(value || "")
    .trim()
    .toUpperCase();
  return STREAM_AUTO_PLAY_MODES.includes(normalized) ? normalized : "MANUAL";
}

function normalizeStreamAutoPlaySource(value) {
  const normalized = String(value || "")
    .trim()
    .toUpperCase();
  return STREAM_AUTO_PLAY_SOURCES.includes(normalized) ? normalized : "ALL_SOURCES";
}

function normalizeStreamAutoPlayTimeout(value) {
  const seconds = Math.trunc(Number(value));
  if (!Number.isFinite(seconds)) {
    return DEFAULTS.streamAutoPlayTimeoutSeconds;
  }
  if (seconds === 11 || seconds === STREAM_AUTO_PLAY_TIMEOUT_UNLIMITED) {
    return STREAM_AUTO_PLAY_TIMEOUT_UNLIMITED;
  }
  return STREAM_AUTO_PLAY_TIMEOUT_VALUES.filter(
    (entry) => entry !== STREAM_AUTO_PLAY_TIMEOUT_UNLIMITED
  ).reduce(
    (closest, entry) => (Math.abs(entry - seconds) < Math.abs(closest - seconds) ? entry : closest),
    DEFAULTS.streamAutoPlayTimeoutSeconds
  );
}

function normalizeStringList(value) {
  return [
    ...new Set(
      (Array.isArray(value) ? value : []).map((entry) => String(entry || "").trim()).filter(Boolean)
    )
  ];
}

function normalizeReuseLastLinkCacheHours(value) {
  const hours = Math.trunc(Number(value));
  if (!Number.isFinite(hours)) {
    return DEFAULTS.streamReuseLastLinkCacheHours;
  }
  return Math.min(168, Math.max(1, hours));
}

function normalizeNextEpisodeThresholdMode(value) {
  const normalized = String(value || "")
    .trim()
    .toUpperCase();
  return NEXT_EPISODE_THRESHOLD_MODES.includes(normalized)
    ? normalized
    : DEFAULTS.nextEpisodeThresholdMode;
}

function normalizeBrowserExternalPlayer(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return ["disabled", "outplayer", "lenna", "infuse", "vlc"].includes(normalized) ? normalized : "disabled";
}

function normalizeExternalPlayerProgress(value) {
  return String(value || "").trim().toLowerCase() === "manual" ? "manual" : "automatic";
}

function normalizeHalfStep(value, min, max, fallback) {
  const next = Number(value);
  if (!Number.isFinite(next)) {
    return fallback;
  }
  return Math.round(Math.max(min, Math.min(max, next)) * 2) / 2;
}

function normalizeStillWatchingThreshold(value) {
  const threshold = Math.trunc(Number(value));
  if (!Number.isFinite(threshold)) {
    return DEFAULTS.stillWatchingEpisodeThreshold;
  }
  return Math.min(6, Math.max(2, threshold));
}

function extractLanguageCode(value, fallback = "off") {
  if (value && typeof value === "object") {
    return extractLanguageCode(
      value.id ?? value.value ?? value.code ?? value.language ?? value.languageCode,
      fallback
    );
  }
  const code = String(value ?? "").trim();
  if (!code || code.toLowerCase() === "[object object]") {
    return fallback;
  }
  return code;
}

function normalizeSelectableSubtitleLanguageCode(language, fallback = "off") {
  const code = extractLanguageCode(language, fallback).trim().toLowerCase();
  if (!code) {
    return fallback;
  }
  switch (code) {
    case "pt-br":
    case "pt_br":
    case "br":
    case "pob":
      return "pt-br";
    case "pt-pt":
    case "pt_pt":
    case "por":
      return "pt";
    case "forced":
    case "force":
    case "forc":
      return "forced";
    case "none":
    case "off":
      return "off";
    default:
      return code;
  }
}

export function normalizePlayerSettings(settings = {}) {
  const { subtitleDelayMs: _ignoredSubtitleDelayMs, ...persistentSettings } = settings || {};
  const subtitleStyle = {
    ...DEFAULTS.subtitleStyle,
    ...(persistentSettings.subtitleStyle || {})
  };
  const storedOffsetContract = String(
    persistentSettings.subtitleStyle?.verticalOffsetContract || ""
  );
  const storedOffset = persistentSettings.subtitleStyle?.verticalOffset;
  subtitleStyle.verticalOffset = normalizeSubtitleVerticalOffset(
    storedOffsetContract === SUBTITLE_VERTICAL_OFFSET_CONTRACT
      ? storedOffset
      : Number(storedOffset) === 0
        ? SUBTITLE_VERTICAL_OFFSET_DEFAULT
        : storedOffset
  );
  subtitleStyle.verticalOffsetContract = SUBTITLE_VERTICAL_OFFSET_CONTRACT;
  let preferredLanguage = normalizeSelectableSubtitleLanguageCode(
    subtitleStyle.preferredLanguage ?? persistentSettings.subtitleLanguage,
    DEFAULTS.subtitleStyle.preferredLanguage
  );
  // Migrate the removed Web-only master switch to Android's "None" language
  // contract. Keep the legacy field enabled so forced-only mode can still run
  // when the preferred language is off, matching Android TV.
  if (persistentSettings.subtitlesEnabled === false) {
    preferredLanguage = "off";
  }
  let secondaryPreferredLanguage = normalizeSelectableSubtitleLanguageCode(
    subtitleStyle.secondaryPreferredLanguage ?? persistentSettings.secondarySubtitleLanguage,
    DEFAULTS.subtitleStyle.secondaryPreferredLanguage
  );
  let useForcedSubtitles = Boolean(
    subtitleStyle.useForcedSubtitles ?? persistentSettings.useForcedSubtitles
  );

  if (preferredLanguage === "forced") {
    useForcedSubtitles = true;
    preferredLanguage =
      secondaryPreferredLanguage &&
      secondaryPreferredLanguage !== "forced" &&
      secondaryPreferredLanguage !== "off"
        ? secondaryPreferredLanguage
        : "en";
    secondaryPreferredLanguage = "off";
  }
  if (secondaryPreferredLanguage === "forced") {
    useForcedSubtitles = true;
    secondaryPreferredLanguage = "off";
  }

  return {
    ...DEFAULTS,
    ...persistentSettings,
    trailerAutoplay: persistentSettings.trailerAutoplay ?? DEFAULTS.trailerAutoplay,
    trailerDelaySeconds: Math.min(15, Math.max(0, Math.trunc(Number(persistentSettings.trailerDelaySeconds ?? 7)) || 0)),
    loadingOverlayEnabled: persistentSettings.loadingOverlayEnabled !== false,
    showPlayerLoadingStatus: persistentSettings.showPlayerLoadingStatus !== false,
    pauseOverlayEnabled: persistentSettings.pauseOverlayEnabled !== false,
    parentalGuideEnabled: persistentSettings.parentalGuideEnabled !== false,
    autoSkipSegmentTypes: [...new Set((Array.isArray(persistentSettings.autoSkipSegmentTypes) ? persistentSettings.autoSkipSegmentTypes : []).map((entry) => String(entry).toLowerCase()).filter((entry) => ["intro", "recap", "outro"].includes(entry)))],
    addonSubtitleStartupMode: ["FAST_STARTUP", "PREFERRED_ONLY", "ALL_SUBTITLES"].includes(String(persistentSettings.addonSubtitleStartupMode || "").toUpperCase())
      ? String(persistentSettings.addonSubtitleStartupMode).toUpperCase()
      : "ALL_SUBTITLES",
    addonSubtitleStartupModeAutoPreferred: Boolean(
      persistentSettings.addonSubtitleStartupModeAutoPreferred
    ),
    streamAutoPlayMode: normalizeStreamAutoPlayMode(
      persistentSettings.streamAutoPlayMode ?? DEFAULTS.streamAutoPlayMode
    ),
    streamAutoPlaySource: normalizeStreamAutoPlaySource(
      persistentSettings.streamAutoPlaySource ?? DEFAULTS.streamAutoPlaySource
    ),
    streamAutoPlaySelectedAddons: normalizeStringList(
      persistentSettings.streamAutoPlaySelectedAddons
    ),
    streamAutoPlaySelectedPlugins: normalizeStringList(
      persistentSettings.streamAutoPlaySelectedPlugins
    ),
    streamAutoPlayRegex: String(persistentSettings.streamAutoPlayRegex ?? "").slice(0, 500),
    streamAutoPlayPreferBingeGroupForNextEpisode: Boolean(
      persistentSettings.streamAutoPlayPreferBingeGroupForNextEpisode ??
      DEFAULTS.streamAutoPlayPreferBingeGroupForNextEpisode
    ),
    streamAutoPlayReuseBingeGroup: Boolean(
      persistentSettings.streamAutoPlayReuseBingeGroup ?? DEFAULTS.streamAutoPlayReuseBingeGroup
    ),
    streamReuseLastLinkEnabled: Boolean(
      persistentSettings.streamReuseLastLinkEnabled ?? DEFAULTS.streamReuseLastLinkEnabled
    ),
    streamReuseLastLinkCacheHours: normalizeReuseLastLinkCacheHours(
      persistentSettings.streamReuseLastLinkCacheHours
    ),
    streamAutoPlayTimeoutSeconds: normalizeStreamAutoPlayTimeout(
      persistentSettings.streamAutoPlayTimeoutSeconds
    ),
    browserExternalPlayer: normalizeBrowserExternalPlayer(
      persistentSettings.browserExternalPlayer ?? DEFAULTS.browserExternalPlayer
    ),
    externalPlayerProgress: normalizeExternalPlayerProgress(
      persistentSettings.externalPlayerProgress ?? DEFAULTS.externalPlayerProgress
    ),
    nextEpisodeThresholdMode: normalizeNextEpisodeThresholdMode(
      persistentSettings.nextEpisodeThresholdMode ?? DEFAULTS.nextEpisodeThresholdMode
    ),
    nextEpisodeThresholdPercent: normalizeHalfStep(
      persistentSettings.nextEpisodeThresholdPercent ?? DEFAULTS.nextEpisodeThresholdPercent,
      97,
      100,
      DEFAULTS.nextEpisodeThresholdPercent
    ),
    nextEpisodeThresholdMinutesBeforeEnd: normalizeHalfStep(
      persistentSettings.nextEpisodeThresholdMinutesBeforeEnd ??
        DEFAULTS.nextEpisodeThresholdMinutesBeforeEnd,
      0,
      3.5,
      DEFAULTS.nextEpisodeThresholdMinutesBeforeEnd
    ),
    stillWatchingEnabled: Boolean(settings.stillWatchingEnabled ?? DEFAULTS.stillWatchingEnabled),
    stillWatchingEpisodeThreshold: normalizeStillWatchingThreshold(
      settings.stillWatchingEpisodeThreshold ?? DEFAULTS.stillWatchingEpisodeThreshold
    ),
    osdClockEnabled: Boolean(
      persistentSettings.osdClockEnabled ?? DEFAULTS.osdClockEnabled
    ),
    subtitlesEnabled: true,
    secondaryPreferredAudioLanguage: (() => {
      const normalized = String(
        persistentSettings.secondaryPreferredAudioLanguage ??
          DEFAULTS.secondaryPreferredAudioLanguage
      )
        .trim()
        .toLowerCase();
      return !normalized || ["default", "device", "forced", "off"].includes(normalized)
        ? "none"
        : normalized;
    })(),
    subtitleLanguage: preferredLanguage,
    secondarySubtitleLanguage: secondaryPreferredLanguage,
    subtitleStyle: {
      ...subtitleStyle,
      preferredLanguage,
      secondaryPreferredLanguage,
      useForcedSubtitles,
      showOnlyPreferredLanguages: Boolean(subtitleStyle.showOnlyPreferredLanguages)
    }
  };
}

const store = createProfileScopedStore({
  key: KEY,
  normalize: normalizePlayerSettings,
  merge(current, partial) {
    const { subtitleDelayMs: _ignoredSubtitleDelayMs, ...persistentPartial } = partial || {};
    return {
      ...current,
      ...persistentPartial,
      subtitleStyle: {
        ...current.subtitleStyle,
        ...(persistentPartial.subtitleStyle || {})
      }
    };
  }
});

export const PlayerSettingsStore = {
  getDefaults() {
    return normalizePlayerSettings({});
  },

  getForProfile(profileId) {
    return store.getForProfile(profileId);
  },

  get() {
    return store.get();
  },

  replaceForProfile(profileId, nextValue, options = {}) {
    return store.replaceForProfile(profileId, nextValue, options);
  },

  setForProfile(profileId, partial, options = {}) {
    return store.setForProfile(profileId, partial, options);
  },

  set(partial, options = {}) {
    return store.set(partial, options);
  }
};
