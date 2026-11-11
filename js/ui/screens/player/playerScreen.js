import { BrowserOfflineDownloadOptions } from "../../components/browserOfflineDownloadOptions.js";
import { filterFilenameStreams } from "../../../core/streams/filenameStreamPolicy.js";
import { renderFilenamePlaybackBadge } from "../../components/filenamePlaybackBadge.js";
import { classifyStreamFilename } from "../../../core/streams/streamCompatibilityFilter.js";
import { selectedPlaybackTask } from "../../../core/player/selectedPlaybackTask.js";
import {
  isTranscodeEnabled,
  prepareMeasuredTranscode,
  SelectedStreamDelivery
} from "../../../core/player/selectedStreamDelivery.js";

import {
  selectFilenamePlaybackAttempt,
  nextPlaybackFallbackRoute,
  canTryUnverifiedRemux,
  canTryUnverifiedAudioTranscode,
  prepareUnverifiedAudioTranscode,
  prepareUnverifiedRemux
} from "../../../core/player/unverifiedPlayback.js";
import { clientRemuxPlan, clientRemuxAssets } from "../../../core/player/remuxClient.js";
import {
  relayTrackContext,
  relayAudioUrl,
  createRelaySubtitleTransport,
  mergeRelayRenditionTracks
} from "../../../core/player/relayTracks.js";
import { createEmbeddedSubtitles } from "../../../core/player/clientRemux/embeddedSubtitles.mjs";
import { secureMediaUrl } from "../../../core/streams/secureMediaUrl.js";

import {
  playerStreamProbeKey,
  filterPlayerStreams,
  nextEpisodeSelectionOptions
} from "../../../core/streams/playerStreamPolicy.js";
import {
  normalizeSourceForDisplay,
  renderBrowserSourceCardContent
} from "../../components/browserStreamSourceCard.js";
import {
  createPlayerOrientation,
  playerLocalPoint,
  playerLocalRect
} from "./browserPlayerOrientation.js";

import { BrowserPlayerPresentationScreen } from "./browserPlayerPresentationScreen.js";
import { playerDesignIcon } from "./browserPlayerPresentation.js";
import { isAppInstalled } from "../../components/browserInstallPrompt.js";
import { formatRuntimeLabel } from "../../../core/util/runtimeLabel.js";
import { traceHost } from "../../../core/util/playbackTrace.js";
import {
  REMUX_POLICY,
  TRANSCODE_ENDPOINT,
  PROBE_ENDPOINT,
  PROBE_MODE,
  PROBE_CLIENT_CONCURRENCY
} from "../../../config.js";
import { createStreamProber, streamProbeIdentity } from "../../../core/player/streamProbe.js";
import { assessPlaybackCapabilities } from "../../../core/player/playbackCapabilities.js";
import { classifyPlayback } from "../../../core/player/playbackMethod.js";
import { getDeviceCapabilities } from "../../../core/player/deviceCapabilities.js";
import {
  StartupLoadingOverlay,
  usesUnifiedStartup
} from "../../components/startupLoadingOverlay.js";
import { PlayerController } from "../../../core/player/playerController.js";
import {
  audioTrackLabelConflictsWithCodec,
  formatAudioCodecName,
  getAuthoritativeAudioCodecValue,
  getAudioTrackLabelPrefix
} from "../../../core/player/audioTrackCodecMetadata.js";
import {
  canReleasePlayingStartupAudioGate,
  selectStartupAudioFallbackOption,
  shouldAllowPlaybackDuringStartupAudioGate
} from "../../../core/player/startupAudioGatePolicy.js";
import { isTerminalHlsHttpStatus } from "../../../core/player/hlsNetworkErrorPolicy.js";
import { buildClockFormatOptions, resolveBrowserHour12 } from "../../../core/player/clockFormat.js";
import { normalizeImageUrl } from "../../../core/media/imageProxy.js";
import {
  getCachedAddonLogoDisplayUrl,
  hasFailedAddonLogo,
  normalizeAddonLogoUrl,
  requestAddonLogo
} from "../../../core/media/addonLogoCache.js";
import { subtitleRepository } from "../../../data/repository/subtitleRepository.js";
import { streamRepository } from "../../../data/repository/streamRepository.js";
import { PluginProviderPlaysStore } from "../../../data/local/pluginProviderPlaysStore.js";
import { scraperIdFromPluginBingeGroup } from "../../../core/streams/pluginBingeGroup.js";
import { addonRepository } from "../../../data/repository/addonRepository.js";
import { parentalGuideRepository } from "../../../data/repository/parentalGuideRepository.js";
import { skipIntroRepository } from "../../../data/repository/skipIntroRepository.js";
import { PlayerSettingsStore } from "../../../data/local/playerSettingsStore.js";
import { StreamBadgeSettingsStore } from "../../../data/local/streamBadgeSettingsStore.js";
import { matchStreamBadges } from "../../../core/streams/streamBadgeRules.js";
import { hasReleaseToken } from "../../../core/streams/releaseToken.js";
import {
  autoPlayCandidates,
  isAutoPlayEffectivelyEnabled,
  selectAutoPlayStream
} from "../../../core/streams/streamAutoPlaySelector.js";
import {
  withinStreamSelectionDeadline,
  resolveAutoPlayStream,
  reportAutoPlaySelection,
  streamSelectionDeadline
} from "../../../core/streams/streamAutoResolve.js";

import { metaRepository } from "../../../data/repository/metaRepository.js";
import { I18n } from "../../../i18n/index.js";
import { Environment } from "../../../platform/environment.js";
import { Router } from "../../navigation/router.js";
import { setBrowserMediaTitle } from "../../navigation/browserDocumentTitle.js";
import { renderLoadingIndicator } from "../../components/loadingIndicator.js";
import {
  bindBrowserPlayerGestures,
  getBrowserPlayerVideoTapAction
} from "../../components/browserPlayerGestures.js";
import {
  BROWSER_PICTURE_IN_PICTURE_STANDARD,
  BROWSER_PICTURE_IN_PICTURE_WEBKIT,
  enterBrowserPictureInPicture,
  exitBrowserPictureInPicture,
  getBrowserPictureInPictureCapability,
  isBrowserPictureInPictureActive,
  isBrowserPictureInPictureUnavailableForSession,
  shouldMarkBrowserPictureInPictureUnavailable
} from "../../components/browserPictureInPicture.js";
import {
  copyBrowserExternalStreamLink,
  getBrowserExternalPlayerPlatform,
  getManualBrowserExternalPlayerOptions,
  isTransferableExternalMediaUrl,
  launchBrowserExternalPlayer,
  prepareBrowserExternalPlaybackLaunch
} from "../../components/browserExternalPlayer.js";
import { clearExternalPlaybackHandoff } from "../../components/browserExternalPlaybackHandoff.js";
import { resolveExternalResumeSeconds } from "../../components/externalPlayerResume.js";
import { bindBrowserPushReturn } from "../../components/browserPushReturn.js";
import { bindHorizontalRailDragScroll } from "../../components/horizontalRailDragScroll.js";
import { markBrowserExternalPlaybackFinished } from "../../components/browserExternalPlaybackFinish.js";
import {
  externalPlaybackReportDurationSeconds,
  formatExternalPlaybackDuration,
  validateExternalPlaybackPositionParts
} from "../../components/browserExternalPlaybackTime.js";
import { NuvioDialog } from "../../components/nuvioDialog.js";
import { normalizeSubtitleForDisplay } from "../../components/browserSubtitleDisplay.js";
import {
  createOfflineSubtitleFingerprint,
  decodeOfflineSubtitleBytes,
  detectOfflineSubtitleFormat,
  getBrowserOfflineSubtitleFile,
  getBrowserOfflineArtwork,
  getOfflineDownload,
  isOfflineSubtitleTextLoadable,
  listOfflineSubtitles,
  listOfflineDownloads
} from "../../../core/offline/browserOfflineDownloads.js";
import {
  createBrowserOfflinePlayback,
  releaseBrowserOfflinePlayback
} from "../../../core/offline/browserOfflinePlayback.js";
import {
  selectCompletedOfflineDetailDownloads,
  createOfflineEpisodeEntries
} from "../detail/offlineDetailData.js";
import { DirectDebridResolver } from "../../../core/debrid/directDebridResolver.js";
import { TrackingScrobbleService } from "../../../data/repository/trackingScrobbleService.js";
import { StreamPreferencesStore } from "../../../data/local/streamPreferencesStore.js";

import { buildStreamResumeIdentity } from "../../../core/streams/streamResumeIdentity.js";
import { TrackPreferencesStore } from "../../../data/local/trackPreferencesStore.js";
import {
  shouldEnterStillWatchingPrompt,
  shouldShowNextEpisodeCard as shouldShowNextEpisodeCardRule
} from "./playerNextEpisodeRules.js";
import { normalizePlaybackDisplayLineBreaks } from "./playbackDisplayText.js";
import {
  resolveBrowserPlayerShortcutRoute,
  shouldBlurBrowserPlayerToolbarAfterPointer
} from "./playerBrowserShortcutRouting.js";
import {
  getSubtitleAssAlignment,
  getSubtitleAssAlignmentSettings,
  parseVttCueLayout
} from "../../../core/player/subtitleCueLayout.js";
import {
  SUBTITLE_VERTICAL_OFFSET_DEFAULT,
  SUBTITLE_VERTICAL_OFFSET_PLAYER_STEP,
  formatSubtitleVerticalOffset,
  normalizeSubtitleVerticalOffset,
  splitSubtitleVerticalOffset
} from "../../../core/player/subtitleVerticalOffset.js";

const CLOCK_FORMATTER_CACHE = new Map();
const LANGUAGE_DISPLAY_NAME_CACHE = new Map();
const STARTUP_PLAYBACK_ADVANCE_EPSILON_SECONDS = 0.001;
const BUFFERING_SPINNER_STALL_MS = 0;
const LOADING_LOGO_FILL_TARGET_LERP = 0.22;
const LOADING_LOGO_FILL_IDLE_STEP = 0.006;
const LOADING_LOGO_FILL_FRAME_MS = 80;
const EPISODE_PANEL_TRANSITION_MS = 220;

function isBackEvent(event) {
  return Environment.isBackEvent(event);
}

function isSelectKeyCode(keyCode) {
  return keyCode === 13 || keyCode === 23;
}

function buildPendingPlaybackRestore(params = {}) {
  if (params?.startFromBeginning) {
    return null;
  }
  const resumePositionMs = Number(params.resumePositionMs || 0);
  if (Number.isFinite(resumePositionMs) && resumePositionMs > 0) {
    return {
      timeSeconds: resumePositionMs / 1000,
      paused: false,
      attempts: 0,
      lastAttemptAt: 0
    };
  }
  const resumePercent = Number(params.resumeProgressPercent);
  if (Number.isFinite(resumePercent) && resumePercent > 0) {
    return {
      progressPercent: Math.max(0, Math.min(100, resumePercent)),
      durationSeconds:
        Number(params.resumeDurationMs || 0) > 0 ? Number(params.resumeDurationMs) / 1000 : 0,
      paused: false,
      attempts: 0,
      lastAttemptAt: 0
    };
  }
  return null;
}

const AUDIO_TRACK_LANGUAGE_KEY_BY_CODE = {
  ar: "common.arabic",
  de: "common.german",
  en: "common.english",
  es: "common.spanish",
  fr: "common.french",
  hi: "common.hindi",
  hu: "common.hungarian",
  it: "common.italian",
  ja: "common.japanese",
  ko: "common.korean",
  nl: "common.dutch",
  pl: "common.polish",
  pt: "common.portuguese",
  ro: "common.romanian",
  ru: "common.russian",
  sk: "common.slovak",
  sl: "common.slovenian",
  sv: "common.swedish",
  tr: "common.turkish",
  vi: "common.vietnamese",
  zh: "common.chinese"
};
// Maps ISO 639-2 (bibliographic + terminologic) and a few legacy codes to
// the ISO 639-1 / app language ids, so subtitle and audio tracks labelled
// with 3-letter codes (common from OpenSubtitles) match
// the preferred language and show the right language name.
const LANGUAGE_CODE_ALIASES = {
  afr: "af",
  alb: "sq",
  amh: "am",
  ara: "ar",
  arm: "hy",
  aze: "az",
  baq: "eu",
  bel: "be",
  ben: "bn",
  bos: "bs",
  br: "pt-br",
  bul: "bg",
  bur: "my",
  cat: "ca",
  ces: "cs",
  chi: "zh",
  cym: "cy",
  cze: "cs",
  dan: "da",
  deu: "de",
  dut: "nl",
  ell: "el",
  eng: "en",
  est: "et",
  eus: "eu",
  fas: "fa",
  fil: "tl",
  fin: "fi",
  fra: "fr",
  fre: "fr",
  geo: "ka",
  ger: "de",
  gle: "ga",
  glg: "gl",
  gre: "el",
  guj: "gu",
  heb: "he",
  hin: "hi",
  hrv: "hr",
  hun: "hu",
  hye: "hy",
  ice: "is",
  in: "id",
  ind: "id",
  isl: "is",
  ita: "it",
  iw: "he",
  jpn: "ja",
  kan: "kn",
  kat: "ka",
  kaz: "kk",
  khm: "km",
  kor: "ko",
  lao: "lo",
  lav: "lv",
  lit: "lt",
  mac: "mk",
  mal: "ml",
  mar: "mr",
  may: "ms",
  mkd: "mk",
  mlt: "mt",
  mon: "mn",
  msa: "ms",
  mya: "my",
  nep: "ne",
  nld: "nl",
  nor: "no",
  pan: "pa",
  pb: "pt-br",
  per: "fa",
  pob: "pt-br",
  pol: "pl",
  por: "pt",
  ptb: "pt-br",
  ron: "ro",
  rum: "ro",
  rus: "ru",
  sin: "si",
  slk: "sk",
  slo: "sk",
  slv: "sl",
  spa: "es",
  sqi: "sq",
  srp: "sr",
  swa: "sw",
  swe: "sv",
  tam: "ta",
  tel: "te",
  tgl: "tl",
  tha: "th",
  tur: "tr",
  ukr: "uk",
  und: "",
  urd: "ur",
  uzb: "uz",
  vie: "vi",
  wel: "cy",
  zho: "zh",
  zul: "zu"
};
const LANGUAGE_NAME_ALIASES = {
  arabic: "ar",
  arabo: "ar",
  chinese: "zh",
  cinese: "zh",
  deutsch: "de",
  dutch: "nl",
  english: "en",
  inglese: "en",
  french: "fr",
  francais: "fr",
  francese: "fr",
  german: "de",
  hindi: "hi",
  hungarian: "hu",
  italiano: "it",
  italian: "it",
  giapponese: "ja",
  japanese: "ja",
  korean: "ko",
  coreano: "ko",
  olandese: "nl",
  polish: "pl",
  polacco: "pl",
  brazilian: "pt-br",
  "brazilian portuguese": "pt-br",
  brasileiro: "pt-br",
  portuguese: "pt",
  "portuguese br": "pt-br",
  "portuguese brazil": "pt-br",
  "portuguese brazilian": "pt-br",
  "portuguese brasil": "pt-br",
  "portuguese brasileiro": "pt-br",
  "portuguese do brasil": "pt-br",
  "portugues brasil": "pt-br",
  "portugues do brasil": "pt-br",
  portoghese: "pt",
  romanian: "ro",
  rumeno: "ro",
  russian: "ru",
  russo: "ru",
  slovak: "sk",
  slovacco: "sk",
  slovenian: "sl",
  sloveno: "sl",
  spanish: "es",
  espanol: "es",
  spagnolo: "es",
  castellano: "es",
  swedish: "sv",
  svedese: "sv",
  tamil: "ta",
  telugu: "te",
  turkish: "tr",
  turco: "tr",
  vietnamese: "vi",
  vietnamita: "vi"
};
const SUBTITLE_LANGUAGE_OFF_KEY = "__off__";
const SUBTITLE_LANGUAGE_UNKNOWN_KEY = "__unknown__";
const SUBTITLE_TEXT_COLORS = ["#FFFFFF", "#D9D9D9", "#FFD700", "#00E5FF", "#FF5C5C", "#00FF88"];
const SUBTITLE_OUTLINE_COLORS = ["#000000", "#FFFFFF", "#00E5FF", "#FF5C5C"];
const SUBTITLE_DELAY_MIN_MS = -60000;
const SUBTITLE_DELAY_MAX_MS = 60000;
const SUBTITLE_DELAY_STEP_MS = 100;
const SUBTITLE_FONT_STEP = 10;
const SUBTITLE_VERTICAL_OFFSET_STEP = SUBTITLE_VERTICAL_OFFSET_PLAYER_STEP;
const AUDIO_AMPLIFICATION_MIN_DB = 0;
const AUDIO_AMPLIFICATION_MAX_DB = 10;
const PLAYER_SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
const NEXT_EPISODE_PREFETCH_PERCENT = 0.9;
const SKIP_INTERVAL_CHECK_MS = 250;
const SKIP_INTERVAL_SEEK_SUPPRESSION_MS = 12000;
const PARENTAL_GUIDE_ROW_HEIGHT = 36;
const PARENTAL_GUIDE_ROW_GAP = 4;
const PAUSE_OVERLAY_DELAY_MS = 5000;
const MAX_PAUSE_OVERLAY_CAST = 8;
const PARENTAL_GUIDE_CONTAINER_IN_MS = 300;
const PARENTAL_GUIDE_LINE_IN_MS = 400;
const PARENTAL_GUIDE_ITEM_STAGGER_MS = 80;
const PARENTAL_GUIDE_ITEM_IN_MS = 200;
const PARENTAL_GUIDE_HOLD_MS = 5000;
const PARENTAL_GUIDE_ITEM_EXIT_STAGGER_MS = 60;
const PARENTAL_GUIDE_ITEM_EXIT_MS = 150;
const PARENTAL_GUIDE_LINE_OUT_DELAY_MS = 100;
const PARENTAL_GUIDE_LINE_OUT_MS = 300;
const PARENTAL_GUIDE_CONTAINER_OUT_DELAY_MS = 200;
const PARENTAL_GUIDE_CONTAINER_OUT_MS = 200;
const SKIP_INTRO_COUNTDOWN_MS = 10000;

function t(key, params = {}, fallback = key) {
  return I18n.t(key, params, { fallback });
}

function buildIndexedLabel(baseLabel, index) {
  return `${baseLabel} ${index + 1}`;
}

function subtitleLabel(index) {
  return buildIndexedLabel(t("subtitle_dialog_title", {}, "Subtitle"), index);
}

function audioLabel(index) {
  return buildIndexedLabel(t("audio_dialog_title", {}, "Audio"), index);
}

function cleanDisplayText(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeSubtitleRenderMode(value) {
  return String(value || "")
    .trim()
    .toLowerCase() === "html"
    ? "html"
    : "native";
}

function capitalizeDisplayLabel(value) {
  const text = cleanDisplayText(value);
  if (!text) {
    return "";
  }
  const locale = typeof I18n.getLocale === "function" ? I18n.getLocale() : undefined;
  return `${text.charAt(0).toLocaleUpperCase(locale)}${text.slice(1)}`;
}

function extractReleaseYear(value) {
  return String(value ?? "").match(/\b(19|20)\d{2}\b/)?.[0] || "";
}

function normalizeComparableText(value) {
  return cleanDisplayText(value).toLowerCase().replace(/[_-]+/g, " ");
}

function extractPauseOverlayCast(data = {}) {
  const result = [];
  const seen = new Map();
  const collections = [data?.castItems, data?.castMembers, data?.cast, data?.credits?.cast];

  const pushEntry = (entry) => {
    if (!entry) {
      return;
    }
    const name =
      typeof entry === "string"
        ? cleanDisplayText(entry)
        : cleanDisplayText(entry?.name || entry?.fullName || entry?.actor || "");
    if (!name) {
      return;
    }
    const character =
      typeof entry === "string" ? "" : cleanDisplayText(entry?.character || entry?.role || "");
    const key = normalizeComparableText(name);
    const rawPhoto =
      typeof entry === "string"
        ? ""
        : String(
            entry.photo ||
              entry.profilePath ||
              entry.profile_path ||
              entry.avatar ||
              entry.image ||
              ""
          );
    const photo = normalizeImageUrl(
      rawPhoto.startsWith("/") && !entry.photo
        ? "https://image.tmdb.org/t/p/w185" + rawPhoto
        : rawPhoto
    );
    const previous = seen.get(key);
    if (previous) {
      if (!previous.photo && photo) previous.photo = photo;
      if (!previous.character && character) previous.character = character;
      return;
    }
    const person = { name, character, photo };
    seen.set(key, person);
    result.push(person);
  };

  collections.forEach((collection) => {
    if (!Array.isArray(collection)) {
      return;
    }
    collection.forEach(pushEntry);
  });

  return result.slice(0, MAX_PAUSE_OVERLAY_CAST);
}

function pushUniqueText(target, value) {
  const text = cleanDisplayText(value);
  if (!text) {
    return;
  }
  const normalized = normalizeComparableText(text);
  if (target.some((entry) => normalizeComparableText(entry) === normalized)) {
    return;
  }
  target.push(text);
}

function flattenTrackMetadata(value, into = []) {
  if (value === null || value === undefined) {
    return into;
  }
  if (Array.isArray(value)) {
    value.forEach((entry) => flattenTrackMetadata(entry, into));
    return into;
  }
  if (typeof value === "object") {
    Object.values(value).forEach((entry) => flattenTrackMetadata(entry, into));
    return into;
  }
  const text = cleanDisplayText(value);
  if (text) {
    into.push(text);
  }
  return into;
}

function isGenericAudioTrackLabel(value) {
  const normalized = normalizeComparableText(value);
  return (
    normalized === "" ||
    /^audio\s*\d*$/.test(normalized) ||
    /^track\s*\d*$/.test(normalized) ||
    normalized === "soundhandler" ||
    normalized === "sound handler"
  );
}

function isGenericSubtitleTrackLabel(value) {
  const normalized = normalizeComparableText(value);
  return /^subtitles?\s*\d*$/.test(normalized) || /^text\s*\d*$/.test(normalized);
}

function getTrackMetadataStrings(track = {}) {
  const values = [];
  [
    track?.name,
    track?.label,
    track?.title,
    track?.language,
    track?.lang,
    track?.channels,
    track?.characteristics,
    track?.kind,
    track?.role,
    track?.accessibility,
    track?.forced,
    track?.isForced,
    track?.sdh,
    track?.isSdh,
    track?.is_sdh,
    track?.cc,
    track?.closedCaption,
    track?.closedCaptions,
    track?.closed_caption,
    track?.hearingImpaired,
    track?.hearing_impaired,
    track?.codec,
    track?.codecs,
    track?.audioCodec,
    track?.codecProfile,
    track?.profile,
    track?.codec_profile,
    track?.codec_id,
    track?.codec_name,
    track?.codec_tag_string,
    track?.mimeType,
    track?.mime_type,
    track?.sampleMimeType,
    track?.sample_mime_type,
    track?.format,
    track?.format_name,
    track?.format_long_name,
    track?.channelCount,
    track?.audioSampleRate,
    track?.sampleRate,
    track?.extraInfo,
    track?.attrs
  ].forEach((value) => flattenTrackMetadata(value, values));
  return values;
}

function getAudioTrackSupportState(_track = {}) {
  return {
    supported: true,
    unsupportedReason: null
  };
}

function normalizeTrackLanguageCode(value) {
  const raw = cleanDisplayText(value).toLowerCase();
  if (!raw || raw === "unknown") {
    return "";
  }
  if (!/^[a-z]{2,3}(?:[-_][a-z0-9]{2,8})*$/i.test(raw)) {
    return "";
  }
  const parts = raw.split(/[-_]/);
  const base = LANGUAGE_CODE_ALIASES[parts[0]] ?? parts[0];
  if (!base) {
    return "";
  }
  return [base, ...parts.slice(1)].join("-");
}

function resolveRouteContentLanguage(params = {}) {
  return (
    [params?.contentLanguage, params?.originalLanguage, params?.original_language]
      .map((value) => normalizeTrackLanguageCode(value))
      .find(Boolean) || ""
  );
}

function normalizeLanguageNameText(value) {
  const comparable = normalizeComparableText(value);
  const asciiComparable =
    typeof comparable.normalize === "function" ? comparable.normalize("NFD") : comparable;
  return asciiComparable
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(
      /\b(forced|force|forc|forzato|forzata|forzati|forzate|subtitle|subtitles|sub|sdh|cc|closed|captions?|full|normal|default|signs?|songs?|foreign|only)\b/g,
      " "
    )
    .replace(/\s+/g, " ")
    .trim();
}

function inferTrackLanguageCodeFromText(value) {
  const normalized = normalizeLanguageNameText(value);
  if (!normalized) {
    return "";
  }
  const padded = ` ${normalized} `;
  const aliasEntries = Object.entries(LANGUAGE_NAME_ALIASES).sort(
    (left, right) => right[0].length - left[0].length
  );
  const match = aliasEntries.find(([name]) => padded.includes(` ${name} `));
  return match?.[1] || "";
}

function inferUniqueTrackLanguageCodeFromText(value) {
  const normalized = normalizeLanguageNameText(value);
  if (!normalized) {
    return "";
  }
  const padded = ` ${normalized} `;
  const matchedCodes = new Set();
  Object.entries(LANGUAGE_NAME_ALIASES)
    .sort((left, right) => right[0].length - left[0].length)
    .forEach(([name, code]) => {
      if (padded.includes(` ${name} `)) {
        matchedCodes.add(code);
      }
    });
  if (matchedCodes.size === 1) {
    return Array.from(matchedCodes)[0];
  }
  // A regional alias also contains its generic language name (for example,
  // "Brazilian Portuguese" matches both pt-BR and pt). That is refinement,
  // not ambiguity: keep the single regional variant.
  const regionalCodes = Array.from(matchedCodes).filter((code) => code.includes("-"));
  if (
    regionalCodes.length === 1 &&
    Array.from(matchedCodes).every(
      (code) => code === regionalCodes[0] || code === regionalCodes[0].split("-")[0]
    )
  ) {
    return regionalCodes[0];
  }
  return "";
}

function getTrackLanguageValue(track = {}) {
  const candidates = [
    track?.language,
    track?.lang,
    track?.track_lang,
    track?.extraInfo?.track_lang,
    track?.extraInfo?.language
  ].map((value) => cleanDisplayText(value));
  const knownLanguage = candidates.find((value) => {
    const code = normalizeTrackLanguageCode(value) || inferTrackLanguageCodeFromText(value);
    const baseCode = String(code || "").split("-")[0];
    return Boolean(code) && !["und", "unk", "zxx"].includes(baseCode);
  });
  return knownLanguage || candidates.find((value) => value) || "";
}

function inferAudioTrackDisplayLanguageCode(track = {}, entry = {}) {
  const candidates = [track?.name, track?.label, track?.title, entry?.label];
  for (const candidate of candidates) {
    const inferredCode = inferUniqueTrackLanguageCodeFromText(candidate);
    if (inferredCode) {
      return inferredCode;
    }
  }
  return "";
}

function inferAudioTrackLanguageKey(track = {}, entry = {}) {
  const explicit = detectTrackLanguageVariant(track, getTrackLanguageValue(track));
  const displayCode = inferAudioTrackDisplayLanguageCode(track, entry);
  if (
    displayCode &&
    (!explicit ||
      explicit.split("-")[0] !== displayCode.split("-")[0] ||
      (!explicit.includes("-") && displayCode.includes("-")))
  ) {
    return displayCode;
  }
  if (explicit) {
    return explicit;
  }
  if (displayCode) {
    return displayCode;
  }

  const candidates = [
    track?.name,
    track?.label,
    track?.title,
    entry?.label,
    entry?.secondary,
    ...getTrackMetadataStrings(track)
  ];
  for (const candidate of candidates) {
    const normalizedCode = normalizeTrackLanguageCode(candidate);
    if (normalizedCode) {
      return normalizedCode;
    }
    const inferredCode = inferTrackLanguageCodeFromText(candidate);
    if (inferredCode) {
      return inferredCode;
    }
  }
  return "";
}

function getAudioTrackLanguageLabel(track = {}, entry = {}) {
  const languageKey = inferAudioTrackLanguageKey(track, entry);
  return languageKey ? getTrackLanguageLabel({ language: languageKey }) : "";
}

function getTrackLanguageLabel(track = {}) {
  const rawLanguage = cleanDisplayText(getTrackLanguageValue(track));
  if (!rawLanguage) {
    return "";
  }

  const normalizedCode = normalizeTrackLanguageCode(rawLanguage);
  const displayCode = normalizedCode ? normalizedCode.split("-")[0] : "";
  const locale = typeof I18n.getLocale === "function" ? I18n.getLocale() : "en";
  if (displayCode) {
    const cacheKey = `${locale}::${displayCode}`;
    if (!LANGUAGE_DISPLAY_NAME_CACHE.has(cacheKey)) {
      let displayName = "";
      try {
        if (typeof Intl !== "undefined" && typeof Intl.DisplayNames === "function") {
          const formatter = new Intl.DisplayNames([locale], { type: "language" });
          displayName = cleanDisplayText(formatter.of(displayCode));
        }
      } catch (_) {
        displayName = "";
      }
      if (!displayName) {
        const fallbackKey = AUDIO_TRACK_LANGUAGE_KEY_BY_CODE[displayCode];
        displayName = fallbackKey
          ? t(fallbackKey, {}, rawLanguage.toUpperCase())
          : rawLanguage.toUpperCase();
      }
      LANGUAGE_DISPLAY_NAME_CACHE.set(cacheKey, displayName);
    }
    return LANGUAGE_DISPLAY_NAME_CACHE.get(cacheKey) || "";
  }

  return rawLanguage;
}

function getMeaningfulTrackLabel(track = {}) {
  const candidates = [track?.name, track?.label, track?.title];
  for (const candidate of candidates) {
    const text = cleanDisplayText(candidate);
    if (!text || isGenericAudioTrackLabel(text) || isGenericSubtitleTrackLabel(text)) {
      continue;
    }
    if (normalizeTrackLanguageCode(text)) {
      continue;
    }
    return text;
  }
  return "";
}

function isTruthyTrackFlag(value) {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    return value === 1;
  }
  const text = cleanDisplayText(value).toLowerCase();
  return text === "1" || text === "true" || text === "yes" || text === "y";
}

function getTrackFlagCandidates(track = {}, keys = []) {
  const values = [];
  const pushFrom = (source) => {
    if (!source || typeof source !== "object") {
      return;
    }
    keys.forEach((key) => {
      if (Object.prototype.hasOwnProperty.call(source, key)) {
        values.push(source[key]);
      }
    });
  };

  pushFrom(track);
  pushFrom(track?.extraInfo);
  pushFrom(track?.attrs);
  pushFrom(track?.tags);
  pushFrom(track?.disposition);
  pushFrom(track?.raw);
  pushFrom(track?.raw?.extraInfo);
  pushFrom(track?.raw?.attrs);
  pushFrom(track?.raw?.tags);
  pushFrom(track?.raw?.disposition);
  return values;
}

function hasTruthyTrackFlag(track = {}, keys = []) {
  return getTrackFlagCandidates(track, keys).some((value) => isTruthyTrackFlag(value));
}

function isSdhSubtitleTrack(track = {}) {
  if (
    isTruthyTrackFlag(track?.sdh) ||
    isTruthyTrackFlag(track?.isSdh) ||
    isTruthyTrackFlag(track?.is_sdh) ||
    isTruthyTrackFlag(track?.hearingImpaired) ||
    isTruthyTrackFlag(track?.hearing_impaired)
  ) {
    return true;
  }
  const searchText = getTrackMetadataStrings(track).join(" ").toLowerCase();
  return /\b(sdh|hearing impaired|hearing-impaired|hard of hearing|hoh)\b/.test(searchText);
}

function isClosedCaptionTrack(track = {}) {
  if (
    isTruthyTrackFlag(track?.cc) ||
    isTruthyTrackFlag(track?.closedCaption) ||
    isTruthyTrackFlag(track?.closedCaptions) ||
    isTruthyTrackFlag(track?.closed_caption)
  ) {
    return true;
  }
  const searchText = getTrackMetadataStrings(track).join(" ").toLowerCase();
  return /\b(cc|closed captions?|closed-caption(?:ed)?|captioned)\b/.test(searchText);
}

function detectChannelLayout(value) {
  const text = cleanDisplayText(value).toLowerCase();
  if (!text) {
    return "";
  }
  const explicitLayout = text.match(/\b(7\.1|5\.1|2\.1|2\.0|1\.0)\b/);
  if (explicitLayout) {
    if (explicitLayout[1] === "2.0") {
      return t("player.track.stereo", {}, "Stereo");
    }
    return explicitLayout[1];
  }
  const numericMatch =
    text.match(/\b([0-9]{1,2})(?:ch| channels?)\b/) ||
    text.match(/^([0-9]{1,2})(?:\/[a-z0-9.]+)?$/);
  if (!numericMatch) {
    return "";
  }
  const channels = Number(numericMatch[1]);
  if (!Number.isFinite(channels) || channels <= 0) {
    return "";
  }
  if (channels >= 8) {
    return "7.1";
  }
  if (channels >= 6) {
    return "5.1";
  }
  if (channels === 2) {
    return t("player.track.stereo", {}, "Stereo");
  }
  if (channels === 1) {
    return "1.0";
  }
  return `${channels}ch`;
}

function getTrackDescriptorLabels(track = {}) {
  const descriptors = [];
  const metadataStrings = getTrackMetadataStrings(track);
  const searchText = metadataStrings.join(" ").toLowerCase();

  const channelCandidates = [track?.channels, ...metadataStrings];
  for (const candidate of channelCandidates) {
    const channelLayout = detectChannelLayout(candidate);
    if (channelLayout) {
      pushUniqueText(descriptors, channelLayout);
      break;
    }
  }

  if (!descriptors.length) {
    if (/\bstereo\b/.test(searchText)) {
      pushUniqueText(descriptors, t("player.track.stereo", {}, "Stereo"));
    } else if (/\bsurround\b/.test(searchText)) {
      pushUniqueText(descriptors, t("player.track.surround", {}, "Surround"));
    }
  }

  if (/\b(atmos|joc)\b/.test(searchText)) {
    pushUniqueText(descriptors, "Dolby Atmos");
  } else if (/\b(eac3|ec-3|ddp|dolby digital plus)\b/.test(searchText)) {
    pushUniqueText(descriptors, "Dolby Digital Plus");
  } else if (/\b(ac3|ac-3|dolby digital)\b/.test(searchText)) {
    pushUniqueText(descriptors, "Dolby Digital");
  } else if (/\b(truehd)\b/.test(searchText)) {
    pushUniqueText(descriptors, "TrueHD");
  } else if (/\b(dts:x|dts-hd|dts)\b/.test(searchText)) {
    pushUniqueText(descriptors, "DTS");
  } else if (/\b(aac|mp4a)\b/.test(searchText)) {
    pushUniqueText(descriptors, "AAC");
  } else if (/\b(opus)\b/.test(searchText)) {
    pushUniqueText(descriptors, "Opus");
  } else if (/\b(flac)\b/.test(searchText)) {
    pushUniqueText(descriptors, "FLAC");
  } else if (/\b(mp3|mpeg audio)\b/.test(searchText)) {
    pushUniqueText(descriptors, "MP3");
  }

  if (isForcedSubtitleTrack(track)) {
    pushUniqueText(descriptors, t("sub_forced_lang", {}, "Forced"));
  }
  if (isSdhSubtitleTrack(track)) {
    pushUniqueText(descriptors, "SDH");
  }
  if (isClosedCaptionTrack(track)) {
    pushUniqueText(descriptors, "CC");
  }
  if (/\b(commentary)\b/.test(searchText)) {
    pushUniqueText(descriptors, t("player.track.commentary", {}, "Commentary"));
  }
  if (
    /\b(audio description|audio-description|describes-video|describes video|descriptive)\b/.test(
      searchText
    )
  ) {
    pushUniqueText(descriptors, t("player.track.audioDescription", {}, "Audio description"));
  }

  return descriptors;
}

function isForcedSubtitleTrack(track = {}) {
  if (String(track.kind || "").toLowerCase() === "forced") return true;
  if (
    hasTruthyTrackFlag(track, [
      "forced",
      "isForced",
      "is_forced",
      "forcedSubtitle",
      "forced_subtitle",
      "flagForced",
      "flag_forced",
      "defaultForced",
      "default_forced",
      "trackForced",
      "track_forced"
    ])
  ) {
    return true;
  }
  const searchText = getTrackMetadataStrings(track).join(" ").toLowerCase();
  const hasForcedName = /\b(forced|forc|forzato|forzata|forzati|forzate)\b/.test(searchText);
  // Match Android TV: anime releases commonly label forced dialogue tracks as
  // "Songs & Signs" without exposing "forced" in the track name.
  const isSongsAndSigns = searchText.includes("songs") && searchText.includes("sign");
  return hasForcedName || isSongsAndSigns;
}

function isForcedAddonSubtitle(subtitle = {}) {
  return [subtitle?.id, subtitle?.url, subtitle?.addonName]
    .map((value) => cleanDisplayText(value).toLowerCase())
    .some((value) => value.includes("forced"));
}

function getSubtitleEntryLanguageSource(entry = {}) {
  const track = entry?.track || entry;
  const explicitLanguage = getTrackLanguageValue(track) || getTrackLanguageValue(entry);
  if (explicitLanguage) {
    return detectTrackLanguageVariant(track, explicitLanguage);
  }
  const secondaryLanguage = normalizeTrackLanguageCode(entry.secondary) ? entry.secondary : "";
  if (secondaryLanguage) {
    return secondaryLanguage;
  }
  const fallbackLabel = entry.label || entry.title || "";
  return isGenericSubtitleTrackLabel(fallbackLabel) ? "" : fallbackLabel;
}

function detectTrackLanguageVariant(track = {}, language = getTrackLanguageValue(track)) {
  const normalizedLanguage =
    normalizeTrackLanguageCode(language) || inferTrackLanguageCodeFromText(language);
  if (!normalizedLanguage) {
    return "";
  }
  if (normalizedLanguage === "pt-br" || normalizedLanguage === "es-419") {
    return normalizedLanguage;
  }
  const baseLanguage = normalizedLanguage.split("-")[0];
  const haystack = getTrackMetadataStrings(track)
    .concat([track?.trackId, track?.id])
    .map((value) => cleanDisplayText(value).toLowerCase())
    .join(" ");
  if (baseLanguage === "pt") {
    const hasBrazilian = [
      "pt-br",
      "pt_br",
      "pob",
      "brazilian",
      "brazil",
      "brasil",
      "brasileiro",
      " br",
      "(br)"
    ].some((tag) => haystack.includes(tag));
    const hasEuropean = [
      "pt-pt",
      "pt_pt",
      "iberian",
      "european",
      "portugal",
      "europeu",
      " eu",
      "(eu)"
    ].some((tag) => haystack.includes(tag));
    return hasBrazilian && !hasEuropean ? "pt-br" : "pt";
  }
  if (baseLanguage === "es") {
    const hasLatino = [
      "es-419",
      "es_419",
      "es-la",
      "es-lat",
      "latino",
      "latinoamerica",
      "latinoamericano",
      "latam",
      "lat am",
      "latin america"
    ].some((tag) => haystack.includes(tag));
    const hasCastilian = [
      "es-es",
      "es_es",
      "castilian",
      "castellano",
      "spain",
      "españa",
      "espana",
      "iberian"
    ].some((tag) => haystack.includes(tag));
    return hasLatino && !hasCastilian ? "es-419" : "es";
  }
  return baseLanguage;
}

function formatAudioChannelLayout(value) {
  const numericValue = Number(value);
  if (Number.isFinite(numericValue) && numericValue > 0) {
    if (numericValue === 1) return "Mono";
    if (numericValue === 2) return "Stereo";
    if (numericValue === 6) return "5.1";
    if (numericValue === 8) return "7.1";
    return `${numericValue}ch`;
  }

  const text = cleanDisplayText(value).toLowerCase();
  if (!text) {
    return "";
  }
  if (text.includes("mono") || text === "1" || text === "1.0") return "Mono";
  if (text.includes("stereo") || text === "2" || text === "2.0") return "Stereo";
  if (text.includes("5.1") || text === "6") return "5.1";
  if (text.includes("7.1") || text === "8") return "7.1";
  const numericMatch = text.match(/\b(\d{1,2})(?:ch| channels?)\b/) || text.match(/^(\d{1,2})$/);
  if (!numericMatch) {
    return "";
  }
  const channels = Number(numericMatch[1]);
  if (!Number.isFinite(channels) || channels <= 0) {
    return "";
  }
  if (channels === 1) return "Mono";
  if (channels === 2) return "Stereo";
  if (channels === 6) return "5.1";
  if (channels === 8) return "7.1";
  return `${channels}ch`;
}

function formatAudioTrackDisplay(track = {}, index = 0) {
  const rawLabel = getMeaningfulTrackLabel(track);
  const rawLanguage = cleanDisplayText(getTrackLanguageValue(track));
  const languageLabel = capitalizeDisplayLabel(getAudioTrackLanguageLabel(track));
  const rawLanguageLabel = capitalizeDisplayLabel(rawLanguage);
  const authoritativeCodecValue = getAuthoritativeAudioCodecValue(track);
  const codecName = formatAudioCodecName(
    authoritativeCodecValue || getTrackMetadataStrings(track).join(" ")
  );
  const channelLayout = formatAudioChannelLayout(track?.channelCount || track?.channels);
  const sampleRate = Number(track?.sampleRate || track?.audioSampleRate || 0);
  const labelConflictsWithCodec = audioTrackLabelConflictsWithCodec(
    rawLabel,
    authoritativeCodecValue
  );
  const labelPrefix = labelConflictsWithCodec ? getAudioTrackLabelPrefix(rawLabel) : "";
  const baseName =
    labelPrefix ||
    (labelConflictsWithCodec ? "" : rawLabel) ||
    languageLabel ||
    rawLanguageLabel ||
    audioLabel(index);
  const suffix = [codecName, channelLayout].filter(Boolean).join(" ");
  const label = suffix ? `${baseName} (${suffix})` : baseName;
  const secondaryParts = [];
  if (
    languageLabel &&
    normalizeComparableText(languageLabel) !== normalizeComparableText(baseName)
  ) {
    pushUniqueText(secondaryParts, languageLabel);
  }
  if (Number.isFinite(sampleRate) && sampleRate > 0) {
    pushUniqueText(secondaryParts, `${Math.round(sampleRate / 1000)} kHz`);
  }
  const secondary = secondaryParts.join(" | ");

  return { label, secondary };
}

function formatTime(secondsValue) {
  const total = Math.max(0, Math.floor(Number(secondsValue || 0)));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function formatClock(date = new Date()) {
  const locale = typeof I18n.getLocale === "function" ? I18n.getLocale() : undefined;
  const hour12 = resolveBrowserHour12({
    intlApi: typeof Intl !== "undefined" ? Intl : null
  });
  const localeKey = `${String(locale || "__default__")}:${String(hour12)}`;
  const options = buildClockFormatOptions(hour12);
  if (!CLOCK_FORMATTER_CACHE.has(localeKey)) {
    try {
      CLOCK_FORMATTER_CACHE.set(localeKey, new Intl.DateTimeFormat(locale || undefined, options));
    } catch (_) {
      CLOCK_FORMATTER_CACHE.set(localeKey, null);
    }
  }
  const formatter = CLOCK_FORMATTER_CACHE.get(localeKey);
  try {
    if (formatter?.format) {
      return formatter.format(date);
    }
    return date.toLocaleTimeString(locale || undefined, options);
  } catch (_) {
    return date.toLocaleTimeString(undefined, options);
  }
}

function formatEndsAt(currentSeconds, durationSeconds) {
  const current = Number(currentSeconds || 0);
  const duration = Number(durationSeconds || 0);
  if (!Number.isFinite(duration) || duration <= 0) {
    return "--:--";
  }
  const remainingMs = Math.max(0, (duration - current) * 1000);
  const endDate = new Date(Date.now() + remainingMs);
  return formatClock(endDate);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function trackListToArray(trackList) {
  if (!trackList) {
    return [];
  }

  try {
    const iterableTracks = Array.from(trackList).filter(Boolean);
    if (iterableTracks.length) {
      return iterableTracks;
    }
  } catch (_) {
    // Fall through to indexed track lists.
  }

  const length = Number(trackList.length || 0);
  if (Number.isFinite(length) && length > 0) {
    const indexedTracks = [];
    for (let index = 0; index < length; index += 1) {
      const track =
        trackList[index] || (typeof trackList.item === "function" ? trackList.item(index) : null);
      if (track) {
        indexedTracks.push(track);
      }
    }
    if (indexedTracks.length) {
      return indexedTracks;
    }
  }

  if (typeof trackList.item === "function") {
    const probedTracks = [];
    for (let index = 0; index < 32; index += 1) {
      const track = trackList.item(index);
      if (!track) {
        if (probedTracks.length) {
          break;
        }
        continue;
      }
      probedTracks.push(track);
    }
    if (probedTracks.length) {
      return probedTracks;
    }
  }

  const objectTracks = Object.keys(trackList)
    .filter((key) => /^\d+$/.test(key))
    .map((key) => trackList[key])
    .filter(Boolean);
  return objectTracks;
}

function normalizeItemType(value) {
  const normalized = String(value || "movie").toLowerCase();
  return normalized || "movie";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeAttribute(value) {
  return escapeHtml(value);
}

function cleanPlaybackDiagnosticValue(value, maxLength = 320) {
  const text = String(value ?? "")
    .replace(/(?:https?|wss?|file|blob|magnet):[^\s"'<>]+/gi, "[redacted]")
    .replace(/\b(?:authorization|cookie)\s*:\s*[^\s,;]+/gi, (match) =>
      match.replace(/(:\s*)[^\s,;]+$/, "$1[redacted]")
    )
    .replace(/\bbearer\s+[^\s,;]+/gi, "Bearer [redacted]")
    .replace(/\b(?:access[_-]?token|refresh[_-]?token|api[_-]?key)\s*[:=]\s*[^\s,;]+/gi, (match) =>
      match.replace(/([:=]\s*)[^\s,;]+$/, "$1[redacted]")
    )
    .replace(
      /([?&](?:token|access_token|refresh_token|apikey|api_key|key)=)[^&\s]+/gi,
      "$1[redacted]"
    )
    .replace(/\s+/g, " ")
    .trim();
  if (!text) {
    return "";
  }
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

function describeSafePlaybackEndpoint(value = "") {
  const raw = String(value || "").trim();
  if (!raw) {
    return "[redacted]";
  }
  try {
    const parsed = new URL(raw);
    const extension = String(parsed.pathname || "")
      .match(/\.([a-z0-9]{1,12})$/i)?.[1]
      ?.toLowerCase();
    return extension ? `${parsed.hostname} • .${extension}` : parsed.hostname || "[redacted]";
  } catch (_) {
    return "[redacted]";
  }
}

function pushPlaybackDiagnosticLine(lines, label, value, maxLength = 320) {
  const text = cleanPlaybackDiagnosticValue(value, maxLength);
  if (!text) {
    return;
  }
  const line = `${label}: ${text}`;
  if (!lines.includes(line)) {
    lines.push(line);
  }
}

function extractPlaybackHttpStatus(value = "") {
  const text = String(value || "");
  if (!text) {
    return 0;
  }
  const patterns = [
    /\bhttp(?:\s+status|\s+code)?\s*[:=]?\s*([45]\d{2})\b/i,
    /\bstatus(?:\s+code)?\s*[:=]?\s*([45]\d{2})\b/i,
    /\bresponse(?:\s+code)?\s*[:=]?\s*([45]\d{2})\b/i
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    const status = Number(match?.[1] || 0);
    if (status >= 400 && status <= 599) {
      return status;
    }
  }
  if (/\bhttp\b/i.test(text)) {
    const match = text.match(/\b([45]\d{2})\b/);
    const status = Number(match?.[1] || 0);
    if (status >= 400 && status <= 599) {
      return status;
    }
  }
  return 0;
}

function formatEpisodePanelDate(value = "") {
  const raw = String(value || "").trim();
  if (!raw) {
    return "";
  }
  const localDateMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:$|T)/);
  const parsed =
    localDateMatch && !raw.includes("T")
      ? new Date(
          Number(localDateMatch[1]),
          Number(localDateMatch[2]) - 1,
          Number(localDateMatch[3])
        )
      : new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    return "";
  }
  try {
    return parsed.toLocaleDateString(undefined, {
      month: "long",
      day: "numeric",
      year: "numeric"
    });
  } catch (_) {
    return localDateMatch ? `${localDateMatch[1]}-${localDateMatch[2]}-${localDateMatch[3]}` : raw;
  }
}

function formatNextEpisodeAirDate(value = "") {
  const raw = String(value || "").trim();
  const datePortion = raw.match(/\b\d{4}-\d{2}-\d{2}\b/)?.[0] || "";
  const dateLabel = formatEpisodePanelDate(raw) || formatEpisodePanelDate(datePortion);
  return dateLabel
    ? t("cw_airs_date", [dateLabel], "Airs %1$s")
    : t("next_episode_not_aired_yet", {}, "Next episode hasn't aired yet");
}

function episodeDisplayCode(episode = {}) {
  const season = Number(episode?.season);
  const episodeNumber = Number(episode?.episode);
  if (!Number.isFinite(season) || !Number.isFinite(episodeNumber)) {
    return "";
  }
  return `S${season} E${episodeNumber}`;
}

function episodeThumbnailUrl(episode = {}) {
  return cleanDisplayText(
    episode?.thumbnail ||
      episode?.thumbnailUrl ||
      episode?.still ||
      episode?.stillUrl ||
      episode?.poster ||
      episode?.image ||
      ""
  );
}

function formatBytes(value) {
  const bytes = Number(value || 0);
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "";
  }
  const units = ["B", "KB", "MB", "GB", "TB"];
  let amount = bytes;
  let unitIndex = 0;
  while (amount >= 1024 && unitIndex < units.length - 1) {
    amount /= 1024;
    unitIndex += 1;
  }
  const precision = amount >= 10 || unitIndex === 0 ? 0 : 1;
  return `${amount.toFixed(precision)} ${units[unitIndex]}`;
}

function normalizeStreamBadgeChipColor(value = "") {
  const hex = String(value || "")
    .trim()
    .replace(/^#/, "");
  if (!/^[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(hex)) {
    const cssColor = String(value || "").trim();
    return /^(transparent|rgba?\([\d\s,%.]+\))$/i.test(cssColor) ? cssColor : "";
  }
  if (hex.length === 6) {
    return `#${hex}`.toUpperCase();
  }
  const alpha = parseInt(hex.slice(0, 2), 16);
  const red = parseInt(hex.slice(2, 4), 16);
  const green = parseInt(hex.slice(4, 6), 16);
  const blue = parseInt(hex.slice(6, 8), 16);
  if (alpha >= 255) {
    return `#${hex.slice(2)}`.toUpperCase();
  }
  if (alpha <= 0) {
    return "transparent";
  }
  return `rgba(${red}, ${green}, ${blue}, ${(alpha / 255).toFixed(3).replace(/0+$/, "").replace(/\.$/, "")})`;
}

function renderPlayerImageBadgeChip(badge = {}) {
  const imageUrl = normalizeImageUrl(badge.imageURL);
  if (!imageUrl) {
    return "";
  }
  const backgroundColor = normalizeStreamBadgeChipColor(badge.tagColor);
  const outlineColor = normalizeStreamBadgeChipColor(badge.borderColor);
  const textColor = normalizeStreamBadgeChipColor(badge.textColor);
  const filled =
    String(badge.tagStyle || "")
      .trim()
      .toLowerCase() === "filled";
  const style = [
    filled && backgroundColor ? `background:${backgroundColor};` : "",
    outlineColor ? `border-color:${outlineColor};` : "",
    textColor ? `color:${textColor};` : ""
  ].join("");
  return `
    <span class="stream-route-stream-badge image${filled ? " filled" : ""}"${style ? ` style="${escapeHtml(style)}"` : ""}>
      <img src="${escapeAttribute(imageUrl)}" alt="${escapeAttribute(badge.name || "")}" loading="lazy" decoding="async" />
    </span>
  `;
}

function getPlayerSourceLogoDisplayUrl(value = "", onSettled = null) {
  const logoUrl = normalizeAddonLogoUrl(value);
  if (!logoUrl || hasFailedAddonLogo(logoUrl)) {
    return "";
  }
  const cachedLogoUrl = getCachedAddonLogoDisplayUrl(logoUrl);
  if (cachedLogoUrl) {
    return cachedLogoUrl;
  }
  void requestAddonLogo(logoUrl, onSettled);
  return logoUrl;
}

function renderPlayerSourceBadges(
  stream = {},
  badgeSettings = StreamBadgeSettingsStore.snapshot(),
  { sizeLast = false } = {}
) {
  const matchedBadges = matchStreamBadges(stream, badgeSettings.rules);
  const chips = [];
  const sizeBytes = stream.behaviorHints?.videoSize;
  if (badgeSettings.showFileSizeBadges !== false && sizeBytes != null) {
    const label = formatBytes(sizeBytes);
    if (label) {
      chips.push(
        `<span class="stream-route-stream-badge size">${escapeHtml(t("streams_size", [label], `SIZE ${label}`))}</span>`
      );
    }
  }
  const sizeChips = sizeLast ? chips.splice(0) : [];
  matchedBadges.slice(0, 8).forEach((badge) => {
    const chip = renderPlayerImageBadgeChip(badge);
    if (chip) {
      chips.push(chip);
    }
  });
  chips.push(...sizeChips);
  const filenameLabel = renderFilenamePlaybackBadge(stream, badgeSettings);
  if (filenameLabel) chips.unshift(filenameLabel);
  return chips.length
    ? `<div class="stream-route-card-badges player-source-badges" aria-label="${escapeHtml(t("settings_stream_badges_section", {}, "Fusion Style"))}">${chips.join("")}</div>`
    : "";
}

function resolvePlayerSourceBadgePlacement(badgeSettings = StreamBadgeSettingsStore.snapshot()) {
  return String(badgeSettings.badgePlacement || "BOTTOM")
    .trim()
    .toUpperCase() === "TOP"
    ? "TOP"
    : "BOTTOM";
}

function formatSubtitleDelay(delayMs = 0) {
  const seconds = Number(delayMs || 0) / 1000;
  return `${seconds >= 0 ? "+" : ""}${seconds.toFixed(3)}s`;
}

function normalizeSubtitleFontSize(value = 120) {
  const parsed = Number(value ?? 120);
  if (!Number.isFinite(parsed)) {
    return 120;
  }
  return clamp(Math.round(parsed), 50, 200);
}

function formatHtmlSubtitleFontSize(value = 120) {
  const scale = normalizeSubtitleFontSize(value) / 100;
  const documentRef = globalThis?.document;
  const viewportHeight = Number(
    globalThis?.innerHeight ||
      documentRef?.documentElement?.clientHeight ||
      documentRef?.body?.clientHeight ||
      0
  );
  const basePx = viewportHeight > 0 ? clamp(viewportHeight * 0.044, 30, 82) : 48;
  return `${Math.round(basePx * scale)}px`;
}

function addonSubtitleSelectionId(subtitle) {
  return JSON.stringify([
    subtitle.id || "",
    subtitle.url,
    subtitle.lang || subtitle.language || ""
  ]);
}

function normalizeSubtitleLanguageKey(value) {
  const code = normalizeTrackLanguageCode(value) || inferTrackLanguageCodeFromText(value);
  if (code) {
    return code;
  }
  const cleaned = cleanDisplayText(value);
  if (!normalizeLanguageNameText(cleaned)) {
    return SUBTITLE_LANGUAGE_UNKNOWN_KEY;
  }
  return cleaned ? cleaned.toLowerCase() : SUBTITLE_LANGUAGE_UNKNOWN_KEY;
}

function extractSubtitleLanguageSetting(value, fallback = SUBTITLE_LANGUAGE_OFF_KEY) {
  if (value && typeof value === "object") {
    return extractSubtitleLanguageSetting(
      value.id ?? value.value ?? value.code ?? value.language ?? value.languageCode,
      fallback
    );
  }
  const code = cleanDisplayText(value);
  if (!code || code.toLowerCase() === "[object object]") {
    return fallback;
  }
  return code;
}

function subtitleLanguageLabel(languageKey) {
  if (languageKey === SUBTITLE_LANGUAGE_OFF_KEY) {
    return t("subtitle_none", {}, "Off");
  }
  if (languageKey === SUBTITLE_LANGUAGE_UNKNOWN_KEY) {
    return t("common.unknown", {}, "Unknown");
  }
  const locale = typeof I18n.getLocale === "function" ? I18n.getLocale() : undefined;
  const normalizedCode = normalizeTrackLanguageCode(languageKey);
  if (normalizedCode === "pt-br" || normalizedCode === "es-419") {
    try {
      if (typeof Intl !== "undefined" && typeof Intl.DisplayNames === "function") {
        const displayName = cleanDisplayText(
          new Intl.DisplayNames([locale], { type: "language" }).of(normalizedCode)
        );
        if (displayName) {
          return `${displayName.charAt(0).toLocaleUpperCase(locale)}${displayName.slice(1)}`;
        }
      }
    } catch (_) {
      // Older TV engines use the stable English fallback below.
    }
    return normalizedCode === "pt-br" ? "Portuguese (Brazil)" : "Spanish (Latin America)";
  }
  const baseCode = normalizedCode?.split("-")[0] || "";
  let label = "";
  if (baseCode) {
    label = getTrackLanguageLabel({ language: baseCode });
  }
  if (!label) {
    label = getTrackLanguageLabel({ language: languageKey });
  }
  if (!label && baseCode) {
    const baseLabelKey = AUDIO_TRACK_LANGUAGE_KEY_BY_CODE[baseCode];
    label = baseLabelKey ? t(baseLabelKey, {}, baseCode.toUpperCase()) : baseCode.toUpperCase();
  }
  if (!label) {
    label = String(languageKey || "").toUpperCase();
  }
  return label ? `${label.charAt(0).toLocaleUpperCase(locale)}${label.slice(1)}` : "";
}

function formatSubtitleTrackDisplay(track = {}, index = 0) {
  const languageSource = getSubtitleEntryLanguageSource(track);
  const languageKey = normalizeSubtitleLanguageKey(languageSource);
  const languageLabel = subtitleLanguageLabel(languageKey);
  const descriptors = getTrackDescriptorLabels(track).filter(
    (detail) => !isSubtitleLanguageOnlyDetail(detail, languageLabel, languageKey)
  );
  const rawLabel = getMeaningfulTrackLabel(track);
  const label =
    languageKey !== SUBTITLE_LANGUAGE_UNKNOWN_KEY && languageLabel
      ? languageLabel
      : rawLabel || subtitleLabel(index);

  return {
    label,
    language: getTrackLanguageValue(track) || languageSource,
    secondary: descriptors.join(" · "),
    languageKey,
    languageLabel
  };
}

function isSubtitleLanguageOnlyDetail(value, languageLabel = "", languageKey = "") {
  const text = cleanDisplayText(value);
  if (!text) {
    return true;
  }
  const comparable = normalizeComparableText(text);
  const labelComparable = normalizeComparableText(languageLabel);
  if (labelComparable && comparable === labelComparable) {
    return true;
  }

  const normalizedDetailCode =
    normalizeTrackLanguageCode(text) || inferTrackLanguageCodeFromText(text);
  const normalizedLanguageCode =
    normalizeTrackLanguageCode(languageKey) || inferTrackLanguageCodeFromText(languageKey);
  if (normalizedDetailCode && normalizedLanguageCode) {
    return (
      normalizedDetailCode === normalizedLanguageCode ||
      normalizedDetailCode.split("-")[0] === normalizedLanguageCode.split("-")[0]
    );
  }

  const inferredKey = normalizeSubtitleLanguageKey(text);
  if (normalizedLanguageCode && inferredKey && inferredKey !== SUBTITLE_LANGUAGE_UNKNOWN_KEY) {
    return (
      inferredKey === normalizedLanguageCode ||
      inferredKey.split("-")[0] === normalizedLanguageCode.split("-")[0]
    );
  }
  return false;
}

function styleChipLabel(value = "") {
  return String(value || "")
    .replace(/^#/, "")
    .toUpperCase();
}

function createTrackDialogCache() {
  return {
    subtitleOptions: null,
    subtitleLanguageRail: null,
    subtitleOptionsByLanguage: new Map(),
    audioEntries: null
  };
}

function dbToGain(db = 0) {
  return Math.pow(10, Number(db || 0) / 20);
}

function supportsWebAudioAmplification() {
  const video = PlayerController.video;
  const source = video?.currentSrc || video?.src;
  const origin = globalThis.location?.origin;
  if (!source || !origin) return false;
  // Native remote media can play without CORS, but Web Audio may silence it.
  // Keep direct playback intact rather than changing the video's CORS mode.
  try {
    return new URL(source, origin).origin === origin;
  } catch (_) {
    return false;
  }
}

function isMagnetUrl(value = "") {
  return String(value || "")
    .trim()
    .toLowerCase()
    .startsWith("magnet:");
}

function directPlaybackUrl(value = "") {
  const url = String(value || "").trim();
  return url && !isMagnetUrl(url) ? secureMediaUrl(url) : "";
}

function streamDirectPlaybackUrl(stream = {}) {
  return directPlaybackUrl(stream?.url) || directPlaybackUrl(stream?.externalUrl);
}

function streamDebridIdentity(item = {}) {
  const resolve = item.clientResolve || item.raw?.clientResolve || {};
  const behaviorHints = item.behaviorHints || item.raw?.behaviorHints || {};
  const infoHash = item.infoHash || item.raw?.infoHash || resolve.infoHash || "";
  const magnetUri =
    resolve.magnetUri ||
    (isMagnetUrl(item.url) ? item.url : "") ||
    (isMagnetUrl(item.externalUrl) ? item.externalUrl : "");
  const hasDebridMarker = Boolean(
    item.clientResolve ||
    item.raw?.clientResolve ||
    item.debridCacheStatus ||
    item.raw?.debridCacheStatus ||
    infoHash ||
    magnetUri
  );
  if (!hasDebridMarker) {
    return "";
  }
  const locator = infoHash || magnetUri || item.url || item.externalUrl || item.ytId || "";
  if (!locator) {
    return "";
  }
  return [
    String(item.addonName || "Addon"),
    String(
      resolve.service ||
        item.debridCacheStatus?.providerId ||
        item.raw?.debridCacheStatus?.providerId ||
        ""
    ),
    String(locator),
    String(resolve.fileIdx ?? item.fileIdx ?? item.raw?.fileIdx ?? ""),
    String(behaviorHints.filename || resolve.filename || ""),
    String(resolve.torrentName || "")
  ].join("::");
}

function streamMergeKey(item = {}) {
  const debridIdentity = streamDebridIdentity(item);
  if (debridIdentity) {
    return `debrid::${debridIdentity}`;
  }
  const locator = item.url || item.externalUrl || item.ytId || "";
  if (!locator) {
    return "";
  }
  return [
    String(item.addonName || "Addon"),
    String(locator),
    String(item.sourceType || ""),
    String(item.fileIdx ?? ""),
    String(item.behaviorHints?.filename || "")
  ].join("::");
}

function mergeStreamItem(previous = {}, next = {}) {
  const behaviorHints = {
    ...(previous.behaviorHints || {}),
    ...(next.behaviorHints || {})
  };
  return {
    ...previous,
    ...next,
    id: previous.id || next.id,
    url: next.url || previous.url || "",
    externalUrl: next.externalUrl || previous.externalUrl || null,
    ytId: next.ytId || previous.ytId || null,
    behaviorHints: Object.keys(behaviorHints).length ? behaviorHints : null,
    subtitles:
      Array.isArray(next.subtitles) && next.subtitles.length ? next.subtitles : previous.subtitles,
    sources: Array.isArray(next.sources) && next.sources.length ? next.sources : previous.sources
  };
}

function flattenStreamGroups(streamResult) {
  if (!streamResult || streamResult.status !== "success") {
    return [];
  }
  const flattened = [];
  (streamResult.data || []).forEach((group) => {
    const addonName = group.addonName || "Addon";
    (group.streams || []).forEach((stream, index) => {
      const resolve = stream.clientResolve || stream.raw?.clientResolve || {};
      const streamOrigin = {
        ...(group.streamOrigin || {}),
        ...(stream.streamOrigin || {}),
        addonId:
          stream.addonId ||
          group.addonId ||
          group.streamOrigin?.addonId ||
          stream.streamOrigin?.addonId ||
          null,
        addonBaseUrl:
          stream.addonBaseUrl ||
          group.addonBaseUrl ||
          group.streamOrigin?.addonBaseUrl ||
          stream.streamOrigin?.addonBaseUrl ||
          null,
        addonName:
          stream.addonName ||
          group.addonName ||
          group.streamOrigin?.addonName ||
          stream.streamOrigin?.addonName ||
          addonName,
        sourceProviderId:
          stream.sourceProviderId ||
          group.sourceProviderId ||
          stream.streamOrigin?.sourceProviderId ||
          group.streamOrigin?.sourceProviderId ||
          null
      };
      const entry = {
        id:
          stream.id ||
          `${addonName}-${index}-${stream.url || stream.externalUrl || stream.ytId || stream.infoHash || resolve.infoHash || resolve.magnetUri || ""}`,
        label: stream.name || stream.title || `${addonName} stream`,
        name: stream.name || null,
        title: stream.title || null,
        description: stream.description || stream.name || "",
        addonId: stream.addonId || group.addonId || null,
        addonBaseUrl: stream.addonBaseUrl || group.addonBaseUrl || null,
        addonName,
        addonLogo: group.addonLogo || stream.addonLogo || null,
        sourceProviderId:
          stream.sourceProviderId ||
          group.sourceProviderId ||
          stream.streamOrigin?.sourceProviderId ||
          group.streamOrigin?.sourceProviderId ||
          null,
        streamOrigin,
        mimeType: stream.mimeType || stream.raw?.mimeType || stream.type || stream.source || null,
        sourceType: stream.sourceType || stream.mimeType || stream.type || stream.source || "",
        url: stream.url || stream.externalUrl || "",
        ytId: stream.ytId || null,
        infoHash: stream.infoHash || null,
        fileIdx: stream.fileIdx ?? null,
        externalUrl: stream.externalUrl || null,
        behaviorHints: stream.behaviorHints || null,
        sources: Array.isArray(stream.sources) ? stream.sources : [],
        quality: stream.quality || null,
        qualityValue: Number.isFinite(Number(stream.qualityValue))
          ? Number(stream.qualityValue)
          : -1,
        clientResolve: stream.clientResolve || null,
        debridCacheStatus: stream.debridCacheStatus || null,
        subtitles: Array.isArray(stream.subtitles) ? stream.subtitles : [],
        addonOrderIndex: Number.isFinite(Number(stream.addonOrderIndex))
          ? Number(stream.addonOrderIndex)
          : Number(group.addonOrderIndex ?? Number.MAX_SAFE_INTEGER),
        raw: stream
      };
      if (DirectDebridResolver.shouldListStream(entry)) {
        flattened.push(entry);
      }
    });
  });
  return flattened;
}

function mergeStreamItems(existing = [], incoming = []) {
  const order = [];
  const byKey = new Map();
  const push = (item) => {
    const key = streamMergeKey(item);
    if (!key) {
      return;
    }
    if (!byKey.has(key)) {
      order.push(key);
      byKey.set(key, item);
      return;
    }
    byKey.set(key, mergeStreamItem(byKey.get(key), item));
  };
  (existing || []).forEach(push);
  (incoming || []).forEach(push);
  return order.map((key) => byKey.get(key));
}

function normalizeParentalWarnings(source) {
  const severityRank = {
    severe: 0,
    moderate: 1,
    mild: 2,
    none: 99
  };

  if (Array.isArray(source)) {
    return source
      .map((entry) => ({
        label: String(entry?.label || "").trim(),
        severity: String(entry?.severity || "").trim()
      }))
      .filter((entry) => entry.label && entry.severity)
      .filter((entry) => entry.severity.toLowerCase() !== "none")
      .sort((left, right) => {
        const leftRank = severityRank[left.severity.toLowerCase()] ?? 50;
        const rightRank = severityRank[right.severity.toLowerCase()] ?? 50;
        return leftRank - rightRank;
      })
      .slice(0, 5);
  }

  const guide = source && typeof source === "object" ? source : null;
  if (!guide) {
    return [];
  }

  const labels = {
    nudity: "Nudity",
    violence: "Violence",
    profanity: "Profanity",
    alcohol: "Alcohol/Drugs",
    frightening: "Frightening"
  };

  return Object.entries(labels)
    .map(([key, label]) => {
      const severity = String(guide[key] || "").trim();
      if (!severity || severity.toLowerCase() === "none") {
        return null;
      }
      return { label, severity };
    })
    .filter(Boolean)
    .sort((left, right) => {
      const leftRank = severityRank[left.severity.toLowerCase()] ?? 50;
      const rightRank = severityRank[right.severity.toLowerCase()] ?? 50;
      return leftRank - rightRank;
    })
    .slice(0, 5);
}

function buildLocalizedParentalWarnings(guide = {}) {
  const labels = {
    nudity: t("parental_nudity", {}, "Nudity"),
    violence: t("parental_violence", {}, "Violence"),
    profanity: t("parental_profanity", {}, "Profanity"),
    alcohol: t("parental_alcohol", {}, "Alcohol/Drugs"),
    frightening: t("parental_frightening", {}, "Frightening")
  };
  const severityLabels = {
    severe: t("parental_severity_severe", {}, "Severe"),
    moderate: t("parental_severity_moderate", {}, "Moderate"),
    mild: t("parental_severity_mild", {}, "Mild")
  };
  const severityRank = {
    severe: 0,
    moderate: 1,
    mild: 2
  };
  return Object.entries(labels)
    .map(([key, label]) => ({
      label,
      severityKey: String(guide?.[key] || "")
        .trim()
        .toLowerCase()
    }))
    .filter((entry) => entry.severityKey && entry.severityKey !== "none")
    .sort(
      (left, right) =>
        (severityRank[left.severityKey] ?? 50) - (severityRank[right.severityKey] ?? 50)
    )
    .map((entry) => ({
      label: entry.label,
      severity: severityLabels[entry.severityKey] || entry.severityKey
    }))
    .slice(0, 5);
}

function normalizePlayableImdbId(value = "") {
  const candidate = String(value || "")
    .trim()
    .split(":")[0];
  return /^tt\d+$/i.test(candidate) ? candidate : "";
}

function normalizePlayableTmdbId(value = "") {
  const raw = String(value || "").trim();
  if (!raw || /^tt\d+$/i.test(raw)) {
    return 0;
  }
  const numeric = raw.replace(/^tmdb:/i, "").split(":")[0];
  return /^\d+$/.test(numeric) ? Number(numeric) : 0;
}

function normalizePlayableTraktId(value = "") {
  const raw = String(value || "").trim();
  const numeric = raw.replace(/^trakt:/i, "").split(":")[0];
  return /^\d+$/.test(numeric) ? Number(numeric) : 0;
}

function buildSkipIntervalLabel(interval = {}) {
  const type = String(interval?.type || "")
    .trim()
    .toLowerCase();
  if (type === "recap") {
    return t("skip_recap", {}, "Skip Recap");
  }
  if (type === "outro" || type === "ed" || type === "mixed-ed") {
    return t("skip_outro", {}, "Skip Outro");
  }
  return t("skip_intro", {}, "Skip Intro");
}

function getSkipIntervalKey(interval = null) {
  return interval ? `${interval.type}:${interval.startTime}:${interval.endTime}` : "";
}

function stripQuotes(value) {
  const text = String(value || "").trim();
  if (text.startsWith('"') && text.endsWith('"')) {
    return text.slice(1, -1);
  }
  return text;
}

function parseHlsAttributeList(value) {
  const raw = String(value || "");
  const attributes = {};
  const regex = /([A-Z0-9-]+)=("[^"]*"|[^,]*)/gi;
  let match;
  while ((match = regex.exec(raw)) !== null) {
    const key = String(match[1] || "").toUpperCase();
    const attributeValue = stripQuotes(match[2] || "");
    if (!key) {
      continue;
    }
    attributes[key] = attributeValue;
  }
  return attributes;
}

function resolveUrl(baseUrl, maybeRelativeUrl) {
  try {
    return new URL(String(maybeRelativeUrl || ""), String(baseUrl || "")).toString();
  } catch (_) {
    return String(maybeRelativeUrl || "");
  }
}

function uniqueNonEmptyValues(values = []) {
  const seen = new Set();
  const unique = [];
  (values || []).forEach((value) => {
    const normalized = String(value || "").trim();
    if (!normalized || seen.has(normalized)) {
      return;
    }
    seen.add(normalized);
    unique.push(normalized);
  });
  return unique;
}

export const PlayerScreen = {
  ...BrowserOfflineDownloadOptions,
  ...BrowserPlayerPresentationScreen,
  async mount(params = {}) {
    this.container = document.getElementById("player");
    this.unbindDesktopPlayerPointerBridge();
    this.container.style.display = "block";
    const mountToken = Number(this.playerMountToken || 0) + 1;
    this.playerMountToken = mountToken;
    this._nextEpisodeProbeResults = new Map();
    this._playerListProbeResults = new Map();
    this._playerListProbePending = new Set();
    this._playerListProbeFailed = new Set();
    this._fallbackAudioProber?.cancelAll();
    this._fallbackAudioProber = null;
    this._playerListProber = null;
    this._playerRelayAvailability = null;
    this.desktopLastAudibleVolume = null;
    this.desktopMuteRestoreVolume = null;
    this.playerRouteActive = true;
    this.params = params;
    this._selectedSourceAbort?.abort();
    this._selectedSourceProber?.cancelAll();
    this._selectedSourceAbort = null;
    this._startupSourceFailures = new Set();
    this._startupSourceAdvancing = false;
    this._preparingSelectedSource = false;
    this._startupDiscoveryCompleted = false;
    this._processingUnavailable = false;

    if (
      params.sourceProbe &&
      (params.streamCandidates || []).some(
        (stream) => playerStreamProbeKey(stream) === params.sourceProbeKey
      )
    )
      this._playerListProbeResults.set(params.sourceProbeKey, params.sourceProbe);
    this.browserToolbarPage = 0;
    this.desktopVolumeReadOnly = true;
    this.desktopVolumeCapabilityVideo = null;
    this.desktopVolumeWriteRevision = Number(this.desktopVolumeWriteRevision || 0) + 1;
    this.subtitleKeyboardNavigation = false;
    this.offlineObjectUrl = Environment.isBrowser() ? String(params.offlineObjectUrl || "") : "";
    this.offlineDownloadId = Environment.isBrowser() ? String(params.offlineDownloadId || "") : "";
    this.offlinePlayerDownloads = [];
    this.offlinePlayerArtworkUrls = new Set();
    this.offlinePlayerLibraryLoaded = false;
    this.trackPreferenceContentId = this.getTrackPreferenceContentId();
    this.rememberedAudioTrackPreference = TrackPreferencesStore.getAudio(
      this.trackPreferenceContentId
    );
    this.contentLanguage = resolveRouteContentLanguage(params);
    this.externalFrameUrl = String(params.externalFrameUrl || "").trim();
    this.aspectModes = [
      { objectFit: "contain", label: t("player_aspect_fit", {}, "Fit") },
      { objectFit: "cover", label: t("player_aspect_fill", {}, "Fill") },
      { objectFit: "fill", label: t("player_aspect_stretch", {}, "Stretch") }
    ];

    this.hasPrecomputedStreamCandidates = Boolean(
      Array.isArray(params.streamCandidates) && params.streamCandidates.length
    );
    this.streamCandidates = this.normalizeStreamCandidates(
      Array.isArray(params.streamCandidates) ? params.streamCandidates : []
    );
    const preferredStreamId = String(params?.preferredStreamId || "").trim();
    const preferredStreamCandidate = preferredStreamId
      ? this.streamCandidates.find((stream) => String(stream?.id || "") === preferredStreamId) ||
        null
      : null;
    const initialStreamCandidate =
      preferredStreamCandidate || this.selectBestStreamCandidate(this.streamCandidates);
    const initialStreamLocator =
      params.streamUrl ||
      initialStreamCandidate?.url ||
      initialStreamCandidate?.externalUrl ||
      null;
    const initialStreamUrl =
      directPlaybackUrl(params.streamUrl) || streamDirectPlaybackUrl(initialStreamCandidate);
    if (!this.streamCandidates.length && initialStreamLocator) {
      this.streamCandidates = this.normalizeStreamCandidates([
        {
          url: initialStreamLocator,
          title: "Current source",
          addonName: "Current"
        }
      ]);
    }

    this.currentStreamIndex = this.streamCandidates.findIndex(
      (stream) =>
        (preferredStreamCandidate &&
          String(stream?.id || "") === String(preferredStreamCandidate.id || "")) ||
        stream.url === initialStreamLocator ||
        stream.externalUrl === initialStreamLocator ||
        (initialStreamUrl && streamDirectPlaybackUrl(stream) === initialStreamUrl)
    );
    if (this.currentStreamIndex < 0) {
      this.currentStreamIndex = 0;
    }
    this.activePlaybackSourceContext =
      this.getPlaybackSourceContext(
        preferredStreamCandidate ||
          initialStreamCandidate ||
          this.streamCandidates[this.currentStreamIndex] ||
          null
      ) ||
      this.normalizePlaybackSourceContext(
        params.playbackSourceContext || params.sourceContext || null
      );

    this.subtitles = [];
    this.remoteSubtitleCandidates = [];
    this.offlineSubtitleObjectUrls = [];
    this.offlineSubtitleTracks = [];
    this.nextEpisodeTransitionMeta = null;
    this.subtitleDialogVisible = false;
    this.subtitleDialogTab = "builtIn";
    this.subtitleDialogIndex = 0;
    this.subtitleLanguageRailIndex = 0;
    this.subtitleOptionRailIndex = 0;
    this.subtitleStyleRailIndex = 0;
    this.subtitleStyleControlSide = "minus";
    this.subtitleFocusedRail = "language";
    this.subtitleDialogScrollMode = "nearest";
    this.subtitleDialogScrollTimer = null;
    this.cancelSubtitlePointerScrollTransaction?.();
    this.subtitlePointerScrollTransaction = null;
    this.selectedSubtitleTrackIndex = -1;
    this.selectedAddonSubtitleId = null;
    this.subtitleExplicitlyOff = false;
    this.subtitleLayoutDiagnosticKeys = new Set();
    this.startupSubtitlePreferenceApplied = false;
    this.startupSubtitlePreferenceApplying = false;
    this.startupAudioPreferenceApplied = false;
    this.startupAudioPreferenceApplying = false;
    this.startupAudioFallbackApplied = false;
    this.startupAudioTrackSetSignature = "";
    this.startupAudioPreferenceRetryTimer = null;
    this.startupAudioPreferenceRetryDeadline = 0;
    this.startupTrackPreferenceReady = false;
    this.trackDialogCache = createTrackDialogCache();
    this.builtInSubtitleCount = 0;
    this.externalTrackNodes = [];
    this.externalSubtitleObjectUrls = [];
    this.htmlSubtitleCues = [];
    this.htmlSubtitleRenderFrame = null;
    this.htmlSubtitleRenderTimer = null;
    this.htmlSubtitleActiveCueKey = "";
    this.htmlSubtitleSelectedId = null;
    this.subtitleCueStyleBindings = new Map();
    this.subtitleCueOriginalState = new WeakMap();

    this.audioDialogVisible = false;
    this.audioDialogIndex = 0;
    this.audioMixFocusIndex = 0;
    this.audioFocusedColumn = "tracks";
    this.selectedAudioTrackIndex = -1;
    this.audioFallbackApplying = false;
    this.failedAutomaticAudioFallbackEntryId = "";

    this.sourcesPanelVisible = false;
    this.sourcesLoading = false;
    this.sourcesError = "";
    this.sourceFilter = "all";
    this.sourcesFocus = { zone: "filter", index: 0 };
    this.sourceLoadToken = 0;
    this.completedSourceRequestKey = "";
    this.streamCandidatesByVideoId = new Map();
    this.streamCandidatesLoadPromises = new Map();

    this.aspectModeIndex = 0;
    this.aspectToastTimer = null;
    this.speedDialogVisible = false;
    this.speedDialogIndex = Math.max(0, PLAYER_SPEEDS.indexOf(1));

    this.episodes = Array.isArray(params.episodes) ? params.episodes : [];
    this.updateBrowserDocumentTitle();
    this.episodePanelVisible = false;
    const explicitEpisodeIndex = this.episodes.findIndex((entry) => entry.id === params.videoId);
    const fallbackEpisodeIndex = this.episodes.findIndex((entry) => {
      const seasonMatch = params.season == null || Number(entry?.season) === Number(params.season);
      const episodeMatch =
        params.episode == null || Number(entry?.episode) === Number(params.episode);
      return seasonMatch && episodeMatch;
    });
    this.episodePanelIndex = Math.max(
      0,
      explicitEpisodeIndex >= 0 ? explicitEpisodeIndex : fallbackEpisodeIndex
    );
    this.episodePanelFocusZone = "episodes";
    this.episodePanelSeason = null;
    this.episodePanelSeasonIndex = 0;
    this.episodePanelMode = "episodes";
    this.episodePanelStreams = [];
    this.episodePanelStreamsLoading = false;
    this.episodePanelStreamsError = "";
    this.episodePanelStreamFilter = "all";
    this.episodePanelStreamFocus = { zone: "actions", index: 0 };
    this.episodePanelStreamVideoId = "";
    this.episodePanelStreamLoadToken = 0;
    this.episodePanelExitTimer = null;
    this.switchingEpisode = false;

    this.seekOverlayVisible = false;
    this.seekPreviewSeconds = null;
    this.seekPreviewDirection = 0;
    this.seekRepeatCount = 0;
    this.seekCommitTimer = null;
    this.seekOverlayTimer = null;
    this.seekOverlaySuppressControlsUntil = 0;
    this.pauseOverlayVisible = false;
    this.pauseOverlayTimer = null;
    this.pauseOverlayDelayMs = PAUSE_OVERLAY_DELAY_MS;
    this.pauseOverlayMetaRequestToken = Number(this.pauseOverlayMetaRequestToken || 0);
    this.pauseOverlayMeta = null;
    this.nextEpisodeLaunching = false;
    this.nextEpisodeLaunchToken = Number(this.nextEpisodeLaunchToken || 0) + 1;
    this.nextEpisodeCardTriggered = false;
    this.nextEpisodeCardSearching = false;
    this.nextEpisodeCardSourceName = "";
    this.nextEpisodeCardCountdownSec = null;
    this.nextEpisodeAutoplayAttemptedKey = "";
    this.consecutiveAutoPlayCount = Math.max(
      0,
      Math.trunc(Number(params.consecutiveAutoPlayCount || 0) || 0)
    );
    this.stillWatchingPromptVisible = false;
    this.stillWatchingPromptCountdownSec = 0;
    this.stillWatchingPromptTimer = null;
    this.stillWatchingPromptFocusArmed = false;
    this.stillWatchingPromptFocus = "continue";
    this.playerBackNavigationInProgress = false;
    this.nextEpisodeCardDismissed = false;
    this.nextEpisodeBackExitArmed = false;

    this.parentalWarnings = normalizeParentalWarnings(
      params.parentalWarnings || params.parentalGuide
    );
    this.parentalGuideVisible = false;
    this.parentalGuideExiting = false;
    this.parentalGuideShown = false;
    this.parentalGuideTimer = null;
    this.parentalGuideExitTimer = null;
    this.parentalGuideLineEnterTimer = null;
    this.parentalGuideLineExitTimer = null;
    this.parentalGuideLineAnimationFrame = null;
    this.parentalGuideLineProgress = 0;
    this.skipIntervals = [];
    this.activeSkipInterval = null;
    this.skipIntervalDismissed = false;
    this.skipIntroAutoHidden = false;
    this.skipIntroCountdownProgress = 0;
    this.skipIntroCountdownLastTickAt = 0;
    this.skipIntroCountdownStartAt = 0;
    this.skipIntroAnimationFrame = null;
    this.skipIntroFocusFrame = null;
    this.skipIntroRenderedKey = "";
    this.skipIntroSuppressedKey = "";
    this.skipIntroSuppressedUntil = 0;
    this.lastActionOverlayBottomPx = null;
    this.subtitleSelectionTimer = null;
    this.subtitleSelectionToken = 0;
    this.subtitleLoadToken = 0;
    this.subtitleLoading = false;
    this.manifestLoadToken = 0;
    this.manifestLoading = false;
    this.manifestAudioTracks = [];
    this.manifestSubtitleTracks = [];
    this.manifestVariants = [];
    this.manifestMasterUrl = "";
    this.selectedManifestAudioTrackId = null;
    this.selectedManifestSubtitleTrackId = null;
    this.hlsManifestSubtitlePromotionUrls = new Set();
    this.activePlaybackUrl = initialStreamUrl || null;
    // A relay has nothing to serve until it has copied the film. When the list knows a
    // source is relayed, it hands over a status URL for that exact source, and the
    // player waits for it here instead of letting an eighteen-second stall guard turn
    // a working relay into "Playback error".
    this.relayPrepareUrl = String(params?.relayPrepare || "").trim();
    this.relayPlaybackUrl = String(params?.relayPlaybackUrl || "").trim();
    this.relayPrepareDone = false;
    this.resetPictureInPictureAvailability();
    this.pendingPlaybackRestore = buildPendingPlaybackRestore(params);
    this.trackDiscoveryToken = 0;
    this.trackDiscoveryInProgress = false;
    this.trackDiscoveryTimer = null;
    this.trackDiscoveryStartedAt = 0;
    this.trackDiscoveryDeadline = 0;
    this.lastTrackWarmupAt = 0;
    this.silentAudioFallbackAttempts = new Set();
    this.silentAudioFallbackCount = 0;
    this.maxSilentAudioFallbackCount = 1;
    this.lastPlaybackErrorAt = 0;
    this.failedPlaybackUrls = new Set();
    this.failedPlaybackStreamIds = new Set();
    this.playbackStallTimer = null;
    this.startupReadiness = null;
    this.lastPlaybackProgressAt = Date.now();
    this.playbackTransitionLightweight = false;
    this.directAudioPreferenceState = null;
    this.pendingAutomaticDirectAudio = null;
    this.directAudioSwitching = null;
    this.hasPresentedPlaybackFrame = false;
    this.startupErrorMessage = "";
    this.startupErrorMediaCode = 0;
    this.startupErrorDetails = [];
    this.startupPlaybackBaselineSeconds = null;
    this.startupPlaybackHasAdvanced = false;
    this.paused = false;
    this.controlsVisible = true;
    this.loadingVisible = true;
    this.loadingProgress = null;
    this.loadingLogoFillActive = false;
    this.loadingLogoFillProgress = 0;
    this.loadingLogoFillTarget = 0;
    this.loadingLogoFillFrame = null;
    this.loadingProgressRefreshInFlight = false;
    this.seekLoading = false;
    this.seekLoadingBaselineSeconds = null;
    this.seekLoadingTargetSeconds = null;
    this.startupAudioGateActive = false;
    this.startupAudioGateAllowsPlayback = false;
    this.startupAudioGateDeadline = 0;
    this.loadingCompletionTimer = null;
    this.loadingCompletionToken = 0;
    this.bufferingSpinnerTimer = null;
    this.bufferingSpinnerBaselineSeconds = null;
    this.moreActionsVisible = false;
    this.playbackInfoVisible = false;
    this.controlFocusZone = "buttons";
    this.stickyProgressFocus = false;
    this.autoHideControlsAfterSeek = false;
    this.controlFocusIndex = 0;
    this.controlsHideTimer = null;
    this.desktopProgressPointer = null;
    this.desktopSuppressProgressClick = false;
    this.desktopProgressClickSuppressTimer = null;
    this.tickTimer = null;
    this.skipIntervalCheckTimer = null;
    this.skipIntervalsRequestToken = Number(this.skipIntervalsRequestToken || 0);
    this.videoListeners = [];
    this.mediaSessionHandlersBound = false;
    this.mediaSessionActions = [];

    const playerSettings = PlayerSettingsStore.get();
    this.subtitleRenderMode = normalizeSubtitleRenderMode(playerSettings.subtitleRenderMode);
    this.subtitleDelayMs = 0;
    this.subtitleStyleSettings = {
      ...playerSettings.subtitleStyle,
      preferredLanguage: extractSubtitleLanguageSetting(
        playerSettings.subtitleStyle?.preferredLanguage || playerSettings.subtitleLanguage || "off"
      ),
      secondaryPreferredLanguage: extractSubtitleLanguageSetting(
        playerSettings.subtitleStyle?.secondaryPreferredLanguage ||
          playerSettings.secondarySubtitleLanguage ||
          "off"
      )
    };
    this.audioAmplificationDb = clamp(
      Number(playerSettings.audioAmplificationDb || 0),
      AUDIO_AMPLIFICATION_MIN_DB,
      AUDIO_AMPLIFICATION_MAX_DB
    );
    this.persistAudioAmplification = Boolean(playerSettings.persistAudioAmplification);
    this.audioAmplificationAvailable =
      supportsWebAudioAmplification() &&
      typeof (globalThis.AudioContext || globalThis.webkitAudioContext) === "function";
    this.audioContext = null;
    this.audioGainNode = null;
    this.audioMediaSource = null;

    this.renderPlayerUi();
    if (this.offlineDownloadId) void this.loadOfflinePlayerLibrary();
    this.bindDesktopPlayerPointerBridge();
    this.pauseOverlayMeta = this.buildPauseOverlayMeta();
    if (!this.isExternalFrameMode()) {
      this.bindVideoEvents();
      this.bindMediaSessionHandlers();
      this.applyAudioAmplification();
      this.applySubtitlePresentationSettings();
      void this.fetchParentalGuide();
      void this.fetchSkipIntervals();
      void this.hydratePauseOverlayMeta();
    }
    this.renderEpisodePanel();
    this.applyAspectMode({ showToast: false });
    if (!this.isExternalFrameMode()) {
      this.updateUiTick();
    }

    if (params.prepareSelectedSource && !this.isExternalFrameMode()) {
      const sourceCandidate = initialStreamCandidate || this.getCurrentStreamCandidate();
      if (sourceCandidate)
        void this.playStreamCandidate(sourceCandidate, {
          preservePendingRestore: true,
          mountToken
        });
    } else if (initialStreamUrl && !this.isExternalFrameMode()) {
      const sourceCandidate =
        this.getStreamCandidateByUrl(initialStreamUrl) || this.getCurrentStreamCandidate();
      this.activePlaybackUrl = initialStreamUrl;
      this.resetPictureInPictureAvailability();
      const allowPlaybackDuringStartupAudioGate = shouldAllowPlaybackDuringStartupAudioGate({
        isHlsPlayback: this.isCurrentSourceLikelyHls(initialStreamUrl, sourceCandidate),
        isClientRemuxPlayback:
          this.params?.playbackPlan?.route === "client" &&
          this.params.playbackPlan.sourceUrl === initialStreamUrl
      });
      this.enableStartupAudioGate({
        allowPlayback: allowPlaybackDuringStartupAudioGate
      });
      void this.startPlayerControllerPlayback(
        this.activePlaybackUrl,
        this.buildPlaybackContext(sourceCandidate),
        { mountToken, sourceCandidate }
      );
      this.loadManifestTrackDataForCurrentStream(this.activePlaybackUrl);
      this.startTrackDiscoveryWindow({ durationMs: 7000 });
      this.schedulePlaybackStallGuard();
    } else if (!this.isExternalFrameMode()) {
      const sourceCandidate = initialStreamCandidate || this.getCurrentStreamCandidate();
      if (sourceCandidate && DirectDebridResolver.canResolveStream(sourceCandidate)) {
        void this.playStreamCandidate(sourceCandidate, {
          preservePendingRestore: true,
          mountToken
        });
      }
    }

    if (!this.isExternalFrameMode()) {
      this.loadSubtitles();
      this.syncTrackState();
      this.tickTimer = setInterval(() => this.updateUiTick(), 1000);
      this.startSkipIntervalCheckTimer();
      this.bindPlayerEndedHandler();
      this.setControlsVisible(true, { focus: true });
    } else {
      this.loadingVisible = false;
      this.updateLoadingVisibility();
      this.setControlsVisible(false);
    }
  },

  isExternalFrameMode() {
    return Boolean(this.externalFrameUrl);
  },

  updateBrowserDocumentTitle() {
    const episodeEntry = this.resolvePauseOverlayEpisodeEntry(this.episodes || []);
    const enrichedMeta = this.pauseOverlayMeta || {};
    setBrowserMediaTitle({
      title:
        this.params?.playerTitle ||
        this.params?.itemTitle ||
        this.params?.title ||
        enrichedMeta.title ||
        "",
      year:
        this.params?.playerReleaseYear ||
        this.params?.releaseYear ||
        this.params?.year ||
        enrichedMeta.releaseYear ||
        "",
      season: this.params?.season ?? episodeEntry?.season ?? enrichedMeta.season ?? null,
      episode: this.params?.episode ?? episodeEntry?.episode ?? enrichedMeta.episode ?? null,
      episodeTitle:
        this.params?.playerEpisodeTitle ||
        this.params?.episodeTitle ||
        episodeEntry?.title ||
        enrichedMeta.episodeTitle ||
        ""
    });
  },

  isActiveMountToken(mountToken = null) {
    if (!this.playerRouteActive) {
      return false;
    }
    if (mountToken !== null && Number(mountToken) !== Number(this.playerMountToken || 0)) {
      return false;
    }
    return Boolean(this.container);
  },

  resolvePlaybackMediaSourceType(streamCandidate = this.getCurrentStreamCandidate()) {
    const normalizeSourceType =
      typeof PlayerController.normalizePlaybackSourceType === "function"
        ? PlayerController.normalizePlaybackSourceType.bind(PlayerController)
        : (value) => (String(value || "").includes("/") ? String(value || "").trim() : null);

    const declaredTypes = [
      streamCandidate?.raw?.mimeType,
      streamCandidate?.mimeType,
      streamCandidate?.sampleMimeType,
      streamCandidate?.sourceType,
      streamCandidate?.raw?.sourceType,
      streamCandidate?.raw?.type
    ];
    for (const value of declaredTypes) {
      const normalized = normalizeSourceType(value);
      if (normalized) {
        return normalized;
      }
    }

    const filenameHints = [
      streamCandidate?.behaviorHints?.filename,
      streamCandidate?.raw?.behaviorHints?.filename,
      streamCandidate?.raw?.filename
    ];
    for (const value of filenameHints) {
      const guessed =
        typeof PlayerController.guessMediaMimeType === "function"
          ? PlayerController.guessMediaMimeType(String(value || ""))
          : null;
      if (guessed) {
        return guessed;
      }
    }
    return null;
  },

  buildPlaybackContext(streamCandidate = this.getCurrentStreamCandidate()) {
    const requestHeaders = this.getCurrentStreamRequestHeaders(streamCandidate);
    const mediaSourceType = this.resolvePlaybackMediaSourceType(streamCandidate);
    return {
      itemId: this.params.itemId || null,
      itemType: normalizeItemType(this.params.itemType || "movie"),
      videoId: this.params.videoId || null,
      season: this.params.season == null ? null : Number(this.params.season),
      episode: this.params.episode == null ? null : Number(this.params.episode),
      title: this.params.playerTitle || this.params.itemTitle || null,
      poster: this.params.poster || null,
      background:
        this.params.playerBackdropUrl || this.params.backdrop || this.params.poster || null,
      logo: this.params.playerLogoUrl || this.params.logo || null,
      episodeTitle: this.params.episodeTitle || this.params.playerSubtitle || null,
      requestHeaders,
      mediaSourceType,
      streamIdentity: streamCandidate
        ? buildStreamResumeIdentity(streamCandidate) || streamMergeKey(streamCandidate) || null
        : null,
      playbackPlan:
        this.params?.playbackPlan?.sourceUrl === (streamCandidate?.url || this.activePlaybackUrl)
          ? this.params.playbackPlan
          : null,
      offlinePlayback: Boolean(this.offlineDownloadId)
    };
  },

  rememberSelectedStreamPreference(streamCandidate) {
    const prefContentId = String(this.params?.itemId || "").trim();
    const prefVideoId = String(this.params?.videoId || this.params?.itemId || "").trim();
    if (this.offlineDownloadId || !streamCandidate?.id || !prefContentId) {
      return;
    }
    StreamPreferencesStore.set(prefContentId, prefVideoId, streamCandidate.id, {
      playbackConfirmed: true,
      bingeGroup:
        streamCandidate?.behaviorHints?.bingeGroup ||
        streamCandidate?.raw?.behaviorHints?.bingeGroup ||
        "",
      resumeIdentity: buildStreamResumeIdentity(streamCandidate)
    });
  },

  buildSubtitleLookupContext() {
    const type = normalizeItemType(this.params?.itemType || "movie");
    const identity = this.buildPlaybackIdentityContext();
    const rawItemId = String(this.params?.itemId || "").trim();
    const baseItemId = rawItemId ? String(rawItemId.split(":")[0] || "").trim() : "";
    const imdbItemId = normalizePlayableImdbId(identity.imdbId);
    const id = imdbItemId || baseItemId || rawItemId || "";
    const currentStream = this.getCurrentStreamCandidate();
    const rawStream = currentStream?.raw || currentStream || {};
    const behaviorHints = {
      ...(rawStream?.behaviorHints || {}),
      ...(currentStream?.behaviorHints || {})
    };

    let videoId = null;
    if (type === "series") {
      const routeVideoId = String(this.params?.videoId || "").trim();
      const season = Number(this.params?.season);
      const episode = Number(this.params?.episode);
      // The exact episode id used by the player is authoritative, matching Android TV.
      if (routeVideoId) {
        videoId = routeVideoId;
      } else if (
        id &&
        Number.isFinite(season) &&
        season > 0 &&
        Number.isFinite(episode) &&
        episode > 0
      ) {
        videoId = `${id}:${season}:${episode}`;
      }
    }

    return {
      type,
      id,
      videoId,
      season: this.params?.season ?? null,
      episode: this.params?.episode ?? null,
      title: this.params?.playerTitle || this.params?.itemTitle || null,
      year: this.params?.playerReleaseYear || this.params?.year || null,
      videoHash:
        behaviorHints.videoHash ||
        currentStream?.videoHash ||
        rawStream.videoHash ||
        this.params?.videoHash ||
        null,
      videoSize:
        behaviorHints.videoSize ||
        currentStream?.videoSize ||
        rawStream.videoSize ||
        this.params?.videoSize ||
        null,
      filename:
        behaviorHints.filename ||
        currentStream?.filename ||
        rawStream.filename ||
        this.params?.filename ||
        null
    };
  },

  buildPlaybackIdentityContext() {
    const itemType = normalizeItemType(this.params?.itemType || "movie");
    const rawImdbId = String(this.params?.imdbId || this.params?.imdb_id || "").trim();
    const rawItemId = String(this.params?.itemId || "").trim();
    const rawVideoId = String(this.params?.videoId || "").trim();
    const seasonRaw = this.params?.season;
    const season = Number(seasonRaw);
    const episode = Number(this.params?.episode || 0);
    const imdbId =
      [
        normalizePlayableImdbId(rawImdbId),
        normalizePlayableImdbId(rawVideoId),
        normalizePlayableImdbId(rawItemId)
      ].find(Boolean) || "";
    const tmdbId =
      [
        normalizePlayableTmdbId(this.params?.tmdbId || this.params?.tmdb_id),
        normalizePlayableTmdbId(rawItemId),
        normalizePlayableTmdbId(rawVideoId)
      ].find(Boolean) || 0;
    const traktId =
      [
        normalizePlayableTraktId(this.params?.traktId || this.params?.trakt_id),
        normalizePlayableTraktId(rawItemId),
        normalizePlayableTraktId(rawVideoId)
      ].find(Boolean) || 0;
    return {
      itemType,
      imdbId,
      tmdbId,
      traktId,
      season: seasonRaw != null && Number.isFinite(season) && season >= 0 ? season : null,
      episode: Number.isFinite(episode) && episode > 0 ? episode : null
    };
  },

  getTrackPreferenceContentId() {
    const identity = this.buildPlaybackIdentityContext();
    const itemId = String(this.params?.itemId || "").trim();
    if (itemId) {
      return itemId;
    }
    if (identity.imdbId) {
      return identity.imdbId;
    }
    if (identity.tmdbId) {
      return `tmdb:${identity.itemType}:${identity.tmdbId}`;
    }
    if (identity.traktId) {
      return `trakt:${identity.itemType}:${identity.traktId}`;
    }
    return "";
  },

  getAudioTrackPreference(entry = {}) {
    const track = entry?.track || {};
    const sourceTrackId = Number(track?.sourceTrackId);
    const trackId =
      [
        track?.trackId,
        Number.isFinite(sourceTrackId) && sourceTrackId >= 0 ? sourceTrackId : null,
        track?.raw?.id,
        track?.id,
        entry?.manifestAudioTrackId
      ]
        .map((value) => cleanDisplayText(value))
        .find(Boolean) || "";
    const name =
      [track?.name, track?.label, track?.title, entry?.label]
        .map((value) => cleanDisplayText(value))
        .find(Boolean) || "";
    return {
      language: inferAudioTrackLanguageKey(track, entry),
      name,
      trackId
    };
  },

  rememberAudioTrackSelection(preference = null) {
    if (!preference || !this.trackPreferenceContentId) {
      return;
    }
    TrackPreferencesStore.setAudio(this.trackPreferenceContentId, preference);
    this.rememberedAudioTrackPreference = { ...preference };
  },

  findRememberedAudioOption(preference = this.rememberedAudioTrackPreference) {
    if (!preference) {
      return null;
    }
    const options = this.collectAudioOptionItems().filter((option) => option.supported);
    const targetId = normalizeComparableText(preference.trackId || "");
    const targetName = normalizeComparableText(preference.name || "");
    const targetLanguage =
      normalizeTrackLanguageCode(preference.language || "") ||
      normalizeComparableText(preference.language || "");
    const describe = (option) => {
      const current = this.getAudioTrackPreference(option.entry);
      return {
        id: normalizeComparableText(current.trackId || ""),
        name: normalizeComparableText(current.name || ""),
        language:
          normalizeTrackLanguageCode(current.language || "") ||
          normalizeComparableText(current.language || "")
      };
    };
    const languageMatchesExactly = (current) =>
      !targetLanguage || current.language === targetLanguage;
    const nameMatches = (current) =>
      !targetName || current.name === targetName || current.name.includes(targetName);

    if (targetId) {
      const exactId = options.find((option) => {
        const current = describe(option);
        return current.id === targetId && languageMatchesExactly(current) && nameMatches(current);
      });
      if (exactId) {
        return exactId;
      }
    }

    if (targetName) {
      const exactName = options.find((option) => {
        const current = describe(option);
        return current.name === targetName && languageMatchesExactly(current);
      });
      if (exactName) {
        return exactName;
      }
      const containedName = options.find((option) => {
        const current = describe(option);
        return current.name.includes(targetName) && languageMatchesExactly(current);
      });
      if (containedName) {
        return containedName;
      }
    }

    if (!targetLanguage) {
      return null;
    }
    const exactLanguage = options.find((option) => describe(option).language === targetLanguage);
    if (exactLanguage) {
      return exactLanguage;
    }
    const targetBase = targetLanguage.split("-")[0];
    return options.find((option) => describe(option).language.split("-")[0] === targetBase) || null;
  },

  buildScrobbleContext() {
    const identity = this.buildPlaybackIdentityContext();
    const currentSec = this.getPlaybackCurrentSeconds();
    const durationSec = this.getPlaybackDurationSeconds();
    const progress = durationSec > 0 ? Math.min(100, (currentSec / durationSec) * 100) : 0;
    return {
      contentId: String(this.params?.itemId || identity.imdbId || ""),
      videoId: String(this.params?.videoId || this.params?.playerVideoId || ""),
      contentType: identity.itemType === "series" ? "series" : "movie",
      imdbId: identity.imdbId,
      tmdbId: identity.tmdbId || null,
      traktId: identity.traktId || null,
      title: String(this.params?.playerTitle || this.params?.itemTitle || this.params?.title || ""),
      year:
        Number(
          this.params?.playerReleaseYear || this.params?.releaseYear || this.params?.year || 0
        ) || null,
      seasonNumber: identity.season,
      episodeNumber: identity.episode,
      episodeTitle: String(
        this.params?.playerEpisodeTitle ||
          this.params?.episodeTitle ||
          this.params?.playerSubtitle ||
          ""
      ),
      positionMs: Math.round(currentSec * 1000),
      durationMs: Math.round(durationSec * 1000),
      progressPercent: progress
    };
  },

  maybeShowParentalGuideOverlay() {
    if (
      PlayerSettingsStore.get().parentalGuideEnabled === false ||
      this.parentalGuideShown ||
      !this.parentalWarnings.length ||
      this.paused ||
      this.loadingVisible ||
      this.startupAudioGateActive ||
      !this.hasPresentedPlaybackFrame
    ) {
      return;
    }
    this.showParentalGuideOverlay();
  },

  async fetchParentalGuide() {
    const { itemType, imdbId, season, episode } = this.buildPlaybackIdentityContext();
    if (!imdbId) {
      return;
    }
    const response =
      (itemType === "series" || itemType === "tv") && season && episode
        ? await parentalGuideRepository.getTvGuide(imdbId, season, episode)
        : await parentalGuideRepository.getMovieGuide(imdbId);
    const warnings = buildLocalizedParentalWarnings(response?.parentalGuide || {});
    if (!warnings.length) {
      return;
    }
    if (JSON.stringify(this.parentalWarnings || []) === JSON.stringify(warnings)) {
      return;
    }
    const hasAlreadyShown = Boolean(this.parentalGuideShown);
    this.parentalWarnings = warnings;
    if (!hasAlreadyShown) {
      this.parentalGuideShown = false;
    }
    this.renderParentalGuideOverlay();
    if (!hasAlreadyShown) {
      this.maybeShowParentalGuideOverlay();
    }
  },

  async fetchSkipIntervals() {
    const requestToken = (this.skipIntervalsRequestToken || 0) + 1;
    this.skipIntervalsRequestToken = requestToken;
    if (!PlayerSettingsStore.get().skipIntroEnabled) {
      this.skipIntervals = [];
      this.activeSkipInterval = null;
      this.skipIntervalDismissed = false;
      this.skipIntroAutoHidden = false;
      this.skipIntroCountdownProgress = 0;
      this.skipIntroCountdownLastTickAt = Date.now();
      this.skipIntroCountdownStartAt = 0;
      this.skipIntroSuppressedKey = "";
      this.skipIntroSuppressedUntil = 0;
      this.stopSkipIntroCountdownAnimation();
      this.renderSkipIntroButton();
      return;
    }
    const { imdbId, season, episode } = this.buildPlaybackIdentityContext();
    if (!imdbId || !season || !episode) {
      this.skipIntervals = [];
      this.activeSkipInterval = null;
      this.skipIntervalDismissed = false;
      this.skipIntroAutoHidden = false;
      this.skipIntroCountdownProgress = 0;
      this.skipIntroCountdownLastTickAt = Date.now();
      this.skipIntroCountdownStartAt = 0;
      this.skipIntroSuppressedKey = "";
      this.skipIntroSuppressedUntil = 0;
      this.stopSkipIntroCountdownAnimation();
      this.renderSkipIntroButton();
      return;
    }
    const intervals = await skipIntroRepository.getSkipIntervals(imdbId, season, episode);
    if (this.skipIntervalsRequestToken !== requestToken) {
      return;
    }
    this.skipIntervals = Array.isArray(intervals) ? intervals : [];
    this.skipIntervalDismissed = false;
    this.skipIntroAutoHidden = false;
    this.skipIntroCountdownProgress = 0;
    this.skipIntroCountdownLastTickAt = Date.now();
    this.skipIntroCountdownStartAt = 0;
    this.skipIntroSuppressedKey = "";
    this.skipIntroSuppressedUntil = 0;
    this.stopSkipIntroCountdownAnimation();
    this.updateActiveSkipInterval(this.getPlaybackCurrentSeconds());
  },

  updateActiveSkipInterval(currentTime = this.getPlaybackCurrentSeconds()) {
    if (!PlayerSettingsStore.get().skipIntroEnabled) {
      if (this.activeSkipInterval != null) {
        this.activeSkipInterval = null;
      }
      return;
    }
    const previous = this.activeSkipInterval;
    let active =
      (Array.isArray(this.skipIntervals) ? this.skipIntervals : []).find((interval) => {
        const start = Number(interval?.startTime);
        const end = Number(interval?.endTime);
        return (
          Number.isFinite(start) &&
          Number.isFinite(end) &&
          currentTime >= start &&
          currentTime < end - 0.5
        );
      }) || null;
    const candidateKey = getSkipIntervalKey(active);
    const suppressedKey = String(this.skipIntroSuppressedKey || "");
    const suppressionActive =
      suppressedKey && Date.now() < Number(this.skipIntroSuppressedUntil || 0);
    if (suppressedKey && !suppressionActive) {
      this.skipIntroSuppressedKey = "";
      this.skipIntroSuppressedUntil = 0;
    } else if (suppressionActive && candidateKey === suppressedKey) {
      // TV playback engines can briefly report the pre-seek position while a
      // skip seek settles. Keep the skipped interval hidden through that churn.
      active = null;
    }
    const previousKey = getSkipIntervalKey(previous);
    const nextKey = getSkipIntervalKey(active);
    if (previousKey !== nextKey) {
      this.skipIntervalDismissed = false;
      this.skipIntroAutoHidden = false;
      this.skipIntroCountdownProgress = 0;
      this.skipIntroCountdownLastTickAt = Date.now();
      this.skipIntroCountdownStartAt = 0;
      this.stopSkipIntroCountdownAnimation();
    }
    this.activeSkipInterval = active;
    if (previousKey !== nextKey) {
      const intervalType = String(active?.type || "")
        .trim()
        .toLowerCase();
      const autoSkipType = ["outro", "ed", "mixed-ed"].includes(intervalType)
        ? "outro"
        : intervalType === "recap"
          ? "recap"
          : "intro";
      if (active && PlayerSettingsStore.get().autoSkipSegmentTypes?.includes(autoSkipType)) {
        this.skipActiveInterval();
        return;
      }
      this.renderSkipIntroButton();
      this.updateSkipIntroCountdown(Date.now());
    }
  },

  getSkipIntervalProgress(
    interval = this.activeSkipInterval,
    currentTime = this.getPlaybackCurrentSeconds()
  ) {
    if (!interval) {
      return 0;
    }
    const start = Number(interval.startTime);
    const end = Number(interval.endTime);
    const current = Number(currentTime);
    if (
      !Number.isFinite(start) ||
      !Number.isFinite(end) ||
      end <= start ||
      !Number.isFinite(current)
    ) {
      return 0;
    }
    return clamp((current - start) / (end - start), 0, 1);
  },

  isSkipIntroPlaybackReady() {
    return Boolean(this.hasPresentedPlaybackFrame && !this.loadingVisible);
  },

  stopSkipIntroCountdownAnimation() {
    if (this.skipIntroAnimationFrame != null && typeof cancelAnimationFrame === "function") {
      cancelAnimationFrame(this.skipIntroAnimationFrame);
    }
    this.skipIntroAnimationFrame = null;
    this.skipIntroCountdownStartAt = 0;
  },

  updateSkipIntroCountdown(now = Date.now()) {
    const playbackReady = this.isSkipIntroPlaybackReady();
    const shouldTrack =
      Boolean(this.activeSkipInterval) && playbackReady && !this.skipIntervalDismissed;
    if (!shouldTrack) {
      this.stopSkipIntroCountdownAnimation();
      this.skipIntroAutoHidden = false;
      this.skipIntroCountdownProgress = 0;
      this.skipIntroCountdownLastTickAt = Number(now || Date.now());
      return;
    }

    if (!this.controlsVisible) {
      this.startSkipIntroCountdownAnimation();
      return;
    }

    this.stopSkipIntroCountdownAnimation();
    this.skipIntroCountdownLastTickAt = Number(now || Date.now());
  },

  startSkipIntroCountdownAnimation() {
    if (typeof requestAnimationFrame !== "function") {
      this.skipIntroCountdownProgress = clamp(this.skipIntroCountdownProgress, 0, 1);
      if (this.skipIntroCountdownProgress >= 1) {
        this.skipIntroAutoHidden = true;
      }
      this.syncSkipIntroButtonProgress();
      return;
    }

    if (
      !this.activeSkipInterval ||
      !this.isSkipIntroPlaybackReady() ||
      this.skipIntervalDismissed ||
      this.controlsVisible ||
      this.skipIntroAutoHidden
    ) {
      return;
    }

    if (this.skipIntroAnimationFrame != null) {
      return;
    }

    const currentProgress = clamp(this.skipIntroCountdownProgress, 0, 1);
    this.skipIntroCountdownStartAt = 0;

    const tick = (timestamp) => {
      this.skipIntroAnimationFrame = null;
      if (
        !this.activeSkipInterval ||
        !this.isSkipIntroPlaybackReady() ||
        this.skipIntervalDismissed ||
        this.controlsVisible
      ) {
        this.syncSkipIntroButtonProgress();
        return;
      }

      const now = Number(timestamp || Date.now());
      if (!this.skipIntroCountdownStartAt) {
        this.skipIntroCountdownStartAt = now - currentProgress * SKIP_INTRO_COUNTDOWN_MS;
      }
      const elapsed = Math.max(0, now - Number(this.skipIntroCountdownStartAt || 0));
      this.skipIntroCountdownProgress = clamp(elapsed / SKIP_INTRO_COUNTDOWN_MS, 0, 1);
      this.syncSkipIntroButtonProgress();

      if (this.skipIntroCountdownProgress >= 1) {
        this.skipIntroAutoHidden = true;
        this.renderSkipIntroButton();
        return;
      }

      this.skipIntroAnimationFrame = requestAnimationFrame(tick);
    };

    this.skipIntroAnimationFrame = requestAnimationFrame(tick);
  },

  syncSkipIntroButtonProgress() {
    const button = this.uiRefs?.skipIntro?.querySelector(".player-skip-intro-btn");
    if (!button) {
      return;
    }
    const fill = button.querySelector(".player-skip-intro-progress-fill");
    const progressNode = button.querySelector(".player-skip-intro-progress");
    if (fill) {
      fill.style.transform = `scaleX(${clamp(this.skipIntroCountdownProgress, 0, 1)})`;
    }
    if (progressNode) {
      const progressVisible =
        !this.controlsVisible && !this.skipIntroAutoHidden && !this.skipIntervalDismissed;
      progressNode.style.opacity = progressVisible ? "1" : "0";
    }
  },

  syncSkipIntroButtonTheme(button = null) {
    const target = button || this.uiRefs?.skipIntro?.querySelector(".player-skip-intro-btn");
    if (!target) {
      return;
    }

    const rootStyle = getComputedStyle(document.documentElement);
    const focusBackground =
      rootStyle.getPropertyValue("--player-focus-background").trim() || "#303030";
    const focusContent = rootStyle.getPropertyValue("--player-text-primary").trim() || "#ffffff";
    const focusRing = rootStyle.getPropertyValue("--player-focus-ring").trim() || "#ffffff";
    const pointerBrowser =
      Environment.isBrowser() && !document.documentElement.classList.contains("nuvio-keyboard-nav");
    const isFocused =
      !pointerBrowser &&
      (document.activeElement === target || target.classList.contains("focused"));
    const background = isFocused ? focusBackground : "rgba(30, 30, 30, 0.85)";
    const color = isFocused ? focusContent : "#fff";
    const boxShadow = isFocused ? `0 0 0 4px ${focusRing}` : "none";

    target.style.setProperty("background", background, "important");
    target.style.setProperty("background-color", background, "important");
    target.style.setProperty("color", color, "important");
    target.style.setProperty("box-shadow", boxShadow, "important");

    const icon = target.querySelector(".player-skip-intro-icon");
    const label = target.querySelector(".player-skip-intro-label");
    icon?.style.setProperty("color", color, "important");
    label?.style.setProperty("color", color, "important");
    label?.style.setProperty("-webkit-text-fill-color", color, "important");
  },

  isSkipIntroButtonFocusable() {
    const container = this.uiRefs?.skipIntro;
    const button = container?.querySelector(".player-skip-intro-btn");
    return Boolean(
      button &&
      button.isConnected &&
      !container.classList.contains("hidden") &&
      this.activeSkipInterval &&
      !this.skipIntervalDismissed &&
      this.isSkipIntroPlaybackReady()
    );
  },

  syncSkipIntroFocusState() {
    const button = this.uiRefs?.skipIntro?.querySelector(".player-skip-intro-btn");
    if (!button) {
      return;
    }
    const focused = this.controlFocusZone === "skipIntro" && this.isSkipIntroButtonFocusable();
    button.classList.toggle("focused", focused);
    if (focused) {
      const activeElement = document.activeElement;
      if (
        activeElement &&
        activeElement !== button &&
        activeElement !== document.body &&
        typeof activeElement.blur === "function"
      ) {
        activeElement.blur();
      }
      if (document.activeElement !== button && typeof button.focus === "function") {
        try {
          button.focus();
        } catch (_) {
          // Ignore focus races while the controls are being updated.
        }
      }
    }
    this.syncSkipIntroButtonTheme(button);
  },

  focusSkipIntroButton() {
    if (!this.isSkipIntroButtonFocusable()) {
      return false;
    }
    this.stickyProgressFocus = false;
    this.autoHideControlsAfterSeek = false;
    this.controlFocusZone = "skipIntro";
    this.syncControlFocusDom();
    this.syncSkipIntroFocusState();
    this.resetControlsAutoHide();
    return true;
  },

  renderSkipIntroButton() {
    const button = this.uiRefs?.skipIntro;
    if (!button) {
      return;
    }
    const activeInterval = this.activeSkipInterval;
    const playbackReady = this.isSkipIntroPlaybackReady();
    const shouldShow = Boolean(activeInterval) && playbackReady && !this.skipIntervalDismissed;
    const isVisible = shouldShow && (!this.skipIntroAutoHidden || this.controlsVisible);
    const activeKey = activeInterval
      ? `${activeInterval.type}:${activeInterval.startTime}:${activeInterval.endTime}`
      : "none";
    const renderKey = `${activeKey}|ready:${playbackReady ? 1 : 0}|controls:${this.controlsVisible ? 1 : 0}|hidden:${this.skipIntroAutoHidden ? 1 : 0}|dismissed:${this.skipIntervalDismissed ? 1 : 0}`;
    button.classList.toggle("hidden", !isVisible);
    button.classList.toggle("is-raised", Boolean(this.controlsVisible));
    if (!isVisible && this.controlFocusZone === "skipIntro") {
      this.controlFocusZone =
        this.controlsVisible && this.isSeekBarAvailable() ? "progress" : "buttons";
    }
    if (!shouldShow) {
      button.innerHTML = "";
      this.skipIntroRenderedKey = renderKey;
      return;
    }
    if (
      this.skipIntroRenderedKey !== renderKey ||
      !button.querySelector(".player-skip-intro-btn")
    ) {
      const label = buildSkipIntervalLabel(activeInterval);
      const progress = clamp(this.skipIntroCountdownProgress, 0, 1);
      const progressVisible =
        !this.controlsVisible && !this.skipIntroAutoHidden && !this.skipIntervalDismissed;
      button.innerHTML = `
        <button class="player-skip-intro-btn focusable" type="button" tabindex="-1" data-player-pointer-action="skipIntro" style="--skip-intro-progress-visible:${progressVisible ? 1 : 0};">
          <span class="player-skip-intro-content">
            <span class="player-skip-intro-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
                <path d="M6 18l8.5-6L6 6v12zm10-12v12h2V6h-2z" fill="currentColor"></path>
              </svg>
            </span>
            <span class="player-skip-intro-label">${escapeHtml(label)}</span>
          </span>
          <span class="player-skip-intro-progress" aria-hidden="true">
            <span class="player-skip-intro-progress-track"></span>
            <span class="player-skip-intro-progress-fill" style="transform:scaleX(${progress.toFixed(4)})"></span>
          </span>
        </button>
      `;
      this.skipIntroRenderedKey = renderKey;
    }
    this.syncSkipIntroButtonProgress();
    const focusTarget = this.uiRefs?.skipIntro?.querySelector(".player-skip-intro-btn");
    if (focusTarget) {
      if (!focusTarget.dataset.skipIntroThemeBound) {
        const syncTheme = () => this.syncSkipIntroButtonTheme(focusTarget);
        focusTarget.addEventListener("focus", syncTheme, true);
        focusTarget.addEventListener("blur", syncTheme, true);
        focusTarget.dataset.skipIntroThemeBound = "1";
      }
      focusTarget.classList.toggle("focused", this.controlFocusZone === "skipIntro");
      this.syncSkipIntroButtonTheme(focusTarget);
    }
    if (
      isVisible &&
      !this.controlsVisible &&
      !this.skipIntroAutoHidden &&
      !this.skipIntervalDismissed
    ) {
      if (this.skipIntroFocusFrame != null && typeof cancelAnimationFrame === "function") {
        cancelAnimationFrame(this.skipIntroFocusFrame);
      }
      if (typeof requestAnimationFrame === "function") {
        this.skipIntroFocusFrame = requestAnimationFrame(() => {
          this.skipIntroFocusFrame = null;
          const focusTarget = this.uiRefs?.skipIntro?.querySelector(".player-skip-intro-btn");
          if (!focusTarget || !focusTarget.isConnected) {
            return;
          }
          if (document.activeElement === focusTarget) {
            return;
          }
          try {
            focusTarget.focus();
            this.syncSkipIntroButtonTheme(focusTarget);
          } catch (_) {
            // Focus can fail while the DOM is being replaced; harmless.
          }
        });
      } else {
        try {
          const fallbackTarget = button.querySelector(".player-skip-intro-btn");
          fallbackTarget?.focus?.();
          this.syncSkipIntroButtonTheme(fallbackTarget);
        } catch (_) {
          // no-op
        }
      }
    }
  },

  startSkipIntervalCheckTimer() {
    this.stopSkipIntervalCheckTimer();
    this.skipIntervalCheckTimer = setInterval(() => {
      if (this.isExternalFrameMode()) {
        return;
      }
      if (!PlayerSettingsStore.get().skipIntroEnabled) {
        return;
      }
      if (!Array.isArray(this.skipIntervals) || !this.skipIntervals.length) {
        return;
      }
      this.updateActiveSkipInterval(this.getPlaybackCurrentSeconds());
    }, SKIP_INTERVAL_CHECK_MS);
  },

  stopSkipIntervalCheckTimer() {
    if (this.skipIntervalCheckTimer) {
      clearInterval(this.skipIntervalCheckTimer);
      this.skipIntervalCheckTimer = null;
    }
  },

  skipActiveInterval() {
    if (!this.activeSkipInterval) {
      return false;
    }
    const interval = this.activeSkipInterval;
    const targetTime = Number(interval.endTime || 0) + 0.25;
    this.skipIntroSuppressedKey = getSkipIntervalKey(interval);
    this.skipIntroSuppressedUntil = Date.now() + SKIP_INTERVAL_SEEK_SUPPRESSION_MS;
    this.seekPlaybackSeconds(targetTime, { preserveSkipIntroSuppression: true });
    this.skipIntervalDismissed = true;
    this.activeSkipInterval = null;
    this.skipIntroAutoHidden = false;
    this.skipIntroCountdownProgress = 0;
    this.skipIntroCountdownLastTickAt = Date.now();
    this.skipIntroCountdownStartAt = 0;
    this.stopSkipIntroCountdownAnimation();
    this.renderSkipIntroButton();
    return true;
  },

  normalizeStreamCandidates(streams = []) {
    const normalized = (streams || [])
      .map((stream, index) => {
        const streamUrl = stream?.url || stream?.externalUrl || "";
        const streamOrigin = {
          ...(stream.raw?.streamOrigin || {}),
          ...(stream.streamOrigin || {}),
          addonId:
            stream.addonId ||
            stream.raw?.addonId ||
            stream.streamOrigin?.addonId ||
            stream.raw?.streamOrigin?.addonId ||
            null,
          addonBaseUrl:
            stream.addonBaseUrl ||
            stream.raw?.addonBaseUrl ||
            stream.streamOrigin?.addonBaseUrl ||
            stream.raw?.streamOrigin?.addonBaseUrl ||
            null,
          addonName:
            stream.addonName ||
            stream.sourceName ||
            stream.raw?.addonName ||
            stream.streamOrigin?.addonName ||
            stream.raw?.streamOrigin?.addonName ||
            "Addon",
          sourceProviderId:
            stream.sourceProviderId ||
            stream.raw?.sourceProviderId ||
            stream.streamOrigin?.sourceProviderId ||
            stream.raw?.streamOrigin?.sourceProviderId ||
            null
        };
        const entry = {
          id: stream.id || `stream-${index}-${streamUrl}`,
          label: stream.name || stream.title || stream.label || `Source ${index + 1}`,
          name: stream.name || null,
          title: stream.title || stream.label || null,
          description: stream.description || stream.name || "",
          addonId: stream.addonId || stream.raw?.addonId || null,
          addonBaseUrl: stream.addonBaseUrl || stream.raw?.addonBaseUrl || null,
          addonName: stream.addonName || stream.sourceName || "Addon",
          addonLogo: stream.addonLogo || null,
          sourceProviderId:
            stream.sourceProviderId ||
            stream.raw?.sourceProviderId ||
            stream.streamOrigin?.sourceProviderId ||
            stream.raw?.streamOrigin?.sourceProviderId ||
            null,
          streamOrigin,
          mimeType: stream.mimeType || stream.raw?.mimeType || stream.type || stream.source || null,
          sourceType: stream.sourceType || stream.mimeType || stream.type || stream.source || "",
          url: streamUrl,
          ytId: stream.ytId || null,
          infoHash: stream.infoHash || null,
          fileIdx: stream.fileIdx ?? null,
          externalUrl: stream.externalUrl || null,
          behaviorHints: stream.behaviorHints || null,
          sources: Array.isArray(stream.sources) ? stream.sources : [],
          quality: stream.quality || null,
          qualityValue: Number.isFinite(Number(stream.qualityValue))
            ? Number(stream.qualityValue)
            : -1,
          clientResolve: stream.clientResolve || stream.raw?.clientResolve || null,
          debridCacheStatus: stream.debridCacheStatus || null,
          subtitles: Array.isArray(stream.subtitles) ? stream.subtitles : [],
          addonOrderIndex: Number.isFinite(Number(stream.addonOrderIndex))
            ? Number(stream.addonOrderIndex)
            : Number.MAX_SAFE_INTEGER,
          raw: stream
        };
        return DirectDebridResolver.shouldListStream(entry) ? entry : null;
      })
      .filter(Boolean);
    // Keep the browser player list canonical at its boundary. This is the
    // same stable identity used by Stream Selection, so route candidates and
    // refreshed addon results cannot create duplicate logical sources.
    return Environment.isBrowser() ? mergeStreamItems([], normalized) : normalized;
  },

  getCurrentStreamCandidate() {
    if (!this.streamCandidates.length) {
      return null;
    }
    const current = this.streamCandidates[this.currentStreamIndex] || null;
    if (current?.url) {
      return current;
    }
    const activePlaybackUrl = String(this.activePlaybackUrl || "").trim();
    if (Environment.isBrowser() && activePlaybackUrl) {
      return (
        this.streamCandidates.find((entry) => {
          const candidateUrl = streamDirectPlaybackUrl(entry);
          return candidateUrl === activePlaybackUrl || entry?.url === activePlaybackUrl;
        }) || null
      );
    }
    return this.streamCandidates.find((entry) => Boolean(entry?.url)) || null;
  },

  normalizePlaybackSourceContext(context = null) {
    if (!context || typeof context !== "object") {
      return null;
    }
    const sourceIds = uniqueNonEmptyValues([
      ...(Array.isArray(context.sourceIds) ? context.sourceIds : []),
      context.sourceId,
      context.catalogId
    ]);
    const normalized = {
      addonId: String(context.addonId || "").trim(),
      addonBaseUrl: String(context.addonBaseUrl || "").trim(),
      addonName: String(context.addonName || "").trim(),
      addonOrderIndex: Number.isFinite(Number(context.addonOrderIndex))
        ? Number(context.addonOrderIndex)
        : null,
      sourceProviderId: String(context.sourceProviderId || context.providerId || "").trim(),
      originKind: String(context.originKind || context.kind || context.streamOrigin?.kind || "")
        .trim()
        .toLowerCase(),
      sourceId: sourceIds[0] || "",
      sourceIds,
      catalogId: String(context.catalogId || "").trim(),
      streamOrigin:
        context.streamOrigin && typeof context.streamOrigin === "object"
          ? { ...context.streamOrigin }
          : null,
      selectedStreamId: String(context.selectedStreamId || "").trim(),
      selectedStreamIndex: Number.isFinite(Number(context.selectedStreamIndex))
        ? Number(context.selectedStreamIndex)
        : null
    };
    return Object.values({
      addonId: normalized.addonId,
      addonBaseUrl: normalized.addonBaseUrl,
      addonName: normalized.addonName,
      sourceProviderId: normalized.sourceProviderId,
      sourceId: normalized.sourceId
    }).some(Boolean)
      ? normalized
      : null;
  },

  getPlaybackSourceContext(streamCandidate = null) {
    const stream = streamCandidate || null;
    if (!stream) {
      return this.normalizePlaybackSourceContext(
        this.activePlaybackSourceContext ||
          this.params?.playbackSourceContext ||
          this.params?.sourceContext ||
          null
      );
    }
    const raw = stream.raw || {};
    const origin = stream.streamOrigin || raw.streamOrigin || {};
    const sourceIds = uniqueNonEmptyValues([
      ...(Array.isArray(stream.sources) ? stream.sources : []),
      ...(Array.isArray(raw.sources) ? raw.sources : []),
      stream.sourceId,
      raw.sourceId,
      origin.sourceId,
      stream.catalogId,
      raw.catalogId,
      origin.catalogId
    ]);
    const selectedStreamIndex = this.streamCandidates?.indexOf?.(stream);
    return this.normalizePlaybackSourceContext({
      addonId: stream.addonId || raw.addonId || origin.addonId || "",
      addonBaseUrl: stream.addonBaseUrl || raw.addonBaseUrl || origin.addonBaseUrl || "",
      addonName: stream.addonName || raw.addonName || origin.addonName || "",
      addonOrderIndex:
        stream.addonOrderIndex ?? raw.addonOrderIndex ?? origin.addonOrderIndex ?? null,
      sourceProviderId:
        stream.sourceProviderId || raw.sourceProviderId || origin.sourceProviderId || "",
      originKind: origin.kind || stream.originKind || raw.originKind || "",
      sourceIds,
      sourceId: sourceIds[0] || "",
      catalogId: stream.catalogId || raw.catalogId || origin.catalogId || "",
      streamOrigin: origin,
      selectedStreamId: stream.id || "",
      selectedStreamIndex:
        Number.isFinite(selectedStreamIndex) && selectedStreamIndex >= 0
          ? selectedStreamIndex
          : null
    });
  },

  isDebridPlaybackCandidate(streamCandidate = this.getCurrentStreamCandidate()) {
    const stream = streamCandidate?.raw || streamCandidate || {};
    const resolve = streamCandidate?.clientResolve || stream?.clientResolve || {};
    const debridCacheStatus =
      streamCandidate?.debridCacheStatus || stream?.debridCacheStatus || null;
    return Boolean(String(resolve.type || "").toLowerCase() === "debrid" || debridCacheStatus);
  },

  getStreamSearchText(streamCandidate) {
    const stream = streamCandidate?.raw || streamCandidate || {};
    return String(
      [
        streamCandidate?.label || "",
        streamCandidate?.description || "",
        streamCandidate?.sourceType || "",
        streamCandidate?.url || "",
        stream?.title || "",
        stream?.name || "",
        stream?.description || "",
        stream?.url || ""
      ].join(" ")
    ).toLowerCase();
  },

  getStreamCandidateByUrl(streamUrl) {
    const normalized = String(streamUrl || "").trim();
    if (!normalized) {
      return null;
    }
    return (
      this.streamCandidates.find((entry) => String(entry?.url || "").trim() === normalized) || null
    );
  },

  getTrackProbeUrl() {
    const currentCandidate = this.getCurrentStreamCandidate();
    return String(
      this.activePlaybackUrl || currentCandidate?.url || PlayerController.video?.currentSrc || ""
    ).trim();
  },

  isCurrentSourceAdaptiveManifest() {
    const probeUrl = this.getTrackProbeUrl();
    const probeMimeType =
      typeof PlayerController.guessMediaMimeType === "function"
        ? PlayerController.guessMediaMimeType(probeUrl)
        : null;
    return (
      (typeof PlayerController.isLikelyHlsMimeType === "function" &&
        PlayerController.isLikelyHlsMimeType(probeMimeType)) ||
      (typeof PlayerController.isLikelyDashMimeType === "function" &&
        PlayerController.isLikelyDashMimeType(probeMimeType))
    );
  },

  isCurrentSourceLikelyHls(
    url = this.getTrackProbeUrl(),
    streamCandidate = this.getCurrentStreamCandidate()
  ) {
    const isLikelyHlsMimeType = PlayerController.isLikelyHlsMimeType;
    if (typeof isLikelyHlsMimeType !== "function") {
      return false;
    }
    const declaredSourceType = this.resolvePlaybackMediaSourceType(streamCandidate);
    const inferredSourceType =
      typeof PlayerController.guessMediaMimeType === "function"
        ? PlayerController.guessMediaMimeType(url)
        : null;
    return Boolean(
      isLikelyHlsMimeType.call(PlayerController, declaredSourceType) ||
      isLikelyHlsMimeType.call(PlayerController, inferredSourceType)
    );
  },

  isCurrentSourceLikelyMkv(
    url = this.getTrackProbeUrl(),
    streamCandidate = this.getCurrentStreamCandidate()
  ) {
    const probeUrl = String(url || "")
      .trim()
      .toLowerCase();
    if (probeUrl.includes(".mkv")) {
      return true;
    }
    const sourceType = this.resolvePlaybackMediaSourceType(streamCandidate);
    const normalizedSourceType =
      typeof PlayerController.normalizeMimeType === "function"
        ? PlayerController.normalizeMimeType(sourceType)
        : String(sourceType || "")
            .toLowerCase()
            .split(";")[0]
            .trim();
    return normalizedSourceType === "video/x-matroska";
  },

  getUnavailableTrackMessage(kind = "audio") {
    if (kind === "audio" && this.directTrackLoading)
      return t("player_loading_audio_tracks", {}, "Loading audio tracks…");
    if (
      kind === "audio" &&
      !PlayerController.clientRemux &&
      !this.relayTrackContext &&
      !PlayerController.video?.audioTracks &&
      !PlayerController.video?.webkitAudioTracks
    )
      return t(
        "player_audio_selection_unavailable",
        {},
        "Audio selection is unavailable for this playback."
      );
    return kind === "subtitle" ? "No subtitle tracks available." : "No audio tracks available.";
  },

  getVideoTextTrackList() {
    const video = PlayerController.video;
    if (!video) {
      return null;
    }
    return video.textTracks || video.webkitTextTracks || video.mozTextTracks || null;
  },

  getVideoAudioTrackList() {
    const video = PlayerController.video;
    if (!video) {
      return null;
    }
    return video.audioTracks || video.webkitAudioTracks || video.mozAudioTracks || null;
  },

  collectStreamSidecarSubtitles(streamCandidate = this.getCurrentStreamCandidate()) {
    const mapSubtitles = (candidate) => {
      const stream = candidate?.raw || candidate || null;
      const rawSubtitles = Array.isArray(stream?.subtitles) ? stream.subtitles : [];
      return rawSubtitles
        .filter((subtitle) => Boolean(subtitle?.url))
        .map((subtitle, index) => ({
          id: subtitle.id || `${subtitle.lang || "unk"}-${index}-${subtitle.url}`,
          url: subtitle.url,
          lang: subtitle.lang || "unknown",
          addonName: candidate?.addonName || "Stream",
          addonLogo: candidate?.addonLogo || null,
          fileName: subtitle.fileName || subtitle.filename || subtitle.name || "",
          forced: subtitle.forced === true || subtitle.isForced === true,
          sdh: subtitle.sdh === true || subtitle.hearingImpaired === true
        }));
    };

    const current = mapSubtitles(streamCandidate);
    if (current.length) {
      return current;
    }

    return this.streamCandidates.reduce((items, candidate) => {
      const mapped = mapSubtitles(candidate);
      if (mapped.length) {
        items.push(...mapped);
      }
      return items;
    }, []);
  },

  mergeSubtitleCandidates(primary = [], secondary = []) {
    const merged = [];
    const seenUrls = new Set();
    const seenOfflineIds = new Set();
    const offlineFingerprints = new Set();
    for (const subtitle of [...(primary || []), ...(secondary || [])]) {
      if (!subtitle?.url) continue;
      const url = String(subtitle.url).trim();
      const language = normalizeSubtitleLanguageKey(subtitle.lang || subtitle.language);
      const urlKey = JSON.stringify([url, language]);
      const offlineId = subtitle.offlineSubtitleId;
      const fingerprint = subtitle.offlineFingerprint || createOfflineSubtitleFingerprint(subtitle);
      if (
        seenUrls.has(urlKey) ||
        (offlineId && seenOfflineIds.has(offlineId)) ||
        offlineFingerprints.has(fingerprint)
      )
        continue;
      seenUrls.add(urlKey);
      if (offlineId) seenOfflineIds.add(offlineId);
      if (subtitle.isOffline) offlineFingerprints.add(fingerprint);
      merged.push(subtitle);
    }
    return merged;
  },

  releaseOfflineSubtitleObjectUrls() {
    (this.offlineSubtitleObjectUrls || []).forEach((url) => {
      try {
        URL.revokeObjectURL(url);
      } catch (_) {
        // Best effort during Player lifecycle changes.
      }
    });
    this.offlineSubtitleObjectUrls = [];
    this.offlineSubtitleTracks = [];
  },

  async loadOfflineSubtitleTracks() {
    if (!Environment.isBrowser() || !this.offlineDownloadId) return [];
    const offlineDownload = await getOfflineDownload(this.offlineDownloadId);
    if (offlineDownload?.status !== "completed") return [];
    const subtitles = await listOfflineSubtitles({
      mediaIdentity: offlineDownload.mediaIdentity,
      offlineCopyId: offlineDownload.downloadId
    });
    const existingTracks = new Map(
      (this.offlineSubtitleTracks || []).map((track) => [track.offlineSubtitleId, track])
    );
    const tracks = [];
    for (const subtitle of subtitles) {
      const existing = existingTracks.get(subtitle.subtitleId);
      if (existing?.url) {
        tracks.push(existing);
        continue;
      }
      const offlineFile = await getBrowserOfflineSubtitleFile(subtitle.subtitleId);
      if (!offlineFile?.file) {
        continue;
      }
      const body = decodeOfflineSubtitleBytes(await offlineFile.file.arrayBuffer()).text;
      const detectedFormat = detectOfflineSubtitleFormat(body);
      if (!isOfflineSubtitleTextLoadable(body)) {
        continue;
      }
      const normalizedText = this.normalizeExternalSubtitleText(
        body,
        `offline.${detectedFormat || subtitle.extension || "vtt"}`,
        subtitle.mimeType || ""
      );
      const parsedCues = this.parseSubtitleCues(normalizedText);
      if (!parsedCues.length) {
        continue;
      }
      const url = this.createSubtitleObjectUrl(
        body,
        `offline.${detectedFormat || subtitle.extension || "vtt"}`,
        subtitle.mimeType || "",
        this.offlineSubtitleObjectUrls
      );
      tracks.push({
        id: subtitle.displayId || subtitle.subtitleId,
        url,
        lang: subtitle.lang || "unknown",
        addonName: subtitle.addonName || "Downloaded",
        addonLogo: subtitle.addonLogo || null,
        fileName: subtitle.fileName || "",
        offlineSubtitleId: subtitle.subtitleId,
        offlineFingerprint: subtitle.fingerprint,
        isOffline: true
      });
    }
    const activeIds = new Set(tracks.map((track) => track.offlineSubtitleId));
    (this.offlineSubtitleTracks || []).forEach((track) => {
      if (!activeIds.has(track.offlineSubtitleId) && track.url) {
        try {
          URL.revokeObjectURL(track.url);
        } catch (_) {
          // Best effort after deleting a local track.
        }
      }
    });
    this.offlineSubtitleTracks = tracks;
    this.offlineSubtitleObjectUrls = tracks.map((track) => track.url).filter(Boolean);
    return tracks;
  },

  getCurrentStreamRequestHeaders(streamCandidate = this.getCurrentStreamCandidate()) {
    const requestHeaders =
      streamCandidate?.raw?.behaviorHints?.proxyHeaders?.request ||
      streamCandidate?.behaviorHints?.proxyHeaders?.request;
    if (!requestHeaders || typeof requestHeaders !== "object") {
      return {};
    }
    return { ...requestHeaders };
  },

  parseHlsManifestTracks(manifestText, manifestUrl) {
    const lines = String(manifestText || "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    const audioTracks = [];
    const subtitleTracks = [];
    const variants = [];
    let pendingVariantAttributes = null;

    lines.forEach((line) => {
      if (line.startsWith("#EXT-X-MEDIA:")) {
        const attributes = parseHlsAttributeList(line.slice("#EXT-X-MEDIA:".length));
        const mediaType = String(attributes.TYPE || "").toUpperCase();
        const groupId = String(attributes["GROUP-ID"] || "").trim();
        const name = String(attributes.NAME || attributes.LANGUAGE || "").trim();
        const language = String(attributes.LANGUAGE || "").trim();
        const channels = String(attributes.CHANNELS || "").trim();
        const characteristics = String(attributes.CHARACTERISTICS || "").trim();
        const uri = attributes.URI ? resolveUrl(manifestUrl, attributes.URI) : null;
        const isDefault = String(attributes.DEFAULT || "").toUpperCase() === "YES";
        const forced = String(attributes.FORCED || "").toUpperCase() === "YES";
        const autoselect = String(attributes.AUTOSELECT || "").toUpperCase() === "YES";
        const trackId = `${mediaType || "TRACK"}::${groupId || "main"}::${name || language || "default"}`;

        if (mediaType === "AUDIO") {
          audioTracks.push({
            id: trackId,
            groupId,
            name: name || `Audio ${audioTracks.length + 1}`,
            language,
            channels,
            characteristics,
            uri,
            isDefault,
            forced,
            autoselect
          });
          return;
        }

        if (mediaType === "SUBTITLES") {
          subtitleTracks.push({
            id: trackId,
            groupId,
            name: name || `Subtitle ${subtitleTracks.length + 1}`,
            language,
            characteristics,
            uri,
            isDefault,
            forced,
            autoselect
          });
          return;
        }
        return;
      }

      if (line.startsWith("#EXT-X-STREAM-INF:")) {
        pendingVariantAttributes = parseHlsAttributeList(line.slice("#EXT-X-STREAM-INF:".length));
        return;
      }

      if (line.startsWith("#")) {
        return;
      }

      if (!pendingVariantAttributes) {
        return;
      }

      variants.push({
        uri: resolveUrl(manifestUrl, line),
        audioGroupId: String(pendingVariantAttributes.AUDIO || "").trim() || null,
        subtitleGroupId: String(pendingVariantAttributes.SUBTITLES || "").trim() || null,
        codecs: String(pendingVariantAttributes.CODECS || "").trim(),
        bandwidth: Number(pendingVariantAttributes.BANDWIDTH || 0),
        resolution: String(pendingVariantAttributes.RESOLUTION || "").trim()
      });
      pendingVariantAttributes = null;
    });

    const codecsByAudioGroup = new Map();
    variants.forEach((variant) => {
      const groupId = cleanDisplayText(variant?.audioGroupId);
      const codecs = cleanDisplayText(variant?.codecs);
      if (!groupId || !codecs) {
        return;
      }
      const existing = codecsByAudioGroup.get(groupId) || [];
      if (!existing.includes(codecs)) {
        existing.push(codecs);
        codecsByAudioGroup.set(groupId, existing);
      }
    });
    audioTracks.forEach((track) => {
      const codecs = codecsByAudioGroup.get(cleanDisplayText(track?.groupId));
      if (codecs?.length) {
        track.codecs = codecs.join(", ");
      }
    });

    return {
      audioTracks,
      subtitleTracks,
      variants
    };
  },

  parseDashManifestTracks(manifestText) {
    const parseErrorResult = {
      audioTracks: [],
      subtitleTracks: [],
      variants: []
    };

    const parser = typeof DOMParser === "function" ? new DOMParser() : null;
    if (!parser) {
      return parseErrorResult;
    }

    let xmlDocument = null;
    try {
      xmlDocument = parser.parseFromString(String(manifestText || ""), "application/xml");
    } catch (_) {
      return parseErrorResult;
    }
    if (!xmlDocument) {
      return parseErrorResult;
    }
    if (xmlDocument.getElementsByTagName("parsererror").length > 0) {
      return parseErrorResult;
    }

    const adaptationSets = Array.from(xmlDocument.getElementsByTagName("AdaptationSet"));
    if (!adaptationSets.length) {
      return parseErrorResult;
    }

    const audioTracks = [];
    const subtitleTracks = [];
    adaptationSets.forEach((adaptationSet, setIndex) => {
      const contentType = String(adaptationSet.getAttribute("contentType") || "").toLowerCase();
      const mimeType = String(adaptationSet.getAttribute("mimeType") || "").toLowerCase();
      const representation = adaptationSet.getElementsByTagName("Representation")[0] || null;
      const codecs = String(
        adaptationSet.getAttribute("codecs") || representation?.getAttribute("codecs") || ""
      ).toLowerCase();
      const roleValues = Array.from(adaptationSet.getElementsByTagName("Role"))
        .map((node) => String(node.getAttribute("value") || "").trim())
        .filter(Boolean);
      const accessibilityValues = Array.from(adaptationSet.getElementsByTagName("Accessibility"))
        .map((node) => String(node.getAttribute("value") || "").trim())
        .filter(Boolean);
      const audioChannelConfiguration =
        adaptationSet.getElementsByTagName("AudioChannelConfiguration")[0] ||
        representation?.getElementsByTagName("AudioChannelConfiguration")?.[0] ||
        null;
      const language = String(
        adaptationSet.getAttribute("lang") || representation?.getAttribute("lang") || ""
      ).trim();
      const label = String(
        adaptationSet.getAttribute("label") ||
          representation?.getAttribute("label") ||
          roleValues[0] ||
          ""
      ).trim();
      const setId = String(adaptationSet.getAttribute("id") || setIndex).trim();
      const channels = String(audioChannelConfiguration?.getAttribute("value") || "").trim();
      const role = roleValues.join(" ");
      const accessibility = accessibilityValues.join(" ");

      const isAudio = contentType === "audio" || mimeType.startsWith("audio/");
      const isSubtitle =
        contentType === "text" ||
        mimeType.startsWith("text/") ||
        mimeType.includes("ttml") ||
        mimeType.includes("vtt") ||
        codecs.includes("stpp") ||
        codecs.includes("wvtt");

      if (isAudio) {
        audioTracks.push({
          id: `DASH::AUDIO::${setId}::${language || label || audioTracks.length + 1}`,
          groupId: setId,
          name: label || `Audio ${audioTracks.length + 1}`,
          language,
          channels,
          role,
          accessibility,
          codecs,
          uri: null,
          isDefault: audioTracks.length === 0
        });
      } else if (isSubtitle) {
        subtitleTracks.push({
          id: `DASH::SUBTITLES::${setId}::${language || label || subtitleTracks.length + 1}`,
          groupId: setId,
          name: label || `Subtitle ${subtitleTracks.length + 1}`,
          language,
          role,
          accessibility,
          uri: null,
          isDefault: subtitleTracks.length === 0
        });
      }
    });

    return {
      audioTracks,
      subtitleTracks,
      variants: []
    };
  },

  parseManifestTracks(manifestText, manifestUrl) {
    const text = String(manifestText || "");
    if (!text) {
      return { audioTracks: [], subtitleTracks: [], variants: [] };
    }
    if (text.includes("#EXTM3U")) {
      return this.parseHlsManifestTracks(text, manifestUrl);
    }
    if (/<\s*MPD[\s>]/i.test(text)) {
      return this.parseDashManifestTracks(text);
    }
    return { audioTracks: [], subtitleTracks: [], variants: [] };
  },

  loadDirectSubtitleData({ confirmedMkv = false } = {}) {
    const url = this.activePlaybackUrl;
    const video = PlayerController.video;
    const candidate = this.getCurrentStreamCandidate();
    if (
      !Environment.isBrowser() ||
      !video ||
      !/^https?:/i.test(url || "") ||
      PlayerController.clientRemux ||
      this.relayTrackContext ||
      this.isCurrentSourceAdaptiveManifest() ||
      (!confirmedMkv && !this.isCurrentSourceLikelyMkv(url, candidate))
    )
      return;
    const token = this.relayTrackToken;
    const active = () =>
      token === this.relayTrackToken &&
      this.activePlaybackUrl === url &&
      PlayerController.video === video &&
      !this.playerBackNavigationInProgress;
    const addonTracks = new Set((this.externalTrackNodes || []).map((node) => node.track));
    const nativeSubtitles = this.getTextTracks().some(
      (track) => !addonTracks.has(track) && ["subtitles", "captions", "forced"].includes(track.kind)
    );
    if (!nativeSubtitles && !this.relayTextSubtitles) {
      const { assetBase, version } = clientRemuxAssets();
      this.relayTextSubtitles = createEmbeddedSubtitles({
        video,
        assetBase,
        version,
        requestHeaders: this.getCurrentStreamRequestHeaders(candidate),
        getTime: () => this.getPlaybackCurrentSeconds(),
        onTracks: () => {
          if (active()) this.refreshTrackDialogs();
        },
        onStatus: () => {
          if (active()) this.refreshTrackDialogs();
        },
        onCues: () => {
          if (active()) this.refreshSubtitleCueStyles();
        }
      });
      this.relayTextSubtitles.setDelay(Number(this.subtitleDelayMs || 0) / 1000);
      this.relayTextSubtitles.setSource(url);
    }
  },

  async loadDirectTrackData() {
    const url = this.activePlaybackUrl;
    const video = PlayerController.video;
    if (
      !Environment.isBrowser() ||
      !video ||
      !/^https?:/i.test(url || "") ||
      PlayerController.clientRemux ||
      this.relayTrackContext ||
      this.isCurrentSourceAdaptiveManifest()
    )
      return;
    if (
      this.directTrackUrl === url &&
      this.directTrackVideo === video &&
      (this.directTrackLoading ||
        this.directTrackProbe ||
        Date.now() - Number(this.directTrackAttemptAt || 0) < 15000)
    )
      return;
    this.directTrackAttemptAt = Date.now();
    this.directTrackUrl = url;
    this.directTrackVideo = video;
    this.directTrackLoading = true;
    const token = this.relayTrackToken;
    const candidate = this.getCurrentStreamCandidate();
    const active = () =>
      token === this.relayTrackToken &&
      this.activePlaybackUrl === url &&
      PlayerController.video === video &&
      !this.playerBackNavigationInProgress;
    const prober = (this._directTrackProber ||= createStreamProber({
      endpoint: PROBE_ENDPOINT,
      mode: PROBE_MODE,
      clientConcurrency: PROBE_CLIENT_CONCURRENCY,
      timeoutMs: 15000,
      assess: (probe) => assessPlaybackCapabilities(probe)
    }));
    try {
      this.loadDirectSubtitleData();
      const cached = candidate ? this.getPlayerStreamProbe?.(candidate) : null;
      const probe =
        cached ||
        (await prober.probe(url, {
          reason: "tracks",
          identity: streamProbeIdentity(candidate)
        }));
      if (!active()) return;
      this.directTrackProbe = probe;
      const nativeTracks = PlayerController.getBrowserAudioTracks();
      if (!nativeTracks.length && probe) {
        this.directAudioTracks = (probe.audioStreams || []).map((track) => ({
          ...track,
          engine: "direct-source",
          id: "direct-source-" + track.index,
          selected: false,
          supported:
            REMUX_POLICY.mode !== "off" &&
            probe.playbackCapabilities?.relayVideo !== false &&
            probe.playbackCapabilities?.audio?.find((a) => a.index === track.index)?.supported !==
              false
        }));
      }
      if (probe?.container === "mkv") this.loadDirectSubtitleData({ confirmedMkv: true });
    } catch (_) {
      // Track discovery must never interrupt a video that is already playing.
    } finally {
      if (active()) {
        this.directTrackLoading = false;
        this.refreshTrackDialogs();
        this.applyDirectAudioPreferenceAfterStart?.();
        if (globalThis.__NUVIO_PLAYBACK_STARTUP_DEBUG__ === true) {
          const probe = this.directTrackProbe;
          const failure = probe ? "" : prober.failureReason(url);
          const facts = {
            mode: PROBE_MODE,
            result: probe ? "metadata" : "unavailable",
            reason: /^(?:[a-z0-9-]{1,80}|HTTP [1-5][0-9]{2})$/.test(failure) ? failure : "",
            elapsedMs: Date.now() - this.directTrackAttemptAt,
            nativeTrackCount: PlayerController.getBrowserAudioTracks().length,
            sourceTrackCount: probe?.audioStreams?.length || 0,
            displayedTrackCount: this.directAudioTracks?.length || 0
          };
          const detail = JSON.stringify(facts);
          console.warn("[DirectAudioProbe] " + detail);
          void fetch("/api/debug/log", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              kind: "direct-audio-probe",
              message: facts.result,
              stack: detail,
              at: new Date().toISOString()
            })
          }).catch(() => {});
        }
      }
    }
  },

  applyDirectAudioPreferenceAfterStart() {
    const url = this.activePlaybackUrl;
    if (
      !Environment.isBrowser() ||
      !this.hasPresentedPlaybackFrame ||
      this.playerBackNavigationInProgress ||
      PROBE_MODE === "off" ||
      !/^https?:/i.test(url || "") ||
      PlayerController.playbackEngine !== "native-file" ||
      !PlayerController.video ||
      PlayerController.video.paused ||
      PlayerController.getBrowserAudioTracks().length ||
      this.relayTrackContext ||
      this.isCurrentSourceAdaptiveManifest()
    )
      return;

    if (this.directAudioPreferenceState?.url !== url)
      this.directAudioPreferenceState = { url, probing: false, attempted: false };
    const state = this.directAudioPreferenceState;
    if (state.attempted) return;
    if (!this.directTrackProbe) {
      if (!state.probing && !this.directTrackLoading) {
        state.probing = true;
        this.showAspectToast(
          t(
            "player_audio_preference_checking",
            {},
            "Checking audio tracks. Playing default audio."
          ),
          { durationMs: 2400 }
        );
        void this.loadDirectTrackData();
      }
      return;
    }

    state.attempted = true;
    const preferred = this.findRememberedAudioOption() || this.findStartupPreferredAudioOption();
    const entry = preferred?.entry;
    if (!entry?.supported || entry.track?.engine !== "direct-source") return;
    const tracks = this.directTrackProbe.audioStreams || [];
    const defaultTrack = tracks.find((track) => track.default) || tracks[0];
    if (entry.track.index === defaultTrack?.index) return;
    void this.switchDirectAudioTrack(entry, {
      automatic: true,
      language: preferred.languageLabel || preferred.label
    });
  },

  async switchDirectAudioTrack(entry, { automatic = false, language = "" } = {}) {
    const previous = this.directAudioSwitching;
    if (
      (previous && (automatic || !previous.automatic || previous.started)) ||
      !this.directTrackProbe ||
      entry.supported === false
    )
      return;
    const url = this.activePlaybackUrl;
    const token = this.relayTrackToken;
    const mountToken = this.playerMountToken;
    const candidate = this.getCurrentStreamCandidate();
    const request = (this.directAudioSwitching = { automatic, started: false });
    try {
      const delivery = await prepareUnverifiedRemux(url, {
        probe: this.directTrackProbe,
        audioIndex: entry.track.index
      });
      if (
        this.directAudioSwitching !== request ||
        this.activePlaybackUrl !== url ||
        token !== this.relayTrackToken ||
        !this.isActiveMountToken(mountToken) ||
        this.playerBackNavigationInProgress
      )
        return;
      request.started = true;
      if (automatic) {
        this.pendingAutomaticDirectAudio = { url, mediaUrl: delivery.url, candidate, mountToken };
        this.showAspectToast(
          t("player_audio_preference_switching", { language }, "Switching audio to {{language}}"),
          { durationMs: 3000 }
        );
      }
      this.params.playbackPlan = delivery.plan;
      const attempt = this.params.unverifiedPlayback;
      if (attempt) {
        attempt.route = "remux";
        attempt.remuxTried = true;
        attempt.routeStartedAt = Date.now();
        attempt.mediaUrl = delivery.url;
      }
      this.relayPrepareDone = false;
      this.relayPrepareUrl = "";
      await this.playStreamByUrl(delivery.url, {
        preservePanel: true,
        preservePlaybackState: true,
        resetSilentAudioState: false,
        sourceCandidate: candidate,
        requestedAudioIndex: entry.track.index,
        rememberRequestedAudio: !automatic,
        mountToken
      });
    } catch (_) {
      if (automatic && request.started && (await this.restoreDefaultAfterAutomaticAudioFailure()))
        return;
      if (
        this.directAudioSwitching === request &&
        this.activePlaybackUrl === url &&
        this.isActiveMountToken(mountToken)
      ) {
        if (automatic && this.pendingAutomaticDirectAudio) {
          this.pendingAutomaticDirectAudio = null;
          this.params.playbackPlan = null;
          const attempt = this.params.unverifiedPlayback;
          if (attempt) {
            attempt.route = "direct";
            attempt.mediaUrl = url;
          }
          this.relayPrepareDone = false;
          this.relayPrepareUrl = "";
        }
        this.showAspectToast(
          t(
            "player_audio_switch_failed",
            {},
            "Unable to switch audio with the available stream processing."
          )
        );
      }
    } finally {
      if (this.directAudioSwitching === request) this.directAudioSwitching = null;
    }
  },

  async restoreDefaultAfterAutomaticAudioFailure() {
    const transition = this.pendingAutomaticDirectAudio;
    if (
      !transition ||
      transition.mediaUrl !== this.activePlaybackUrl ||
      this.hasPresentedPlaybackFrame ||
      this.playerBackNavigationInProgress ||
      !this.isActiveMountToken(transition.mountToken)
    )
      return false;

    this.pendingAutomaticDirectAudio = null;
    this.params.playbackPlan = null;
    const attempt = this.params.unverifiedPlayback;
    if (attempt) {
      attempt.route = "direct";
      attempt.mediaUrl = transition.url;
      attempt.rawTried = true;
      attempt.busy = true;
    }
    this.showAspectToast(
      t(
        "player_audio_preference_default",
        {},
        "Preferred audio unavailable. Continuing with default audio."
      ),
      { durationMs: 3000 }
    );
    this.relayPrepareDone = false;
    this.relayPrepareUrl = "";
    try {
      await this.playStreamByUrl(transition.url, {
        preservePanel: true,
        preservePlaybackState: true,
        preservePendingRestore: true,
        resetSilentAudioState: false,
        sourceCandidate: transition.candidate,
        mountToken: transition.mountToken
      });
      return true;
    } catch {
      return false;
    } finally {
      if (attempt) attempt.busy = false;
    }
  },

  clearRelayTrackData() {
    this.relayTrackToken = Number(this.relayTrackToken || 0) + 1;
    this.relayTextSubtitles?.destroy();
    this.relayTextSubtitles = null;
    this.relayAudioTracks = [];
    this.relayTrackProbe = null;
    this.relayTrackContext = null;
    this.relayTrackPlaybackUrl = null;
    this.relayTrackVideo = null;
    this._directTrackProber?.cancelAll();
    this.directTrackUrl = null;
    this.directTrackVideo = null;
    this.directTrackProbe = null;
    this.directTrackLoading = false;
    this.directAudioTracks = [];
  },

  async loadRelayTrackData(playbackUrl) {
    if (
      this.relayTrackPlaybackUrl === playbackUrl &&
      this.relayTrackVideo === PlayerController.video
    )
      return;
    this.clearRelayTrackData();
    const token = this.relayTrackToken;
    const context = relayTrackContext(playbackUrl, TRANSCODE_ENDPOINT);
    this.relayTrackPlaybackUrl = playbackUrl;
    this.relayTrackVideo = PlayerController.video;
    if (!context || !PlayerController.video) return;
    this.relayTrackContext = context;
    const active = () => token === this.relayTrackToken;
    const refresh = () => {
      if (active()) this.refreshTrackDialogs();
    };
    const prober = (this._relayTrackProber ||= createStreamProber({
      endpoint: PROBE_ENDPOINT,
      mode: PROBE_MODE,
      clientConcurrency: PROBE_CLIENT_CONCURRENCY,
      timeoutMs: 15000,
      assess: (probe) => assessPlaybackCapabilities(probe)
    }));
    const probe = await prober.probe(context.source, { reason: "tracks" });
    if (!active()) return;
    this.relayTrackProbe = probe;
    PlayerController.setSourceDurationHint?.(playbackUrl, probe?.durationSeconds);
    this.relayAudioTracks = (probe?.audioStreams || []).map((track) => ({
      ...track,
      id: "relay-audio-" + track.index,
      engine: "relay",
      selected: track.index === context.audioIndex,
      supported:
        track.index <= 7 &&
        ((context.url.searchParams.get("a") || "aac") === "aac" ||
          probe.playbackCapabilities?.audio?.find((t) => t.index === track.index)?.supported !==
            false)
    }));
    refresh();
    if (probe?.container !== "mkv") return;
    this.relayTextSubtitles = createEmbeddedSubtitles({
      video: PlayerController.video,
      assetBase: document.baseURI,
      version: "relay",
      getTime: () => this.getPlaybackCurrentSeconds(),
      onTracks: refresh,
      onStatus: refresh,
      onCues: () => {
        if (active()) this.refreshSubtitleCueStyles();
      },
      makeTransport: () => createRelaySubtitleTransport(context)
    });
    this.relayTextSubtitles.setDelay(Number(this.subtitleDelayMs || 0) / 1000);
    this.relayTextSubtitles.setSource(context.source);
  },

  async loadManifestTrackDataForCurrentStream(playbackUrl = this.activePlaybackUrl) {
    void this.loadRelayTrackData(playbackUrl).catch(() => {});
    const currentCandidate = this.getCurrentStreamCandidate();
    const masterUrl = playbackUrl || currentCandidate?.url || "";
    const runtimeUrl = String(PlayerController.video?.currentSrc || "").trim();
    const loadToken = (this.manifestLoadToken || 0) + 1;
    this.manifestLoadToken = loadToken;
    this.manifestLoading = true;

    this.manifestAudioTracks = [];
    this.manifestSubtitleTracks = [];
    this.manifestVariants = [];
    this.manifestMasterUrl = masterUrl;
    this.selectedManifestAudioTrackId = null;
    this.selectedManifestSubtitleTrackId = null;
    this.refreshTrackDialogs();

    const probeUrl = masterUrl || runtimeUrl || playbackUrl || "";
    const probeMimeType =
      typeof PlayerController.guessMediaMimeType === "function"
        ? PlayerController.guessMediaMimeType(probeUrl)
        : null;
    const isAdaptiveManifest =
      (typeof PlayerController.isLikelyHlsMimeType === "function" &&
        PlayerController.isLikelyHlsMimeType(probeMimeType)) ||
      (typeof PlayerController.isLikelyDashMimeType === "function" &&
        PlayerController.isLikelyDashMimeType(probeMimeType));

    if (!isAdaptiveManifest) {
      if (loadToken === this.manifestLoadToken) {
        this.manifestLoading = false;
        this.refreshTrackDialogs();
      }
      return;
    }

    if (!masterUrl) {
      if (loadToken === this.manifestLoadToken) {
        this.manifestLoading = false;
        this.refreshTrackDialogs();
      }
      return;
    }

    try {
      const headers = this.getCurrentStreamRequestHeaders(currentCandidate);
      const manifestFetchTimeoutMs = 5000;
      const fetchManifestText = async (url, requestHeaders = {}) => {
        const requestController =
          typeof AbortController === "function" ? new AbortController() : null;
        let requestTimeoutId = null;
        try {
          const timeoutPromise = new Promise((_, reject) => {
            requestTimeoutId = setTimeout(() => {
              try {
                requestController?.abort?.();
              } catch (_) {
                // Ignore abort failures.
              }
              reject(new Error("Manifest fetch timeout"));
            }, manifestFetchTimeoutMs);
          });
          const response = await Promise.race([
            fetch(url, {
              method: "GET",
              headers: requestHeaders,
              signal: requestController?.signal
            }),
            timeoutPromise
          ]);
          const text = await response.text();
          return {
            text,
            finalUrl: response.url || url
          };
        } finally {
          if (requestTimeoutId) {
            clearTimeout(requestTimeoutId);
          }
        }
      };

      const urlCandidates = uniqueNonEmptyValues([
        masterUrl,
        runtimeUrl,
        playbackUrl,
        this.activePlaybackUrl
      ]);
      let selectedParsed = null;
      let selectedMasterUrl = masterUrl;

      for (const candidateUrl of urlCandidates) {
        let fetchedManifest = null;
        try {
          fetchedManifest = await fetchManifestText(candidateUrl, headers);
        } catch (_) {
          try {
            fetchedManifest = await fetchManifestText(candidateUrl, {});
          } catch (_) {
            fetchedManifest = null;
          }
        }

        if (loadToken !== this.manifestLoadToken) {
          return;
        }
        if (!fetchedManifest) {
          continue;
        }

        const parsed = this.parseManifestTracks(
          fetchedManifest.text,
          fetchedManifest.finalUrl || candidateUrl
        );
        const hasTracks = parsed.audioTracks.length || parsed.subtitleTracks.length;
        if (hasTracks) {
          selectedParsed = parsed;
          selectedMasterUrl = fetchedManifest.finalUrl || candidateUrl;
          break;
        }

        if (!selectedParsed && parsed.variants.length > 0) {
          selectedParsed = parsed;
          selectedMasterUrl = fetchedManifest.finalUrl || candidateUrl;
        }

        if (parsed.variants.length > 0) {
          const variant = parsed.variants[0];
          if (!variant?.uri) {
            continue;
          }
          try {
            const variantFetched = await fetchManifestText(variant.uri, headers);
            if (loadToken !== this.manifestLoadToken) {
              return;
            }
            const nestedParsed = this.parseManifestTracks(
              variantFetched.text,
              variantFetched.finalUrl || variant.uri
            );
            if (nestedParsed.audioTracks.length || nestedParsed.subtitleTracks.length) {
              selectedParsed = nestedParsed;
              selectedMasterUrl = variantFetched.finalUrl || variant.uri;
              break;
            }
            if (!selectedParsed && nestedParsed.variants.length > 0) {
              selectedParsed = nestedParsed;
              selectedMasterUrl = variantFetched.finalUrl || variant.uri;
            }
          } catch (_) {
            try {
              const variantFetchedNoHeaders = await fetchManifestText(variant.uri, {});
              if (loadToken !== this.manifestLoadToken) {
                return;
              }
              const nestedParsed = this.parseManifestTracks(
                variantFetchedNoHeaders.text,
                variantFetchedNoHeaders.finalUrl || variant.uri
              );
              if (nestedParsed.audioTracks.length || nestedParsed.subtitleTracks.length) {
                selectedParsed = nestedParsed;
                selectedMasterUrl = variantFetchedNoHeaders.finalUrl || variant.uri;
                break;
              }
              if (!selectedParsed && nestedParsed.variants.length > 0) {
                selectedParsed = nestedParsed;
                selectedMasterUrl = variantFetchedNoHeaders.finalUrl || variant.uri;
              }
            } catch (_) {
              // Ignore nested manifest failures.
            }
          }
        }
      }

      if (!selectedParsed) {
        return;
      }

      this.manifestMasterUrl = selectedMasterUrl || masterUrl;
      this.manifestAudioTracks = selectedParsed.audioTracks;
      this.manifestSubtitleTracks = selectedParsed.subtitleTracks;
      this.manifestVariants = selectedParsed.variants;
      this.selectedManifestAudioTrackId =
        selectedParsed.audioTracks.find((track) => track.isDefault)?.id ||
        selectedParsed.audioTracks[0]?.id ||
        null;
      this.selectedManifestSubtitleTrackId =
        selectedParsed.subtitleTracks.find((track) => track.isDefault)?.id || null;
      this.refreshTrackDialogs();
      this.promoteHlsManifestSubtitlePlayback(selectedMasterUrl || masterUrl);
    } catch (_error) {
      // Ignore parsing failures on providers that block manifest fetch.
    } finally {
      if (loadToken === this.manifestLoadToken) {
        this.manifestLoading = false;
        this.refreshTrackDialogs();
      }
    }
  },

  promoteHlsManifestSubtitlePlayback(manifestUrl = this.manifestMasterUrl) {
    const targetUrl = String(manifestUrl || this.activePlaybackUrl || "").trim();
    if (!targetUrl || !this.manifestSubtitleTracks.length) {
      return false;
    }
    if (String(PlayerController.playbackEngine || "") === "hls.js") {
      return false;
    }
    if (typeof PlayerController.canUseHlsJs !== "function" || !PlayerController.canUseHlsJs()) {
      return false;
    }
    if (this.hlsManifestSubtitlePromotionUrls.has(targetUrl)) {
      return false;
    }
    this.hlsManifestSubtitlePromotionUrls.add(targetUrl);
    void this.playStreamByUrl(targetUrl, {
      preservePanel: true,
      preservePlaybackState: true,
      resetSilentAudioState: false,
      forceEngine: "hls.js"
    });
    return true;
  },

  pickManifestVariant({ audioGroupId = null, subtitleGroupId = null } = {}) {
    if (!this.manifestVariants.length) {
      return null;
    }

    const byAudio = audioGroupId
      ? this.manifestVariants.filter((variant) => variant.audioGroupId === audioGroupId)
      : this.manifestVariants.slice();
    const candidatePool = byAudio.length ? byAudio : this.manifestVariants;

    let scopedCandidates = candidatePool;
    if (subtitleGroupId) {
      const bySubtitle = candidatePool.filter(
        (variant) => variant.subtitleGroupId === subtitleGroupId
      );
      if (bySubtitle.length) {
        scopedCandidates = bySubtitle;
      }
    } else if (subtitleGroupId === null) {
      const withoutSubtitle = candidatePool.filter((variant) => !variant.subtitleGroupId);
      if (withoutSubtitle.length) {
        scopedCandidates = withoutSubtitle;
      }
    }

    const capabilityProbe =
      typeof PlayerController.getPlaybackCapabilities === "function"
        ? PlayerController.getPlaybackCapabilities()
        : null;
    const supports = (key, fallback = true) => {
      if (!capabilityProbe) {
        return fallback;
      }
      return Boolean(capabilityProbe[key]);
    };

    const scoreVariant = (variant) => {
      if (!variant) {
        return Number.NEGATIVE_INFINITY;
      }
      let score = 0;
      const codecs = String(variant.codecs || "").toLowerCase();
      const resolution = String(variant.resolution || "").toLowerCase();
      const bandwidth = Number(variant.bandwidth || 0);

      const resolutionMatch = resolution.match(/^(\d+)\s*x\s*(\d+)$/i);
      const width = Number(resolutionMatch?.[1] || 0);
      const height = Number(resolutionMatch?.[2] || 0);
      if (width >= 3840 || height >= 2160) score += 60;
      else if (width >= 1920 || height >= 1080) score += 40;
      else if (width >= 1280 || height >= 720) score += 20;
      else if (width > 0 || height > 0) score += 8;

      if (Number.isFinite(bandwidth) && bandwidth > 0) {
        score += Math.min(30, Math.round((bandwidth / 1000000) * 3));
      }

      if (codecs.includes("dvh1") || codecs.includes("dvhe")) {
        score += supports("dolbyVision", true) ? 18 : -100;
      }
      if (codecs.includes("hvc1") || codecs.includes("hev1")) {
        score += supports("mp4Hevc", true) || supports("mp4HevcMain10", true) ? 14 : -90;
      }
      if (codecs.includes("av01")) {
        score += supports("mp4Av1", true) ? 10 : -80;
      }
      if (codecs.includes("vp9")) {
        score += supports("webmVp9", true) ? 8 : -60;
      }
      if (codecs.includes("ec-3") || codecs.includes("eac3")) {
        score += supports("audioEac3", true) ? 10 : -50;
      }
      if (codecs.includes("ac-3") || codecs.includes("ac3")) {
        score += supports("audioAc3", true) ? 6 : -35;
      }

      return score;
    };

    return (
      scopedCandidates.slice().sort((left, right) => scoreVariant(right) - scoreVariant(left))[0] ||
      null
    );
  },

  applyManifestTrackSelection({ audioTrackId, subtitleTrackId } = {}) {
    if (audioTrackId !== undefined) {
      this.selectedManifestAudioTrackId = audioTrackId;
    }
    if (subtitleTrackId !== undefined) {
      this.selectedManifestSubtitleTrackId = subtitleTrackId;
    }

    const selectedAudio =
      this.manifestAudioTracks.find((track) => track.id === this.selectedManifestAudioTrackId) ||
      null;
    const selectedSubtitle =
      this.manifestSubtitleTracks.find(
        (track) => track.id === this.selectedManifestSubtitleTrackId
      ) || null;
    const variant = this.pickManifestVariant({
      audioGroupId: selectedAudio?.groupId || null,
      subtitleGroupId: selectedSubtitle ? selectedSubtitle.groupId || null : null
    });

    if (!variant?.uri) {
      this.refreshTrackDialogs();
      return;
    }

    const targetUrl = variant.uri;
    if (targetUrl === this.activePlaybackUrl) {
      this.refreshTrackDialogs();
      return;
    }

    const video = PlayerController.video;
    const restoreTimeSeconds = this.getPlaybackCurrentSeconds();
    const restorePaused = Boolean(this.paused || video?.paused);
    this.pendingPlaybackRestore = {
      timeSeconds: Number.isFinite(restoreTimeSeconds) ? restoreTimeSeconds : 0,
      paused: restorePaused,
      attempts: 0,
      lastAttemptAt: 0
    };

    this.activePlaybackUrl = targetUrl;
    this.resetPictureInPictureAvailability();
    const currentStreamCandidate = this.getCurrentStreamCandidate();
    this.paused = false;
    this.hasPresentedPlaybackFrame = false;
    this.startupPlaybackBaselineSeconds = null;
    this.startupPlaybackHasAdvanced = false;
    this.loadingVisible = true;
    this.loadingProgress = null;
    this.loadingLogoFillActive = false;
    this.loadingLogoFillProgress = 0;
    this.loadingLogoFillTarget = 0;
    this.syncLoadingOverlayProgress();
    this.updateLoadingVisibility();
    this.enableStartupAudioGate();
    this.startPlayerControllerPlayback(
      targetUrl,
      this.buildPlaybackContext(currentStreamCandidate),
      { sourceCandidate: currentStreamCandidate }
    );
    this.schedulePlaybackStallGuard();
    this.setControlsVisible(true, { focus: false });
  },

  renderPlayerUi() {
    StartupLoadingOverlay.setBackHandler(() => this.navigateBackToStreamScreen());
    this.uiRefs = null;
    this.lastUiTickState = null;
    this.container.querySelector("#playerUiRoot")?.remove();

    const root = document.createElement("div");
    root.id = "playerUiRoot";
    root.className =
      "player-ui-root" +
      (Environment.isBrowser() && !this.isExternalFrameMode() ? " player-presentation" : "");
    root.tabIndex = -1;

    if (this.isExternalFrameMode()) {
      StartupLoadingOverlay.finish();
      root.innerHTML = `
        <div class="player-external-frame-shell">
          <iframe
            class="player-external-frame"
            src="${escapeHtml(this.externalFrameUrl)}"
            title="${escapeHtml(this.params.playerTitle || "Trailer")}"
            allow="autoplay; encrypted-media; picture-in-picture"
            referrerpolicy="strict-origin-when-cross-origin"
            allowfullscreen
            scrolling="no"
          ></iframe>
        </div>
      `;
    } else {
      const header = this.getPlayerHeaderData();
      const loadingMeta = this.getLoadingOverlayMeta();
      const osdClockEnabled = Boolean(PlayerSettingsStore.get().osdClockEnabled);
      root.innerHTML = `
        <div id="playerLoadingOverlay" class="player-loading-overlay">
          <button type="button" class="startup-loading-back focusable" data-player-loading-back aria-label="Back"><img class="player-desktop-back-icon" src="assets/icons/ic_player_back.svg" alt="" aria-hidden="true" /></button>
          <div class="player-loading-backdrop"${loadingMeta.backdropUrl ? ` style="background-image:url('${loadingMeta.backdropUrl}')"` : ""}></div>
          <div class="player-loading-gradient"></div>
          <div class="player-loading-center">
            <div class="player-loading-identity${loadingMeta.logoUrl ? " has-logo" : ""}">
              ${
                loadingMeta.logoUrl
                  ? `
                <div class="player-loading-logo-stack">
                  <img class="player-loading-logo player-loading-logo-base" src="${escapeAttribute(loadingMeta.logoUrl)}" alt="${escapeAttribute(loadingMeta.title || "logo")}" />
                  <div class="player-loading-logo-fill-clip hidden">
                    <img class="player-loading-logo player-loading-logo-fill" src="${escapeAttribute(loadingMeta.logoUrl)}" alt="" aria-hidden="true" />
                  </div>
                </div>
              `
                  : ""
              }
              <div class="player-loading-title">${escapeHtml(loadingMeta.title || this.params.playerTitle || this.params.itemId || "Nuvio")}</div>
            </div>
            <div class="player-loading-subtitle${loadingMeta.subtitle ? "" : " hidden"}">${escapeHtml(loadingMeta.subtitle || "")}</div>
            <div class="player-loading-status hidden"></div>
          </div>
        </div>

        <div id="playerBufferingSpinner" class="player-loading-spinner hidden" aria-hidden="true">
          ${renderLoadingIndicator({ className: "player-loading-spinner-ring" })}
          <div class="player-loading-status player-loading-spinner-status hidden"></div>
        </div>

        <div id="playerStartupErrorOverlay" class="player-startup-error-overlay hidden" aria-hidden="true"></div>

        <div id="playerTorrentOverlay" class="player-torrent-overlay hidden" aria-hidden="true">
          <div class="player-torrent-overlay-row">
            <span class="player-torrent-overlay-tag">P2P</span>
            <span class="player-torrent-overlay-speed"></span>
          </div>
          <div class="player-torrent-overlay-detail"></div>
        </div>

        <div id="playerParentalGuide" class="player-parental-guide hidden"></div>
        <div id="playerSkipIntro" class="player-skip-intro hidden"></div>

        <div id="playerAspectToast" class="player-aspect-toast hidden" role="status" aria-live="polite"></div>
        <div id="playerGestureFeedback" class="player-gesture-feedback hidden" aria-live="polite"></div>

        <div id="playerHtmlSubtitles" class="player-html-subtitles hidden" aria-hidden="true"></div>
        <div id="playerNativeSubtitles" class="player-html-subtitles player-native-subtitles hidden" aria-hidden="true"><div class="player-native-subtitle-lines"></div></div>

        <div id="playerSeekOverlay" class="player-seek-overlay hidden">
          <div class="player-seek-overlay-track"><div id="playerSeekFill" class="player-seek-fill"></div></div>
          <div class="player-seek-overlay-bottom">
            <span id="playerSeekDirection" class="player-seek-direction"></span>
            <span id="playerSeekPreview" class="player-seek-preview">0:00 / 0:00</span>
          </div>
        </div>

        <div id="playerPauseOverlay" class="player-pause-overlay hidden"></div>

        <div id="playerNextEpisodeCard" class="player-next-episode-card hidden"></div>

        <div id="playerModalBackdrop" class="player-modal-backdrop hidden"></div>
        <div id="playerSubtitleDialog" class="player-modal player-subtitle-modal hidden"></div>
        <div id="playerAudioDialog" class="player-modal player-audio-modal hidden"></div>
        <div id="playerSpeedDialog" class="player-modal player-speed-modal hidden"></div>
        <div id="playerMobileMorePanel" class="player-mobile-more-panel hidden"></div>
        <div id="playerSourcesPanel" class="player-sources-panel hidden"></div>

        ${
          Environment.isBrowser()
            ? this.renderBrowserPlayerChrome(header, osdClockEnabled)
            : `        <div id="playerControlsOverlay" class="player-controls-overlay">
          <div class="player-controls-gradient player-controls-gradient-top"></div>
          <div class="player-controls-gradient player-controls-gradient-bottom"></div>

          <div class="player-controls-top${osdClockEnabled ? "" : " hidden"}">
            <div id="playerClock" class="player-clock">--:--</div>
            <div id="playerEndsAt" class="player-ends-at">${escapeHtml(t("player_ends_at", ["--:--"], "Ends at %1$s"))}</div>
          </div>

          <div class="player-controls-bottom">
            <div class="player-meta">
              <div class="player-title">${escapeHtml(header.title)}</div>
              ${header.subtitle ? `<div class="player-subtitle">${escapeHtml(header.subtitle)}</div>` : ""}
              ${header.meta ? `<div class="player-meta-tertiary">${escapeHtml(header.meta)}</div>` : ""}
            </div>

            <div class="player-controls-bar">
              <div id="playerProgressShell" class="player-progress-shell focusable" tabindex="-1" data-player-pointer-action="progress">
                <div id="playerProgressHover" class="player-progress-hover hidden" aria-hidden="true"></div>
                <div class="player-progress-track">
                  <div id="playerProgressBuffered" class="player-progress-buffered"></div>
                  <div id="playerProgressFill" class="player-progress-fill"></div>
                </div>
              </div>

              <div class="player-controls-row">
                <div id="playerControlButtons" class="player-control-buttons"></div>
                ${Environment.isBrowser() ? '<div class="player-controls-right">' : ""}
                  <div id="playerTimeLabel" class="player-time-label">0:00 / 0:00</div>
                  ${this.renderDesktopPlaybackTools()}
                ${Environment.isBrowser() ? "</div>" : ""}
              </div>
            </div>
          </div>
        </div>`
        }
      `;
    }

    const desktopBackButton = this.renderDesktopBackButton();
    if (desktopBackButton) {
      root.insertAdjacentHTML("beforeend", desktopBackButton);
    }

    this.container.appendChild(root);
    if (Environment.isBrowser() && !this.isExternalFrameMode()) {
      this.browserOrientation?.destroy();
      this.browserOrientation = createPlayerOrientation(this.container, {
        preference: this.params?.playerOrientationPreference || "landscape",
        onChange: (state) => {
          this.params.playerOrientationPreference = state.preference;
          this.scheduleDesktopPlayerViewportSync();
        }
      });
    }
    this.cachePlayerUiRefs(root);
    this.configureProposalPresentation?.();
    this.syncPlayerOverlayLayoutState();
    this.bindLoadingLogoFallback();
    if (!this.isExternalFrameMode()) {
      this.renderControlButtons();
      this.renderSubtitleDialog();
      this.renderAudioDialog();
      this.renderSpeedDialog();
      this.renderSourcesPanel();
      this.renderParentalGuideOverlay();
      this.renderSkipIntroButton();
      this.renderSeekOverlay();
      this.renderPauseOverlay();
      this.renderNextEpisodeCard();
    }
  },

  renderDesktopBackButton() {
    if (!Environment.isBrowser()) {
      return "";
    }
    return `
      <button class="player-desktop-back-button" type="button" tabindex="-1" data-player-desktop-back data-back-style="${this.shouldReturnToStreamOnBack() ? "stream" : "detail"}"
              aria-label="${escapeHtml(t("common.back", {}, "Back"))}">
        <img class="player-desktop-back-icon" src="assets/icons/ic_player_back.svg" alt="" aria-hidden="true" />
      </button>
    `;
  },

  renderDesktopPlaybackTools() {
    if (!Environment.isBrowser()) {
      return "";
    }
    this.detectDesktopSoftwareVolume?.();
    const { volume, muted } = this.getDesktopVolumeState();
    const volumePercent = muted ? 0 : Math.round(volume * 100);
    const pictureInPictureAvailable = this.isDesktopPictureInPictureSupported();
    return `
      <div class="player-desktop-playback-tools" aria-label="Playback controls">
        <button class="player-desktop-tool-button" type="button" tabindex="-1" data-player-desktop-action="mute"
                title="${escapeHtml(muted ? "Unmute" : "Mute")}" aria-label="${escapeHtml(muted ? "Unmute" : "Mute")}">
          <img class="player-desktop-tool-icon" data-player-desktop-mute-icon src="assets/icons/${muted ? "ic_player_volume_muted.svg" : "ic_player_volume.svg"}" alt="" aria-hidden="true" />
        </button>
        <input class="player-desktop-volume" type="range" min="0" max="100" step="1"
               value="${volumePercent}" data-player-desktop-volume aria-label="Volume" ${this.desktopVolumeReadOnly !== false ? "hidden disabled" : ""} />
        ${
          pictureInPictureAvailable
            ? `<button class="player-desktop-tool-button" type="button" tabindex="-1" data-player-desktop-action="picture-in-picture"
                  title="Enter Picture-in-Picture" aria-label="Enter Picture-in-Picture">
                <img class="player-desktop-tool-icon" src="assets/icons/ic_player_picture_in_picture.svg" alt="" aria-hidden="true" />
              </button>`
            : ""
        }
        <button class="player-desktop-tool-button" type="button" tabindex="-1" data-player-desktop-action="fullscreen" ${this.getDesktopFullscreenCapability() ? "" : "hidden disabled"}
                title="Enter fullscreen" aria-label="Enter fullscreen">
          <img class="player-desktop-tool-icon player-desktop-fullscreen-icon" data-player-desktop-fullscreen-icon src="assets/icons/ic_player_fullscreen.svg" alt="" aria-hidden="true" />
        </button>
      </div>
    `;
  },

  getExternalPlayerContext() {
    if (!Environment.isBrowser()) return null;
    const mediaUrl = String(
      this.activePlaybackUrl || this.getCurrentStreamCandidate()?.url || ""
    ).trim();
    if (!isTransferableExternalMediaUrl(mediaUrl)) return null;
    const selectedSubtitle = (this.subtitles || []).find((subtitle) => {
      return addonSubtitleSelectionId(subtitle) === this.selectedAddonSubtitleId;
    });
    const uiState = this.getPlayerUiState();
    return {
      mediaUrl,
      title: uiState.currentEpisodeTitle || uiState.title || "",
      subtitleUrl: selectedSubtitle?.url || ""
    };
  },

  canOpenInExternalPlayer() {
    return Boolean(
      this.getExternalPlayerContext() && getManualBrowserExternalPlayerOptions().length
    );
  },

  openExternalPlayerChooser() {
    if (!this.canOpenInExternalPlayer()) return false;
    this.externalPlayerChooserDialog?.destroy?.();
    this.externalPlayerChooserDialog = new NuvioDialog({
      title: "Open in external player",
      subtitle: "Choose a player",
      widthVw: 32,
      panelClassName: "desktop-external-player-dialog",
      actionsClassName: "desktop-external-player-actions",
      buttons: [
        ...getManualBrowserExternalPlayerOptions().map((player) => ({
          label:
            player === "lenna"
              ? "Lenna"
              : player === "infuse"
                ? "Infuse"
                : player === "outplayer"
                  ? "Outplayer"
                  : "VLC",
          className: "desktop-external-player-choice",
          content: () => {
            const copy = document.createElement("span");
            const playerName =
              player === "lenna"
                ? "Lenna"
                : player === "infuse"
                  ? "Infuse"
                  : player === "outplayer"
                    ? "Outplayer"
                    : "VLC";
            copy.className = "desktop-external-player-choice-copy";
            copy.innerHTML = `<strong>${playerName}</strong><small>Open this stream in ${playerName}</small>`;
            return copy;
          },
          onAction: () => {
            this.externalPlayerChooserDialog?.destroy?.();
            this.launchExternalPlayer(player);
          }
        })),
        {
          label: "Copy Stream Link",
          className: "desktop-external-player-choice",
          onAction: async () => {
            const copied = await copyBrowserExternalStreamLink({
              mediaUrl: this.getExternalPlayerContext()?.mediaUrl
            });
            this.externalPlayerChooserDialog?.destroy?.();
            this.showAspectToast(copied ? "Stream link copied" : "Could not copy stream link");
          }
        },
        {
          label: "Cancel",
          className: "desktop-external-player-cancel",
          onAction: () => this.externalPlayerChooserDialog?.destroy?.()
        }
      ],
      onDismiss: () => {
        this.externalPlayerChooserDialog = null;
      }
    }).mount(document.body);
    return true;
  },

  async launchExternalPlayer(player) {
    const context = this.getExternalPlayerContext();
    if (!context) return false;
    const settings = PlayerSettingsStore.get();
    const progressMode = settings.externalPlayerProgress === "manual" ? "manual" : "automatic";
    const returnMethod = settings.externalReturnMethod;
    const prepared = prepareBrowserExternalPlaybackLaunch({
      player,
      platform: getBrowserExternalPlayerPlatform(),
      progressMode,
      returnMethod,
      resumePositionSeconds: this.getExternalPlayerResumeSeconds(),
      knownDurationMs: this.getExternalPlayerKnownDurationMs(),
      progressContext: PlayerController.createProgressContext?.(),
      ...context
    });
    if (!prepared?.launch?.href) {
      return false;
    }
    if (prepared.handoff) {
      PlayerController.beginExternalPlaybackHandoff?.(prepared.handoff);
    }
    // Return notifications are optional: the binding helper resolves false on
    // unsupported, unavailable, or failed Push paths and must not alter launch.
    // An Automation already brings the person back, so asking the relay for a
    // notification too would arrive for an app they are already looking at.
    // The subscription itself is left alone: it carries every other
    // notification the app sends, so cancelling it here would cost more than
    // this one message is worth.
    if (returnMethod !== "automation") {
      await bindBrowserPushReturn({ token: prepared.handoff?.token });
    }
    launchBrowserExternalPlayer({ href: prepared.launch.href });
    return true;
  },

  getExternalPlayerResumeSeconds() {
    if (this.params?.startFromBeginning) return 0;
    const activeSeconds = Number(this.getPlaybackCurrentSeconds());
    if (Number.isFinite(activeSeconds) && activeSeconds > 0) return activeSeconds;
    return resolveExternalResumeSeconds({
      positionMs: this.params?.resumePositionMs,
      progressPercent: this.params?.resumeProgressPercent,
      durationMs: this.params?.resumeDurationMs || this.getExternalPlayerKnownDurationMs()
    });
  },

  getExternalPlayerKnownDurationMs() {
    const playbackDurationMs = Math.max(0, Number(this.getPlaybackDurationSeconds() || 0)) * 1000;
    if (playbackDurationMs > 0) return playbackDurationMs;
    const routeDurationMs = Math.max(0, Number(this.params?.resumeDurationMs || 0));
    if (routeDurationMs > 0) return routeDurationMs;
    return Math.max(0, Number(this.params?.runtime || this.params?.runtimeMinutes || 0)) * 60_000;
  },

  showExternalPlaybackManualFallback(handoff) {
    if (!handoff?.progressContext?.itemId || this.externalPlaybackReturnDialog) return false;
    let submitting = false;
    const title =
      handoff.progressContext.episodeTitle || handoff.progressContext.title || "this title";
    const close = () => {
      this.externalPlaybackReturnDialog?.destroy?.();
      this.externalPlaybackReturnDialog = null;
    };
    const consume = () => clearExternalPlaybackHandoff();
    this.externalPlaybackReturnDialog = new NuvioDialog({
      title: "How did your playback go?",
      subtitle: title,
      widthVw: 32,
      panelClassName: "desktop-external-player-dialog",
      actionsClassName: "desktop-external-player-actions desktop-external-player-manual-actions",
      buttons: [
        {
          label: "Keep current progress",
          className: "desktop-external-player-manual-keep",
          onAction: () => {
            consume();
            close();
          }
        },
        {
          label: "Set playback position",
          className: "desktop-external-player-manual-set",
          onAction: () => {
            close();
            this.showExternalPlaybackPositionDialog(handoff);
          }
        },
        {
          label: "Mark as finished",
          className: "desktop-external-player-primary desktop-external-player-manual-finish",
          onAction: async () => {
            if (submitting) return;
            submitting = true;
            const applied = await markBrowserExternalPlaybackFinished({
              handoff,
              controller: PlayerController
            });
            if (!applied) {
              submitting = false;
              this.showAspectToast("Could not mark as finished");
              return;
            }
            consume();
            close();
            this.showAspectToast("Marked as finished");
          }
        }
      ],
      onDismiss: () => {
        this.externalPlaybackReturnDialog = null;
      }
    }).mount(document.body);
    return true;
  },

  /**
   * Takes the prompt away once the real report turns up.
   *
   * The prompt asks where the viewer got to. A report that arrives afterwards
   * answers that exactly, so leaving the prompt up invites a guess to be
   * written over the true position.
   */
  dismissExternalPlaybackManualFallback() {
    if (!this.externalPlaybackReturnDialog) return false;
    this.externalPlaybackReturnDialog.destroy?.();
    this.externalPlaybackReturnDialog = null;
    return true;
  },

  showExternalPlaybackPositionDialog(handoff) {
    const manualDurationMs = Math.max(0, Number(handoff.knownDurationMs || 0));
    const inputs = [];
    let error = null;
    let saveButton = null;
    let submitting = false;
    const validate = () =>
      validateExternalPlaybackPositionParts(
        inputs[0]?.value,
        inputs[1]?.value,
        inputs[2]?.value,
        manualDurationMs
      );
    const updateSaveState = ({ showError = false } = {}) => {
      const result = validate();
      if (saveButton) {
        saveButton.disabled = submitting || !result.valid;
        saveButton.setAttribute("aria-disabled", String(submitting || !result.valid));
      }
      if (error) error.textContent = showError || !result.valid ? result.message : "";
      return result;
    };
    const content = () => {
      const wrapper = document.createElement("div");
      wrapper.className = "desktop-external-player-choice-copy";
      const runtime = formatExternalPlaybackDuration(manualDurationMs) || "Unknown";
      wrapper.innerHTML = `<small>Runtime: ${runtime}</small>`;
      const fields = document.createElement("div");
      fields.className = "desktop-external-player-time-fields";
      ["HH", "MM", "SS"].forEach((label, index) => {
        const input = document.createElement("input");
        input.type = "text";
        input.inputMode = "numeric";
        input.maxLength = 2;
        input.placeholder = label;
        input.className = "desktop-external-player-time-input";
        input.setAttribute("data-nuvio-dialog-preserve-deletion", "");
        input.setAttribute(
          "aria-label",
          label === "HH" ? "Hours" : label === "MM" ? "Minutes" : "Seconds"
        );
        input.addEventListener("focus", () => {
          if (input.value.length >= 2) input.select();
        });
        input.addEventListener("input", () => {
          input.value = input.value.replace(/\D/g, "").slice(0, 2);
          if (input.value.length >= 2 && inputs[index + 1]) inputs[index + 1].focus();
          updateSaveState();
        });
        input.addEventListener("keydown", (event) => {
          if (event.key !== "Backspace" && event.key !== "Delete") return;
          event.stopPropagation();
          if (event.key === "Backspace" && !input.value && inputs[index - 1])
            inputs[index - 1].focus();
        });
        inputs.push(input);
        fields.appendChild(input);
        if (index < 2) {
          const separator = document.createElement("span");
          separator.className = "desktop-external-player-time-separator";
          separator.textContent = ":";
          separator.setAttribute("aria-hidden", "true");
          fields.appendChild(separator);
        }
      });
      wrapper.appendChild(fields);
      error = document.createElement("small");
      error.className = "nuvio-dialog-error";
      wrapper.appendChild(error);
      return wrapper;
    };
    const close = () => {
      this.externalPlaybackPositionDialog?.destroy?.();
      this.externalPlaybackPositionDialog = null;
    };
    this.externalPlaybackPositionDialog = new NuvioDialog({
      title: "Set playback position",
      content,
      widthVw: 32,
      panelClassName: "desktop-external-player-dialog",
      actionsClassName: "desktop-external-player-actions",
      buttons: [
        {
          label: "Save",
          onAction: async () => {
            if (submitting) return;
            const result = updateSaveState({ showError: true });
            if (!result.valid) return;
            submitting = true;
            updateSaveState();
            try {
              const applied = await PlayerController.applyExternalPlaybackReport({
                handoff,
                outcome: "stopped",
                positionSeconds: result.positionMs / 1000,
                durationSeconds: externalPlaybackReportDurationSeconds(manualDurationMs)
              });
              if (!applied) throw new Error("Progress was not applied");
              clearExternalPlaybackHandoff();
              close();
              this.showAspectToast("Playback position saved");
            } catch (_) {
              submitting = false;
              if (error) error.textContent = "Could not save playback position. Try again.";
              updateSaveState();
            }
          }
        },
        {
          label: "Back",
          onAction: () => {
            close();
            this.showExternalPlaybackManualFallback(handoff);
          }
        }
      ],
      onDismiss: () => {
        this.externalPlaybackPositionDialog = null;
      }
    }).mount(document.body);
    saveButton = this.externalPlaybackPositionDialog?._buttonEls?.[0] || null;
    updateSaveState();
  },

  isCompactBrowserPlayerToolbar() {
    return Boolean(
      Environment.isBrowser() &&
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(max-width: 600px) and (orientation: portrait)").matches
    );
  },

  scheduleDesktopPlayerViewportSync() {
    if (!Environment.isBrowser()) {
      return;
    }
    if (this.desktopPlayerViewportSyncFrame) {
      cancelAnimationFrame(this.desktopPlayerViewportSyncFrame);
    }
    if (this.desktopPlayerViewportSyncFollowupFrame) {
      cancelAnimationFrame(this.desktopPlayerViewportSyncFollowupFrame);
      this.desktopPlayerViewportSyncFollowupFrame = null;
    }
    // fullscreenchange fires before the browser has necessarily painted the
    // fullscreen viewport. Mobile orientation changes can likewise publish a
    // resize before #player has received its final dynamic viewport bounds.
    // Reuse the existing aspect path once immediately and once on the next
    // paint without changing playback state or writing a separate layout model.
    const syncLayout = () => {
      this.applyAspectMode({ showToast: false });
      this.updateBrowserNativeSubtitleOffset();
      this.syncDesktopPlaybackTools();
      this.fitPauseOverlay();
      this.positionTrackDialogs();
      this.renderControlButtons();
    };
    this.desktopPlayerViewportSyncFrame = requestAnimationFrame(() => {
      this.desktopPlayerViewportSyncFrame = null;
      syncLayout();
      this.desktopPlayerViewportSyncFollowupFrame = requestAnimationFrame(() => {
        this.desktopPlayerViewportSyncFollowupFrame = null;
        syncLayout();
      });
    });
  },

  bindDesktopPlayerPointerBridge() {
    if (!Environment.isBrowser() || !this.container || this.boundDesktopPlayerClickHandler) {
      return;
    }

    this.boundDesktopPlayerPointerMoveHandler = (event) => {
      this.updateProgressHover(event);
      const activePointer = this.desktopProgressPointer;
      if (activePointer && Number(event.pointerId) === Number(activePointer.pointerId)) {
        const deltaX = playerLocalPoint(event, this.browserOrientation).x - activePointer.startX;
        const deltaY = playerLocalPoint(event, this.browserOrientation).y - activePointer.startY;
        if (!activePointer.dragging && Math.hypot(deltaX, deltaY) > 2) {
          activePointer.dragging = true;
        }
        if (activePointer.dragging) {
          event.preventDefault?.();
          this.seekProgressFromPointer(event, activePointer.shell);
        }
        return;
      }

      this.revealDesktopPlayerControls();
    };

    this.boundDesktopPlayerPointerDownHandler = (event) => {
      if (event.button !== 0 || event.isPrimary === false) {
        return;
      }
      const target = event.target;
      if (!(target instanceof Element)) {
        return;
      }
      const shell = target.closest(".player-progress-shell");
      if (!(shell instanceof HTMLElement) || !this.container.contains(shell)) {
        return;
      }
      this.desktopProgressPointer = {
        pointerId: event.pointerId,
        startX: playerLocalPoint(event, this.browserOrientation).x,
        startY: playerLocalPoint(event, this.browserOrientation).y,
        shell,
        dragging: false
      };
      try {
        shell.setPointerCapture?.(event.pointerId);
      } catch (_) {
        // Pointer capture is best effort; a click still follows the existing path.
      }
      this.revealDesktopPlayerControls();
    };

    const finishProgressPointer = (event, { cancelled = false } = {}) => {
      const activePointer = this.desktopProgressPointer;
      if (!activePointer || Number(event.pointerId) !== Number(activePointer.pointerId)) {
        return;
      }
      if (activePointer.dragging && !cancelled) {
        event.preventDefault?.();
        this.seekProgressFromPointer(event, activePointer.shell);
        // Only the native click emitted by this completed drag is ignored. A
        // normal progress click still reaches onPointerActivate below.
        this.desktopSuppressProgressClick = true;
        if (this.desktopProgressClickSuppressTimer) {
          clearTimeout(this.desktopProgressClickSuppressTimer);
        }
        this.desktopProgressClickSuppressTimer = setTimeout(() => {
          this.desktopSuppressProgressClick = false;
          this.desktopProgressClickSuppressTimer = null;
        }, 0);
      }
      try {
        activePointer.shell.releasePointerCapture?.(event.pointerId);
      } catch (_) {
        // Capture may already have been released by the browser.
      }
      this.desktopProgressPointer = null;
      this.revealDesktopPlayerControls();
    };

    this.boundDesktopPlayerPointerUpHandler = (event) => finishProgressPointer(event);
    this.boundDesktopPlayerPointerCancelHandler = (event) =>
      finishProgressPointer(event, { cancelled: true });

    this.boundDesktopPlayerClickHandler = (event) => {
      // Enter already activates the TV/D-pad focus target through onKeyDown.
      // Do not run its keyboard-generated browser click a second time.
      if (event.defaultPrevented || Number(event.detail || 0) === 0) {
        return;
      }
      const target = event.target;
      if (!(target instanceof Element)) {
        return;
      }

      const fallback = target.closest("[data-action='labelFallbackReason']");
      if (fallback && this.container.contains(fallback)) {
        event.preventDefault();
        event.stopPropagation();
        this.showAspectToast(fallback.dataset.reason, { durationMs: 10000 });
        return;
      }
      const backButton = target.closest("[data-player-desktop-back]");
      if (backButton && this.container.contains(backButton)) {
        void this.navigateDesktopPlayerBack();
        return;
      }

      // A browser click outside an open panel should use the same cleanup path
      // as Esc/Back, and must not fall through to the video play/pause click.
      if (this.dismissDesktopPlayerPanelFromPointer(target)) {
        return;
      }

      const progressShell = target.closest(".player-progress-shell");
      if (progressShell && this.container.contains(progressShell)) {
        if (this.desktopSuppressProgressClick) {
          this.desktopSuppressProgressClick = false;
          if (this.desktopProgressClickSuppressTimer) {
            clearTimeout(this.desktopProgressClickSuppressTimer);
            this.desktopProgressClickSuppressTimer = null;
          }
          return;
        }
        void this.onPointerActivate(progressShell, event);
        return;
      }

      const actionTarget = target.closest(
        ".player-control-btn[data-action], [data-player-loading-back], [data-player-pointer-action], [data-player-error-action], " +
          "[data-sources-zone], [data-subtitle-style-action], [data-subtitle-rail], " +
          "[data-audio-step], [data-audio-column], [data-proposal-subtitle-language], [data-speed-index], [data-episode-action], " +
          "[data-episode-stream-action], [data-episode-stream-filter-index], " +
          "[data-episode-stream-index], [data-player-download-index], [data-episode-season-index], [data-episode-index], " +
          "[data-player-desktop-action], [data-player-desktop-volume]"
      );
      if (actionTarget && this.container.contains(actionTarget)) {
        void this.onPointerActivate(actionTarget, event);
        return;
      }
    };

    this.boundDesktopPlayerPointerLeaveHandler = () => this.updateProgressHover(null);
    this.container.addEventListener("pointerleave", this.boundDesktopPlayerPointerLeaveHandler);
    this.container.addEventListener("pointermove", this.boundDesktopPlayerPointerMoveHandler);
    this.container.addEventListener("pointerdown", this.boundDesktopPlayerPointerDownHandler);
    this.container.addEventListener("pointerup", this.boundDesktopPlayerPointerUpHandler);
    this.container.addEventListener("pointercancel", this.boundDesktopPlayerPointerCancelHandler);
    this.container.addEventListener("click", this.boundDesktopPlayerClickHandler);
    this.boundDesktopPlayerInputHandler = (event) => {
      const volumeInput = event.target?.closest?.("[data-player-desktop-volume]");
      if (!volumeInput || !this.container.contains(volumeInput)) {
        return;
      }
      this.setDesktopVolume(Number(volumeInput.value) / 100);
      this.revealDesktopPlayerControls();
    };
    this.container.addEventListener("input", this.boundDesktopPlayerInputHandler);
    this.boundDesktopPlayerChangeHandler = (event) => {
      const size = event.target?.closest?.("[data-proposal-subtitle-size]");
      if (size && this.container.contains(size)) {
        this.subtitleStyleSettings = {
          ...this.subtitleStyleSettings,
          fontSize: Number(size.value)
        };
        this.schedulePersistPlayerPresentationSettings();
        this.applySubtitlePresentationSettings();
        this.renderSubtitleDialog();
      }
      const select = event.target?.closest?.("[data-player-episode-season]");
      if (select && this.container.contains(select))
        this.selectEpisodePanelSeason(Number(select.value));
      const source = event.target?.closest?.("[data-player-episode-source]");
      if (source && this.container.contains(source)) this.selectEpisodePanelSource(source.value);
      const currentSource = event.target?.closest?.("[data-player-source-filter]");
      if (currentSource && this.container.contains(currentSource)) {
        this.setSourceFilter(currentSource.value);
        this.renderSourcesPanel();
        this.uiRefs?.sourcesPanel
          ?.querySelector("[data-player-source-filter]")
          ?.focus({ preventScroll: true });
      }
    };
    this.container.addEventListener("change", this.boundDesktopPlayerChangeHandler);

    this.boundDesktopFullscreenChangeHandler = () => this.scheduleDesktopPlayerViewportSync();
    document.addEventListener("fullscreenchange", this.boundDesktopFullscreenChangeHandler);
    this.boundDesktopPlayerResizeHandler = () => this.scheduleDesktopPlayerViewportSync();
    window.addEventListener("resize", this.boundDesktopPlayerResizeHandler);
    this.boundDesktopPlayerOrientationChangeHandler = () =>
      this.scheduleDesktopPlayerViewportSync();
    window.addEventListener("orientationchange", this.boundDesktopPlayerOrientationChangeHandler);
    this.desktopPlayerVisualViewport = window.visualViewport || null;
    this.boundDesktopPlayerVisualViewportResizeHandler = () =>
      this.scheduleDesktopPlayerViewportSync();
    this.desktopPlayerVisualViewport?.addEventListener(
      "resize",
      this.boundDesktopPlayerVisualViewportResizeHandler
    );
    const video = this.getDesktopPlaybackVideo();
    if (video) {
      ["loadedmetadata", "webkitbeginfullscreen", "webkitendfullscreen"].forEach((name) =>
        video.addEventListener(name, this.boundDesktopFullscreenChangeHandler)
      );
      this.boundDesktopVolumeChangeHandler = () => this.syncDesktopPlaybackTools();
      video.addEventListener("volumechange", this.boundDesktopVolumeChangeHandler);
      this.boundDesktopPictureInPictureChangeHandler = () => this.syncDesktopPlaybackTools();
      video.addEventListener(
        "enterpictureinpicture",
        this.boundDesktopPictureInPictureChangeHandler
      );
      video.addEventListener(
        "leavepictureinpicture",
        this.boundDesktopPictureInPictureChangeHandler
      );
      video.addEventListener(
        "webkitpresentationmodechanged",
        this.boundDesktopPictureInPictureChangeHandler
      );
    }
    this.browserPlayerGestureCleanup?.();
    this.browserPlayerGestureCleanup = bindBrowserPlayerGestures(this.container, {
      getPoint: (event) => playerLocalPoint(event, this.browserOrientation),
      getSurfaceRect: () => playerLocalRect(this.container, this.browserOrientation),
      isInteractiveTarget: (target, event) => !this.isDesktopVideoAreaClick(target, event),
      onSeek: (zone) => this.seekBrowserPlayerGesture(zone),
      onSwipeStart: () => this.beginBrowserSwipeSeek(),
      onSwipeMove: (movement) => this.updateBrowserSwipeSeek(movement),
      onSwipeEnd: (result) => this.finishBrowserSwipeSeek(result),
      onHoldChange: (active) => this.setBrowserPlayerGestureHold(active),
      getSingleTapContext: () => ({ controlsWereVisible: this.controlsVisible }),
      onSingleTap: ({ controlsWereVisible } = {}) =>
        this.handleBrowserVideoAreaTap(Boolean(controlsWereVisible))
    });
    this.playerRailDragCleanup?.();
    this.playerRailDragCleanup = bindHorizontalRailDragScroll({
      container: this.container,
      trackSelector:
        ".player-episode-season-tabs, .player-dialog-tabs, .player-sources-filters, .player-episode-stream-filters"
    });
  },

  unbindDesktopPlayerPointerBridge() {
    this.playerRailDragCleanup?.();
    this.playerRailDragCleanup = null;
    if (!this.container || !this.boundDesktopPlayerClickHandler) {
      return;
    }
    this.container.removeEventListener("pointerleave", this.boundDesktopPlayerPointerLeaveHandler);
    this.container.removeEventListener("pointermove", this.boundDesktopPlayerPointerMoveHandler);
    this.container.removeEventListener("pointerdown", this.boundDesktopPlayerPointerDownHandler);
    this.container.removeEventListener("pointerup", this.boundDesktopPlayerPointerUpHandler);
    this.container.removeEventListener(
      "pointercancel",
      this.boundDesktopPlayerPointerCancelHandler
    );
    this.container.removeEventListener("click", this.boundDesktopPlayerClickHandler);
    this.container.removeEventListener("input", this.boundDesktopPlayerInputHandler);
    this.container.removeEventListener("change", this.boundDesktopPlayerChangeHandler);
    document.removeEventListener("fullscreenchange", this.boundDesktopFullscreenChangeHandler);
    window.removeEventListener("resize", this.boundDesktopPlayerResizeHandler);
    window.removeEventListener(
      "orientationchange",
      this.boundDesktopPlayerOrientationChangeHandler
    );
    this.desktopPlayerVisualViewport?.removeEventListener(
      "resize",
      this.boundDesktopPlayerVisualViewportResizeHandler
    );
    this.getDesktopPlaybackVideo()?.removeEventListener(
      "volumechange",
      this.boundDesktopVolumeChangeHandler
    );
    this.getDesktopPlaybackVideo()?.removeEventListener(
      "enterpictureinpicture",
      this.boundDesktopPictureInPictureChangeHandler
    );
    this.getDesktopPlaybackVideo()?.removeEventListener(
      "leavepictureinpicture",
      this.boundDesktopPictureInPictureChangeHandler
    );
    this.getDesktopPlaybackVideo()?.removeEventListener(
      "webkitpresentationmodechanged",
      this.boundDesktopPictureInPictureChangeHandler
    );
    ["loadedmetadata", "webkitbeginfullscreen", "webkitendfullscreen"].forEach((name) =>
      this.getDesktopPlaybackVideo()?.removeEventListener(
        name,
        this.boundDesktopFullscreenChangeHandler
      )
    );
    this.browserPlayerGestureCleanup?.();
    this.browserPlayerGestureCleanup = null;
    this.boundDesktopPlayerPointerMoveHandler = null;
    this.boundDesktopPlayerPointerLeaveHandler = null;
    this.boundDesktopPlayerPointerDownHandler = null;
    this.boundDesktopPlayerPointerUpHandler = null;
    this.boundDesktopPlayerPointerCancelHandler = null;
    this.boundDesktopPlayerClickHandler = null;
    this.boundDesktopPlayerInputHandler = null;
    this.boundDesktopPlayerChangeHandler = null;
    this.boundDesktopFullscreenChangeHandler = null;
    this.boundDesktopPlayerResizeHandler = null;
    this.boundDesktopPlayerOrientationChangeHandler = null;
    this.boundDesktopPlayerVisualViewportResizeHandler = null;
    this.desktopPlayerVisualViewport = null;
    this.boundDesktopVolumeChangeHandler = null;
    this.boundDesktopPictureInPictureChangeHandler = null;
    if (this.desktopPlayerViewportSyncFrame) {
      cancelAnimationFrame(this.desktopPlayerViewportSyncFrame);
      this.desktopPlayerViewportSyncFrame = null;
    }
    if (this.desktopPlayerViewportSyncFollowupFrame) {
      cancelAnimationFrame(this.desktopPlayerViewportSyncFollowupFrame);
      this.desktopPlayerViewportSyncFollowupFrame = null;
    }
    this.desktopProgressPointer = null;
    this.desktopSuppressProgressClick = false;
    if (this.desktopProgressClickSuppressTimer) {
      clearTimeout(this.desktopProgressClickSuppressTimer);
      this.desktopProgressClickSuppressTimer = null;
    }
  },

  revealDesktopPlayerControls() {
    if (!Environment.isBrowser() || this.isExternalFrameMode()) {
      return;
    }
    this.container?.classList.remove("desktop-player-cursor-hidden");
    if (this.controlsVisible) {
      this.resetControlsAutoHide();
      return;
    }
    this.setControlsVisible(true, { focus: false });
  },

  handleBrowserVideoAreaTap(controlsWereVisible = this.controlsVisible) {
    if (getBrowserPlayerVideoTapAction(controlsWereVisible) === "reveal-controls") {
      this.revealDesktopPlayerControls();
      return true;
    }
    this.togglePause({ focusControls: false });
    return true;
  },

  isDesktopVideoAreaClick(target, event = null) {
    if (
      !Environment.isBrowser() ||
      this.isExternalFrameMode() ||
      this.moreActionsVisible ||
      !this.container?.contains(target)
    ) {
      return false;
    }
    const blockedSelector = [
      "[data-player-desktop-back]",
      ".player-control-btn[data-action]",
      ".nv-top",
      ".nv-center",
      ".player-controls-top",
      ".player-controls-bottom",
      ".player-mobile-more-panel",
      ".player-modal",
      ".player-modal-backdrop",
      ".player-sources-panel",
      ".player-episode-panel",
      ".player-pause-overlay",
      ".player-next-episode-card",
      ".player-skip-intro",
      ".player-seek-overlay",
      ".player-loading-overlay",
      ".player-startup-error-overlay",
      ".player-torrent-overlay"
    ].join(", ");
    if (target.closest(blockedSelector)) return false;
    // A miss beside a toolbar button must not toggle playback through the video.
    const progressRect = playerLocalRect(this.uiRefs?.progressShell, this.browserOrientation);
    if (
      this.controlsVisible &&
      event &&
      progressRect &&
      playerLocalPoint(event, this.browserOrientation).y >= progressRect.top
    )
      return false;
    return true;
  },

  beginBrowserSwipeSeek() {
    const duration = this.getPlaybackDurationSeconds();
    if (!Number.isFinite(duration) || duration <= 0) return false;
    const start = this.getPlaybackCurrentSeconds();
    this.browserSwipeSeek = { start, target: start, duration };
    return true;
  },

  updateBrowserSwipeSeek({ deltaX, width }) {
    const state = this.browserSwipeSeek;
    if (!state || width <= 0) return;
    state.target = clamp(
      state.start + (deltaX / width) * Math.min(120, state.duration),
      0,
      state.duration
    );
    const delta = state.target - state.start;
    this.showBrowserPlayerGestureFeedback(
      formatTime(state.target) +
        " / " +
        formatTime(state.duration) +
        "\n" +
        (delta < 0 ? "−" : "+") +
        formatTime(Math.abs(delta)),
      "center",
      { persistent: true }
    );
    this.resetControlsAutoHide();
  },

  finishBrowserSwipeSeek({ cancelled = false } = {}) {
    const state = this.browserSwipeSeek;
    this.browserSwipeSeek = null;
    this.hideBrowserPlayerGestureFeedback();
    if (!state || cancelled) return false;
    return this.seekPlaybackSeconds(state.target);
  },

  seekBrowserPlayerGesture(zone) {
    const direction = zone === "left" ? -1 : zone === "right" ? 1 : 0;
    if (!direction) return false;
    const current = Number(this.getPlaybackCurrentSeconds() || 0);
    const duration = Number(this.getPlaybackDurationSeconds() || 0);
    let target = Math.max(0, current + direction * 10);
    if (Number.isFinite(duration) && duration > 0) target = Math.min(target, duration);
    const didSeek = this.seekPlaybackSeconds(target);
    if (didSeek) this.showBrowserPlayerGestureFeedback(direction < 0 ? "−10s" : "+10s", zone);
    return didSeek;
  },

  setBrowserPlayerGestureHold(active) {
    if (active) {
      if (this.browserGesturePreviousPlaybackRate != null) return;
      this.browserGesturePreviousPlaybackRate = this.getPlaybackSpeed();
      void this.applyPlaybackSpeed(2);
      this.showBrowserPlayerGestureFeedback("2x", "center", { persistent: true });
      return;
    }
    const previous = this.browserGesturePreviousPlaybackRate;
    this.browserGesturePreviousPlaybackRate = null;
    if (previous != null) void this.applyPlaybackSpeed(previous);
    this.hideBrowserPlayerGestureFeedback();
  },

  showBrowserPlayerGestureFeedback(label, side = "center", { persistent = false } = {}) {
    const feedback = this.uiRefs?.gestureFeedback;
    if (!feedback) return;
    if (this.browserGestureFeedbackTimer) clearTimeout(this.browserGestureFeedbackTimer);
    feedback.textContent = label;
    feedback.dataset.side = side;
    feedback.classList.remove("hidden");
    if (!persistent) {
      this.browserGestureFeedbackTimer = setTimeout(
        () => this.hideBrowserPlayerGestureFeedback(),
        720
      );
    }
  },

  hideBrowserPlayerGestureFeedback() {
    if (this.browserGestureFeedbackTimer) clearTimeout(this.browserGestureFeedbackTimer);
    this.browserGestureFeedbackTimer = null;
    const feedback = this.uiRefs?.gestureFeedback;
    if (feedback) feedback.classList.add("hidden");
  },

  getDesktopPlaybackVideo() {
    const video = PlayerController.video;
    return video instanceof HTMLMediaElement ? video : null;
  },

  getDesktopVolumeState() {
    const video = this.getDesktopPlaybackVideo();
    const volume = clamp(Number(video?.volume ?? 1), 0, 1);
    const muted = Boolean(video?.muted) || volume <= 0;
    return { volume, muted };
  },

  detectDesktopSoftwareVolume() {
    const video = this.getDesktopPlaybackVideo();
    if (!video) {
      this.desktopVolumeReadOnly = true;
      return;
    }
    if (this.desktopVolumeCapabilityVideo === video) return;
    if (!video.paused && !video.muted) {
      this.desktopVolumeReadOnly = true;
      return;
    }
    this.desktopVolumeCapabilityVideo = video;
    const original = Number(video.volume);
    const probe = original > 0.5 ? 0.25 : 0.75;
    try {
      video.volume = probe;
      this.desktopVolumeReadOnly = Math.abs(Number(video.volume) - probe) > 0.01;
    } catch (_) {
      this.desktopVolumeReadOnly = true;
    } finally {
      try {
        video.volume = original;
      } catch (_) {
        /* The volume may be readonly. */
      }
    }
  },

  confirmDesktopVolumeWrite(video, volume) {
    const revision = (this.desktopVolumeWriteRevision =
      Number(this.desktopVolumeWriteRevision || 0) + 1);
    if (typeof requestAnimationFrame !== "function") return;
    requestAnimationFrame(() => {
      if (revision !== this.desktopVolumeWriteRevision || this.getDesktopPlaybackVideo() !== video)
        return;
      if (Math.abs(Number(video.volume) - volume) > 0.01) {
        this.desktopVolumeReadOnly = true;
        this.showAspectToast("Use your device volume buttons");
        this.syncDesktopPlaybackTools();
      }
    });
  },

  setDesktopVolume(value) {
    const video = this.getDesktopPlaybackVideo();
    if (!video) {
      return false;
    }
    const volume = clamp(Number(value), 0, 1);
    video.volume = volume;
    if (Math.abs(Number(video.volume) - volume) > 0.01) {
      this.desktopVolumeReadOnly = true;
      this.showAspectToast("Use your device volume buttons");
      this.syncDesktopPlaybackTools();
      return false;
    }
    this.desktopVolumeReadOnly = false;
    this.desktopMuteRestoreVolume = null;
    if (volume > 0) this.desktopLastAudibleVolume = volume;
    video.muted = volume <= 0;
    this.confirmDesktopVolumeWrite?.(video, volume);
    this.syncDesktopPlaybackTools();
    return true;
  },

  toggleDesktopMute() {
    const video = this.getDesktopPlaybackVideo();
    if (!video) {
      return false;
    }
    const currentVolume = clamp(Number(video.volume ?? 1), 0, 1);
    const currentlyMuted = Boolean(video.muted) || currentVolume <= 0;
    if (currentlyMuted) {
      const restoredVolume = clamp(
        Number(
          this.desktopMuteRestoreVolume ?? (currentVolume || this.desktopLastAudibleVolume || 1)
        ),
        0,
        1
      );
      video.muted = false;
      video.volume = restoredVolume > 0 ? restoredVolume : 1;
      this.confirmDesktopVolumeWrite?.(video, restoredVolume > 0 ? restoredVolume : 1);
      this.desktopMuteRestoreVolume = null;
    } else {
      if (currentVolume > 0) {
        this.desktopLastAudibleVolume = currentVolume;
      }
      this.desktopMuteRestoreVolume = currentVolume;
      this.desktopVolumeWriteRevision = Number(this.desktopVolumeWriteRevision || 0) + 1;
      video.muted = true;
    }
    this.syncDesktopPlaybackTools();
    return true;
  },

  getDesktopFullscreenCapability() {
    if (!Environment.isBrowser() || !this.container || isAppInstalled()) return null;
    if (
      document.fullscreenEnabled !== false &&
      typeof this.container.requestFullscreen === "function"
    )
      return "element";
    const video = this.getDesktopPlaybackVideo();
    if (
      video?.webkitSupportsFullscreen !== false &&
      typeof video?.webkitEnterFullscreen === "function"
    )
      return "video";
    return null;
  },

  isDesktopPlayerFullscreen() {
    const video = this.getDesktopPlaybackVideo();
    return Boolean(
      Environment.isBrowser() &&
      (document.fullscreenElement === this.container ||
        video?.webkitDisplayingFullscreen === true ||
        video?.webkitPresentationMode === "fullscreen")
    );
  },

  async exitDesktopFullscreen() {
    if (
      document.fullscreenElement === this.container &&
      typeof document.exitFullscreen === "function"
    ) {
      await document.exitFullscreen();
      return true;
    }
    const video = this.getDesktopPlaybackVideo();
    if (typeof video?.webkitExitFullscreen === "function") {
      video.webkitExitFullscreen();
      return true;
    }
    return false;
  },

  resetPictureInPictureAvailability() {
    this.pictureInPictureUnsupportedVideo = null;
    this.pictureInPicturePlaybackSession = Number(this.pictureInPicturePlaybackSession || 0) + 1;
    this.pictureInPictureUnsupportedPlaybackSession = null;
  },

  isPictureInPictureUnavailableForActivePlayback(video = this.getDesktopPlaybackVideo()) {
    return isBrowserPictureInPictureUnavailableForSession({
      video,
      session: this.pictureInPicturePlaybackSession,
      unavailableVideo: this.pictureInPictureUnsupportedVideo,
      unavailableSession: this.pictureInPictureUnsupportedPlaybackSession
    });
  },

  markPictureInPictureUnavailableForActivePlayback(video, error) {
    if (!shouldMarkBrowserPictureInPictureUnavailable(error) || !video) return false;
    const alreadyUnavailable = this.isPictureInPictureUnavailableForActivePlayback(video);
    this.pictureInPictureUnsupportedVideo = video;
    this.pictureInPictureUnsupportedPlaybackSession = this.pictureInPicturePlaybackSession;
    if (!alreadyUnavailable) {
      this.showAspectToast("Picture-in-Picture is not supported for this video.");
    }
    return true;
  },

  isStandardPictureInPictureSupported() {
    return (
      Environment.isBrowser() &&
      getBrowserPictureInPictureCapability(this.getDesktopPlaybackVideo(), document) ===
        BROWSER_PICTURE_IN_PICTURE_STANDARD
    );
  },

  getSafariPictureInPictureCapability() {
    if (!Environment.isBrowser()) return null;
    return (
      getBrowserPictureInPictureCapability(this.getDesktopPlaybackVideo(), document) ===
      BROWSER_PICTURE_IN_PICTURE_WEBKIT
    );
  },

  isSafariPictureInPictureSupported() {
    return this.getSafariPictureInPictureCapability() === true;
  },

  isDesktopPictureInPictureSupported() {
    // This is capability based: installed/standalone PWAs use the same active
    // video probe as a browser tab. Standard PiP remains preferred over the
    // WebKit presentation-mode fallback.
    return (
      !this.isPictureInPictureUnavailableForActivePlayback() &&
      (this.isStandardPictureInPictureSupported() || this.isSafariPictureInPictureSupported())
    );
  },

  isDesktopPlayerPictureInPicture() {
    const video = this.getDesktopPlaybackVideo();
    return Environment.isBrowser() && isBrowserPictureInPictureActive(video, document);
  },

  async exitDesktopPictureInPicture() {
    const video = this.getDesktopPlaybackVideo();
    if (!video || !this.isDesktopPlayerPictureInPicture()) {
      return false;
    }
    return exitBrowserPictureInPicture(video, document);
  },

  async toggleDesktopPictureInPicture() {
    const video = this.getDesktopPlaybackVideo();
    if (!this.isDesktopPictureInPictureSupported() || !video || video.disablePictureInPicture) {
      this.syncDesktopPlaybackTools();
      return false;
    }

    try {
      if (this.isDesktopPlayerPictureInPicture()) {
        await this.exitDesktopPictureInPicture();
      } else if (this.isStandardPictureInPictureSupported()) {
        try {
          await enterBrowserPictureInPicture(video, document);
        } catch (initialError) {
          if (this.markPictureInPictureUnavailableForActivePlayback(video, initialError)) {
            throw initialError;
          }
          // Chromium may reject PiP while this page owns fullscreen. Preserve
          // fullscreen unless the browser actually requires an exit first.
          if (!document.fullscreenElement) {
            throw initialError;
          }
          await document.exitFullscreen?.();
          await enterBrowserPictureInPicture(video, document);
        }
      } else {
        await enterBrowserPictureInPicture(video, document);
      }
      this.revealDesktopPlayerControls();
      this.syncDesktopPlaybackTools();
      this.renderCompactBrowserMorePanel();
      return true;
    } catch (error) {
      this.markPictureInPictureUnavailableForActivePlayback(video, error);
      this.syncDesktopPlaybackTools();
      this.renderCompactBrowserMorePanel();
      return false;
    }
  },

  async toggleDesktopFullscreen() {
    if (!Environment.isBrowser() || !this.container) return false;
    try {
      if (this.isDesktopPlayerFullscreen()) {
        if (!(await this.exitDesktopFullscreen())) return false;
      } else {
        const capability = this.getDesktopFullscreenCapability();
        if (!capability) return false;
        if (capability === "video") {
          this.getDesktopPlaybackVideo().webkitEnterFullscreen();
        } else {
          if (this.isDesktopPlayerPictureInPicture()) await this.exitDesktopPictureInPicture();
          await this.container.requestFullscreen();
        }
      }
      this.revealDesktopPlayerControls();
      this.syncDesktopPlaybackTools();
      return true;
    } catch (_) {
      this.syncDesktopPlaybackTools();
      return false;
    }
  },

  async navigateDesktopPlayerBack() {
    if (this.isDesktopPlayerFullscreen()) {
      try {
        await this.exitDesktopFullscreen();
      } catch (_) {
        // Browser fullscreen exit is best effort before using the existing back path.
      }
    }
    return this.navigateBackToStreamScreen();
  },

  syncDesktopPlaybackTools() {
    if (!Environment.isBrowser()) {
      return;
    }
    const tools = Array.from(
      this.uiRefs?.root?.querySelectorAll(
        ".player-presentation, .player-desktop-playback-tools, .player-mobile-more-panel"
      ) || []
    );
    if (!tools.length) {
      return;
    }
    this.detectDesktopSoftwareVolume?.();
    const { volume, muted } = this.getDesktopVolumeState();
    const fullscreen = this.isDesktopPlayerFullscreen();
    const fullscreenAvailable =
      !isAppInstalled() && Boolean(fullscreen || this.getDesktopFullscreenCapability());
    const pictureInPictureAvailable = this.isDesktopPictureInPictureSupported();
    const pictureInPictureActive = this.isDesktopPlayerPictureInPicture();
    const muteLabel = muted ? "Unmute" : "Mute";
    const fullscreenLabel = fullscreen ? "Exit fullscreen" : "Enter fullscreen";
    const pictureInPictureLabel = pictureInPictureActive
      ? "Exit Picture-in-Picture"
      : "Enter Picture-in-Picture";
    tools.forEach((toolRoot) => {
      const muteButton = toolRoot.querySelector("[data-player-desktop-action='mute']");
      const muteIcon = toolRoot.querySelector("[data-player-desktop-mute-icon]");
      const volumeInput = toolRoot.querySelector("[data-player-desktop-volume]");
      const fullscreenButton = toolRoot.querySelector("[data-player-desktop-action='fullscreen']");
      const fullscreenIcon = toolRoot.querySelector("[data-player-desktop-fullscreen-icon]");
      const pictureInPictureButton = toolRoot.querySelector(
        "[data-player-desktop-action='picture-in-picture']"
      );
      muteButton?.setAttribute("aria-label", muteLabel);
      muteButton?.setAttribute("title", muteLabel);
      if (muteIcon) {
        if (muteIcon.tagName === "IMG")
          muteIcon.src = `assets/icons/${muted ? "ic_player_volume_muted.svg" : "ic_player_volume.svg"}`;
        else muteIcon.innerHTML = playerDesignIcon(muted ? "volume-x" : "volume-2");
      }
      if (volumeInput) {
        volumeInput.hidden = this.desktopVolumeReadOnly !== false;
        volumeInput.disabled = this.desktopVolumeReadOnly !== false;
        if (volumeInput.closest?.(".nv-volume"))
          volumeInput.closest(".nv-volume").hidden = this.desktopVolumeReadOnly !== false;
        volumeInput.title = this.desktopVolumeReadOnly
          ? "Use your device volume buttons"
          : "Volume";
        volumeInput.value = String(muted ? 0 : Math.round(volume * 100));
        volumeInput.style?.setProperty("--player-volume-progress", volumeInput.value + "%");
      }
      if (fullscreenButton) {
        fullscreenButton.hidden = !fullscreenAvailable;
        fullscreenButton.disabled = !fullscreenAvailable;
      }
      fullscreenButton?.setAttribute("aria-label", fullscreenLabel);
      fullscreenButton?.setAttribute("title", fullscreenLabel);
      if (fullscreenIcon) {
        if (fullscreenIcon.tagName === "IMG")
          fullscreenIcon.src = `assets/icons/${fullscreen ? "ic_player_fullscreen_exit.svg" : "ic_player_fullscreen.svg"}`;
        else fullscreenIcon.innerHTML = playerDesignIcon(fullscreen ? "minimize" : "maximize");
      }
      if (pictureInPictureButton) {
        pictureInPictureButton.hidden = !pictureInPictureAvailable;
        pictureInPictureButton.disabled =
          !pictureInPictureAvailable ||
          !this.getDesktopPlaybackVideo() ||
          this.getDesktopPlaybackVideo().disablePictureInPicture;
        pictureInPictureButton.setAttribute("aria-label", pictureInPictureLabel);
        pictureInPictureButton.setAttribute("title", pictureInPictureLabel);
      }
    });
  },

  dismissDesktopPlayerPanelFromPointer(target) {
    if (!Environment.isBrowser() || !(target instanceof Element)) {
      return false;
    }

    if (this.moreActionsVisible) {
      const panel = this.uiRefs?.root?.querySelector("#playerMobileMorePanel");
      if (panel?.contains(target)) return false;
      this.moreActionsVisible = false;
      this.renderControlButtons();
      this.updateModalBackdrop();
      this.revealDesktopPlayerControls();
      return true;
    }

    const panels = [
      {
        visible: this.sourcesPanelVisible,
        node: this.uiRefs?.sourcesPanel,
        close: () => this.closeSourcesPanel()
      },
      {
        visible: this.subtitleDialogVisible,
        node: this.uiRefs?.subtitleDialog,
        close: () => this.closeSubtitleDialog()
      },
      {
        visible: this.audioDialogVisible,
        node: this.uiRefs?.audioDialog,
        close: () => this.closeAudioDialog()
      },
      {
        visible: this.speedDialogVisible,
        node: this.uiRefs?.speedDialog,
        close: () => this.closeSpeedDialog()
      },
      {
        visible: this.episodePanelVisible,
        node: this.uiRefs?.root?.querySelector("#episodeSidePanel"),
        close: () => {
          if (this.episodePanelMode === "streams") {
            this.closeEpisodeStreamsView();
          } else {
            this.hideEpisodePanel();
          }
        }
      }
    ];

    const activePanel = panels.find(({ visible, node }) => visible && node instanceof Element);
    const trackPanel =
      activePanel &&
      [this.uiRefs?.subtitleDialog, this.uiRefs?.audioDialog, this.uiRefs?.speedDialog].includes(
        activePanel.node
      );
    if (trackPanel && target.closest(".player-controls-bottom")) return false;
    if (!activePanel || activePanel.node.contains(target)) {
      return false;
    }

    activePanel.close();
    return true;
  },

  getDesktopPlayerInteractiveTarget(target) {
    if (!(target instanceof Element)) {
      return null;
    }
    return target.closest(
      "[data-player-desktop-back], .player-control-btn[data-action], [data-player-pointer-action], " +
        "[data-player-error-action], [data-sources-zone], [data-subtitle-style-action], " +
        "[data-subtitle-rail], [data-audio-step], [data-audio-column], [data-speed-index], " +
        "[data-episode-action], [data-episode-stream-action], [data-episode-stream-filter-index], " +
        "[data-episode-stream-index], [data-episode-season-index], [data-episode-index], " +
        "[data-player-desktop-action], [data-player-desktop-volume]"
    );
  },

  isDesktopEditableTarget(target) {
    return Boolean(
      target instanceof Element &&
      target.closest("input, textarea, select, [contenteditable], [contenteditable='true']")
    );
  },

  isDesktopPanelInteractiveTarget(target) {
    return Boolean(
      target instanceof Element &&
      target.closest(
        ".player-modal, .player-sources-panel, .player-episode-panel, [data-player-desktop-volume]"
      )
    );
  },

  cachePlayerUiRefs(root = null) {
    const uiRoot = root || this.container?.querySelector("#playerUiRoot");
    this.uiRefs = uiRoot
      ? {
          root: uiRoot,
          loadingOverlay: uiRoot.querySelector("#playerLoadingOverlay"),
          bufferingSpinner: uiRoot.querySelector("#playerBufferingSpinner"),
          startupErrorOverlay: uiRoot.querySelector("#playerStartupErrorOverlay"),
          torrentOverlay: uiRoot.querySelector("#playerTorrentOverlay"),
          torrentOverlaySpeed: uiRoot.querySelector(
            "#playerTorrentOverlay .player-torrent-overlay-speed"
          ),
          torrentOverlayDetail: uiRoot.querySelector(
            "#playerTorrentOverlay .player-torrent-overlay-detail"
          ),
          loadingIdentity: uiRoot.querySelector(".player-loading-identity"),
          loadingLogoStack: uiRoot.querySelector(".player-loading-logo-stack"),
          loadingLogoBase: uiRoot.querySelector(".player-loading-logo-base"),
          loadingLogoFillClip: uiRoot.querySelector(".player-loading-logo-fill-clip"),
          loadingLogoFill: uiRoot.querySelector(".player-loading-logo-fill"),
          loadingTitle: uiRoot.querySelector(".player-loading-title"),
          loadingSubtitle: uiRoot.querySelector(".player-loading-subtitle"),
          loadingStatus: uiRoot.querySelector("#playerLoadingOverlay .player-loading-status"),
          bufferingStatus: uiRoot.querySelector("#playerBufferingSpinner .player-loading-status"),
          parentalGuide: uiRoot.querySelector("#playerParentalGuide"),
          skipIntro: uiRoot.querySelector("#playerSkipIntro"),
          aspectToast: uiRoot.querySelector("#playerAspectToast"),
          gestureFeedback: uiRoot.querySelector("#playerGestureFeedback"),
          htmlSubtitles: uiRoot.querySelector("#playerHtmlSubtitles"),
          nativeSubtitles: uiRoot.querySelector("#playerNativeSubtitles"),
          seekOverlay: uiRoot.querySelector("#playerSeekOverlay"),
          seekDirection: uiRoot.querySelector("#playerSeekDirection"),
          seekPreview: uiRoot.querySelector("#playerSeekPreview"),
          seekFill: uiRoot.querySelector("#playerSeekFill"),
          pauseOverlay: uiRoot.querySelector("#playerPauseOverlay"),
          nextEpisodeCard: uiRoot.querySelector("#playerNextEpisodeCard"),
          modalBackdrop: uiRoot.querySelector("#playerModalBackdrop"),
          subtitleDialog: uiRoot.querySelector("#playerSubtitleDialog"),
          audioDialog: uiRoot.querySelector("#playerAudioDialog"),
          speedDialog: uiRoot.querySelector("#playerSpeedDialog"),
          mobileMorePanel: uiRoot.querySelector("#playerMobileMorePanel"),
          sourcesPanel: uiRoot.querySelector("#playerSourcesPanel"),
          controlsOverlay: uiRoot.querySelector("#playerControlsOverlay"),
          controlsBottom: uiRoot.querySelector(".player-controls-bottom"),
          progressShell: uiRoot.querySelector("#playerProgressShell"),
          clock: uiRoot.querySelector("#playerClock"),
          endsAt: uiRoot.querySelector("#playerEndsAt"),
          progressBuffered: uiRoot.querySelector("#playerProgressBuffered"),
          progressFill: uiRoot.querySelector("#playerProgressFill"),
          controlButtons: uiRoot.querySelector("#playerControlButtons"),
          timeLabel: uiRoot.querySelector("#playerTimeLabel"),
          startupErrorButton: uiRoot.querySelector(
            "#playerStartupErrorOverlay .player-startup-error-button"
          )
        }
      : null;
    this.lastUiTickState = {
      bufferedVisible: false,
      bufferedWidth: "",
      progressWidth: "",
      clockText: "",
      clockMinuteKey: "",
      endsAtText: "",
      endsAtMinuteBucket: null,
      timeLabelText: "",
      seekWidth: "",
      seekPreviewText: "",
      seekDirectionText: "",
      progressFocused: false
    };
    this.refreshLoadingOverlayPresentation();
    this.renderStartupErrorOverlay();
  },

  getLoadingOverlayMeta() {
    const transition = this.nextEpisodeTransitionMeta || null;
    return {
      internalPlayer: true,
      itemType: this.params?.itemType,
      orientation:
        this.browserOrientation?.preference ||
        this.params?.playerOrientationPreference ||
        "landscape",
      posterUrl: this.params?.playerPosterUrl || this.params?.poster || "",
      textlessPoster: this.params?.textlessPoster || "",
      title: String(
        transition?.title ||
          this.params?.playerTitle ||
          this.params?.itemTitle ||
          this.params?.itemId ||
          "Nuvio"
      ).trim(),
      subtitle: "",
      logoUrl: String(transition?.logoUrl || this.params?.playerLogoUrl || "").trim(),
      backdropUrl: String(transition?.backdropUrl || this.params?.playerBackdropUrl || "").trim()
    };
  },

  refreshLoadingOverlayPresentation() {
    const overlay = this.uiRefs?.loadingOverlay;
    if (!overlay) {
      return;
    }
    const loadingMeta = this.getLoadingOverlayMeta();
    const identity = this.uiRefs?.loadingIdentity;
    const logo = this.uiRefs?.loadingLogo;
    const title = this.uiRefs?.loadingTitle;
    const subtitle = this.uiRefs?.loadingSubtitle;
    if (identity) {
      identity.classList.toggle("has-logo", Boolean(loadingMeta.logoUrl));
    }
    if (logo) {
      if (loadingMeta.logoUrl) {
        if (logo.getAttribute("src") !== loadingMeta.logoUrl) {
          logo.setAttribute("src", loadingMeta.logoUrl);
        }
        logo.setAttribute("alt", loadingMeta.title || "logo");
      } else {
        logo.removeAttribute("src");
      }
    }
    if (title) {
      title.textContent =
        loadingMeta.title ||
        this.params?.playerTitle ||
        this.params?.itemTitle ||
        this.params?.itemId ||
        "Nuvio";
    }
    if (subtitle) {
      subtitle.textContent = loadingMeta.subtitle || "";
      subtitle.classList.toggle("hidden", !loadingMeta.subtitle);
    }
    const backdrop = overlay.querySelector(".player-loading-backdrop");
    if (backdrop instanceof HTMLElement) {
      backdrop.style.backgroundImage = loadingMeta.backdropUrl
        ? `url('${loadingMeta.backdropUrl.replace(/'/g, "%27")}')`
        : "";
    }
    this.syncLoadingOverlayProgress();
  },

  isStartupErrorVisible() {
    return Boolean(String(this.startupErrorMessage || "").trim());
  },

  clearStartupError() {
    this.startupErrorMessage = "";
    this.startupErrorMediaCode = 0;
    this.startupErrorDetails = [];
    this.renderStartupErrorOverlay();
  },

  getPlaybackErrorCodeLabel(mediaErrorCode = 0) {
    const code = Number(mediaErrorCode || 0);
    if (code === 1) return "1 aborted";
    if (code === 2) return "2 network";
    if (code === 3) return "3 decode";
    if (code === 4) return "4 source not supported";
    return code > 0 ? String(code) : "";
  },

  getPlaybackEventErrorDetail(eventDetail = {}) {
    const detail = eventDetail && typeof eventDetail === "object" ? eventDetail : {};
    const hlsResponseCode = Number(detail.hlsResponseCode || 0);
    return [
      detail.hlsErrorType,
      detail.hlsErrorDetails,
      hlsResponseCode >= 400 && hlsResponseCode <= 599 ? `HTTP ${hlsResponseCode}` : "",
      detail.dashError,
      /^client-transcode-[a-z-]+$/.test(detail.reason || "") ? detail.reason : "",
      detail.playbackEngine
    ]
      .map((value) => String(value || "").trim())
      .filter(Boolean)
      .join(" ");
  },

  getHttpPlaybackErrorMessage(statusCode = 0) {
    const status = Number(statusCode || 0);
    if (status < 400 || status > 599) {
      return "";
    }
    const providerHint =
      status === 403
        ? t(
            "player_error_stream_blocked",
            {},
            "\n\nThe stream source is blocked or restricted. Try a different source."
          )
        : status === 404
          ? t(
              "player_error_stream_removed",
              {},
              "\n\nThe stream link has expired or been removed. Try a different source."
            )
          : status === 410
            ? t(
                "player_error_stream_expired",
                {},
                "\n\nThe stream link has expired. Try a different source."
              )
            : status === 429
              ? t(
                  "player_error_stream_rate_limited",
                  {},
                  "\n\nToo many requests to the stream source. Wait a moment and try again."
                )
              : [500, 502, 503].includes(status)
                ? t(
                    "player_error_stream_unavailable",
                    {},
                    "\n\nThe stream server is currently unavailable. Try a different source."
                  )
                : "";
    return `HTTP ${status}${normalizePlaybackDisplayLineBreaks(providerHint)}`;
  },

  getWebHeaderRestrictedStreamMessage(streamCandidate = this.getCurrentStreamCandidate()) {
    const candidate = streamCandidate || {};
    const raw = candidate?.raw || {};
    const rawBehaviorHints = raw?.behaviorHints || {};
    const candidateBehaviorHints = candidate?.behaviorHints || {};
    const requestHeaders =
      rawBehaviorHints?.proxyHeaders?.request || candidateBehaviorHints?.proxyHeaders?.request;
    const notWebReadyValue = rawBehaviorHints?.notWebReady ?? candidateBehaviorHints?.notWebReady;
    const notWebReady =
      notWebReadyValue === true ||
      String(notWebReadyValue || "")
        .trim()
        .toLowerCase() === "true";
    const hasRequiredHeaders =
      requestHeaders &&
      typeof requestHeaders === "object" &&
      Object.entries(requestHeaders).some(
        ([name, value]) => String(name || "").trim() && String(value ?? "").trim()
      );
    if (!notWebReady || !hasRequiredHeaders) {
      return "";
    }
    return t(
      "player_error_web_headers_unsupported",
      {},
      "This source is not compatible with this device's player because it requires special request headers. Try a different source or contact the add-on provider."
    );
  },

  getPlaybackErrorDetailLines({
    mediaErrorCode = 0,
    detail = "",
    error = null,
    eventDetail = null,
    streamCandidate = null,
    playbackUrl = "",
    reason = "",
    resolverStatus = "",
    resolverDetail = ""
  } = {}) {
    const lines = [];
    const video = PlayerController.video || null;
    const candidate =
      streamCandidate ||
      this.getStreamCandidateByUrl(playbackUrl || this.activePlaybackUrl) ||
      this.getCurrentStreamCandidate();
    const raw = candidate?.raw || {};
    const requestHeaders =
      raw?.behaviorHints?.proxyHeaders?.request ||
      candidate?.behaviorHints?.proxyHeaders?.request ||
      null;
    const headerNames =
      requestHeaders && typeof requestHeaders === "object"
        ? Object.keys(requestHeaders).filter(Boolean).join(", ")
        : "";
    const mediaError = video?.error || null;
    const eventErrorDetail = this.getPlaybackEventErrorDetail(eventDetail);
    const rememberedHlsError =
      typeof PlayerController.getLastHlsErrorDetail === "function"
        ? PlayerController.getLastHlsErrorDetail()
        : "";
    const httpStatus = extractPlaybackHttpStatus(
      [
        detail,
        eventErrorDetail,
        rememberedHlsError,
        error?.message,
        error?.name,
        error?.errorText,
        error?.status
      ]
        .filter(Boolean)
        .join(" ")
    );
    const runtimeDetail =
      detail ||
      eventErrorDetail ||
      error?.message ||
      error?.name ||
      error?.errorText ||
      error?.status ||
      "";
    const sourceLabel = [
      candidate?.addonName,
      candidate?.name || candidate?.title || candidate?.description,
      candidate?.id
    ]
      .filter(Boolean)
      .join(" / ");
    const sourceType = [
      candidate?.mimeType,
      raw?.mimeType,
      candidate?.sourceType,
      raw?.sourceType,
      raw?.type
    ].find(Boolean);
    const activeUrl =
      playbackUrl ||
      this.activePlaybackUrl ||
      candidate?.url ||
      candidate?.externalUrl ||
      raw?.url ||
      raw?.externalUrl ||
      "";

    pushPlaybackDiagnosticLine(lines, "Platform", "browser");
    pushPlaybackDiagnosticLine(lines, "Reason", reason);
    pushPlaybackDiagnosticLine(lines, "Media code", this.getPlaybackErrorCodeLabel(mediaErrorCode));
    pushPlaybackDiagnosticLine(lines, "HTTP status", httpStatus || "unavailable");
    pushPlaybackDiagnosticLine(lines, "Runtime error", runtimeDetail);
    pushPlaybackDiagnosticLine(
      lines,
      "HLS error",
      eventDetail?.hlsErrorDetails || eventDetail?.hlsErrorType || rememberedHlsError,
      420
    );
    pushPlaybackDiagnosticLine(lines, "DASH error", eventDetail?.dashError);
    pushPlaybackDiagnosticLine(lines, "HTML media error", mediaError?.message || mediaError?.code);
    pushPlaybackDiagnosticLine(lines, "Video readyState", video?.readyState);
    pushPlaybackDiagnosticLine(lines, "Video networkState", video?.networkState);
    pushPlaybackDiagnosticLine(
      lines,
      "Current source",
      describeSafePlaybackEndpoint(video?.currentSrc || video?.src)
    );
    pushPlaybackDiagnosticLine(
      lines,
      "Playback engine",
      PlayerController.playbackEngine || "unknown"
    );
    pushPlaybackDiagnosticLine(
      lines,
      "Client remux",
      PlayerController.getClientRemuxStartupDiagnostic?.(),
      640
    );
    pushPlaybackDiagnosticLine(lines, "Source", sourceLabel);
    pushPlaybackDiagnosticLine(lines, "Source type", sourceType);
    pushPlaybackDiagnosticLine(lines, "Source endpoint", describeSafePlaybackEndpoint(activeUrl));
    pushPlaybackDiagnosticLine(lines, "Proxy header names", headerNames);
    pushPlaybackDiagnosticLine(lines, "Resolver status", resolverStatus);
    pushPlaybackDiagnosticLine(lines, "Resolver detail", resolverDetail);
    return lines;
  },

  formatPlaybackErrorForSources(message = "", options = {}) {
    const baseMessage =
      String(message || "").trim() || t("player_error_playback_fallback", {}, "Playback error");
    const detailLines = this.getPlaybackErrorDetailLines(options);
    return detailLines.length
      ? `${baseMessage}\n\nDetails\n${detailLines.join("\n")}`
      : baseMessage;
  },

  showStartupError(
    message = "",
    {
      mediaErrorCode = 0,
      detail = "",
      error = null,
      eventDetail = null,
      streamCandidate = null,
      playbackUrl = "",
      reason = "",
      resolverStatus = "",
      resolverDetail = "",
      details = null
    } = {}
  ) {
    const attempt = this.params?.unverifiedPlayback;
    if (
      !this.hasPresentedPlaybackFrame &&
      (eventDetail?.reason === "client-transcode-software-video-decode-failed" ||
        (attempt?.softwareVideoDecodeFailed &&
          attempt.mediaUrl === (playbackUrl || this.activePlaybackUrl)))
    ) {
      message = t(
        "player_error_software_video_decode",
        {},
        "This device could not decode the video for Full Transcode. Choose another stream."
      );
    }
    if (
      this.params?.prepareSelectedSource &&
      (this._preparingSelectedSource || !this.hasPresentedPlaybackFrame) &&
      !this.playerBackNavigationInProgress
    ) {
      void this.advanceAfterSelectedSourceFailure(message, {
        error,
        detail,
        streamCandidate,
        playbackUrl,
        mediaErrorCode,
        reason
      });
      return;
    }
    if (this.startupReadiness) {
      this.startupReadiness.timeoutError = reason === "startup-stall" && !mediaErrorCode;
    }
    this.reportPlaybackStartupDiagnostics?.(reason || "startup-error");
    StartupLoadingOverlay.finish("error");
    this.startupErrorMessage =
      String(message || "").trim() || t("player_error_playback_fallback", {}, "Playback error");
    this.startupErrorMediaCode = Number(mediaErrorCode || 0);
    this.startupErrorDetails = Array.isArray(details)
      ? details.map((line) => cleanPlaybackDiagnosticValue(line)).filter(Boolean)
      : this.getPlaybackErrorDetailLines({
          mediaErrorCode,
          detail,
          error,
          eventDetail,
          streamCandidate,
          playbackUrl,
          reason,
          resolverStatus,
          resolverDetail
        });
    if (attempt && attempt.mediaUrl === (playbackUrl || this.activePlaybackUrl)) {
      this.startupErrorDetails.push(
        "Playback attempt: " + attempt.route + (attempt.remuxTried ? "; remux tried" : "")
      );
      if (attempt.probeReason)
        this.startupErrorDetails.push(
          "Metadata check: " + cleanPlaybackDiagnosticValue(attempt.probeReason)
        );
    }
    this.lastPlaybackErrorAt = 0;
    this.loadingVisible = false;
    this.loadingProgress = null;
    this.loadingLogoFillActive = false;
    this.loadingLogoFillProgress = 0;
    this.loadingLogoFillTarget = 0;
    this.stopLoadingLogoFillAnimation();
    this.clearPlaybackStallGuard();
    this.clearBufferingSpinnerTimer();
    this.clearPauseOverlayTimer();
    this.releaseStartupAudioGate({ resume: false });
    this.sourcesLoading = false;
    this.sourcesError = "";
    this.sourcesPanelVisible = false;
    this.subtitleDialogVisible = false;
    this.audioDialogVisible = false;
    this.speedDialogVisible = false;
    this.episodePanelVisible = false;
    this.moreActionsVisible = false;
    this.seekOverlayVisible = false;
    this.seekPreviewSeconds = null;
    this.pauseOverlayVisible = false;
    this.updateLoadingVisibility();
    this.renderControlButtons();
    this.renderSourcesPanel();
    this.renderSubtitleDialog();
    this.renderAudioDialog();
    this.renderSpeedDialog();
    this.renderEpisodePanel();
    this.renderPauseOverlay();
    this.renderStartupErrorOverlay();
    this.focusStartupErrorButton();
  },

  startPlaybackStartupDiagnostics() {
    this.playbackStartupDiagnosticCleanup?.();
    this.playbackStartupDiagnosticCleanup = null;
    this.playbackStartupDiagnostic = null;
    if (globalThis.__NUVIO_PLAYBACK_STARTUP_DEBUG__ !== true) return;
    const video = this.getDesktopPlaybackVideo();
    if (!video?.addEventListener) return;
    const state = {
      startedAt: Date.now(),
      events: [],
      reported: new Set(),
      standalone: isAppInstalled()
    };
    this.playbackStartupDiagnostic = state;
    const names = [
      "loadstart",
      "progress",
      "stalled",
      "waiting",
      "loadedmetadata",
      "loadeddata",
      "canplay",
      "playing",
      "error"
    ];
    const record = (event) => {
      if (this.playbackStartupDiagnostic !== state) return;
      const ms = Date.now() - state.startedAt;
      if (ms > 90000) {
        this.playbackStartupDiagnosticCleanup?.();
        return;
      }
      if (
        state.events.length < 24 &&
        (event.type !== "progress" || !state.events.some((entry) => entry.event === "progress"))
      ) {
        state.events.push({
          event: event.type,
          ms,
          ready: video.readyState,
          network: video.networkState
        });
      }
      if (["loadedmetadata", "canplay", "error"].includes(event.type))
        this.reportPlaybackStartupDiagnostics(event.type);
    };
    names.forEach((name) => video.addEventListener(name, record));
    this.playbackStartupDiagnosticCleanup = () =>
      names.forEach((name) => video.removeEventListener(name, record));
  },

  reportPlaybackStartupDiagnostics(reason) {
    const state = this.playbackStartupDiagnostic;
    if (
      !state ||
      globalThis.__NUVIO_PLAYBACK_STARTUP_DEBUG__ !== true ||
      state.reported.has(reason) ||
      state.reported.size >= 5
    )
      return;
    state.reported.add(reason);
    const video = this.getDesktopPlaybackVideo();
    const detail = {
      reason,
      startedAt: state.startedAt,
      elapsedMs: Date.now() - state.startedAt,
      standalone: state.standalone,
      ready: video?.readyState,
      network: video?.networkState,
      mediaErrorCode: video?.error?.code || 0,
      events: state.events
    };
    void fetch("/api/debug/log", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind: "playback-startup",
        message: "Playback startup timing",
        stack: JSON.stringify(detail),
        at: new Date().toISOString()
      })
    }).catch(() => {});
  },

  async runUnverifiedPlaybackAttempt(route, { manual = false } = {}) {
    const attempt = this.params?.unverifiedPlayback;
    if (this.playerBackNavigationInProgress) return true;
    if (
      !attempt ||
      attempt.busy ||
      !["direct", "remux", "audio-transcode", "transcode"].includes(route)
    )
      return false;
    const triedKey = {
      direct: "rawTried",
      remux: "remuxTried",
      "audio-transcode": "audioTranscodeTried",
      transcode: "audioTranscodeTried"
    }[route];
    // Automatic failures can arrive from both media events and the startup timer.
    // Only an explicit user retry may run a route that has already been attempted.
    if (attempt.routeFallbackEnabled && attempt[triedKey] && !manual) return false;
    const mountToken = this.playerMountToken;
    const previousUrl = this.activePlaybackUrl;
    const candidate = this.getStreamCandidateByUrl(previousUrl) || this.getCurrentStreamCandidate();
    attempt.busy = true;
    if (manual) attempt.softwareVideoDecodeFailed = false;
    const previousRoute = attempt.route;
    if (attempt.routeFallbackEnabled) {
      this._selectedSourceAbort?.abort();
      this._selectedSourceAbort = new AbortController();
      this._playbackUrlGeneration = (this._playbackUrlGeneration || 0) + 1;
    }
    attempt.route = route;
    if (route === "transcode") StartupLoadingOverlay.setStage?.("opening");
    else StartupLoadingOverlay.setPlaybackAttempt?.({ route, failedRoute: previousRoute });
    attempt.routeStartedAt = Date.now();
    attempt[triedKey] = true;
    this.clearPlaybackStallGuard();
    this.loadingVisible = true;
    try {
      const signal = this._selectedSourceAbort?.signal;
      const source = { ...candidate, url: attempt.sourceUrl, externalUrl: null };
      const probe = route === "transcode" ? await this.readSelectedPlaybackProbe(source) : null;
      if (signal?.aborted || attempt !== this.params?.unverifiedPlayback) return true;
      const prepare = async () => {
        if (route === "transcode")
          return this.prepareProbedPlaybackTranscode(attempt.sourceUrl, probe, signal, true);
        return route === "remux"
          ? await prepareUnverifiedRemux(attempt.sourceUrl, {
              probe: this.getPlayerStreamProbe?.(candidate),
              audioIndex: this.getPlayerStreamProbe?.(candidate)
                ? Number(
                    classifyPlayback({
                      url: attempt.sourceUrl,
                      probe: this.getPlayerStreamProbe(candidate),
                      capabilities: getDeviceCapabilities()
                    }).audioIndex
                  ) || 0
                : 0
            })
          : route === "audio-transcode"
            ? await prepareUnverifiedAudioTranscode(attempt.sourceUrl, {
                probe: this.getPlayerStreamProbe?.(candidate),
                capabilities: getDeviceCapabilities(),
                filenameVerdict: attempt.filenameVerdict,
                allowFilenameEstimate: attempt.filenameRouting === true,
                readProbe: () => {
                  const prober = (this._fallbackAudioProber ||= createStreamProber({
                    endpoint: PROBE_ENDPOINT,
                    mode: PROBE_MODE,
                    clientConcurrency: PROBE_CLIENT_CONCURRENCY,
                    timeoutMs: 15000,
                    assess: (probe) => assessPlaybackCapabilities(probe)
                  }));
                  return prober
                    .probe(attempt.sourceUrl, {
                      reason: "audio-fallback",
                      timeoutMs: 15000,
                      identity: streamProbeIdentity(candidate)
                    })
                    .then((facts) => {
                      if (facts && attempt === this.params?.unverifiedPlayback)
                        (this._playerListProbeResults ||= new Map()).set(
                          playerStreamProbeKey(candidate),
                          facts
                        );
                      return facts;
                    });
                }
              })
            : { url: attempt.sourceUrl, plan: null };
      };
      let delivery = attempt.routeFallbackEnabled
        ? await selectedPlaybackTask(prepare, {
            signal: this._selectedSourceAbort?.signal,
            timeoutMs:
              route === "remux"
                ? 17000
                : route === "direct"
                  ? 13000
                  : route === "transcode"
                    ? 75000
                    : 30000
          })
        : await prepare();
      if (!delivery && attempt.routeFallbackEnabled && route === "audio-transcode") {
        const facts = this.getPlayerStreamProbe?.(candidate);
        const verdict = facts
          ? classifyPlayback({
              url: attempt.sourceUrl,
              probe: facts,
              capabilities: getDeviceCapabilities()
            })
          : null;
        if (verdict?.method === "remux" && Number(verdict.audioIndex) > 0)
          delivery = await prepareUnverifiedRemux(attempt.sourceUrl, {
            probe: facts,
            audioIndex: Number(verdict.audioIndex)
          });
      }
      if (!delivery && attempt.routeFallbackEnabled)
        throw new Error("Verified conversion is unavailable for this stream.");
      if (!delivery) {
        attempt.route = previousRoute;
        return false;
      }
      if (
        this.playerBackNavigationInProgress ||
        !this.isActiveMountToken(mountToken) ||
        attempt !== this.params?.unverifiedPlayback ||
        this.activePlaybackUrl !== previousUrl
      )
        return true;
      if (
        route === "audio-transcode" &&
        (delivery.plan?.method === "remux" || /[?&]a=copy(?:&|$)/.test(delivery.url))
      )
        attempt.route = "remux";
      if (route === "transcode") {
        attempt.route = delivery.route;
        attempt.measuredTranscode = true;
        attempt.output = delivery.output;
      } else {
        attempt.measuredTranscode = false;
        attempt.output = null;
      }
      attempt.mediaUrl = delivery.url;
      this.params.playbackPlan = delivery.plan;
      console.warn(
        `[Playback] fallback route=${attempt.route === "remux" ? REMUX_POLICY.mode + "-remux" : attempt.route}`
      );
      this.relayPrepareDone = false;
      this.relayPrepareUrl = "";
      attempt.busy = false;
      this._preparingSelectedSource = false;
      this.activePlaybackUrl = delivery.url;
      await this.playStreamByUrl(delivery.url, {
        preservePanel: true,
        preservePendingRestore: true,
        resetSilentAudioState: false,
        sourceCandidate: candidate,
        mountToken
      });
    } catch (error) {
      if (
        !this.playerBackNavigationInProgress &&
        this.isActiveMountToken(mountToken) &&
        attempt === this.params?.unverifiedPlayback &&
        [previousUrl, attempt.mediaUrl].includes(this.activePlaybackUrl)
      ) {
        attempt.busy = false;
        if (
          (route === "remux" || attempt.routeFallbackEnabled) &&
          (await this.tryUnverifiedRemuxAfterFailure({
            detail: String(error?.message || ""),
            preparationFailed: attempt.routeFallbackEnabled === true,
            httpStatus: extractPlaybackHttpStatus(String(error?.message || ""))
          }))
        )
          return true;
        this.showStartupError(error?.message || "Unable to prepare this playback attempt.", {
          error,
          reason: "remux-attempt",
          playbackUrl: attempt.mediaUrl,
          streamCandidate: candidate
        });
      }
    } finally {
      if (!attempt.routeFallbackEnabled || attempt.route === route) attempt.busy = false;
    }
    return true;
  },

  async tryUnverifiedRemuxAfterFailure(failure = {}) {
    if (this.pendingAutomaticDirectAudio && (await this.restoreDefaultAfterAutomaticAudioFailure()))
      return true;
    const attempt = this.params?.unverifiedPlayback;
    if (attempt?.measuredTranscode && !attempt.routeFallbackEnabled) return false;
    if (attempt?.routeFallbackEnabled) {
      if (
        this.playerBackNavigationInProgress ||
        (this.hasPresentedPlaybackFrame && !this._preparingSelectedSource) ||
        attempt.mediaUrl !== this.activePlaybackUrl
      )
        return false;
      if (attempt.busy) return true;
      if (failure.reason === "client-transcode-software-video-decode-failed")
        attempt.softwareVideoDecodeFailed = true;
      if (
        attempt.route !== "direct" &&
        [401, 403, 429, 502, 503].includes(Number(failure.httpStatus))
      ) {
        this._processingUnavailable = true;
        failure = { ...failure, httpStatus: 0, detail: "", preparationFailed: true };
      }
      const next = nextPlaybackFallbackRoute(attempt, failure, {
        remuxAvailable: REMUX_POLICY.mode !== "off" && !this._processingUnavailable,
        audioAvailable: isTranscodeEnabled() && !this._processingUnavailable
      });
      if (!next) return false;
      console.warn(
        "[Playback] route-failed",
        JSON.stringify({
          route: attempt.route,
          next,
          trigger: failure.startupStall
            ? "startup-timeout"
            : failure.preparationFailed
              ? "preparation"
              : "playback-error",
          mediaErrorCode: Number(failure.mediaErrorCode) || 0,
          httpStatus: Number(failure.httpStatus) || 0
        })
      );
      return this.runUnverifiedPlaybackAttempt(next === "audio-transcode" ? "transcode" : next);
    }
    if (this._processingUnavailable) return false;
    if (!attempt || this.hasPresentedPlaybackFrame || attempt.mediaUrl !== this.activePlaybackUrl)
      return false;
    if (attempt.busy) return true;
    // Reserve before awaiting: native errors, play rejection and the startup guard
    // may describe the same failure. Each automatic route gets one attempt only.
    if (REMUX_POLICY.mode !== "off" && canTryUnverifiedRemux(attempt, failure))
      return this.runUnverifiedPlaybackAttempt("remux");
    if (canTryUnverifiedAudioTranscode(attempt, failure))
      return this.runUnverifiedPlaybackAttempt("audio-transcode");
    return false;
  },

  handleUnverifiedPlaybackAction(action) {
    const attempt = this.params?.unverifiedPlayback;
    if (!attempt) return false;
    if (action === "raw") {
      void this.runUnverifiedPlaybackAttempt("direct", { manual: true });
      return true;
    }
    if (action === "retry") {
      void this.runUnverifiedPlaybackAttempt(attempt.route, { manual: true });
      return true;
    }
    return false;
  },

  startPlayerControllerPlayback(
    url,
    context = {},
    { mountToken = null, sourceCandidate = null } = {}
  ) {
    const playbackUrl = String(url || "").trim();
    if (this.params?.playbackPlan?.sourceUrl === playbackUrl)
      context = { ...context, playbackPlan: this.params.playbackPlan };
    if (!playbackUrl) {
      this.showStartupError(t("player_error_no_stream_url", {}, "No stream URL provided"), {
        streamCandidate: sourceCandidate,
        reason: "missing-url"
      });
      return;
    }
    if (context.playbackPlan?.route === "client")
      context = {
        ...context,
        playbackPlan: {
          ...context.playbackPlan,
          startSeconds: Number(this.pendingPlaybackRestore?.timeSeconds) || 0
        }
      };
    PlayerController.video?.classList?.remove("player-awaiting-autoplay");
    this.startupReadiness = Environment.isBrowser()
      ? {
          url: playbackUrl,
          video: PlayerController.video,
          startedAt: Date.now(),
          metadataAt: null,
          timeoutError: false,
          allowPlayback: Boolean(this.startupAudioGateAllowsPlayback)
        }
      : null;
    this.startPlaybackStartupDiagnostics?.();
    PlayerController.setStartupPresentationAudioMuted?.(true);
    return Promise.resolve(PlayerController.play(playbackUrl, context)).catch(async (error) => {
      if (!this.isActiveMountToken(mountToken) || this.isExternalFrameMode()) {
        return;
      }
      if (playbackUrl !== String(this.activePlaybackUrl || "").trim()) {
        return;
      }
      if (this.isStartupErrorVisible()) {
        return;
      }
      const mediaErrorCode =
        typeof PlayerController.getLastPlaybackErrorCode === "function"
          ? Number(PlayerController.getLastPlaybackErrorCode() || 0)
          : 0;
      const detail = String(error?.message || error?.name || error || "").trim();
      const candidate =
        sourceCandidate ||
        this.getStreamCandidateByUrl(playbackUrl) ||
        this.getCurrentStreamCandidate();
      if (
        await this.tryUnverifiedRemuxAfterFailure?.({
          mediaErrorCode,
          detail,
          httpStatus: extractPlaybackHttpStatus(detail)
        })
      )
        return;
      this.markPlaybackSourceFailed(playbackUrl);
      if (!this.hasPresentedPlaybackFrame) {
        this.showStartupError(this.getStartupErrorMessage(mediaErrorCode, detail, candidate), {
          mediaErrorCode,
          detail,
          error,
          streamCandidate: candidate,
          playbackUrl,
          reason: "play-start"
        });
        console.warn("Playback failed to start", {
          url: playbackUrl,
          mediaErrorCode,
          error
        });
        return;
      }
      this.sourcesError = this.formatPlaybackErrorForSources(
        `${this.mediaErrorMessage(mediaErrorCode, detail, candidate)}. Choose another source manually.`,
        {
          mediaErrorCode,
          detail,
          error,
          streamCandidate: candidate,
          playbackUrl,
          reason: "play-after-startup"
        }
      );
      this.renderSourcesPanel();
      console.warn("Playback failed after startup", {
        url: playbackUrl,
        mediaErrorCode,
        error
      });
    });
  },

  getStartupErrorMessage(
    mediaErrorCode = 0,
    detail = "",
    streamCandidate = this.getCurrentStreamCandidate()
  ) {
    const code = Number(mediaErrorCode || 0);
    const compatibilityMessage = this.getWebHeaderRestrictedStreamMessage(streamCandidate);
    if (compatibilityMessage && (code === 0 || code === 2 || code === 4)) {
      return compatibilityMessage;
    }
    const baseMessage = this.mediaErrorMessage(code, detail, streamCandidate);
    const extra = String(detail || "").trim();
    if (!extra || (code === 4 && this.isDebridPlaybackCandidate(streamCandidate))) {
      return `${baseMessage}.`;
    }
    const normalizedExtra = extra.replace(/\s+/g, " ");
    if (baseMessage.toLowerCase().includes(normalizedExtra.toLowerCase())) {
      return baseMessage;
    }
    return `${baseMessage}. ${normalizedExtra}`;
  },

  focusStartupErrorButton() {
    const button = this.uiRefs?.startupErrorButton;
    if (button?.focus) {
      button.focus();
    }
    button?.classList?.add("focused");
  },

  showClientRemuxPlayAfterAutoplayBlock(status) {
    const state = this.startupReadiness;
    const video = PlayerController.video;
    if (
      !status?.autoplayBlocked ||
      !state ||
      state.autoplayBlocked ||
      this.hasPresentedPlaybackFrame ||
      !video?.paused ||
      video.readyState < 2 ||
      video.error ||
      this.isStartupErrorVisible() ||
      this.isExternalFrameMode()
    ) {
      return;
    }

    state.autoplayBlocked = true;
    video.classList?.add("player-awaiting-autoplay");
    this.clearPlaybackStallGuard();
    this.clearLoadingCompletionTimer();
    this.releaseStartupAudioGate({ resume: false });
    this.loadingVisible = false;
    this.paused = true;
    this.updateLoadingVisibility();
    this.updateMediaSessionPlaybackState();
    this.setControlsVisible(true, { focus: false });
    this.renderControlButtons();
  },

  canManuallyStartClientRemux() {
    const runtime = PlayerController.clientRemux;
    return Boolean(
      runtime &&
      (this.startupReadiness?.timeoutError || this.startupReadiness?.autoplayBlocked) &&
      !this.startupErrorMediaCode &&
      !PlayerController.video?.error &&
      !PlayerController.getLastPlaybackErrorCode?.() &&
      runtime.snapshot().state !== "error" &&
      Number(PlayerController.video?.readyState || 0) >= 2
    );
  },

  retryClientRemuxFromGesture() {
    if (!this.canManuallyStartClientRemux()) return false;
    const state = this.startupReadiness;
    state.timeoutError = false;
    state.autoplayBlocked = false;
    PlayerController.video?.classList?.remove("player-awaiting-autoplay");
    state.metadataAt = Date.now();
    state.manualPlayAttempts = Number(state.manualPlayAttempts || 0) + 1;
    this.clearStartupError();
    this.loadingVisible = true;
    this.startupPlaybackBaselineSeconds = this.getPlaybackCurrentSeconds();
    this.startupPlaybackHasAdvanced = false;
    this.releaseStartupAudioGate({ resume: false });
    PlayerController.setStartupPresentationAudioMuted(false);
    // Deliberately synchronous: preserve the user's activation through play()/AudioContext.resume().
    this.applyAudioAmplification();
    PlayerController.resume();
    console.warn(
      "[ClientRemux] manual-play " +
        JSON.stringify({
          attempt: state.manualPlayAttempts,
          audioBoostDb: Number(this.audioAmplificationDb || 0),
          audioContextState: this.audioContext?.state || "none"
        })
    );
    this.schedulePlaybackStallGuard();
    this.updateLoadingVisibility();
    return true;
  },

  renderStartupErrorOverlay() {
    if (Environment.isBrowser() && this.renderProposalError?.()) return;
    const overlay = this.uiRefs?.startupErrorOverlay;
    if (!overlay) {
      return;
    }
    const visible = this.isStartupErrorVisible();
    overlay.classList.toggle("hidden", !visible);
    overlay.setAttribute("aria-hidden", visible ? "false" : "true");
    if (!visible) {
      this.uiRefs?.root?.classList.remove("player-presentation-error");
      overlay.innerHTML = "";
      return;
    }
    const message =
      String(this.startupErrorMessage || "").trim() ||
      t("player_error_playback_fallback", {}, "Playback error");
    const detailLines = Array.isArray(this.startupErrorDetails)
      ? this.startupErrorDetails.filter(Boolean)
      : [];
    this.uiRefs?.root?.classList.toggle("player-presentation-error", visible);
    overlay.innerHTML = `
      <div class="player-startup-error-shell">
        <div class="player-startup-error-title">${escapeHtml(t("player_error_title", {}, "Playback Error"))}</div>
        <div class="player-startup-error-message">${escapeHtml(t("player_error_recovery_help", {}, "Try again or choose another source."))}</div>
        ${
          detailLines.length || message
            ? `
          <details class="player-startup-error-diagnostics"><summary>${escapeHtml(t("player_error_details", {}, "Playback error details"))}</summary><div class="player-startup-error-details"><div>${escapeHtml(message)}</div>${detailLines.map((line) => `<div>${escapeHtml(line)}</div>`).join("")}</div><button type="button" class="player-startup-error-button" data-player-error-action="copy-details">${escapeHtml(t("player_copy_error_details", {}, "Copy details"))}</button></details>
        `
            : ""
        }
        <div class="player-error-recovery-actions"><button type="button" class="player-startup-error-button" data-player-error-action="retry-current">${escapeHtml(t("action_retry", {}, "Try again"))}</button><button type="button" class="player-startup-error-button" data-player-error-action="choose-source">${escapeHtml(this.offlineDownloadId ? t("episodes_panel_title", {}, "Episodes") : t("stream_panel_title", {}, "Streams"))}</button></div>
        ${this.canManuallyStartClientRemux() ? `<button class="player-startup-error-button focusable" type="button" tabindex="0" data-player-error-action="play">${escapeHtml(t("detail_btn_play", {}, "Play"))}</button>` : ""}
        <button class="player-startup-error-button focusable focused" type="button" tabindex="-1" data-player-error-action="back">
          ${escapeHtml(t("player_go_back", {}, "Go Back"))}
        </button>
      </div>
    `;
    this.uiRefs = {
      ...(this.uiRefs || {}),
      startupErrorButton: overlay.querySelector('[data-player-error-action="back"]')
    };
  },

  shouldUseLoadingLogoFill() {
    return false;
  },

  stopLoadingLogoFillAnimation() {
    if (this.loadingLogoFillFrame != null) {
      clearTimeout(this.loadingLogoFillFrame);
      this.loadingLogoFillFrame = null;
    }
  },

  scheduleLoadingLogoFillAnimation() {
    if (this.loadingLogoFillFrame != null || !this.loadingLogoFillActive) {
      return;
    }
    this.loadingLogoFillFrame = setTimeout(() => {
      this.loadingLogoFillFrame = null;
      if (!this.loadingLogoFillActive) {
        return;
      }
      const current = clamp(Number(this.loadingLogoFillProgress || 0), 0, 1);
      const target = clamp(Number(this.loadingLogoFillTarget ?? current), current, 1);
      if (current >= 1 || target <= current) {
        this.syncLoadingOverlayProgress();
        return;
      }
      const distance = target - current;
      const step = Math.max(LOADING_LOGO_FILL_IDLE_STEP, distance * LOADING_LOGO_FILL_TARGET_LERP);
      this.loadingLogoFillProgress = Math.min(target, current + step);
      this.syncLoadingOverlayProgress();
      if (this.loadingLogoFillProgress < target) {
        this.scheduleLoadingLogoFillAnimation();
      }
    }, LOADING_LOGO_FILL_FRAME_MS);
  },

  setLoadingLogoFillTarget(progress = null, { immediate = false } = {}) {
    if (!this.shouldUseLoadingLogoFill()) {
      this.loadingLogoFillActive = false;
      this.loadingLogoFillProgress = 0;
      this.loadingLogoFillTarget = 0;
      this.stopLoadingLogoFillAnimation();
      this.syncLoadingOverlayProgress();
      return;
    }
    const parsed = Number(progress);
    if (!Number.isFinite(parsed)) {
      return;
    }
    const current = clamp(Number(this.loadingLogoFillProgress || 0), 0, 1);
    const target = clamp(parsed, current, 1);
    this.loadingLogoFillActive = true;
    this.loadingLogoFillTarget = Math.max(Number(this.loadingLogoFillTarget || 0), target);
    if (immediate) {
      this.loadingLogoFillProgress = Math.max(current, target);
    }
    this.syncLoadingOverlayProgress();
    this.scheduleLoadingLogoFillAnimation();
  },

  syncLoadingOverlayProgress() {
    const identity = this.uiRefs?.loadingIdentity;
    const stack = this.uiRefs?.loadingLogoStack;
    const base = this.uiRefs?.loadingLogoBase;
    const fillClip = this.uiRefs?.loadingLogoFillClip;
    if (this.isStartupErrorVisible()) {
      if (identity) {
        identity.classList.remove("is-loading-progress");
      }
      if (stack) {
        stack.classList.remove("is-loading-progress");
      }
      if (base) {
        base.style.opacity = "";
      }
      if (fillClip) {
        fillClip.classList.add("hidden");
        fillClip.style.width = "0%";
      }
      return;
    }
    if (!this.shouldUseLoadingLogoFill()) {
      this.loadingLogoFillActive = false;
      this.loadingLogoFillProgress = 0;
      this.loadingLogoFillTarget = 0;
      this.stopLoadingLogoFillAnimation();
      if (identity) {
        identity.classList.remove("is-loading-progress");
      }
      if (stack) {
        stack.classList.remove("is-loading-progress");
      }
      if (base) {
        base.style.opacity = "";
      }
      if (fillClip) {
        fillClip.classList.add("hidden");
        fillClip.style.width = "0%";
      }
      return;
    }
    const progress = Number(this.loadingProgress);
    const hasProgress = Number.isFinite(progress) && progress > 0;
    if (hasProgress) {
      this.loadingLogoFillActive = true;
      this.loadingLogoFillTarget = Math.max(
        Number(this.loadingLogoFillTarget || 0),
        clamp(progress, 0, 1)
      );
    }
    const showFill = Boolean(this.loadingLogoFillActive);
    if (identity) {
      identity.classList.toggle("is-loading-progress", showFill);
    }
    if (stack) {
      stack.classList.toggle("is-loading-progress", showFill);
    }
    if (base) {
      base.style.opacity = showFill ? "0.25" : "";
    }
    if (fillClip) {
      fillClip.classList.toggle("hidden", !showFill);
      if (showFill) {
        const visiblePercent =
          Math.round(clamp(this.loadingLogoFillProgress || 0, 0, 1) * 10000) / 100;
        fillClip.style.width = `${visiblePercent}%`;
      } else {
        fillClip.style.width = "0%";
      }
    }
    if (
      showFill &&
      clamp(Number(this.loadingLogoFillProgress || 0), 0, 1) <
        clamp(Number(this.loadingLogoFillTarget || 0), 0, 1)
    ) {
      this.scheduleLoadingLogoFillAnimation();
    }
  },

  refreshLoadingOverlayProgress() {
    // Browser loading presentation is driven by HTMLVideoElement events.
  },

  bindLoadingLogoFallback() {
    const identity = this.uiRefs?.loadingIdentity;
    const logo = this.uiRefs?.loadingLogoBase;
    const fill = this.uiRefs?.loadingLogoFill;
    if (!identity || !logo) {
      return;
    }

    const showLogo = () => {
      identity.classList.add("logo-loaded");
      identity.classList.remove("logo-failed");
      if (fill && logo.getAttribute("src")) {
        fill.setAttribute("src", logo.getAttribute("src"));
      }
      this.syncLoadingOverlayProgress();
    };
    const showTitleFallback = () => {
      identity.classList.add("logo-failed");
      identity.classList.remove("logo-loaded");
      if (fill) {
        fill.removeAttribute("src");
      }
      this.loadingProgress = null;
      this.loadingLogoFillActive = false;
      this.loadingLogoFillProgress = 0;
      this.loadingLogoFillTarget = 0;
      this.stopLoadingLogoFillAnimation();
      this.syncLoadingOverlayProgress();
    };

    logo.addEventListener("load", showLogo, { once: true });
    logo.addEventListener("error", showTitleFallback, { once: true });

    if (logo.complete) {
      if (logo.naturalWidth > 0 && logo.naturalHeight > 0) {
        showLogo();
      } else {
        showTitleFallback();
      }
    }
  },

  getPlayerUiState() {
    const header = this.getPlayerHeaderData();
    return {
      isPlaying: !this.paused,
      isBuffering: Boolean(this.loadingVisible),
      currentPosition: Math.round(this.getPlaybackCurrentSeconds() * 1000),
      duration: Math.round(this.getPlaybackDurationSeconds() * 1000),
      title: header.title,
      currentSeason: this.params?.season == null ? null : Number(this.params.season),
      currentEpisode: this.params?.episode == null ? null : Number(this.params.episode),
      currentEpisodeTitle: this.getDisplayEpisodeTitle() || null,
      releaseYear: header.meta || null,
      currentStreamName: this.getCurrentStreamCandidate()?.label || null,
      currentStreamUrl: this.getCurrentStreamCandidate()?.url || null,
      showControls: Boolean(this.controlsVisible),
      showSeekOverlay: Boolean(this.seekOverlayVisible),
      pendingPreviewSeekPosition:
        this.seekPreviewSeconds == null
          ? null
          : Math.round(Number(this.seekPreviewSeconds || 0) * 1000),
      playbackSpeed: this.getPlaybackSpeed(),
      showAudioOverlay: Boolean(this.audioDialogVisible),
      showSubtitleOverlay: Boolean(this.subtitleDialogVisible),
      subtitleDelayMs: Number(this.subtitleDelayMs || 0),
      subtitleStyle: { ...this.subtitleStyleSettings },
      audioAmplificationDb: Number(this.audioAmplificationDb || 0),
      isAudioAmplificationAvailable: Boolean(this.audioAmplificationAvailable),
      persistAudioAmplification: Boolean(this.persistAudioAmplification),
      showPauseOverlay: Boolean(this.pauseOverlayVisible),
      showEpisodesPanel: Boolean(this.episodePanelVisible),
      episodesAll: Array.isArray(this.episodes) ? this.episodes : [],
      showSourcesPanel: Boolean(this.sourcesPanelVisible),
      isLoadingSourceStreams: Boolean(this.sourcesLoading),
      sourceStreamsError: this.sourcesError || null,
      sourceAllStreams: Array.isArray(this.streamCandidates) ? this.streamCandidates : [],
      sourceSelectedAddonFilter: this.sourceFilter === "all" ? null : this.sourceFilter,
      sourceFilteredStreams: this.getFilteredSources(),
      sourceAvailableAddons: this.getSourceFilters().filter((entry) => entry !== "all")
    };
  },

  resolvePauseOverlayEpisodeEntry(entries = []) {
    if (!Array.isArray(entries) || !entries.length) {
      return null;
    }
    const explicitVideoId = String(this.params?.videoId || "").trim();
    if (explicitVideoId) {
      const byId = entries.find((entry) => String(entry?.id || "").trim() === explicitVideoId);
      if (byId) {
        return byId;
      }
    }

    const seasonRaw = this.params?.season;
    const season = Number(seasonRaw);
    const episode = Number(this.params?.episode || 0);
    if (
      seasonRaw != null &&
      Number.isFinite(season) &&
      season >= 0 &&
      Number.isFinite(episode) &&
      episode > 0
    ) {
      return (
        entries.find(
          (entry) =>
            Number(entry?.season || 0) === season && Number(entry?.episode || 0) === episode
        ) || null
      );
    }

    return null;
  },

  buildPauseOverlayMeta(meta = null) {
    const resolvedMeta = meta && typeof meta === "object" ? meta : {};
    const episodeEntry = this.resolvePauseOverlayEpisodeEntry(this.episodes);
    const metaEpisodeEntry = this.resolvePauseOverlayEpisodeEntry(resolvedMeta?.videos);
    const title =
      cleanDisplayText(
        this.params?.playerTitle ||
          this.params?.itemTitle ||
          resolvedMeta?.name ||
          this.params?.itemId ||
          "Untitled"
      ) || "Untitled";
    const releaseYear = cleanDisplayText(
      this.params?.playerReleaseYear ||
        this.params?.releaseYear ||
        this.params?.year ||
        extractReleaseYear(resolvedMeta?.releaseInfo)
    );
    const season = Number(
      this.params?.season ?? episodeEntry?.season ?? metaEpisodeEntry?.season ?? 0
    );
    const episode = Number(
      this.params?.episode ?? episodeEntry?.episode ?? metaEpisodeEntry?.episode ?? 0
    );
    const hasEpisodeContext =
      this.params?.season != null &&
      Number.isFinite(season) &&
      season >= 0 &&
      Number.isFinite(episode) &&
      episode > 0;
    const episodeCode = hasEpisodeContext ? `S${season}E${episode}` : "";
    const episodeTitle = cleanDisplayText(
      this.getDisplayEpisodeTitle() ||
        this.params?.playerEpisodeTitle ||
        episodeEntry?.title ||
        metaEpisodeEntry?.title ||
        metaEpisodeEntry?.name ||
        ""
    );
    const description = cleanDisplayText(
      this.params?.playerDescription ||
        this.params?.description ||
        this.params?.overview ||
        episodeEntry?.overview ||
        episodeEntry?.description ||
        metaEpisodeEntry?.overview ||
        metaEpisodeEntry?.description ||
        resolvedMeta?.description ||
        resolvedMeta?.overview ||
        ""
    );
    const backdropUrl = cleanDisplayText(
      this.params?.playerBackdropUrl ||
        this.params?.backdrop ||
        resolvedMeta?.background ||
        resolvedMeta?.poster ||
        this.params?.poster ||
        ""
    );
    const logoUrl = cleanDisplayText(
      this.params?.playerLogoUrl || resolvedMeta?.logo || this.params?.logo || ""
    );

    return {
      title,
      releaseYear,
      genres: resolvedMeta.genres || this.params?.playerGenres || this.params?.genres || "",
      episodeCode,
      episodeTitle,
      description,
      backdropUrl,
      logoUrl,
      runtime: formatRuntimeLabel(
        episodeEntry?.runtimeMinutes ||
          Number.parseFloat(resolvedMeta?.runtime) ||
          this.params?.runtimeMinutes ||
          0
      ),
      cast: extractPauseOverlayCast({
        castItems: this.params?.castItems || resolvedMeta?.castItems,
        castMembers: this.params?.castMembers || resolvedMeta?.castMembers,
        cast: this.params?.cast || resolvedMeta?.cast,
        credits: this.params?.credits || resolvedMeta?.credits
      })
    };
  },

  async hydratePauseOverlayMeta() {
    const itemId = String(this.params?.itemId || "").trim();
    const itemType = normalizeItemType(this.params?.itemType || "movie");
    if (!itemId || this.isExternalFrameMode()) {
      return;
    }

    const requestToken = Number(this.pauseOverlayMetaRequestToken || 0) + 1;
    this.pauseOverlayMetaRequestToken = requestToken;

    try {
      const result = await metaRepository.getMetaFromAllAddons(itemType, itemId);
      if (
        requestToken !== this.pauseOverlayMetaRequestToken ||
        result?.status !== "success" ||
        !result?.data
      ) {
        return;
      }
      this.pauseOverlayMeta = this.buildPauseOverlayMeta(result.data);
      this.updateBrowserDocumentTitle();
      this.renderPauseOverlay();
    } catch (error) {
      if (requestToken === this.pauseOverlayMetaRequestToken) {
        console.warn("Pause overlay metadata fetch failed", error);
      }
    }
  },

  clearPauseOverlayTimer() {
    if (this.pauseOverlayTimer) {
      clearTimeout(this.pauseOverlayTimer);
      this.pauseOverlayTimer = null;
    }
  },

  canShowPauseOverlay() {
    return (
      PlayerSettingsStore.get().pauseOverlayEnabled !== false &&
      !this.isExternalFrameMode() &&
      this.paused &&
      !this.isStartupErrorVisible() &&
      !this.loadingVisible &&
      !this.seekOverlayVisible &&
      this.seekPreviewSeconds == null &&
      !this.isDialogOpen() &&
      !this.parentalGuideVisible &&
      !this.moreActionsVisible &&
      !this.isNextEpisodeCardVisible()
    );
  },

  syncNativePausedStateForPauseOverlay() {
    if (this.isExternalFrameMode() || this.loadingVisible || this.startupAudioGateActive) {
      return false;
    }

    const video = PlayerController.video;
    if (!video?.paused) {
      return false;
    }

    const readyState =
      typeof PlayerController.getPlaybackReadyState === "function"
        ? Number(PlayerController.getPlaybackReadyState() || 0)
        : Number(video.readyState || 0);
    if (readyState < 3) {
      return false;
    }

    const ended =
      typeof PlayerController.isPlaybackEnded === "function"
        ? PlayerController.isPlaybackEnded()
        : Boolean(video.ended);
    if (ended) {
      return false;
    }

    const wasPaused = Boolean(this.paused);
    if (!wasPaused) {
      this.clearPlaybackStallGuard();
      this.paused = true;
      this.updateMediaSessionPlaybackState();
      this.setControlsVisible(true, { focus: false });
      this.renderControlButtons();
    }

    if (this.canShowPauseOverlay() && !this.pauseOverlayVisible && !this.pauseOverlayTimer) {
      this.schedulePauseOverlay();
      return true;
    }

    return !wasPaused;
  },

  dismissPauseOverlay({ revealControls = false, focus = false } = {}) {
    this.clearPauseOverlayTimer();
    // Reconcile DOM visibility even when another event already cleared the flag.
    this.pauseOverlayVisible = false;
    this.renderPauseOverlay();
    if (revealControls && !this.loadingVisible) {
      this.setControlsVisible(true, { focus });
    }
  },

  schedulePauseOverlay({ restart = false } = {}) {
    if (!this.canShowPauseOverlay()) {
      this.clearPauseOverlayTimer();
      this.pauseOverlayVisible = false;
      this.renderPauseOverlay();
      return;
    }
    if (restart) this.clearPauseOverlayTimer();
    // Passive playback statistics must not restart the pause delay or hide it.
    if (this.pauseOverlayVisible || this.pauseOverlayTimer) return;
    this.pauseOverlayVisible = false;
    this.renderPauseOverlay();
    this.pauseOverlayTimer = setTimeout(() => {
      this.pauseOverlayTimer = null;
      if (!this.canShowPauseOverlay()) {
        return;
      }
      this.pauseOverlayVisible = true;
      this.renderPauseOverlay();
    }, this.pauseOverlayDelayMs);
  },

  syncPauseOverlayState() {
    if (this.syncNativePausedStateForPauseOverlay()) {
      return;
    }
    if (this.pauseOverlayVisible && !this.canShowPauseOverlay()) {
      this.dismissPauseOverlay();
      return;
    }
    if (!this.pauseOverlayVisible && this.pauseOverlayTimer && !this.canShowPauseOverlay()) {
      this.clearPauseOverlayTimer();
    }
  },

  renderPauseOverlay() {
    const overlay = this.uiRefs?.pauseOverlay;
    const controlsOverlay = this.uiRefs?.controlsOverlay;
    if (!overlay) {
      return;
    }
    const hidden = !this.pauseOverlayVisible || this.loadingVisible || this.isStartupErrorVisible();
    overlay.classList.toggle("hidden", hidden);
    overlay.classList.toggle("is-still-watching", Boolean(this.stillWatchingPromptVisible));
    controlsOverlay?.classList.toggle("pause-overlay-active", !hidden);
    this.container
      ?.querySelector("#playerUiRoot")
      ?.classList.toggle("pause-screen-visible", !hidden);
    if (hidden) {
      return;
    }

    const clockText =
      String(
        this.lastUiTickState?.clockText || this.uiRefs?.clock?.textContent || "--:--"
      ).trim() || "--:--";
    if (this.stillWatchingPromptVisible) {
      const nextEpisode = this.resolveNextEpisodeInfo();
      const titleLine = [nextEpisode?.episodeLabel, nextEpisode?.episodeTitle]
        .filter(Boolean)
        .join(" • ");
      const episode = this.episodes.find(
        (entry) => String(entry?.id || "") === String(nextEpisode?.videoId || "")
      );
      const thumbnail = episodeThumbnailUrl(episode);
      overlay.innerHTML = `
        <div class="player-pause-overlay-content player-still-watching-content">
          ${thumbnail ? `<img class="player-still-watching-thumb" src="${escapeAttribute(thumbnail)}" alt="" aria-hidden="true" />` : ""}
          <div class="player-still-watching-copy">
            <div class="player-still-watching-kicker">${escapeHtml(t("still_watching_title", {}, "Are you still watching?"))}</div>
            <div class="player-still-watching-title">${escapeHtml(titleLine || t("next_episode_label", {}, "Next episode"))}</div>
            <div class="player-still-watching-status">${escapeHtml(t("still_watching_countdown", [this.stillWatchingPromptCountdownSec], "Stopping in %1$s"))}</div>
          </div>
          <div class="player-still-watching-actions">
            <button class="player-still-watching-btn focusable${this.stillWatchingPromptFocus === "continue" ? " focused" : ""}" type="button" tabindex="-1" data-player-pointer-action="stillWatchingContinue"><span class="player-still-watching-btn-icon" aria-hidden="true">&#9654;</span><span>${escapeHtml(t("still_watching_continue", {}, "Play"))}</span></button>
            <button class="player-still-watching-btn focusable is-secondary${this.stillWatchingPromptFocus === "exit" ? " focused" : ""}" type="button" tabindex="-1" data-player-pointer-action="stillWatchingExit"><span class="player-still-watching-btn-icon" aria-hidden="true">&#10005;</span><span>${escapeHtml(t("still_watching_exit", {}, "Exit"))}</span></button>
          </div>
        </div>
      `;
      if (this.stillWatchingPromptFocusArmed) {
        this.stillWatchingPromptFocusArmed = false;
        setTimeout(() => {
          const focusTarget = overlay.querySelector(
            "[data-player-pointer-action='stillWatchingContinue']"
          );
          focusTarget?.focus?.();
        }, 0);
      }
      return;
    }

    const meta = this.pauseOverlayMeta || this.buildPauseOverlayMeta();
    const castItems = Array.isArray(meta.cast) ? meta.cast.slice(0, MAX_PAUSE_OVERLAY_CAST) : [];
    const sourceBadges = renderPlayerSourceBadges(
      this.getCurrentStreamCandidate() || {},
      StreamBadgeSettingsStore.snapshot(),
      { sizeLast: true }
    );
    overlay.innerHTML = `
      <div class="player-pause-overlay-top">
        <div class="player-pause-overlay-clock">${escapeHtml(clockText)}</div>
        <div class="player-pause-overlay-ends-at">${escapeHtml(this.getPlayerUiState().endsAtText || t("player_ends_at", ["--:--"], "Ends at %1$s"))}</div>
      </div>
      <div class="player-pause-overlay-shade"></div>
      <div class="player-pause-overlay-content">
        <div class="player-pause-kicker">${escapeHtml(t("pause_you_are_watching", {}, "You're watching"))}</div>
        ${meta.logoUrl ? `<img class="player-pause-logo" src="${escapeAttribute(meta.logoUrl)}" alt="${escapeAttribute(meta.title)}" />` : `<div class="player-pause-title"><span>${escapeHtml(meta.title)}</span></div>`}
        <div class="player-pause-meta-line">${escapeHtml([meta.episodeCode, meta.episodeTitle, meta.releaseYear, formatRuntimeLabel(this.getPlaybackDurationSeconds() / 60) || meta.runtime].filter(Boolean).join(" · "))}</div>
        ${sourceBadges ? `<div class="player-pause-badges">${sourceBadges}</div>` : ""}
        ${meta.description ? `<div class="player-pause-description">${escapeHtml(meta.description)}</div>` : ""}
        ${
          castItems.length
            ? `
          <div class="player-pause-cast-section">
            <div class="player-pause-cast-label">${escapeHtml(t("pause_cast_label", {}, "Cast"))}</div>
            <div class="player-pause-cast-row">
              ${castItems
                .map(
                  (member) => `
                <div class="player-pause-cast-chip">
                  <div class="player-pause-cast-portrait">
                    <span aria-hidden="true">${escapeHtml(String(member.name || "").slice(0, 1))}</span>
                    ${member.photo ? `<img src="${escapeAttribute(member.photo)}" alt="" loading="eager" decoding="async" />` : ""}
                  </div>
                  <div class="player-pause-cast-copy">
                    <span class="player-pause-cast-name">${escapeHtml(member.name || "")}</span>
                    ${member.character ? `<span class="player-pause-cast-role">${escapeHtml(member.character)}</span>` : ""}
                  </div>
                </div>
              `
                )
                .join("")}
            </div>
          </div>
        `
            : ""
        }
      </div>
    `;
    overlay.querySelectorAll("img").forEach((image) => {
      image.addEventListener("load", () => this.fitPauseOverlay(), { once: true });
      image.addEventListener(
        "error",
        () => {
          if (image.closest(".player-pause-cast-portrait")) image.hidden = true;
          this.fitPauseOverlay();
        },
        { once: true }
      );
    });
    this.fitPauseOverlay();
  },

  clearStillWatchingPromptTimer() {
    if (this.stillWatchingPromptTimer) {
      clearInterval(this.stillWatchingPromptTimer);
      this.stillWatchingPromptTimer = null;
    }
  },

  resetStillWatchingPromptState({ render = true } = {}) {
    this.clearStillWatchingPromptTimer();
    this.stillWatchingPromptVisible = false;
    this.stillWatchingPromptCountdownSec = 0;
    this.stillWatchingPromptFocusArmed = false;
    this.stillWatchingPromptFocus = "continue";
    if (render) {
      this.renderPauseOverlay();
    }
  },

  enterStillWatchingPromptMode() {
    if (this.stillWatchingPromptVisible || this.nextEpisodeLaunching) {
      return;
    }
    const nextEpisode = this.resolveNextEpisodeInfo();
    if (!nextEpisode?.hasAired) {
      return;
    }

    this.clearStillWatchingPromptTimer();
    this.stillWatchingPromptVisible = true;
    this.stillWatchingPromptCountdownSec = 60;
    this.stillWatchingPromptFocusArmed = true;
    this.stillWatchingPromptFocus = "continue";
    PlayerController.pause();
    this.paused = true;
    this.updateMediaSessionPlaybackState();
    this.setControlsVisible(false, { focus: false });
    this.pauseOverlayVisible = true;
    this.renderPauseOverlay();

    this.stillWatchingPromptTimer = setInterval(() => {
      if (!this.stillWatchingPromptVisible) {
        this.clearStillWatchingPromptTimer();
        return;
      }
      const nextCountdown = Number(this.stillWatchingPromptCountdownSec || 0) - 1;
      if (nextCountdown <= 0) {
        this.onDismissStillWatchingPrompt();
        return;
      }
      this.stillWatchingPromptCountdownSec = nextCountdown;
      this.renderPauseOverlay();
    }, 1000);
  },

  async onStillWatchingContinue() {
    if (!this.stillWatchingPromptVisible) {
      return false;
    }
    this.resetStillWatchingPromptState({ render: false });
    this.consecutiveAutoPlayCount = 0;
    this.pauseOverlayVisible = false;
    this.renderPauseOverlay();
    await this.playNextEpisode({ userInitiated: true });
    return true;
  },

  onDismissStillWatchingPrompt() {
    if (!this.stillWatchingPromptVisible) {
      return false;
    }
    this.resetStillWatchingPromptState({ render: false });
    this.consecutiveAutoPlayCount = 0;
    this.pauseOverlayVisible = false;
    this.renderPauseOverlay();
    return this.navigateBackToStreamScreen({ forceDetail: true });
  },

  getDisplayEpisodeTitle() {
    const rawEpisodeTitle = String(
      this.params?.playerEpisodeTitle ||
        this.params?.episodeTitle ||
        this.params?.playerSubtitle ||
        ""
    ).trim();
    if (!rawEpisodeTitle) {
      return "";
    }
    const season = this.params?.season == null ? null : Number(this.params.season);
    const episode = this.params?.episode == null ? null : Number(this.params.episode);
    if (season == null || episode == null) {
      return rawEpisodeTitle;
    }
    return rawEpisodeTitle
      .replace(new RegExp(`^S0*${season}E0*${episode}\\s*[-\\u2022:]?\\s*`, "i"), "")
      .trim();
  },

  getPlayerHeaderData() {
    const title =
      String(
        this.params?.playerTitle || this.params?.itemTitle || this.params?.itemId || "Untitled"
      ).trim() || "Untitled";
    const season = this.params?.season == null ? null : Number(this.params.season);
    const episode = this.params?.episode == null ? null : Number(this.params.episode);
    const hasEpisodeContext =
      this.params?.season != null &&
      Number.isFinite(season) &&
      season >= 0 &&
      Number.isFinite(episode) &&
      episode > 0;
    const episodeCode = hasEpisodeContext ? `S${season}E${episode}` : "";
    const episodeTitle = this.getDisplayEpisodeTitle();
    const subtitle = hasEpisodeContext
      ? [episodeCode, episodeTitle].filter(Boolean).join(" • ")
      : "";
    const meta = String(
      this.params?.playerReleaseYear || this.params?.releaseYear || this.params?.year || ""
    ).trim();
    return { title, subtitle, meta };
  },

  hasEpisodeAired(released) {
    const raw = String(released || "").trim();
    if (!raw) {
      return true;
    }
    const datePortion = raw.match(/\b\d{4}-\d{2}-\d{2}\b/)?.[0] || raw;
    const parsedTime = Date.parse(datePortion);
    if (!Number.isFinite(parsedTime)) {
      return true;
    }
    return parsedTime <= Date.now();
  },

  resolveNextEpisodeInfo() {
    const itemType = normalizeItemType(this.params?.itemType || "movie");
    if (itemType !== "series") {
      return null;
    }

    let nextEpisode = null;
    const explicitVideoId = String(this.params?.nextEpisodeVideoId || "").trim();
    if (explicitVideoId && this.episodes.length) {
      nextEpisode =
        this.episodes.find((episode) => String(episode?.id || "") === explicitVideoId) || null;
    }

    if (!nextEpisode && this.params?.videoId && this.episodes.length) {
      const currentEpisode = this.episodes.find(
        (episode) => String(episode?.id || "") === String(this.params?.videoId || "")
      );
      nextEpisode = this.getNextEpisodeInSequence(currentEpisode);
    }

    if (!nextEpisode && this.episodes.length) {
      const currentSeasonRaw = this.params?.season;
      const currentSeason = Number(currentSeasonRaw);
      const currentEpisode = Number(this.params?.episode || 0);
      if (
        currentSeasonRaw != null &&
        Number.isFinite(currentSeason) &&
        currentSeason >= 0 &&
        currentEpisode > 0
      ) {
        const currentEntry = this.episodes.find(
          (episode) =>
            Number(episode?.season || 0) === currentSeason &&
            Number(episode?.episode || 0) === currentEpisode
        );
        nextEpisode = this.getNextEpisodeInSequence(currentEntry);
      }
    }

    const nextVideoId = String(nextEpisode?.id || explicitVideoId || "").trim();
    if (!nextVideoId) {
      return null;
    }

    const season = nextEpisode?.season ?? this.params?.nextEpisodeSeason ?? null;
    const episode = nextEpisode?.episode ?? this.params?.nextEpisodeEpisode ?? null;
    const episodeLabel = nextEpisode
      ? `S${nextEpisode.season}E${nextEpisode.episode}`
      : this.params?.nextEpisodeLabel || "";
    const released =
      String(nextEpisode?.released || this.params?.nextEpisodeReleased || "").trim() || null;
    return {
      videoId: nextVideoId,
      season: season == null ? null : Number(season),
      episode: episode == null ? null : Number(episode),
      episodeLabel: episodeLabel || null,
      episodeTitle:
        String(nextEpisode?.title || this.params?.nextEpisodeTitle || "").trim() || null,
      released,
      hasAired: this.hasEpisodeAired(released)
    };
  },

  getNextEpisodeInSequence(currentEpisode = null) {
    if (!currentEpisode || !Array.isArray(this.episodes) || !this.episodes.length) {
      return null;
    }
    const currentSeason = Number(currentEpisode?.season);
    const sequence = this.episodes.filter((episode) =>
      currentSeason === 0 ? Number(episode?.season) === 0 : Number(episode?.season) > 0
    );
    const currentIndex = sequence.findIndex(
      (episode) =>
        String(episode?.id || "") === String(currentEpisode?.id || "") ||
        (Number(episode?.season || 0) === currentSeason &&
          Number(episode?.episode || 0) === Number(currentEpisode?.episode || 0))
    );
    return currentIndex >= 0 ? sequence[currentIndex + 1] || null : null;
  },

  resolveCurrentEpisodeEntry() {
    if (!Array.isArray(this.episodes) || !this.episodes.length) {
      return null;
    }
    const currentVideoId = String(this.params?.videoId || "").trim();
    if (currentVideoId) {
      const byVideoId = this.episodes.find(
        (episode) => String(episode?.id || "") === currentVideoId
      );
      if (byVideoId) {
        return byVideoId;
      }
    }

    const currentSeasonRaw = this.params?.season;
    const currentSeason = Number(currentSeasonRaw);
    const currentEpisode = Number(this.params?.episode || 0);
    if (
      currentSeasonRaw == null ||
      !Number.isFinite(currentSeason) ||
      currentSeason < 0 ||
      currentEpisode <= 0
    ) {
      return null;
    }
    return (
      this.episodes.find(
        (episode) =>
          Number(episode?.season || 0) === currentSeason &&
          Number(episode?.episode || 0) === currentEpisode
      ) || null
    );
  },

  buildStreamRouteParamsFromPlayer() {
    const itemType = normalizeItemType(this.params?.itemType || "movie");
    const currentEpisode = itemType === "series" ? this.resolveCurrentEpisodeEntry() : null;
    const nextEpisode = itemType === "series" ? this.resolveNextEpisodeInfo() : null;
    const currentPositionMs = Math.round(this.getPlaybackCurrentSeconds() * 1000);
    const title =
      this.params?.playerTitle || this.params?.itemTitle || this.params?.itemId || "Untitled";
    const backdrop =
      this.params?.playerBackdropUrl || this.params?.backdrop || this.params?.poster || null;
    const logo = this.params?.playerLogoUrl || this.params?.logo || null;
    const videoId =
      itemType === "series"
        ? this.params?.videoId || currentEpisode?.id || null
        : this.params?.videoId || this.params?.itemId || null;

    return {
      itemId: this.params?.itemId || null,
      itemType,
      imdbId: this.params?.imdbId || null,
      tmdbId: this.params?.tmdbId || this.params?.tmdb_id || null,
      traktId: this.params?.traktId || this.params?.trakt_id || null,
      returnToDetail: true,
      fromDetailRoute: Boolean(this.params?.fromDetailRoute),
      itemTitle: title,
      itemSubtitle: itemType === "series" ? "" : this.params?.playerSubtitle || "",
      year: this.params?.playerReleaseYear || this.params?.year || "",
      backdrop,
      poster: this.params?.playerPosterUrl || this.params?.poster || backdrop,
      textlessPoster: this.params?.textlessPoster || null,
      logo,
      parentalWarnings: this.params?.parentalWarnings || null,
      parentalGuide: this.params?.parentalGuide || null,
      videoId,
      season:
        itemType === "series" ? (this.params?.season ?? currentEpisode?.season ?? null) : null,
      episode:
        itemType === "series" ? (this.params?.episode ?? currentEpisode?.episode ?? null) : null,
      episodeTitle:
        itemType === "series"
          ? this.params?.playerEpisodeTitle ||
            this.params?.playerSubtitle ||
            currentEpisode?.title ||
            ""
          : "",
      episodes: Array.isArray(this.episodes) ? this.episodes : [],
      nextEpisodeVideoId: nextEpisode?.videoId || null,
      nextEpisodeLabel: nextEpisode?.episodeLabel || null,
      nextEpisodeSeason: nextEpisode?.season ?? null,
      nextEpisodeEpisode: nextEpisode?.episode ?? null,
      nextEpisodeTitle: nextEpisode?.episodeTitle || "",
      nextEpisodeReleased: nextEpisode?.released || "",
      resumePositionMs:
        Number.isFinite(currentPositionMs) && currentPositionMs > 0 ? currentPositionMs : 0
    };
  },

  buildReturnStreamRouteParamsFromPlayer() {
    const derivedParams = this.buildStreamRouteParamsFromPlayer();
    const originalParams =
      this.params?.streamRouteParams && typeof this.params.streamRouteParams === "object"
        ? { ...this.params.streamRouteParams }
        : null;
    if (!originalParams) {
      return derivedParams;
    }
    return {
      ...derivedParams,
      ...originalParams,
      resumePositionMs: derivedParams.resumePositionMs,
      startFromBeginning: false
    };
  },

  shouldReturnToStreamOnBack() {
    if (this.params?.returnToStreamOnBack === false) {
      return false;
    }
    const streamParams = this.buildReturnStreamRouteParamsFromPlayer();
    return Boolean(
      this.params?.returnToStreamOnBack ||
      this.params?.streamRouteParams ||
      streamParams.itemId ||
      streamParams.videoId
    );
  },

  buildDetailRouteParamsFromPlayer() {
    const itemType = normalizeItemType(this.params?.itemType || "movie");
    const streamRouteParams =
      this.params?.streamRouteParams && typeof this.params.streamRouteParams === "object"
        ? this.params.streamRouteParams
        : null;
    const currentEpisode = itemType === "series" ? this.resolveCurrentEpisodeEntry() : null;
    const preferredSeasonRaw =
      itemType === "series" ? (this.params?.season ?? currentEpisode?.season) : null;
    const preferredSeason = Number(preferredSeasonRaw);
    return {
      itemId: this.params?.itemId || null,
      itemType,
      fallbackTitle:
        this.params?.playerTitle || this.params?.itemTitle || this.params?.itemId || "Untitled",
      imdbId: this.params?.imdbId || null,
      tmdbId: this.params?.tmdbId || this.params?.tmdb_id || null,
      traktId: this.params?.traktId || this.params?.trakt_id || null,
      returnToSearchOnBack: Boolean(
        this.params?.returnToSearchOnBack || streamRouteParams?.returnToSearchOnBack
      ),
      preferredSeason:
        preferredSeasonRaw != null && Number.isFinite(preferredSeason) && preferredSeason >= 0
          ? preferredSeason
          : null
    };
  },

  buildStreamRouteParamsForEpisode(episode = null) {
    const itemType = normalizeItemType(this.params?.itemType || "movie");
    const targetEpisode = episode || null;
    const title =
      this.params?.playerTitle || this.params?.itemTitle || this.params?.itemId || "Untitled";
    const backdrop =
      this.params?.playerBackdropUrl || this.params?.backdrop || this.params?.poster || null;
    const logo = this.params?.playerLogoUrl || this.params?.logo || null;
    return {
      itemId: this.params?.itemId || null,
      itemType,
      imdbId: this.params?.imdbId || null,
      tmdbId: this.params?.tmdbId || this.params?.tmdb_id || null,
      traktId: this.params?.traktId || this.params?.trakt_id || null,
      returnToDetail: true,
      fromDetailRoute: Boolean(this.params?.fromDetailRoute),
      itemTitle: title,
      itemSubtitle: itemType === "series" ? "" : this.params?.playerSubtitle || "",
      year: this.params?.playerReleaseYear || this.params?.year || "",
      backdrop,
      poster: this.params?.playerPosterUrl || this.params?.poster || backdrop,
      textlessPoster: this.params?.textlessPoster || null,
      logo,
      parentalWarnings: this.params?.parentalWarnings || null,
      parentalGuide: this.params?.parentalGuide || null,
      videoId: targetEpisode?.videoId || targetEpisode?.id || null,
      season: targetEpisode?.season == null ? null : Number(targetEpisode.season),
      episode: targetEpisode?.episode == null ? null : Number(targetEpisode.episode),
      episodeTitle:
        itemType === "series" ? targetEpisode?.episodeTitle || targetEpisode?.title || "" : "",
      episodes: Array.isArray(this.episodes) ? this.episodes : []
    };
  },

  navigateBackToStreamScreen({ forceDetail = false, chooseStream = false } = {}) {
    if (
      this.playerBackNavigationInProgress ||
      (Router.getCurrent?.() && Router.getCurrent() !== "player")
    ) {
      return true;
    }
    this.playerBackNavigationInProgress = true;
    this._candidatePlaybackGeneration = (this._candidatePlaybackGeneration || 0) + 1;
    this._selectedSourceProber?.cancelAll();
    this._selectedSourceAbort?.abort();
    this._fallbackAudioProber?.cancelAll();
    this.nextEpisodeLaunchToken = (this.nextEpisodeLaunchToken || 0) + 1;
    this._nextSourceDiscoveryCancel?.();
    StartupLoadingOverlay.finish();
    const streamParams = this.buildReturnStreamRouteParamsFromPlayer();
    try {
      PlayerController.stop();
    } catch (_) {
      // Route cleanup will make a second best-effort stop if native teardown throws.
    }
    if (chooseStream) {
      this.navigateToPlayerBackFallback({
        shouldReturnToStream: true,
        streamParams: {
          ...streamParams,
          manualSelection: true,
          autoSelectionFinished: true,
          autoResolvedStreamId: null,
          autoResolvedStreams: this.streamCandidates,
          autoResolvedStreamsComplete: this.params.streamCandidatesComplete !== false
        }
      });
      return true;
    }
    const shouldReturnToStream = !forceDetail && this.shouldReturnToStreamOnBack();
    const handoffReturn = String(this.params?.handoffReturnRoute || "").trim();
    const historyReturnRoute = shouldReturnToStream
      ? "stream"
      : ["detail", "home"].includes(handoffReturn)
        ? handoffReturn
        : null;
    if (historyReturnRoute) {
      const historyBack = Router.backToPreviousNuvioRoute?.(historyReturnRoute);
      if (historyBack?.accepted) {
        void historyBack.settled.then((landed) => {
          this.playerBackNavigationInProgress = false;
          // Accepting the Back only means history.back() was issued. When the
          // entry it lands on is not the parent we expected, nothing
          // navigates -- and playback has already been stopped above, so the
          // user is left looking at a dead player waiting for a Back that was
          // never going to come. Recover onto the synthetic route instead of
          // making them press Back again.
          if (!landed && Router.getCurrent?.() === "player") {
            this.navigateToPlayerBackFallback({ shouldReturnToStream, streamParams });
          }
        });
        // FocusEngine must preserve the popstate this Back just requested.
        return "history";
      }
    }

    this.navigateToPlayerBackFallback({ shouldReturnToStream, streamParams });
    return true;
  },

  // Direct, legacy, and malformed Player entries have no proven Stream parent,
  // and a history Back that failed to land leaves the player in the same state.
  navigateToPlayerBackFallback({ shouldReturnToStream, streamParams }) {
    this.playerBackNavigationInProgress = true;
    Router.suppressNextPopstate?.(1500);
    Router.ignoreSinglePopstate?.();
    // The stream route tells this player where Back belongs when its list was
    // never shown. Continue Watching says Home, because the Detail it passed
    // through was replaced on the way in and no longer exists to return to.
    const handoffReturn = String(this.params?.handoffReturnRoute || "").trim();
    const targetRoute = shouldReturnToStream
      ? "stream"
      : handoffReturn === "home" || handoffReturn === "detail"
        ? handoffReturn
        : this.params?.itemId
          ? "detail"
          : "home";
    const targetParams =
      targetRoute === "stream"
        ? streamParams
        : targetRoute === "detail"
          ? this.buildDetailRouteParamsFromPlayer()
          : {};
    void Router.navigate(targetRoute, targetParams, {
      skipStackPush: true,
      replaceHistory: true,
      isBackNavigation: true
    }).finally(() => {
      this.playerBackNavigationInProgress = false;
    });
  },

  shouldShowNextEpisodeCard() {
    const nextEpisode = this.resolveNextEpisodeInfo();
    if (!nextEpisode) {
      return false;
    }
    if (!this.hasPresentedPlaybackFrame) {
      return false;
    }
    if (this.nextEpisodeCardTriggered) {
      return true;
    }
    const durationSeconds = Number(this.getPlaybackDurationSeconds() || 0);
    const currentSeconds = Number(this.getPlaybackCurrentSeconds() || 0);
    if (
      !Number.isFinite(durationSeconds) ||
      durationSeconds <= 0 ||
      !Number.isFinite(currentSeconds) ||
      currentSeconds < 0
    ) {
      return false;
    }
    const settings = PlayerSettingsStore.get();
    const shouldShow = shouldShowNextEpisodeCardRule({
      positionSeconds: currentSeconds,
      durationSeconds,
      skipIntervals: settings.skipIntroEnabled ? this.skipIntervals : [],
      thresholdMode: settings.nextEpisodeThresholdMode,
      thresholdPercent: settings.nextEpisodeThresholdPercent,
      thresholdMinutesBeforeEnd: settings.nextEpisodeThresholdMinutesBeforeEnd
    });
    if (shouldShow) {
      this.nextEpisodeCardTriggered = true;
    }
    return shouldShow;
  },

  hasPlaybackReachedNaturalEnd() {
    const durationSeconds = Number(this.getPlaybackDurationSeconds() || 0);
    const currentSeconds = Number(this.getPlaybackCurrentSeconds() || 0);
    if (
      !Number.isFinite(durationSeconds) ||
      durationSeconds <= 0 ||
      !Number.isFinite(currentSeconds) ||
      currentSeconds < 0
    ) {
      return false;
    }
    const remainingSeconds = durationSeconds - currentSeconds;
    const progress = currentSeconds / durationSeconds;
    return remainingSeconds <= 1 || progress >= 0.999;
  },

  shouldPrefetchNextEpisodeStreams() {
    const durationSeconds = Number(this.getPlaybackDurationSeconds() || 0);
    const currentSeconds = Number(this.getPlaybackCurrentSeconds() || 0);
    if (
      !Number.isFinite(durationSeconds) ||
      durationSeconds <= 0 ||
      !Number.isFinite(currentSeconds) ||
      currentSeconds < 0
    ) {
      return false;
    }
    return currentSeconds / durationSeconds >= NEXT_EPISODE_PREFETCH_PERCENT;
  },

  getStreamCacheKey(videoId, itemType) {
    const normalizedVideoId = String(videoId || "").trim();
    if (!normalizedVideoId) {
      return "";
    }
    return `${normalizeItemType(itemType || this.params?.itemType || "movie")}:${normalizedVideoId}`;
  },

  getCachedPlayableStreamsForVideo(videoId, itemType) {
    const cacheKey = this.getStreamCacheKey(videoId, itemType);
    const cache = this.streamCandidatesByVideoId || (this.streamCandidatesByVideoId = new Map());
    if (!cacheKey || !cache.has(cacheKey)) {
      return null;
    }
    const cached = cache.get(cacheKey);
    return Array.isArray(cached) ? cached.map((stream) => ({ ...stream })) : [];
  },

  hasCachedPlayableStreamsForNextEpisode(nextEpisode = this.resolveNextEpisodeInfo()) {
    if (!nextEpisode?.videoId || nextEpisode.hasAired === false) {
      return false;
    }
    const cached = this.getCachedPlayableStreamsForVideo(
      nextEpisode.videoId,
      this.params?.itemType || "series"
    );
    return Array.isArray(cached) && cached.length > 0;
  },

  ensureNextEpisodeStreamsPrefetch({ force = false } = {}) {
    const nextEpisode = this.resolveNextEpisodeInfo();
    const itemType = normalizeItemType(this.params?.itemType || "movie");
    if (!nextEpisode?.videoId || itemType !== "series" || nextEpisode.hasAired === false) {
      return;
    }
    if (!force && !this.shouldPrefetchNextEpisodeStreams()) {
      return;
    }
    const cacheKey = this.getStreamCacheKey(nextEpisode.videoId, itemType);
    const loadPromises =
      this.streamCandidatesLoadPromises || (this.streamCandidatesLoadPromises = new Map());
    if (
      this.getCachedPlayableStreamsForVideo(nextEpisode.videoId, itemType) ||
      loadPromises.has(cacheKey)
    ) {
      return;
    }
    void this.getPlayableStreamsForVideo(nextEpisode.videoId, itemType, {
      season: nextEpisode.season,
      episode: nextEpisode.episode,
      priorityBingeGroup: this.getCurrentStreamBingeGroup()
    })
      .then(() => this.renderNextEpisodeCard())
      .catch((error) => console.warn("Next episode stream prefetch failed", error));
  },

  dismissNextEpisodeCard({ revealControls = false, armExitOnNextBack = false } = {}) {
    if (this.nextEpisodeLaunching) {
      this.cancelNextEpisodeLaunch();
    }
    this.nextEpisodeCardDismissed = true;
    this.nextEpisodeBackExitArmed = Boolean(armExitOnNextBack);
    if (revealControls) {
      this.setControlsVisible(true, { focus: true });
      return;
    }
    this.renderNextEpisodeCard();
  },

  resetNextEpisodeCardDismissal() {
    if (!this.nextEpisodeCardDismissed && !this.nextEpisodeBackExitArmed) {
      return;
    }
    this.nextEpisodeCardDismissed = false;
    this.nextEpisodeBackExitArmed = false;
    this.renderNextEpisodeCard();
  },

  isNextEpisodeCardVisible() {
    const nextEpisode = this.resolveNextEpisodeInfo();
    return Boolean(
      nextEpisode &&
      this.shouldShowNextEpisodeCard() &&
      !this.nextEpisodeCardDismissed &&
      !this.stillWatchingPromptVisible &&
      !this.loadingVisible &&
      !this.pauseOverlayVisible &&
      !this.subtitleDialogVisible &&
      !this.audioDialogVisible &&
      !this.speedDialogVisible &&
      !this.sourcesPanelVisible &&
      !this.episodePanelVisible &&
      !this.moreActionsVisible &&
      !this.isStartupErrorVisible()
    );
  },

  resetNextEpisodeLaunchPresentation() {
    this.nextEpisodeCardSearching = false;
    this.nextEpisodeCardSourceName = "";
    this.nextEpisodeCardCountdownSec = null;
  },

  cancelNextEpisodeLaunch() {
    this.nextEpisodeLaunchToken = Number(this.nextEpisodeLaunchToken || 0) + 1;
    this.nextEpisodeLaunching = false;
    this.nextEpisodeTransitionMeta = null;
    this.resetNextEpisodeLaunchPresentation();
    this.renderNextEpisodeCard();
  },

  isNextEpisodeLaunchActive(token) {
    return (
      this.nextEpisodeLaunching &&
      Number(token) === Number(this.nextEpisodeLaunchToken) &&
      Router.getCurrent() === "player"
    );
  },

  async runNextEpisodeCountdown(token, selectedStream) {
    const sourceName = String(selectedStream?.name || selectedStream?.addonName || "").trim();
    this.nextEpisodeCardSearching = false;
    this.nextEpisodeCardSourceName = sourceName;
    for (let remaining = 3; remaining >= 1; remaining -= 1) {
      if (!this.isNextEpisodeLaunchActive(token)) {
        return false;
      }
      this.nextEpisodeCardCountdownSec = remaining;
      this.renderNextEpisodeCard();
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    return this.isNextEpisodeLaunchActive(token);
  },

  maybeAutoplayNextEpisode() {
    const isVideoPaused = Boolean(PlayerController.video?.paused);
    if (
      this.nextEpisodeLaunching ||
      this.paused ||
      isVideoPaused ||
      !this.hasPresentedPlaybackFrame
    ) {
      return false;
    }

    const nextEpisode = this.resolveNextEpisodeInfo();
    if (!nextEpisode || normalizeItemType(this.params?.itemType || "movie") !== "series") {
      this.nextEpisodeAutoplayAttemptedKey = "";
      return false;
    }

    const settings = PlayerSettingsStore.get();
    if (!settings.autoplayNextEpisode || !nextEpisode.hasAired) {
      this.nextEpisodeAutoplayAttemptedKey = "";
      return false;
    }
    const effectiveSkipIntervals = settings.skipIntroEnabled ? this.skipIntervals : [];

    const durationSeconds = Number(this.getPlaybackDurationSeconds() || 0);
    const currentSeconds = Number(this.getPlaybackCurrentSeconds() || 0);
    if (
      !Number.isFinite(durationSeconds) ||
      durationSeconds <= 0 ||
      !Number.isFinite(currentSeconds) ||
      currentSeconds < 0
    ) {
      return false;
    }

    if (
      !shouldShowNextEpisodeCardRule({
        positionSeconds: currentSeconds,
        durationSeconds,
        skipIntervals: effectiveSkipIntervals,
        thresholdMode: settings.nextEpisodeThresholdMode,
        thresholdPercent: settings.nextEpisodeThresholdPercent,
        thresholdMinutesBeforeEnd: settings.nextEpisodeThresholdMinutesBeforeEnd
      })
    ) {
      this.nextEpisodeAutoplayAttemptedKey = "";
      return false;
    }

    const attemptKey = [
      String(nextEpisode.videoId || ""),
      String(nextEpisode.season ?? ""),
      String(nextEpisode.episode ?? "")
    ].join(":");
    if (this.nextEpisodeAutoplayAttemptedKey === attemptKey) {
      return false;
    }

    if (
      shouldEnterStillWatchingPrompt({
        stillWatchingEnabled: settings.stillWatchingEnabled,
        autoPlayNextEpisodeEnabled: settings.autoplayNextEpisode,
        nextEpisodeHasAired: nextEpisode.hasAired,
        consecutiveAutoPlayCount: this.consecutiveAutoPlayCount,
        threshold: settings.stillWatchingEpisodeThreshold
      })
    ) {
      this.nextEpisodeAutoplayAttemptedKey = "";
      this.enterStillWatchingPromptMode();
      return true;
    }

    this.nextEpisodeAutoplayAttemptedKey = attemptKey;
    void this.playNextEpisode({ userInitiated: false });
    return true;
  },

  async getPlayableStreamsForVideo(videoId, itemType, options = {}) {
    const normalizedVideoId = String(videoId || "").trim();
    const normalizedType = normalizeItemType(itemType || this.params?.itemType || "movie");
    if (!normalizedVideoId) {
      return [];
    }
    const cacheKey = this.getStreamCacheKey(normalizedVideoId, normalizedType);
    const cache = this.streamCandidatesByVideoId || (this.streamCandidatesByVideoId = new Map());
    if (cache.has(cacheKey)) {
      const cached = cache.get(cacheKey);
      const cachedStreams = Array.isArray(cached) ? cached.map((stream) => ({ ...stream })) : [];
      options.onChunk?.(cachedStreams);
      return cachedStreams;
    }
    const loadPromises =
      this.streamCandidatesLoadPromises || (this.streamCandidatesLoadPromises = new Map());
    if (loadPromises.has(cacheKey)) {
      const loaded = await loadPromises.get(cacheKey);
      const loadedStreams = Array.isArray(loaded) ? loaded.map((stream) => ({ ...stream })) : [];
      options.onChunk?.(loadedStreams);
      return loadedStreams;
    }

    let partialItems = [];
    const loadPromise = streamRepository
      .getStreamsFromAllAddons(normalizedType, normalizedVideoId, {
        itemId: String(this.params?.itemId || ""),
        tmdbId: this.params?.tmdbId ?? this.params?.tmdb_id,
        imdbId: this.params?.imdbId,
        season: options.season ?? null,
        episode: options.episode ?? null,
        priorityBingeGroup: options.priorityBingeGroup,
        onChunk: (chunkResult) => {
          const chunkItems = flattenStreamGroups(chunkResult);
          if (!chunkItems.length) {
            return;
          }
          partialItems = mergeStreamItems(partialItems, chunkItems);
          options.onChunk?.(partialItems.map((stream) => ({ ...stream })));
        }
      })
      .then((streamResult) => {
        const streamItems = mergeStreamItems(
          partialItems,
          streamResult?.status === "success" ? flattenStreamGroups(streamResult) : []
        );
        cache.set(
          cacheKey,
          streamItems.map((stream) => ({ ...stream }))
        );
        return streamItems;
      })
      .finally(() => {
        loadPromises.delete(cacheKey);
      });
    loadPromises.set(cacheKey, loadPromise);

    const streamItems = await loadPromise;
    return streamItems;
  },

  getCurrentStreamBingeGroup() {
    const currentStream =
      this.getStreamCandidateByUrl(this.activePlaybackUrl) || this.getCurrentStreamCandidate();
    return String(
      currentStream?.behaviorHints?.bingeGroup ||
        currentStream?.raw?.behaviorHints?.bingeGroup ||
        ""
    ).trim();
  },

  async selectNextEpisodeStreamByAutoPlayPolicy(
    streamItems = [],
    settings = PlayerSettingsStore.get(),
    options = {}
  ) {
    if (options.cancelled?.() === true || Date.now() >= (options.deadlineAt ?? Infinity))
      return null;
    if (!Array.isArray(streamItems) || !streamItems.length) {
      return null;
    }

    // The list these candidates came from is the same one the stream screen shows, so the
    // owner's "only show direct streams" choice has to hold here too: an episode that
    // autoplays a row the list was told to hide is the filter being bypassed.
    let candidates = streamItems;

    const installedAddonNames =
      options.installedAddonNames instanceof Set
        ? options.installedAddonNames
        : new Set(
            ((await addonRepository.getInstalledAddons().catch(() => [])) || [])
              .map((addon) => String(addon?.displayName || addon?.name || "").trim())
              .filter(Boolean)
          );
    return selectAutoPlayStream(
      candidates,
      nextEpisodeSelectionOptions(settings, {
        labels: StreamBadgeSettingsStore.snapshot(),
        installedAddonNames,
        preferredBingeGroup: settings.streamAutoPlayPreferBingeGroupForNextEpisode
          ? this.getCurrentStreamBingeGroup()
          : "",
        bingeGroupOnly: options.bingeGroupOnly,
        probeForStream: (stream) =>
          this._nextEpisodeProbeResults?.get(playerStreamProbeKey(stream)) ||
          this._nextEpisodeProbeResults?.get(stream.url || stream.externalUrl || "")
      })
    );
  },

  async resolveNextEpisodeStreamByAutoPlayPolicy(nextEpisode, itemType, settings) {
    const deadlineAt = streamSelectionDeadline(settings.streamAutoPlayTimeoutSeconds);
    const controller = new AbortController();
    const cancel = () => controller.abort();
    this._nextSourceDiscoveryCancel?.();
    this._nextSourceDiscoveryCancel = cancel;
    try {
      const installed = await withinStreamSelectionDeadline(
        () => addonRepository.getInstalledAddons().catch(() => []),
        deadlineAt,
        () => [],
        controller.signal
      );
      const selectionSettings = {
        ...settings,
        streamAutoPlayMode:
          settings.streamAutoPlayMode === "MANUAL" && settings.autoplayNextEpisode
            ? "FIRST_STREAM"
            : settings.streamAutoPlayMode
      };
      const result = await resolveAutoPlayStream({
        itemId: this.params?.itemId,
        itemType,
        videoId: nextEpisode.videoId,
        settings: selectionSettings,
        deadlineAt,
        installedAddonNames: new Set(
          (installed || []).map((a) => String(a.displayName || a.name || "").trim()).filter(Boolean)
        ),
        preferredBingeGroup: settings.streamAutoPlayPreferBingeGroupForNextEpisode
          ? this.getCurrentStreamBingeGroup()
          : "",
        returnOnFirstMatch: true,
        signal: controller.signal,
        repository: {
          getStreamsFromAllAddons: async (type, videoId, options) => {
            const wrap = (rows) => ({ status: "success", data: [{ streams: rows }] });
            const rows = await this.getPlayableStreamsForVideo(videoId, type, {
              season: nextEpisode.season,
              episode: nextEpisode.episode,
              priorityBingeGroup: options.priorityBingeGroup,
              onChunk: (rows) => options.onChunk?.(wrap(rows))
            });
            return wrap(rows);
          }
        }
      });
      reportAutoPlaySelection("next-episode", result, selectionSettings);
      return {
        selectedStream: result.selected,
        streamItems: result.streams,
        error: result.error || null,
        timedOut: result.timedOut === true,
        complete: result.complete === true
      };
    } finally {
      if (this._nextSourceDiscoveryCancel === cancel) this._nextSourceDiscoveryCancel = null;
    }
  },

  async openNextEpisodeStreamPicker(
    nextEpisode,
    { streamItems = null, forceReload = true, error = null } = {}
  ) {
    let episodeIndex = this.episodes.findIndex(
      (episode) => String(episode?.id || "") === String(nextEpisode?.videoId || "")
    );
    if (episodeIndex < 0) {
      this.episodes = [
        ...this.episodes,
        {
          id: nextEpisode.videoId,
          season: nextEpisode.season ?? null,
          episode: nextEpisode.episode ?? null,
          title: nextEpisode.episodeTitle || nextEpisode.episodeLabel || ""
        }
      ];
      episodeIndex = this.episodes.length - 1;
    }

    this.nextEpisodeLaunchToken = Number(this.nextEpisodeLaunchToken || 0) + 1;
    this.nextEpisodeLaunching = false;
    this.resetNextEpisodeLaunchPresentation();
    this.loadingVisible = false;
    this.nextEpisodeTransitionMeta = null;
    this.updateLoadingVisibility();
    this.refreshLoadingOverlayPresentation();
    this.setControlsVisible(true, { focus: false });
    this.episodePanelIndex = episodeIndex;
    this.episodePanelVisible = true;
    this.episodePanelMode = "streams";
    this.episodePanelStreamVideoId = String(nextEpisode.videoId || "");
    this.episodePanelStreamFilter = "all";
    this.episodePanelStreamsError = error
      ? t("panel_failed_load_streams", {}, "Failed to load streams")
      : "";
    this.episodePanelStreamsLoading = !Array.isArray(streamItems);
    this.episodePanelStreams = Array.isArray(streamItems) ? streamItems : [];
    this.episodePanelStreamFocus = this.episodePanelStreams.length
      ? { zone: "streams", index: 0 }
      : { zone: "actions", index: 0 };
    this.subtitleDialogVisible = false;
    this.audioDialogVisible = false;
    this.speedDialogVisible = false;
    this.sourcesPanelVisible = false;
    this.syncEpisodePanelSeasonToIndex();
    this.updateModalBackdrop();
    this.renderSubtitleDialog();
    this.renderAudioDialog();
    this.renderSpeedDialog();
    this.renderSourcesPanel();
    this.renderEpisodePanel();

    if (!Array.isArray(streamItems)) {
      await this.openEpisodeStreamsView({ forceReload });
    }
    return true;
  },

  async playNextEpisode({ userInitiated = false } = {}) {
    if (this.offlineDownloadId) {
      await this.loadOfflinePlayerLibrary();
      const current = this.episodes.findIndex(
        (e) =>
          Number(e.season) === Number(this.params.season) &&
          Number(e.episode) === Number(this.params.episode)
      );
      const next = this.episodes[current + 1];
      if (current >= 0 && next) return this.playOfflinePlayerEpisode(next);
      this.showAspectToast(t("player_no_downloaded_episode", {}, "No next episode downloaded"));
      return false;
    }
    const nextEpisode = this.resolveNextEpisodeInfo();
    const itemType = normalizeItemType(this.params?.itemType || "movie");
    if (
      !nextEpisode?.videoId ||
      itemType !== "series" ||
      nextEpisode.hasAired === false ||
      this.nextEpisodeLaunching
    ) {
      return false;
    }

    const settings = PlayerSettingsStore.get();
    const mode = String(settings.streamAutoPlayMode || "MANUAL").toUpperCase();
    const shouldAutoSelectInManualMode = mode === "MANUAL" && Boolean(settings.autoplayNextEpisode);
    if (mode === "MANUAL" && !shouldAutoSelectInManualMode) {
      return this.openNextEpisodeStreamPicker(nextEpisode, { forceReload: true });
    }

    const launchToken = Number(this.nextEpisodeLaunchToken || 0) + 1;
    this.nextEpisodeLaunchToken = launchToken;
    this.nextEpisodeLaunching = true;
    this.nextEpisodeCardTriggered = true;
    this.nextEpisodeCardSearching = true;
    this.nextEpisodeCardSourceName = "";
    this.nextEpisodeCardCountdownSec = null;
    if (userInitiated) {
      // A deliberate Next already confirms the transition. Keep one loading
      // surface visible instead of briefly exposing the automatic Up next card.
      this.loadingVisible = true;
      this.consecutiveAutoPlayCount = 0;
    }
    this.nextEpisodeTransitionMeta = {
      title: this.params?.playerTitle || this.params?.itemTitle || this.params?.itemId || "Nuvio",
      subtitle: nextEpisode.episodeTitle || nextEpisode.episodeLabel || "",
      logoUrl: this.params?.playerLogoUrl || this.params?.logo || "",
      backdropUrl:
        this.params?.playerBackdropUrl || this.params?.backdrop || this.params?.poster || ""
    };
    this.renderNextEpisodeCard();
    StartupLoadingOverlay.begin(
      {
        ...this.getLoadingOverlayMeta(),
        ...this.nextEpisodeTransitionMeta,
        itemKey: String(this.params?.itemId || "")
      },
      "finding"
    );
    StartupLoadingOverlay.setBackHandler(() => this.navigateBackToStreamScreen());

    try {
      const resolution = await this.resolveNextEpisodeStreamByAutoPlayPolicy(
        nextEpisode,
        itemType,
        settings
      );
      if (!this.isNextEpisodeLaunchActive(launchToken)) {
        return false;
      }
      const streamItems = Array.isArray(resolution.streamItems) ? resolution.streamItems : [];
      const selectedStream = resolution.selectedStream || null;

      if (!selectedStream) {
        console.warn("Next episode auto-selection did not find a stream; opening picker", {
          videoId: nextEpisode.videoId,
          totalStreams: streamItems.length,
          mode,
          preferBingeGroup: Boolean(settings.streamAutoPlayPreferBingeGroupForNextEpisode),
          error: resolution.error?.message || null
        });
        return this.openNextEpisodeStreamPicker(nextEpisode, {
          streamItems: resolution.error ? null : streamItems,
          forceReload: Boolean(resolution.error),
          error: resolution.error
        });
      }
      const bestStreamCandidate = selectedStream;
      const bestStream = streamDirectPlaybackUrl(bestStreamCandidate) || null;
      if (
        !userInitiated &&
        !(await this.runNextEpisodeCountdown(launchToken, bestStreamCandidate))
      ) {
        return false;
      }
      const nextEpisodeIndex = this.episodes.findIndex(
        (episode) => String(episode?.id || "") === String(nextEpisode.videoId || "")
      );
      const followingEpisode =
        nextEpisodeIndex >= 0 ? this.episodes[nextEpisodeIndex + 1] || null : null;
      this.consecutiveAutoPlayCount = userInitiated
        ? 0
        : Number(this.consecutiveAutoPlayCount || 0) + 1;
      this.loadingVisible = true;
      this.updateLoadingVisibility();
      this.refreshLoadingOverlayPresentation();
      this.setControlsVisible(false);
      this.renderNextEpisodeCard();
      await PlayerController.flushCurrentProgress({ allowCloudSync: false });
      if (!this.isNextEpisodeLaunchActive(launchToken)) {
        return false;
      }
      void PlayerController.pushProgressIfDue?.(true);
      await Router.navigate(
        "player",
        {
          streamUrl: bestStream,
          prepareSelectedSource: true,
          automaticSourceSelection: true,
          automaticNextEpisode: true,
          streamCandidatesComplete: resolution.complete === true,
          sourceProbe: this.getPlayerStreamProbe(bestStreamCandidate),
          sourceProbeKey: playerStreamProbeKey(bestStreamCandidate),
          itemId: this.params?.itemId,
          itemType,
          imdbId: this.params?.imdbId || null,
          tmdbId: this.params?.tmdbId || this.params?.tmdb_id || null,
          traktId: this.params?.traktId || this.params?.trakt_id || null,
          contentLanguage: this.contentLanguage || null,
          videoId: nextEpisode.videoId,
          season: nextEpisode.season,
          episode: nextEpisode.episode,
          episodeLabel: nextEpisode.episodeLabel || null,
          playerTitle: this.params?.playerTitle || this.params?.itemId,
          playerSubtitle: nextEpisode.episodeTitle || nextEpisode.episodeLabel || "",
          playerEpisodeTitle: nextEpisode.episodeTitle || "",
          playerBackdropUrl: this.params?.playerBackdropUrl || null,
          playerPosterUrl: this.params?.playerPosterUrl || this.params?.poster || null,
          textlessPoster: this.params?.textlessPoster || null,
          playerOrientationPreference:
            this.browserOrientation?.preference ||
            this.params?.playerOrientationPreference ||
            "landscape",
          playerLogoUrl: this.params?.playerLogoUrl || null,
          castItems: this.pauseOverlayMeta?.cast?.length
            ? this.pauseOverlayMeta.cast
            : this.params?.castItems || [],
          episodes: this.episodes || [],
          streamCandidates: streamItems.map((stream) =>
            stream.id === bestStreamCandidate.id ? bestStreamCandidate : stream
          ),
          preferredStreamId: bestStreamCandidate.id || null,
          playbackSourceContext: this.getPlaybackSourceContext(bestStreamCandidate),
          returnToStreamOnBack: this.shouldReturnToStreamOnBack(),
          handoffReturnRoute:
            this.params?.handoffReturnRoute ||
            (this.shouldReturnToStreamOnBack() ? "stream" : "detail"),
          streamRouteParams: this.params?.streamRouteParams || null,
          fromDetailRoute: this.params?.fromDetailRoute || false,
          nextEpisodeVideoId: followingEpisode?.id || null,
          nextEpisodeLabel: followingEpisode
            ? `S${followingEpisode.season}E${followingEpisode.episode}`
            : null,
          nextEpisodeSeason: followingEpisode?.season ?? null,
          nextEpisodeEpisode: followingEpisode?.episode ?? null,
          nextEpisodeTitle: followingEpisode?.title || "",
          nextEpisodeReleased: followingEpisode?.released || "",
          consecutiveAutoPlayCount: this.consecutiveAutoPlayCount
        },
        {
          replaceHistory: true
        }
      );
      return true;
    } catch (error) {
      if (!this.isNextEpisodeLaunchActive(launchToken)) {
        return false;
      }
      console.warn("Next episode play failed", error);
      return this.openNextEpisodeStreamPicker(nextEpisode, { forceReload: true, error });
    }
  },

  persistPlayerPresentationSettings() {
    PlayerSettingsStore.set({
      subtitleStyle: { ...this.subtitleStyleSettings },
      subtitleLanguage: this.subtitleStyleSettings?.preferredLanguage || "off",
      secondarySubtitleLanguage: this.subtitleStyleSettings?.secondaryPreferredLanguage || "off",
      audioAmplificationDb: Number(this.audioAmplificationDb || 0),
      persistAudioAmplification: Boolean(this.persistAudioAmplification)
    });
  },

  ensureAudioAmplificationGraph() {
    const video = PlayerController.video;
    if (!supportsWebAudioAmplification()) {
      this.audioAmplificationAvailable = false;
      return false;
    }
    if (!video || this.audioGainNode) {
      return Boolean(this.audioGainNode);
    }
    const AudioContextCtor = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (typeof AudioContextCtor !== "function") {
      return false;
    }
    try {
      this.audioContext = this.audioContext || new AudioContextCtor();
      this.audioMediaSource =
        this.audioMediaSource || this.audioContext.createMediaElementSource(video);
      this.audioGainNode = this.audioGainNode || this.audioContext.createGain();
      this.audioMediaSource.connect(this.audioGainNode);
      this.audioGainNode.connect(this.audioContext.destination);
      this.audioAmplificationAvailable = true;
      return true;
    } catch (_) {
      this.audioAmplificationAvailable = false;
      return false;
    }
  },

  applyAudioAmplification() {
    if (Number(this.audioAmplificationDb || 0) <= 0) {
      this.audioAmplificationAvailable =
        supportsWebAudioAmplification() &&
        typeof (globalThis.AudioContext || globalThis.webkitAudioContext) === "function";
      if (this.audioGainNode) {
        try {
          this.audioGainNode.gain.value = 1;
        } catch (_) {
          // Best effort.
        }
      }
      return;
    }
    if (!this.ensureAudioAmplificationGraph()) {
      this.audioAmplificationAvailable = false;
      return;
    }
    try {
      if (this.audioContext?.state === "suspended") {
        void this.audioContext.resume().catch(() => {});
      }
      this.audioGainNode.gain.value = dbToGain(this.audioAmplificationDb);
      this.audioAmplificationAvailable = true;
    } catch (_) {
      this.audioAmplificationAvailable = false;
    }
  },

  applySubtitlePresentationSettings({ refreshTrackRendering = false } = {}) {
    const uiRoot = this.uiRefs?.root;
    const video = PlayerController.video;
    if (!uiRoot || !video) {
      return;
    }
    PlayerController.clientRemux?.setSubtitleDelay(Number(this.subtitleDelayMs || 0) / 1000);
    this.relayTextSubtitles?.setDelay(Number(this.subtitleDelayMs || 0) / 1000);
    const style = this.subtitleStyleSettings || {};
    const verticalOffset = splitSubtitleVerticalOffset(style.verticalOffset);
    const subtitleColor = String(style.textColor || "#FFFFFF");
    const outlineColor = String(style.outlineColor || "#000000");
    const subtitleFontWeight = style.bold ? "800" : "500";
    const boldShadow = style.bold
      ? `0.45px 0 0 ${subtitleColor}, -0.45px 0 0 ${subtitleColor}, 0 0.45px 0 ${subtitleColor}, 0 -0.45px 0 ${subtitleColor}`
      : "";
    const outlineShadow = style.outlineEnabled
      ? `0 0 2px ${outlineColor}, 0 0 4px ${outlineColor}`
      : "";
    const subtitleShadow = [outlineShadow, boldShadow].filter(Boolean).join(", ") || "none";
    const subtitleFontSize = normalizeSubtitleFontSize(style.fontSize);
    const htmlSubtitleFontSize = formatHtmlSubtitleFontSize(subtitleFontSize);
    uiRoot.style.setProperty("--player-subtitle-color", String(style.textColor || "#FFFFFF"));
    uiRoot.style.setProperty(
      "--player-subtitle-background",
      String(style.backgroundColor || "#00000000")
    );
    uiRoot.style.setProperty("--player-subtitle-outline-color", outlineColor);
    uiRoot.style.setProperty("--player-subtitle-font-size", `${subtitleFontSize}%`);
    uiRoot.style.setProperty("--player-html-subtitle-font-size", htmlSubtitleFontSize);
    uiRoot.style.setProperty("--player-subtitle-font-weight", subtitleFontWeight);
    uiRoot.style.setProperty("--player-subtitle-shadow", subtitleShadow);
    uiRoot.style.setProperty(
      "--player-subtitle-offset",
      `${(verticalOffset.value * -2).toFixed(2)}vh`
    );
    video.style.setProperty("--player-subtitle-color", String(style.textColor || "#FFFFFF"));
    video.style.setProperty(
      "--player-subtitle-background",
      String(style.backgroundColor || "#00000000")
    );
    video.style.setProperty("--player-subtitle-outline-color", outlineColor);
    video.style.setProperty("--player-subtitle-font-size", `${subtitleFontSize}%`);
    video.style.setProperty("--player-subtitle-font-weight", subtitleFontWeight);
    video.style.setProperty("--player-subtitle-shadow", subtitleShadow);
    video.style.setProperty(
      "--player-subtitle-offset",
      `${(verticalOffset.residualOffset * -2).toFixed(2)}vh`
    );
    this.refreshSubtitleCueStyles();
    if (refreshTrackRendering) {
      this.refreshSubtitleTrackRendering();
    }
  },

  getSubtitleCueTrackList() {
    const trackList = this.getVideoTextTrackList();
    if (!trackList) {
      return [];
    }
    try {
      return Array.from(trackList).filter(
        (track) =>
          track && (!track.kind || ["subtitles", "captions", "forced"].includes(track.kind))
      );
    } catch (_) {
      const tracks = [];
      const length = Number(trackList.length || 0);
      for (let index = 0; index < length; index += 1) {
        const track = trackList[index] || trackList.item?.(index) || null;
        if (track && (!track.kind || ["subtitles", "captions", "forced"].includes(track.kind))) {
          tracks.push(track);
        }
      }
      return tracks;
    }
  },

  clearSubtitleCueStyleBindings() {
    if (!(this.subtitleCueStyleBindings instanceof Map)) {
      this.subtitleCueStyleBindings = new Map();
      return;
    }
    this.subtitleCueStyleBindings.forEach((handler, track) => {
      try {
        track?.removeEventListener?.("cuechange", handler);
      } catch (_) {
        // Best effort.
      }
    });
    this.subtitleCueStyleBindings.clear();
  },

  getSubtitleCueSnapshot(cue) {
    if (!cue || typeof cue !== "object") {
      return null;
    }
    if (!(this.subtitleCueOriginalState instanceof WeakMap)) {
      this.subtitleCueOriginalState = new WeakMap();
    }
    let snapshot = this.subtitleCueOriginalState.get(cue);
    if (!snapshot) {
      snapshot = {
        startTime: cue.startTime,
        endTime: cue.endTime,
        line: cue.line,
        lineAlign: cue.lineAlign,
        position: cue.position,
        positionAlign: cue.positionAlign,
        snapToLines: cue.snapToLines,
        appliedStartTime: cue.startTime,
        appliedEndTime: cue.endTime
      };
      this.subtitleCueOriginalState.set(cue, snapshot);
    }
    return snapshot;
  },

  applySubtitleCueDelay(cue, snapshot, delayMs = 0) {
    if (!cue || !snapshot) {
      return;
    }
    if (cue.startTime !== snapshot.appliedStartTime) snapshot.startTime = cue.startTime;
    if (cue.endTime !== snapshot.appliedEndTime) snapshot.endTime = cue.endTime;
    const offsetSeconds = Number(delayMs || 0) / 1000;
    const startTime = Number(snapshot.startTime);
    const endTime = Number(snapshot.endTime);
    if (!Number.isFinite(startTime) || !Number.isFinite(endTime)) {
      return;
    }
    const nextStart = Math.max(0, startTime + offsetSeconds);
    const nextEnd = Math.max(nextStart + 0.001, endTime + offsetSeconds);
    try {
      if (cue.startTime !== nextStart) cue.startTime = nextStart;
      if (cue.endTime !== nextEnd) cue.endTime = nextEnd;
      snapshot.appliedStartTime = cue.startTime;
      snapshot.appliedEndTime = cue.endTime;
    } catch (_) {
      // Some native text tracks expose readonly cue timing.
    }
  },

  restoreSubtitleCueSnapshot(cue, snapshot) {
    if (!cue || !snapshot) {
      return;
    }
    try {
      if (cue.line !== snapshot.line) cue.line = snapshot.line;
    } catch (_) {
      // Ignore cue restore failures.
    }
    try {
      if ("lineAlign" in cue) {
        if (cue.lineAlign !== snapshot.lineAlign) cue.lineAlign = snapshot.lineAlign;
      }
    } catch (_) {
      // Ignore cue restore failures.
    }
    try {
      if ("position" in cue) {
        if (cue.position !== snapshot.position) cue.position = snapshot.position;
      }
    } catch (_) {
      // Ignore cue restore failures.
    }
    try {
      if ("positionAlign" in cue) {
        if (cue.positionAlign !== snapshot.positionAlign)
          cue.positionAlign = snapshot.positionAlign;
      }
    } catch (_) {
      // Ignore cue restore failures.
    }
    try {
      if ("snapToLines" in cue) {
        if (cue.snapToLines !== snapshot.snapToLines) cue.snapToLines = snapshot.snapToLines;
      }
    } catch (_) {
      // Ignore cue restore failures.
    }
  },

  updateBrowserNativeSubtitleOffset() {
    if (!Environment.isBrowser()) return;
    const video = this.getDesktopPlaybackVideo();
    if (!video?.style) return;
    const rect = playerLocalRect(video, this.browserOrientation);
    const progress = this.uiRefs?.progressShell;
    const lift =
      this.controlsVisible && progress
        ? Math.max(0, rect.bottom - playerLocalRect(progress, this.browserOrientation).top + 12)
        : 0;
    const offset = splitSubtitleVerticalOffset(this.subtitleStyleSettings?.verticalOffset);
    const fontPx = Math.max(
      16,
      rect.height * 0.045 * (Number(this.subtitleStyleSettings?.fontSize || 100) / 100)
    );
    const canvasHeight =
      this.browserOrientation?.height ||
      (typeof window !== "undefined" ? window.innerHeight : rect.height);
    const pixels =
      offset.lineOffset * fontPx * 1.28 + offset.residualOffset * 0.02 * canvasHeight + lift;
    video.style.setProperty("--player-native-subtitle-offset", -pixels + "px");
    this.syncRotatedNativeSubtitles?.();
  },

  applySubtitleCueVerticalOffset(cue, snapshot, offset) {
    if (Environment.isBrowser()) return;
    if (!cue || !snapshot) {
      return;
    }
    const { lineOffset } = splitSubtitleVerticalOffset(offset);
    if (lineOffset === 0) {
      this.restoreSubtitleCueSnapshot(cue, snapshot);
      return;
    }

    const extraLines = 0;
    const baseLine = Number.isFinite(Number(snapshot.line)) ? Number(snapshot.line) : -1;
    try {
      if (snapshot.snapToLines === false && Number.isFinite(Number(snapshot.line))) {
        // Preserve file-authored percentage positioning and horizontal alignment.
        const linePercent =
          100 * 0.045 * (Number(this.subtitleStyleSettings?.fontSize || 100) / 100) * 1.28;
        cue.snapToLines = false;
        cue.line = clamp(baseLine - (lineOffset + extraLines) * linePercent, 0, 100);
      } else {
        cue.snapToLines = true;
        const adjustedLine = clamp(baseLine - lineOffset - extraLines, -100, 100);
        if (cue.line !== adjustedLine) cue.line = adjustedLine;
      }
    } catch (_) {
      // Some native cues do not expose writable layout properties.
    }
  },

  getSubtitleAssAlignment(content) {
    return getSubtitleAssAlignment(content);
  },

  hasSubtitleAssSyntax(content) {
    return /\{[^}]*[\\/][a-z0-9]+[^}]*\}|\\[Nnh]/i.test(String(content || ""));
  },

  getSubtitleAssAlignmentSettings(alignment) {
    return getSubtitleAssAlignmentSettings(alignment);
  },

  applySubtitleAssAlignmentToCue(cue, alignment) {
    const settings = this.getSubtitleAssAlignmentSettings(alignment);
    if (!cue || !settings) {
      return;
    }
    try {
      if ("snapToLines" in cue) {
        cue.snapToLines = false;
      }
    } catch (_) {
      // Ignore cue positioning failures.
    }
    try {
      cue.line = settings.line;
    } catch (_) {
      // Ignore cue positioning failures.
    }
    try {
      cue.align = settings.align;
    } catch (_) {
      // Ignore cue positioning failures.
    }
  },

  copySubtitleCuePresentation(sourceCue, targetCue) {
    if (!sourceCue || !targetCue) {
      return;
    }
    [
      "id",
      "pauseOnExit",
      "region",
      "vertical",
      "snapToLines",
      "line",
      "lineAlign",
      "position",
      "positionAlign",
      "size",
      "align"
    ].forEach((property) => {
      try {
        if (property in sourceCue && property in targetCue) {
          targetCue[property] = sourceCue[property];
        }
      } catch (_) {
        // Ignore cue presentation copy failures.
      }
    });
  },

  replaceSubtitleCueText(track, cue, text) {
    if (!track || !cue || typeof text !== "string") {
      return false;
    }
    const CueCtor =
      typeof VTTCue === "function"
        ? VTTCue
        : typeof TextTrackCue === "function"
          ? TextTrackCue
          : null;
    if (!CueCtor || typeof track.removeCue !== "function" || typeof track.addCue !== "function") {
      return false;
    }
    try {
      const replacement = new CueCtor(cue.startTime, cue.endTime, text);
      this.copySubtitleCuePresentation(cue, replacement);
      const snapshot =
        this.subtitleCueOriginalState instanceof WeakMap
          ? this.subtitleCueOriginalState.get(cue)
          : null;
      if (snapshot && this.subtitleCueOriginalState instanceof WeakMap) {
        this.subtitleCueOriginalState.set(replacement, snapshot);
      }
      track.removeCue(cue);
      track.addCue(replacement);
      return true;
    } catch (_) {
      return false;
    }
  },

  sanitizeSubtitleCueText(cue, track = null) {
    if (!cue || typeof cue !== "object" || typeof cue.text !== "string") {
      return false;
    }
    if (!this.hasSubtitleAssSyntax(cue.text)) {
      return false;
    }
    this.applySubtitleAssAlignmentToCue(cue, this.getSubtitleAssAlignment(cue.text));
    const cleaned = this.sanitizeSubtitleText(cue.text, { preserveBasicStyle: false });
    if (cleaned === cue.text) {
      return false;
    }
    try {
      cue.text = cleaned;
      return true;
    } catch (_) {
      return this.replaceSubtitleCueText(track, cue, cleaned);
    }
  },

  getSubtitleCueArray(cues) {
    if (!cues || typeof cues.length !== "number") {
      return [];
    }
    const cueCount = Number(cues.length || 0);
    const items = [];
    for (let index = 0; index < cueCount; index += 1) {
      const cue = cues[index] || cues.item?.(index) || null;
      if (cue) {
        items.push(cue);
      }
    }
    return items;
  },

  sanitizeSubtitleCuesForTrack(track) {
    const allCues = this.getSubtitleCueArray(track?.cues);
    const activeCues = this.getSubtitleCueArray(track?.activeCues);
    const seen = new Set();
    let changed = false;
    [...allCues, ...activeCues].forEach((cue) => {
      if (!cue || seen.has(cue)) {
        return;
      }
      seen.add(cue);
      changed = this.sanitizeSubtitleCueText(cue, track) || changed;
    });
    return changed;
  },

  isBrowserNativeSubtitleTrack(track) {
    return (
      Environment.isBrowser() &&
      ["subtitles", "captions", "forced"].includes(track?.kind) &&
      !(this.externalTrackNodes || []).some((node) => node.track === track)
    );
  },

  syncRotatedNativeSubtitles() {
    if (!Environment.isBrowser()) return;
    const video = this.getDesktopPlaybackVideo();
    const node = this.uiRefs?.nativeSubtitles;
    if (!video || !node) return;
    const lines = node.firstElementChild;
    const track =
      this.browserOrientation?.rotated &&
      !video.webkitDisplayingFullscreen &&
      !this.selectedAddonSubtitleId &&
      this.getTextTracks().find(
        (entry) => entry.mode === "showing" && this.isBrowserNativeSubtitleTrack(entry)
      );
    const rect = track ? playerLocalRect(video, this.browserOrientation) : null;
    const useOverlay = Boolean(track && lines && rect?.width > 0 && rect?.height > 0);
    video.classList.toggle("player-native-subtitles-mirrored", useOverlay);
    node.classList.toggle("hidden", !useOverlay);
    node.setAttribute("aria-hidden", String(!useOverlay));
    if (!useOverlay) {
      if (lines) lines.textContent = "";
      return;
    }
    // Read the current native cues only: no copied timeline and no cue timing writes.
    const text = this.getSubtitleCueArray(track.activeCues)
      .map((cue) => this.parseSubtitleCueText(cue.text || ""))
      .filter(Boolean)
      .join("\n");
    if (lines.textContent !== text) lines.textContent = text;
    const offset = parseFloat(video.style.getPropertyValue("--player-native-subtitle-offset")) || 0;
    Object.assign(node.style, {
      left: rect.left + "px",
      top: rect.top + "px",
      width: rect.width + "px",
      height: rect.height + "px",
      right: "auto",
      bottom: "auto",
      fontSize:
        Math.max(
          16,
          rect.height * 0.045 * (Number(this.subtitleStyleSettings?.fontSize || 100) / 100)
        ) + "px"
    });
    lines.style.bottom = Math.max(0, rect.height * 0.05 - offset) + "px";
  },

  applyBrowserNativeSubtitleLayout(track) {
    if (!this.isBrowserNativeSubtitleTrack(track)) return false;
    // Browser native subtitles use a stable default layout; keep native timing owned by the demuxer.
    const layout = {
      snapToLines: false,
      line: 95,
      lineAlign: "end",
      position: 50,
      positionAlign: "center",
      align: "center"
    };
    this.getSubtitleCueArray(track.activeCues).forEach((cue) => {
      Object.entries(layout).forEach(([key, value]) => {
        try {
          if (key in cue && cue[key] !== value) cue[key] = value;
        } catch (_) {
          // Native cues may expose only part of the writable WebVTT layout API.
        }
      });
    });
    return true;
  },

  reportNativeSubtitleLayout(track) {
    if (!Environment.isBrowser() || globalThis.__NUVIO_SUBTITLE_DEBUG__ !== true) return;
    const active = this.getSubtitleCueArray(track?.activeCues);
    if (!active.length || (this.externalTrackNodes || []).some((node) => node.track === track))
      return;
    const video = this.getDesktopPlaybackVideo();
    if (!video) return;
    const key = [
      this.subtitleSelectionToken || 0,
      this.controlsVisible,
      Boolean(video.webkitDisplayingFullscreen),
      track.language || "",
      this.browserOrientation?.preference || "desktop",
      this.browserOrientation?.rotation || 0
    ].join(":");
    const seen = (this.subtitleLayoutDiagnosticKeys ||= new Set());
    if (seen.has(key) || seen.size >= 6) return;
    seen.add(key);
    const r = playerLocalRect(video, this.browserOrientation);
    const fields = [
      "startTime",
      "endTime",
      "line",
      "lineAlign",
      "position",
      "positionAlign",
      "align",
      "size",
      "snapToLines",
      "vertical"
    ];
    const detail = {
      controls: Boolean(this.controlsVisible),
      nativeFullscreen: Boolean(video.webkitDisplayingFullscreen),
      orientation: this.browserOrientation?.preference || "desktop",
      video: { width: r.width, height: r.height, x: r.x, y: r.y },
      userOffset: this.subtitleStyleSettings?.verticalOffset,
      nativeOffset: video.style?.getPropertyValue?.("--player-native-subtitle-offset") || "",
      rotation: this.browserOrientation?.rotation || 0,
      cues: active
        .slice(0, 2)
        .map((cue) => Object.fromEntries(fields.map((name) => [name, cue[name]]))),
      tracks: this.getTextTracks()
        .slice(0, 12)
        .map((item) => ({
          kind: item.kind,
          language: item.language,
          mode: item.mode,
          addon: (this.externalTrackNodes || []).some((node) => node.track === item)
        }))
    };
    void fetch("/api/debug/log", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind: "subtitle-layout",
        message: "Native subtitle layout",
        stack: JSON.stringify(detail),
        at: new Date().toISOString()
      })
    }).catch(() => {});
  },

  syncSubtitleCueStylesForTrack(track) {
    if (!track) {
      return false;
    }
    const nativePresentation = this.applyBrowserNativeSubtitleLayout?.(track) === true;
    this.reportNativeSubtitleLayout?.(track);
    this.updateBrowserNativeSubtitleOffset?.();
    const subtitleTextChanged = this.sanitizeSubtitleCuesForTrack(track);
    const style = this.subtitleStyleSettings || {};
    const verticalOffset = normalizeSubtitleVerticalOffset(style.verticalOffset);
    const allCues = this.getSubtitleCueArray(track.cues);
    const activeCues = this.getSubtitleCueArray(track.activeCues);
    const seen = new Set();
    [...allCues, ...activeCues].forEach((cue) => {
      if (!cue || seen.has(cue)) {
        return;
      }
      seen.add(cue);
      const snapshot = this.getSubtitleCueSnapshot(cue);
      if (
        !nativePresentation ||
        Number(this.subtitleDelayMs || 0) !== 0 ||
        cue.startTime !== snapshot.startTime ||
        cue.endTime !== snapshot.endTime
      ) {
        this.applySubtitleCueDelay(cue, snapshot, this.subtitleDelayMs);
      }
      this.applySubtitleCueVerticalOffset(cue, snapshot, verticalOffset);
    });
    return subtitleTextChanged;
  },

  refreshSubtitleCueStyles() {
    const tracks = this.getSubtitleCueTrackList();
    if (!tracks.length) {
      return false;
    }

    this.syncRotatedNativeSubtitles?.();
    let subtitleTextChanged = false;
    tracks.forEach((track) => {
      if (!track) {
        return;
      }
      if (
        typeof track.addEventListener === "function" &&
        !this.subtitleCueStyleBindings.has(track)
      ) {
        const handler = () => {
          this.syncSubtitleCueStylesForTrack(track);
        };
        try {
          track.addEventListener("cuechange", handler);
          this.subtitleCueStyleBindings.set(track, handler);
        } catch (_) {
          // Ignore listener registration failures.
        }
      }
      subtitleTextChanged = this.syncSubtitleCueStylesForTrack(track) || subtitleTextChanged;
    });
    return subtitleTextChanged;
  },

  refreshSubtitleTrackRendering() {
    const restoreTrackMode =
      typeof requestAnimationFrame === "function"
        ? requestAnimationFrame
        : (callback) => setTimeout(callback, 16);
    const selectionToken = this.subtitleSelectionToken;
    this.getSubtitleCueTrackList().forEach((track) => {
      if (!track || track.mode !== "showing") {
        return;
      }
      try {
        track.mode = "hidden";
      } catch (_) {
        return;
      }
      restoreTrackMode(() => {
        if (selectionToken !== this.subtitleSelectionToken || track.mode !== "hidden") return;
        try {
          track.mode = "showing";
        } catch (_) {
          // Ignore native text-track refresh failures.
        }
      });
    });
  },

  positionTrackDialogs() {
    if (!Environment.isBrowser() || !this.uiRefs?.root) return;
    const root = this.uiRefs.root;
    if (root.classList.contains("player-presentation")) return;
    const row = root.querySelector(".player-controls-row");
    if (!row) return;
    const bounds = playerLocalRect(root, this.browserOrientation);
    const toolbar = playerLocalRect(row, this.browserOrientation);
    const style = typeof getComputedStyle === "function" ? getComputedStyle(root) : null;
    const leftInset =
      12 + (Number.parseFloat(style?.getPropertyValue("--browser-safe-area-left")) || 0);
    const rightInset =
      12 + (Number.parseFloat(style?.getPropertyValue("--browser-safe-area-right")) || 0);
    const back = playerLocalRect(
      root.querySelector("[data-player-desktop-back]"),
      this.browserOrientation
    );
    const top = back ? Math.max(12, back.bottom - bounds.top + 10) : 84;
    const bottom = Math.max(12, bounds.bottom - toolbar.top + 10);
    root.style.setProperty("--player-popover-bottom", bottom + "px");
    [
      [this.subtitleDialogVisible, this.uiRefs.subtitleDialog, "subtitleDialog"],
      [this.audioDialogVisible, this.uiRefs.audioDialog, "audioTrack"],
      [this.speedDialogVisible, this.uiRefs.speedDialog, "speed"]
    ].forEach(([visible, dialog, action]) => {
      if (!visible || !dialog) return;
      const anchor =
        root.querySelector('[data-action="' + action + '"]') ||
        root.querySelector('[data-action="more"]');
      const x = anchor ? playerLocalRect(anchor, this.browserOrientation).left - bounds.left : 12;
      dialog.style.bottom = bottom + "px";
      dialog.style.maxHeight = Math.max(0, toolbar.top - bounds.top - top - 10) + "px";
      const width = playerLocalRect(dialog, this.browserOrientation).width;
      dialog.style.left =
        clamp(x, leftInset, Math.max(leftInset, bounds.width - width - rightInset)) + "px";
    });
  },

  updateModalBackdrop() {
    const modalBackdrop = this.uiRefs?.modalBackdrop;
    const controlsOverlay = this.uiRefs?.controlsOverlay;
    if (!modalBackdrop) {
      return;
    }
    const hasModal =
      this.subtitleDialogVisible ||
      this.audioDialogVisible ||
      this.sourcesPanelVisible ||
      this.episodePanelVisible ||
      this.speedDialogVisible ||
      (Environment.isBrowser() && this.moreActionsVisible);
    if (hasModal && (this.pauseOverlayVisible || this.pauseOverlayTimer))
      this.dismissPauseOverlay();
    modalBackdrop.classList.toggle("hidden", !hasModal);
    modalBackdrop.classList.toggle("episodes-open", Boolean(this.episodePanelVisible));
    controlsOverlay?.classList.toggle("modal-blocked", hasModal);
    this.uiRefs?.root?.classList.toggle(
      "track-popover-open",
      Boolean(this.subtitleDialogVisible || this.audioDialogVisible || this.speedDialogVisible)
    );
    this.positionTrackDialogs();
  },

  bindVideoEvents() {
    const video = PlayerController.video;
    if (!video) {
      return;
    }

    if (Environment.isBrowser()) {
      video.controls = false;
      video.removeAttribute?.("controls");
    }

    const setStartupStage = (stage) => {
      if (this.hasPresentedPlaybackFrame) return;
      this.startupLoadingStage = stage;
      StartupLoadingOverlay.setStage(stage);
    };
    const onLoadStart = () => setStartupStage("loading");
    const onMetadataProgress = () => {
      if (!this.hasPresentedPlaybackFrame && Number(video.readyState || 0) === 0) {
        setStartupStage("metadata");
      }
    };
    const onWaiting = () => {
      if (this.isStartupErrorVisible() || this.startupReadiness?.autoplayBlocked) {
        return;
      }
      this.dismissPauseOverlay();
      this.loadingVisible = true;
      this.updateLoadingVisibility();
      if (!this.sourcesPanelVisible && !this.isSeekOverlaySuppressingControls()) {
        this.setControlsVisible(true, { focus: false });
      }
      this.schedulePlaybackStallGuard();
    };

    const onPlaying = () => {
      if (this.startupReadiness) this.startupReadiness.autoplayBlocked = false;
      video.classList?.remove("player-awaiting-autoplay");
      this.noteStartupReadiness(video);
      if (this.isStartupErrorVisible()) {
        return;
      }
      if (this.seekLoading) this.completeSeekLoadingIfReady();
      if (this.startupAudioGateActive && !this.startupAudioGateAllowsPlayback) {
        this.paused = false;
        this.startupTrackPreferenceReady = true;
        this.refreshTrackDialogs();
        this.applyAudioAmplification();
        this.applySubtitlePresentationSettings();
        this.applyAspectMode({ showToast: false });
        this.scheduleLoadingCompletionCheck(250);
        return;
      }
      const bingeGroup = this.getCurrentStreamBingeGroup();
      const scraperId = scraperIdFromPluginBingeGroup(bingeGroup);
      if (scraperId) {
        const playIdentity = JSON.stringify([
          this.params?.videoId,
          this.activePlaybackUrl,
          bingeGroup
        ]);
        if (this._lastRecordedPluginPlayback !== playIdentity) {
          this._lastRecordedPluginPlayback = playIdentity;
          PluginProviderPlaysStore.record(scraperId);
        }
      }
      // Fire-and-forget scrobble start (debounced internally)
      if (
        TrackingScrobbleService.isEnabled() &&
        !PlayerController.shouldSuppressOfflineProgress()
      ) {
        TrackingScrobbleService.start(this.buildScrobbleContext());
      }
      this.lastPlaybackErrorAt = 0;
      this.sourcesError = "";
      this.markPlaybackProgress();
      this.paused = false;
      this.seekOverlaySuppressControlsUntil = 0;
      this.startupTrackPreferenceReady = true;
      this.dismissPauseOverlay();
      this.updateMediaSessionPlaybackState();
      this.refreshTrackDialogs();
      this.applyAudioAmplification();
      this.applySubtitlePresentationSettings();
      this.applyAspectMode({ showToast: false });
      this.attemptPendingPlaybackRestore();
      this.setLoadingLogoFillTarget(1);
      this.markPlaybackPresentedAfterAdvance();
      this.applyDirectAudioPreferenceAfterStart?.();
      this.updateLoadingVisibility();
      this.updateUiTick();
      this.scheduleLoadingCompletionCheck(900);
      if (this.stickyProgressFocus && this.controlsVisible) {
        this.focusProgressBar();
      }
      this.resetControlsAutoHide();
      this.maybeShowParentalGuideOverlay();
      setTimeout(() => {
        this.attemptSilentAudioRecovery("playing");
      }, 700);
    };

    const onPause = () => {
      if (PlayerController.isClientRemuxRestoring()) return;
      if (this.startupAudioGateActive) {
        this.paused = false;
        this.updateMediaSessionPlaybackState();
        return;
      }
      const ended =
        typeof PlayerController.isPlaybackEnded === "function"
          ? PlayerController.isPlaybackEnded()
          : Boolean(video.ended);
      if (ended) {
        return;
      }
      // Immediate scrobble pause
      if (
        TrackingScrobbleService.isEnabled() &&
        !PlayerController.shouldSuppressOfflineProgress()
      ) {
        TrackingScrobbleService.pause(this.buildScrobbleContext());
      }
      this.clearPlaybackStallGuard();
      this.paused = true;
      this.updateMediaSessionPlaybackState();
      this.setControlsVisible(true, { focus: false });
      this.updateUiTick();
      this.renderControlButtons();
      this.schedulePauseOverlay();
    };

    const onTimeUpdate = () => {
      if (this.isStartupErrorVisible()) {
        return;
      }
      if (this.loadingVisible && !this.hasPresentedPlaybackFrame) {
        const playbackPresented = this.markPlaybackPresentedAfterAdvance();
        this.updateLoadingVisibility();
        this.scheduleLoadingCompletionCheck(playbackPresented ? 0 : 120);
      }
      this.markPlaybackProgress();
      this.attemptPendingPlaybackRestore();
      this.renderHtmlSubtitleOverlayAtCurrentTime();
      this.syncRotatedNativeSubtitles?.();
      this.updateUiTick();
    };

    const onProgress = () => {
      this.updateUiTick();
    };

    const onLoadedMetadata = () => {
      this.noteStartupReadiness(video);
      setStartupStage(this.pendingPlaybackRestore ? "restoring" : "frame");
      this.updateLoadingVisibility();
      if (this.isStartupErrorVisible()) {
        return;
      }
      this.attemptPendingPlaybackRestore({ force: true });

      this.loadDirectSubtitleData();
      this.startupTrackPreferenceReady = true;
      this.refreshTrackDialogs();
      this.updateUiTick();
      this.markPlaybackProgress();
      this.applyAudioAmplification();
      this.applySubtitlePresentationSettings();
      this.applyAspectMode({ showToast: false });
      this.ensureTrackDataWarmup();
      if (this.paused) {
        this.schedulePauseOverlay();
      }
      this.startTrackDiscoveryWindow({ durationMs: 5000, intervalMs: 300 });
      this.scheduleLoadingCompletionCheck(900);
      setTimeout(() => {
        this.attemptSilentAudioRecovery("metadata");
      }, 500);
    };

    const onPlayable = () => {
      this.showClientRemuxPlayAfterAutoplayBlock(PlayerController.clientRemux?.snapshot());
      this.noteStartupReadiness(video);
      setStartupStage(this.pendingPlaybackRestore ? "restoring" : "frame");
      if (this.isStartupErrorVisible()) {
        return;
      }
      this.attemptPendingPlaybackRestore();
      this.completeSeekLoadingIfReady();
      this.startupTrackPreferenceReady = true;
      this.refreshTrackDialogs();
      this.applySubtitlePresentationSettings();
      this.applyAspectMode({ showToast: false });
      this.scheduleLoadingCompletionCheck(120);
      this.updateUiTick();
    };

    const onSeeked = () => {
      this.relayTextSubtitles?.seek(this.getPlaybackCurrentSeconds());
      if (this.isStartupErrorVisible()) {
        return;
      }
      this.attemptPendingPlaybackRestore();
      this.completeSeekLoadingIfReady();
      this.markPlaybackProgress();
      this.updateUiTick();
    };

    const onTrackListChanged = () => {
      this.refreshTrackDialogs();
      this.refreshSubtitleCueStyles();
      if (
        this.trackDiscoveryInProgress &&
        this.hasAudioTracksAvailable() &&
        this.hasSubtitleTracksAvailable()
      ) {
        this.trackDiscoveryInProgress = false;
        this.clearTrackDiscoveryTimer();
        this.refreshTrackDialogs();
      }
    };

    const onError = async (event) => {
      if (this.isStartupErrorVisible()) {
        return;
      }
      this.seekLoading = false;
      this.seekLoadingBaselineSeconds = null;
      this.seekLoadingTargetSeconds = null;
      const now = Date.now();
      if (now - Number(this.lastPlaybackErrorAt || 0) < 120) {
        return;
      }
      this.lastPlaybackErrorAt = now;

      const detailErrorCode = Number(event?.detail?.mediaErrorCode || 0);
      const controllerErrorCode =
        typeof PlayerController.getLastPlaybackErrorCode === "function"
          ? Number(PlayerController.getLastPlaybackErrorCode() || 0)
          : 0;
      const mediaErrorCode =
        detailErrorCode || Number(video?.error?.code || 0) || controllerErrorCode;
      const eventDetail = event?.detail && typeof event.detail === "object" ? event.detail : {};
      const playbackErrorDetail = this.getPlaybackEventErrorDetail(eventDetail);
      // The source this failure belongs to. Every message below reports it, and
      // it was referenced here without ever being declared -- so each branch
      // threw at its first mention instead of showing anything. This handler is
      // async, which is why that was silent: the ReferenceError became an
      // unhandled rejection, so a failed stream produced no startup error, no
      // sources error and no offer to choose another source. It just hung.
      //
      // Resolved the way playStreamByUrl resolves it, so the message names the
      // same source the player was actually playing.
      const currentSourceCandidate =
        this.getStreamCandidateByUrl(this.activePlaybackUrl) || this.getCurrentStreamCandidate();
      if (
        await this.tryUnverifiedRemuxAfterFailure?.({
          mediaErrorCode,
          detail: playbackErrorDetail,
          reason: eventDetail.reason,
          httpStatus: eventDetail.hlsResponseCode
        })
      )
        return;
      const terminalHlsHttpFailure = isTerminalHlsHttpStatus(eventDetail.hlsResponseCode);
      if (
        !this.hasPresentedPlaybackFrame &&
        (mediaErrorCode === 2 || mediaErrorCode === 3 || mediaErrorCode === 4)
      ) {
        this.markPlaybackSourceFailed(this.activePlaybackUrl);
        const targetEngine =
          !terminalHlsHttpFailure &&
          typeof PlayerController.getAlternativePlaybackEngine === "function"
            ? PlayerController.getAlternativePlaybackEngine(this.activePlaybackUrl)
            : null;
        if (targetEngine) {
          this.lastPlaybackErrorAt = 0;
          this.loadingVisible = true;
          this.paused = false;
          this.sourcesError = null;
          this.updateLoadingVisibility();
          console.warn("Playback failed during startup; switching player engine", {
            url: this.activePlaybackUrl,
            mediaErrorCode,
            from: PlayerController.playbackEngine,
            to: targetEngine
          });
          void this.playStreamByUrl(this.activePlaybackUrl, {
            preservePanel: true,
            resetSilentAudioState: false,
            preservePendingRestore: Boolean(this.pendingPlaybackRestore),
            forceEngine: targetEngine
          });
          return;
        }
        this.markPlaybackSourceFailed(this.activePlaybackUrl);
        const startupErrorMessage = this.getStartupErrorMessage(
          mediaErrorCode,
          playbackErrorDetail,
          currentSourceCandidate
        );
        this.clearPlaybackStallGuard();
        this.releaseStartupAudioGate({ resume: false });
        this.showStartupError(startupErrorMessage, {
          mediaErrorCode,
          detail: playbackErrorDetail,
          eventDetail,
          streamCandidate: currentSourceCandidate,
          playbackUrl: this.activePlaybackUrl,
          reason: "startup-media-error"
        });
        console.warn("Playback failed during startup", {
          url: this.activePlaybackUrl,
          mediaErrorCode
        });
        return;
      }

      this.markPlaybackSourceFailed(this.activePlaybackUrl);

      this.clearPlaybackStallGuard();
      this.releaseStartupAudioGate({ resume: false });
      this.loadingVisible = false;
      this.paused = true;
      this.dismissPauseOverlay();
      this.updateLoadingVisibility();
      this.setControlsVisible(true, { focus: false });
      this.sourcesError = this.formatPlaybackErrorForSources(
        `${this.mediaErrorMessage(mediaErrorCode, playbackErrorDetail, currentSourceCandidate)}. Choose another source manually.`,
        {
          mediaErrorCode,
          detail: playbackErrorDetail,
          eventDetail,
          streamCandidate: currentSourceCandidate,
          playbackUrl: this.activePlaybackUrl,
          reason: "media-error"
        }
      );
      // Offer recovery without automatically changing the chosen source.
      this.showStartupError(
        this.mediaErrorMessage(mediaErrorCode, playbackErrorDetail, currentSourceCandidate),
        {
          mediaErrorCode,
          detail: playbackErrorDetail,
          eventDetail,
          streamCandidate: currentSourceCandidate,
          playbackUrl: this.activePlaybackUrl,
          reason: "media-error"
        }
      );

      console.warn("Playback failed", {
        url: this.activePlaybackUrl,
        mediaErrorCode
      });
    };

    const bindings = [
      ["loadstart", onLoadStart],
      ["progress", onMetadataProgress],
      ["waiting", onWaiting],
      ["playing", onPlaying],
      ["error", onError],
      ["pause", onPause],
      ["progress", onProgress],
      ["timeupdate", onTimeUpdate],
      ["loadedmetadata", onLoadedMetadata],
      ["loadeddata", onPlayable],
      ["canplay", onPlayable],
      ["seeked", onSeeked],
      ["hlstrackschanged", onTrackListChanged],
      ["dashtrackschanged", onTrackListChanged],
      ["audiotrackschanged", onTrackListChanged],
      ["remuxsubtitlecues", () => this.refreshSubtitleCueStyles()],
      [
        "remuxstatus",
        () => {
          this.updateUiTick();
          this.updateLoadingVisibility();
          const snapshot = PlayerController.clientRemux?.snapshot();
          this.showClientRemuxPlayAfterAutoplayBlock(snapshot);
          const status = snapshot?.subtitle;
          const key = [status?.state, status?.selectedTrack, status?.reason].join(":");
          if (this.clientSubtitleStatusKey !== key) {
            this.clientSubtitleStatusKey = key;
            this.invalidateTrackDialogCaches();
            if (this.subtitleDialogVisible) this.renderSubtitleDialog();
          }
        }
      ]
    ];

    bindings.forEach(([eventName, handler]) => {
      video.addEventListener(eventName, handler);
      this.videoListeners.push({ target: video, eventName, handler });
    });

    const trackTargets = [this.getVideoTextTrackList(), this.getVideoAudioTrackList()].filter(
      Boolean
    );
    trackTargets.forEach((target) => {
      if (typeof target.addEventListener !== "function") {
        return;
      }
      ["addtrack", "removetrack", "change"].forEach((eventName) => {
        target.addEventListener(eventName, onTrackListChanged);
        this.videoListeners.push({ target, eventName, handler: onTrackListChanged });
      });
    });
  },

  unbindVideoEvents() {
    PlayerController.video?.classList?.remove("player-awaiting-autoplay");
    this.startupReadiness = null;
    this.playbackStartupDiagnosticCleanup?.();
    this.playbackStartupDiagnosticCleanup = null;
    this.playbackStartupDiagnostic = null;
    this.videoListeners.forEach(({ target, eventName, handler }) => {
      target?.removeEventListener?.(eventName, handler);
    });
    this.videoListeners = [];
  },

  bindPlayerEndedHandler() {
    const video = PlayerController.video;
    if (!video) {
      return;
    }
    if (this.endedHandler) {
      video.removeEventListener("ended", this.endedHandler);
    }
    this.endedHandler = () => {
      if (PlayerController.isClientRemuxRestoring()) return;
      this.handlePlaybackEnded();
    };
    video.addEventListener("ended", this.endedHandler);
  },

  resetAudioAmplificationForMediaSession() {
    try {
      this.audioMediaSource?.disconnect?.();
    } catch (_) {
      // A detached media element may already have released its Web Audio source.
    }
    try {
      this.audioGainNode?.disconnect?.();
    } catch (_) {
      // Best effort only; the retained context is reused for the fresh video.
    }
    this.audioMediaSource = null;
    this.audioGainNode = null;
  },

  replaceBrowserMediaSession() {
    if (!Environment.isBrowser()) {
      return false;
    }
    const oldVideo = PlayerController.video;
    this.unbindVideoEvents();
    if (this.endedHandler && oldVideo) {
      oldVideo.removeEventListener("ended", this.endedHandler);
    }
    this.endedHandler = null;
    this.resetAudioAmplificationForMediaSession();
    const freshVideo = PlayerController.replaceBrowserVideoElement?.();
    if (!freshVideo) {
      this.bindVideoEvents();
      this.bindPlayerEndedHandler();
      this.applyAudioAmplification();
      return false;
    }
    this.bindVideoEvents();
    this.bindPlayerEndedHandler();
    this.applyAudioAmplification();
    this.applySubtitlePresentationSettings();
    this.applyAspectMode({ showToast: false });
    return true;
  },

  getControlDefinitions() {
    const uiState = this.getPlayerUiState();
    const nextEpisode = this.resolveNextEpisodeInfo();
    const compactBrowserToolbar = this.isCompactBrowserPlayerToolbar();
    const base = [
      {
        action: "playPause",
        label: this.paused ? ">" : "II",
        icon: this.paused ? "assets/icons/ic_player_play.svg" : "assets/icons/ic_player_pause.svg",
        title: "Play/Pause",
        primary: true
      }
    ];

    if (nextEpisode?.hasAired && !this.nextEpisodeLaunching) {
      base.push({
        action: "playNextEpisode",
        icon: "assets/icons/ic_player_skip_next.svg",
        useMask: true,
        title: t("next_episode_label", {}, "Next episode")
      });
    }

    base.push({
      action: "subtitleDialog",
      icon: "assets/icons/ic_player_subtitles.svg",
      title: t("subtitle_dialog_title", {}, "Subtitles")
    });

    base.push({
      action: "audioTrack",
      icon:
        this.selectedAudioTrackIndex >= 0
          ? "assets/icons/ic_player_audio_filled.svg"
          : "assets/icons/ic_player_audio_outline.svg",
      useMask: true,
      title: t("audio_dialog_title", {}, "Audio")
    });

    base.push({
      action: "source",
      icon: "assets/icons/ic_player_source.svg",
      title: t("sources_title", {}, "Sources")
    });

    if (Array.isArray(uiState.episodesAll) && uiState.episodesAll.length) {
      base.push({
        action: "episodes",
        icon: "assets/icons/ic_player_episodes.svg",
        title: t("episodes_panel_title", {}, "Episodes")
      });
    }

    if (Environment.isBrowser()) return this.getBrowserToolbarControls(base);

    base.push({
      action: "more",
      icon: "assets/icons/ic_player_more.svg",
      title:
        this.moreActionsVisible && compactBrowserToolbar
          ? t("common_close", {}, "Close more actions")
          : t("player_more_actions_title", {}, "More Actions")
    });

    if (!this.moreActionsVisible || compactBrowserToolbar) {
      return base;
    }

    const playbackSpeed = this.getPlaybackSpeed();
    const playbackSpeedOptions = this.getPlaybackSpeedOptions();
    return [
      ...base.slice(0, Math.max(0, base.length - 1)),
      ...(playbackSpeedOptions.length > 1
        ? [
            {
              action: "speed",
              label: `${playbackSpeed.toFixed(playbackSpeed % 1 ? 2 : 0)}x`,
              title: t("player_playback_speed", {}, "Playback speed")
            }
          ]
        : []),
      {
        action: "aspect",
        icon: "assets/icons/ic_player_aspect_ratio.svg",
        title: t("player_more_aspect_ratio", {}, "Aspect Ratio")
      },
      {
        action: "backFromMore",
        icon: "assets/icons/ic_player_back.svg",
        title: t("player_go_back", {}, "Back")
      }
    ];
  },

  getBrowserToolbarControls(base) {
    const find = (action) => base.find((entry) => entry.action === action);
    return [
      base[0],
      {
        action: "seekBack10",
        icon: "assets/icons/ic_player_rewind_10.svg",
        title: t("player_seek_back_10", {}, "Back 10 seconds")
      },
      {
        action: "seekForward10",
        icon: "assets/icons/ic_player_forward_10.svg",
        title: t("player_seek_forward_10", {}, "Forward 10 seconds")
      },
      find("playNextEpisode"),
      find("subtitleDialog"),
      find("audioTrack"),
      find("episodes"),
      {
        ...find("source"),
        title: this.offlineDownloadId
          ? t("player_local_file", {}, "File")
          : t("stream_panel_title", {}, "Streams")
      },
      {
        action: "more",
        icon: "assets/icons/ic_player_more.svg",
        title: t("player_more", {}, "More")
      }
    ].filter(Boolean);
  },
  renderCompactBrowserMorePanel() {
    this.renderProposalMore();
  },

  decorateBrowserTrackPanel(dialog, title, action) {
    if (!Environment.isBrowser() || !dialog) return;
    const heading = dialog.querySelector(".player-dialog-title");
    if (heading)
      heading.outerHTML = `<header class="player-panel-heading"><strong>${escapeHtml(title)}</strong><button type="button" class="player-control-btn player-panel-close" data-action="${action}" aria-label="${escapeAttribute(t("common_close", {}, "Close"))}">×</button></header>`;
  },
  getControlRenderSignature(controls = this.getControlDefinitions()) {
    return JSON.stringify(
      controls.map((control) => [
        control.action || "",
        control.label || "",
        control.icon || "",
        control.title || "",
        Boolean(control.primary),
        Boolean(control.useMask)
      ])
    );
  },

  renderControlButtons() {
    if (this.isExternalFrameMode()) {
      return;
    }
    const wrap = this.uiRefs?.controlButtons;
    if (!wrap) {
      return;
    }

    const controls = this.getControlDefinitions();
    const controlRenderSignature = this.getControlRenderSignature(controls);
    if (Environment.isBrowser() && this.renderProposalControls) {
      this.renderProposalControls(controls);
      return;
    }
    if (
      this.stickyProgressFocus &&
      this.controlsVisible &&
      !this.isDialogOpen() &&
      this.isSeekBarAvailable()
    ) {
      this.controlFocusZone = "progress";
    }
    this.controlFocusIndex = clamp(this.controlFocusIndex, 0, Math.max(0, controls.length - 1));

    wrap.innerHTML = controls
      .map(
        (control) => `
      <button class="player-control-btn focusable${control.primary ? " is-primary" : ""}"
              data-action="${control.action}"
              tabindex="${Environment.isBrowser() ? "0" : "-1"}"
              title="${escapeHtml(control.title || "")}" aria-label="${escapeAttribute(control.title || control.label || "")}">
        ${
          control.icon
            ? control.primary || control.useMask
              ? `<span class="player-control-icon player-control-icon-mask" style="-webkit-mask-image:url('${escapeHtml(control.icon)}');mask-image:url('${escapeHtml(control.icon)}');" aria-hidden="true"></span>`
              : `<img class="player-control-icon" src="${control.icon}" alt="" aria-hidden="true" />`
            : `<span class="player-control-label">${escapeHtml(control.label || "")}</span>`
        }
        ${Environment.isBrowser() && !["playPause", "seekBack10", "seekForward10", "playNextEpisode"].includes(control.action) ? `<span class="player-tool-caption">${escapeHtml(control.title || "")}</span>` : ""}
      </button>
    `
      )
      .join("");

    this.renderedControlSignature = controlRenderSignature;

    const buttons = Array.from(wrap.querySelectorAll(".player-control-btn"));
    if (Environment.isBrowser()) {
      this.stickyProgressFocus = false;
      this.controlFocusZone = "";
      buttons.forEach((button) => {
        button.classList.remove("focused");
        if (document.activeElement === button) {
          button.blur?.();
        }
      });
      const progressShell = this.uiRefs?.progressShell;
      progressShell?.classList?.remove("focused");
      if (document.activeElement === progressShell) {
        progressShell?.blur?.();
      }
      this.renderCompactBrowserMorePanel();
      this.renderNextEpisodeCard();
      this.syncPlayerOverlayLayoutState();
      return;
    }
    buttons.forEach((button, index) => {
      button.classList.toggle(
        "focused",
        this.controlFocusZone === "buttons" && index === this.controlFocusIndex
      );
    });
    const progressShell = this.uiRefs?.progressShell;
    if (progressShell) {
      progressShell.classList.toggle("focused", this.controlFocusZone === "progress");
    }

    if (this.controlFocusZone === "progress") {
      buttons.forEach((button) => {
        if (typeof button.blur === "function") {
          button.blur();
        }
      });
      if (
        progressShell &&
        document.activeElement !== progressShell &&
        typeof progressShell.focus === "function"
      ) {
        progressShell.focus();
      }
    } else if (this.controlFocusZone === "buttons") {
      if (
        progressShell &&
        document.activeElement === progressShell &&
        typeof progressShell.blur === "function"
      ) {
        progressShell.blur();
      }
      const focusedButton = buttons[this.controlFocusIndex] || null;
      if (
        focusedButton &&
        document.activeElement !== focusedButton &&
        typeof focusedButton.focus === "function"
      ) {
        focusedButton.focus();
      }
    } else if (this.controlFocusZone === "skipIntro") {
      buttons.forEach((button) => {
        if (typeof button.blur === "function") {
          button.blur();
        }
      });
      if (
        progressShell &&
        document.activeElement === progressShell &&
        typeof progressShell.blur === "function"
      ) {
        progressShell.blur();
      }
    }
    this.syncSkipIntroFocusState();
    this.renderCompactBrowserMorePanel();
    this.renderNextEpisodeCard();
    this.syncPlayerOverlayLayoutState();
  },

  syncControlFocusDom() {
    if (this.isExternalFrameMode()) {
      return;
    }
    const wrap = this.uiRefs?.controlButtons;
    if (!wrap) {
      return;
    }

    if (Environment.isBrowser()) {
      Array.from(wrap.querySelectorAll(".player-control-btn")).forEach((button) => {
        button.classList.remove("focused");
        if (document.activeElement === button) {
          button.blur?.();
        }
      });
      const progressShell = this.uiRefs?.progressShell;
      progressShell?.classList?.remove("focused");
      if (document.activeElement === progressShell) {
        progressShell?.blur?.();
      }
      return;
    }

    const controls = this.getControlDefinitions();
    const buttons = Array.from(wrap.querySelectorAll(".player-control-btn"));
    const controlsMatchDom = buttons.every(
      (button, index) => button.dataset.action === String(controls[index]?.action || "")
    );
    // This path is used only when focus moves. If playback state changed the
    // available controls without rendering them first, fall back to the full
    // state render instead of focusing a stale button.
    if (
      buttons.length !== controls.length ||
      !controlsMatchDom ||
      this.renderedControlSignature !== this.getControlRenderSignature(controls)
    ) {
      this.renderControlButtons();
      return;
    }

    this.controlFocusIndex = clamp(this.controlFocusIndex, 0, Math.max(0, controls.length - 1));
    buttons.forEach((button, index) => {
      button.classList.toggle(
        "focused",
        this.controlFocusZone === "buttons" && index === this.controlFocusIndex
      );
    });

    const progressShell = this.uiRefs?.progressShell;
    progressShell?.classList.toggle("focused", this.controlFocusZone === "progress");

    if (this.controlFocusZone === "progress") {
      buttons.forEach((button) => button.blur?.());
      if (progressShell && document.activeElement !== progressShell) {
        progressShell.focus?.();
      }
    } else if (this.controlFocusZone === "buttons") {
      if (progressShell && document.activeElement === progressShell) {
        progressShell.blur?.();
      }
      const focusedButton = buttons[this.controlFocusIndex] || null;
      if (focusedButton && document.activeElement !== focusedButton) {
        focusedButton.focus?.();
      }
    } else if (this.controlFocusZone === "skipIntro") {
      buttons.forEach((button) => button.blur?.());
      if (progressShell && document.activeElement === progressShell) {
        progressShell.blur?.();
      }
    }

    // Preserve the non-markup side effects of renderControlButtons().
    this.syncSkipIntroFocusState();
    this.renderNextEpisodeCard();
    this.syncPlayerOverlayLayoutState();
  },

  isDialogOpen() {
    return (
      this.subtitleDialogVisible ||
      this.audioDialogVisible ||
      this.sourcesPanelVisible ||
      this.episodePanelVisible ||
      this.speedDialogVisible ||
      (Environment.isBrowser() && this.moreActionsVisible)
    );
  },

  syncPlayerOverlayLayoutState() {
    const root = this.uiRefs?.root;
    if (!root) {
      return;
    }
    const controlsVisible = Boolean(this.controlsVisible) && !this.isExternalFrameMode();
    root.classList.toggle("controls-visible", controlsVisible);
    // Controls can return through tap, resume, a drawer, or error recovery.
    // None may retain the pause screen's visibility mask over the header.
    const pauseVisible = Boolean(
      this.pauseOverlayVisible && !this.loadingVisible && !this.isStartupErrorVisible?.()
    );
    root.classList.toggle("pause-screen-visible", pauseVisible);
    this.uiRefs?.controlsOverlay?.classList.toggle("pause-overlay-active", pauseVisible);
    this.updateBrowserNativeSubtitleOffset();
    const backButton = root.querySelector("[data-player-desktop-back]");
    if (backButton) {
      backButton.toggleAttribute("inert", !controlsVisible);
      backButton.setAttribute("aria-hidden", String(!controlsVisible));
    }
    this.syncPlayerActionOverlayOffset();
  },

  measurePlayerActionOverlayOffset() {
    const root = this.uiRefs?.root;
    const controlsBottom = this.uiRefs?.controlsBottom;
    if (!root || !controlsBottom || !this.controlsVisible || this.isExternalFrameMode()) {
      return null;
    }

    const rootRect = playerLocalRect(root, this.browserOrientation);
    const controlsRect = playerLocalRect(controlsBottom, this.browserOrientation);
    if (!rootRect || !controlsRect) {
      return null;
    }

    const rootBottom = Number(rootRect.bottom);
    const controlsTop = Number(controlsRect.top);
    const rootHeight = Number(rootRect.height);
    if (
      !Number.isFinite(rootBottom) ||
      !Number.isFinite(controlsTop) ||
      !Number.isFinite(rootHeight) ||
      rootHeight <= 0
    ) {
      return null;
    }

    const controlsHeightFromBottom = Math.max(0, rootBottom - controlsTop);
    const safetyGap = Math.max(18, Math.min(48, rootHeight * 0.03));
    return Math.ceil(controlsHeightFromBottom + safetyGap);
  },

  syncPlayerActionOverlayOffset() {
    const root = this.uiRefs?.root;
    if (!root) {
      return;
    }

    if (!this.controlsVisible || this.isExternalFrameMode()) {
      root.style.removeProperty("--player-action-controls-open-bottom");
      this.lastActionOverlayBottomPx = null;
      return;
    }

    const measuredBottom = this.measurePlayerActionOverlayOffset();
    if (!Number.isFinite(measuredBottom) || measuredBottom <= 0) {
      return;
    }
    if (Math.abs(Number(this.lastActionOverlayBottomPx || 0) - measuredBottom) < 1) {
      return;
    }

    this.lastActionOverlayBottomPx = measuredBottom;
    root.style.setProperty("--player-action-controls-open-bottom", `${measuredBottom}px`);
  },

  setControlsVisible(visible, { focus = false } = {}) {
    this.controlsVisible = Boolean(visible);
    if (Environment.isBrowser()) {
      this.container?.classList.toggle(
        "desktop-player-cursor-hidden",
        !this.controlsVisible && !this.paused
      );
    }
    if (this.isExternalFrameMode()) {
      return;
    }
    const overlay = this.uiRefs?.controlsOverlay;
    if (!overlay) {
      return;
    }
    overlay.classList.toggle("hidden", !this.controlsVisible);
    this.syncPlayerOverlayLayoutState();
    this.updateSkipIntroCountdown(Date.now());
    this.renderSkipIntroButton();
    if (this.controlsVisible) {
      this.renderControlButtons();
      if (focus && !Environment.isBrowser()) {
        this.focusFirstControl();
      }
      this.resetControlsAutoHide();
    } else {
      this.clearControlsAutoHide();
      this.focusPlayerRootForHiddenControls();
    }
  },

  focusPlayerRootForHiddenControls() {
    if (this.isExternalFrameMode() || this.controlsVisible || this.isDialogOpen()) {
      return;
    }
    const root = this.uiRefs?.root;
    if (!root || typeof root.focus !== "function") {
      return;
    }
    try {
      root.focus({ preventScroll: true });
    } catch (_) {
      try {
        root.focus();
      } catch (_) {
        // Best effort on older TV engines.
      }
    }
  },

  focusFirstControl() {
    if (Environment.isBrowser()) {
      this.stickyProgressFocus = false;
      this.controlFocusZone = "";
      this.syncControlFocusDom();
      return;
    }
    this.stickyProgressFocus = false;
    this.autoHideControlsAfterSeek = false;
    this.controlFocusZone = "buttons";
    this.controlFocusIndex = 0;
    this.syncControlFocusDom();
    const firstButton = this.container.querySelector(".player-control-btn[data-action]");
    firstButton?.focus?.();
  },

  focusProgressBar() {
    if (Environment.isBrowser()) {
      this.stickyProgressFocus = false;
      this.controlFocusZone = "";
      this.syncControlFocusDom();
      return;
    }
    if (!this.isSeekBarAvailable()) {
      this.stickyProgressFocus = false;
      this.autoHideControlsAfterSeek = false;
      this.controlFocusZone = "buttons";
      this.syncControlFocusDom();
      return;
    }
    const activeElement = document.activeElement;
    if (
      activeElement &&
      activeElement !== document.body &&
      typeof activeElement.blur === "function"
    ) {
      activeElement.blur();
    }
    this.stickyProgressFocus = true;
    this.controlFocusZone = "progress";
    this.syncControlFocusDom();
    this.uiRefs?.progressShell?.focus?.();
    this.scheduleProgressBarRefocus();
  },

  scheduleProgressBarRefocus() {
    if (!this.controlsVisible || this.controlFocusZone !== "progress") {
      return;
    }
    const run = () => {
      if (!this.controlsVisible || this.controlFocusZone !== "progress") {
        return;
      }
      const buttons = Array.from(
        this.uiRefs?.controlButtons?.querySelectorAll?.(".player-control-btn") || []
      );
      buttons.forEach((button) => {
        button.classList.remove("focused");
        if (typeof button.blur === "function") {
          button.blur();
        }
      });
      this.uiRefs?.progressShell?.classList?.add("focused");
      this.uiRefs?.progressShell?.focus?.();
    };
    run();
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(run);
    }
    setTimeout(run, 0);
  },

  isStartupLoadingVisible() {
    return Boolean(
      this.loadingVisible && !this.hasPresentedPlaybackFrame && !this.playbackTransitionLightweight
    );
  },

  isBufferingSpinnerVisible() {
    if (this.playbackTransitionLightweight && this.loadingVisible)
      return !this.isExternalFrameMode() && !this.isStartupErrorVisible();
    if (this.seekLoading) {
      if (this.isStartupLoadingVisible()) {
        return false;
      }
      return !this.isExternalFrameMode() && !this.isStartupErrorVisible();
    }
    if (
      !this.loadingVisible ||
      !this.hasPresentedPlaybackFrame ||
      this.isExternalFrameMode() ||
      this.isStartupErrorVisible()
    ) {
      return false;
    }
    const currentSeconds = Number(this.getPlaybackCurrentSeconds());
    const baselineSeconds = Number(this.bufferingSpinnerBaselineSeconds);
    if (Number.isFinite(currentSeconds) && Number.isFinite(baselineSeconds)) {
      if (currentSeconds > baselineSeconds + STARTUP_PLAYBACK_ADVANCE_EPSILON_SECONDS) {
        return false;
      }
    }
    const stalledForMs = Date.now() - Number(this.lastPlaybackProgressAt || 0);
    return stalledForMs >= BUFFERING_SPINNER_STALL_MS;
  },

  isSeekBarAvailable() {
    return !this.loadingVisible || this.hasPresentedPlaybackFrame || this.seekLoading;
  },

  isSeekOverlaySuppressingControls() {
    return Date.now() < Number(this.seekOverlaySuppressControlsUntil || 0);
  },

  suppressControlsForHiddenSeek(durationMs = 2500) {
    if (this.controlsVisible) {
      return;
    }
    this.seekOverlaySuppressControlsUntil = Math.max(
      Number(this.seekOverlaySuppressControlsUntil || 0),
      Date.now() + Math.max(0, Number(durationMs || 0))
    );
  },

  clearLoadingCompletionTimer() {
    if (this.loadingCompletionTimer) {
      clearTimeout(this.loadingCompletionTimer);
      this.loadingCompletionTimer = null;
    }
  },

  clearBufferingSpinnerTimer() {
    if (this.bufferingSpinnerTimer) {
      clearTimeout(this.bufferingSpinnerTimer);
      this.bufferingSpinnerTimer = null;
    }
  },

  scheduleBufferingSpinnerRefresh(delayMs = BUFFERING_SPINNER_STALL_MS) {
    this.clearBufferingSpinnerTimer();
    if (
      !this.loadingVisible ||
      !this.hasPresentedPlaybackFrame ||
      this.isExternalFrameMode() ||
      this.isStartupErrorVisible()
    ) {
      return;
    }
    this.bufferingSpinnerTimer = setTimeout(
      () => {
        this.bufferingSpinnerTimer = null;
        if (
          !this.loadingVisible ||
          !this.hasPresentedPlaybackFrame ||
          this.isExternalFrameMode() ||
          this.isStartupErrorVisible()
        ) {
          return;
        }
        this.updateLoadingVisibility();
      },
      Math.max(0, Number(delayMs || 0))
    );
  },

  enableStartupAudioGate({ allowPlayback = false, maxWaitMs = 0 } = {}) {
    this.startupAudioGateActive = true;
    this.startupAudioGateAllowsPlayback = Boolean(allowPlayback);
    const boundedWaitMs = Math.max(0, Number(maxWaitMs || 0));
    this.startupAudioGateDeadline = boundedWaitMs > 0 ? Date.now() + boundedWaitMs : 0;
    PlayerController.setStartupAudioGate?.(true, {
      pausePlayback: !allowPlayback
    });
  },

  releaseStartupAudioGate({ resume = true } = {}) {
    if (!this.startupAudioGateActive) {
      return;
    }
    this.startupAudioGateActive = false;
    this.startupAudioGateAllowsPlayback = false;
    this.startupAudioGateDeadline = 0;
    // Once playback leaves the startup gate, later track-list churn must not
    // reopen automatic language matching during normal playback.
    this.startupAudioFallbackApplied = false;
    this.startupAudioTrackSetSignature = "";
    PlayerController.setStartupAudioGate?.(false, { resume });
  },

  isPlaybackStartupSettled() {
    if (
      !this.hasPresentedPlaybackFrame ||
      this.pendingPlaybackRestore ||
      this.startupAudioGateActive
    ) {
      return false;
    }
    return true;
  },

  hasStartupPlaybackAdvanced(currentSeconds = this.getPlaybackCurrentSeconds()) {
    if (this.startupPlaybackHasAdvanced) {
      return true;
    }
    if (this.pendingPlaybackRestore) {
      this.startupPlaybackBaselineSeconds = null;
      return false;
    }
    const current = Number(currentSeconds);
    if (!Number.isFinite(current) || current < 0) {
      return false;
    }
    const baseline = Number(this.startupPlaybackBaselineSeconds);
    if (!Number.isFinite(baseline)) {
      this.startupPlaybackBaselineSeconds = current;
      return false;
    }
    if (current < baseline - 0.25) {
      this.startupPlaybackBaselineSeconds = current;
      return false;
    }
    if (current - baseline >= STARTUP_PLAYBACK_ADVANCE_EPSILON_SECONDS) {
      this.startupPlaybackHasAdvanced = true;
      return true;
    }
    return false;
  },

  markPlaybackPresentedAfterAdvance(currentSeconds = this.getPlaybackCurrentSeconds()) {
    if (this.hasPresentedPlaybackFrame) {
      return true;
    }
    if (!this.hasStartupPlaybackAdvanced(currentSeconds)) {
      return false;
    }
    this.hasPresentedPlaybackFrame = true;
    this.pendingAutomaticDirectAudio = null;
    this.applyDirectAudioPreferenceAfterStart?.();
    this.rememberSelectedStreamPreference?.(this.getCurrentStreamCandidate?.());
    if (!this.startupTrackPreferenceReady) {
      // Tracks may arrive before the first real frame is presented. Re-run the
      // startup track pass once playback is actually live.
      this.startupTrackPreferenceReady = true;
      this.refreshTrackDialogs();
    }
    this.setLoadingLogoFillTarget(1, { immediate: true });
    if (this.isStartupGateReleaseReady()) {
      this.releaseStartupAudioGate();
    }
    this.clearPlaybackStallGuard();
    return true;
  },

  isStartupLogoDismissReady() {
    return Boolean(
      this.hasPresentedPlaybackFrame &&
      this.startupPlaybackHasAdvanced &&
      !this.pendingPlaybackRestore &&
      !this.startupAudioGateActive
    );
  },

  presentStartedPlayback() {
    this.playbackTransitionLightweight = false;
    PlayerController.setStartupPresentationAudioMuted?.(false);
    StartupLoadingOverlay.finish();
    this.startupLoadingStage = "loading";
    const overlay = this.uiRefs?.loadingOverlay;
    overlay?.classList.add("playback-ready");
    this.loadingVisible = false;
    this.updateLoadingVisibility();
    PlayerController.setStartupPresentationAudioMuted?.(false);
    setTimeout(() => overlay?.classList.remove("playback-ready"), 250);
    this.updateUiTick();
    setTimeout(() => this.maybeShowParentalGuideOverlay(), 80);
  },

  isStartupGateReleaseReady() {
    if (!this.startupAudioGateActive) {
      return false;
    }
    const readyState =
      typeof PlayerController.getPlaybackReadyState === "function"
        ? Number(PlayerController.getPlaybackReadyState() || 0)
        : Number(PlayerController.video?.readyState || 0);
    const gateDeadlineExpired =
      Number(this.startupAudioGateDeadline || 0) > 0 &&
      Date.now() >= Number(this.startupAudioGateDeadline || 0);
    if (
      canReleasePlayingStartupAudioGate({
        allowPlayback: this.startupAudioGateAllowsPlayback,
        hasPresentedPlaybackFrame: this.hasPresentedPlaybackFrame,
        pendingAudioSelection: false,
        readyState
      })
    ) {
      if (!this.startupAudioPreferenceApplied) {
        this.applyStartupAudioFallback();
      }
      return Boolean(this.startupAudioPreferenceApplied);
    }
    if (gateDeadlineExpired) {
      if (!this.startupAudioPreferenceApplied) {
        this.applyStartupAudioFallback();
      }
      return (
        Boolean(this.startupAudioPreferenceApplied) &&
        Number.isFinite(readyState) &&
        readyState >= 2
      );
    }
    if (this.pendingPlaybackRestore) {
      return false;
    }
    const audioPreferenceSettled =
      Boolean(this.startupAudioPreferenceApplied) ||
      (!this.startupAudioPreferenceApplying && !this.hasAudioTracksAvailable());
    return audioPreferenceSettled && Number.isFinite(readyState) && readyState >= 3;
  },

  scheduleLoadingCompletionCheck(delayMs = 250, { force = false } = {}) {
    this.clearLoadingCompletionTimer();
    if (!this.loadingVisible || this.isExternalFrameMode()) {
      return;
    }
    this.loadingCompletionTimer = setTimeout(
      () => {
        this.loadingCompletionTimer = null;
        if (!this.loadingVisible || this.isExternalFrameMode()) {
          return;
        }
        if (this.isStartupGateReleaseReady()) {
          this.releaseStartupAudioGate();
          this.scheduleLoadingCompletionCheck(120, { force: true });
          return;
        }
        const fillProgress = Number(this.loadingLogoFillProgress || 0);
        if (fillProgress >= 1 && !this.isPlaybackStartupSettled()) {
          this.markPlaybackPresentedAfterAdvance();
          if (this.isStartupLogoDismissReady()) {
            this.presentStartedPlayback();
            return;
          }
          this.updateUiTick();
          this.scheduleLoadingCompletionCheck(180, { force: true });
          return;
        }
        if (!force && !this.isPlaybackStartupSettled()) {
          this.scheduleLoadingCompletionCheck(250);
          return;
        }
        if (this.loadingProgress != null && fillProgress < 1) {
          this.loadingProgress = 1;
          this.setLoadingLogoFillTarget(1);
          this.scheduleLoadingCompletionCheck(180, { force: true });
          return;
        }
        if (!this.markPlaybackPresentedAfterAdvance()) {
          this.scheduleLoadingCompletionCheck(120, { force: true });
          return;
        }
        const currentFillProgress = Number(this.loadingLogoFillProgress || 0);
        const currentFillTarget = Number(this.loadingLogoFillTarget || 0);
        if (currentFillTarget >= 1 && currentFillProgress < 0.995) {
          this.scheduleLoadingCompletionCheck(120, { force: true });
          return;
        }
        this.presentStartedPlayback();
      },
      Math.max(0, Number(delayMs || 0))
    );
  },

  clearControlsAutoHide() {
    if (this.controlsHideTimer) {
      clearTimeout(this.controlsHideTimer);
      this.controlsHideTimer = null;
    }
  },

  resetControlsAutoHide() {
    this.clearControlsAutoHide();
    if (!this.controlsVisible || this.paused || this.isDialogOpen() || this.seekOverlayVisible) {
      return;
    }
    this.controlsHideTimer = setTimeout(() => {
      this.setControlsVisible(false);
    }, 4200);
  },

  getDisplayedPlaybackSeconds(current = this.getPlaybackCurrentSeconds()) {
    if (
      this.controlsVisible &&
      this.controlFocusZone === "progress" &&
      this.seekPreviewSeconds != null
    )
      return Number(this.seekPreviewSeconds);
    return this.seekLoading && Number.isFinite(this.seekLoadingTargetSeconds)
      ? this.seekLoadingTargetSeconds
      : current;
  },

  getPlaybackCurrentSeconds() {
    if (typeof PlayerController.getCurrentTimeSeconds === "function") {
      return Number(PlayerController.getCurrentTimeSeconds() || 0);
    }
    return Number(PlayerController.video?.currentTime || 0);
  },

  getPlaybackDurationSeconds() {
    if (typeof PlayerController.getDurationSeconds === "function") {
      return Number(PlayerController.getDurationSeconds() || 0);
    }
    return Number(PlayerController.video?.duration || 0);
  },

  getPlaybackBufferedSeconds() {
    if (typeof PlayerController.getBufferedTimeSeconds !== "function") {
      return null;
    }
    const bufferedSeconds = PlayerController.getBufferedTimeSeconds();
    return bufferedSeconds == null ? null : Number(bufferedSeconds);
  },

  getPlaybackSpeed() {
    if (typeof PlayerController.getPlaybackRate === "function") {
      return Number(PlayerController.getPlaybackRate() || 1);
    }
    return Number(PlayerController.video?.playbackRate || 1);
  },

  getPlaybackSpeedOptions() {
    if (typeof PlayerController.getSupportedPlaybackRates === "function") {
      const speeds = PlayerController.getSupportedPlaybackRates();
      if (Array.isArray(speeds) && speeds.length) {
        return speeds;
      }
    }
    return PLAYER_SPEEDS;
  },

  hasKnownPlaybackDuration() {
    const durationSeconds = Number(this.getPlaybackDurationSeconds() || 0);
    return Number.isFinite(durationSeconds) && durationSeconds > 0;
  },

  isPlaybackFrameReady() {
    const readyState =
      typeof PlayerController.getPlaybackReadyState === "function"
        ? Number(PlayerController.getPlaybackReadyState() || 0)
        : Number(PlayerController.video?.readyState || 0);
    return Number.isFinite(readyState) && readyState >= 2;
  },

  clearSeekLoading({ hideBuffering = false } = {}) {
    if (
      !this.seekLoading &&
      this.seekLoadingBaselineSeconds == null &&
      this.seekLoadingTargetSeconds == null
    ) {
      return false;
    }
    this.seekLoading = false;
    this.seekLoadingBaselineSeconds = null;
    this.seekLoadingTargetSeconds = null;
    if (hideBuffering && this.hasPresentedPlaybackFrame) {
      this.loadingVisible = false;
    }
    this.clearBufferingSpinnerTimer();
    this.updateLoadingVisibility();
    return true;
  },

  completeSeekLoadingIfReady() {
    if (!this.seekLoading || this.pendingPlaybackRestore || this.isStartupLoadingVisible()) {
      return false;
    }
    if (!this.isPlaybackFrameReady() || PlayerController.isClientRemuxRestoring?.()) return false;
    const target = this.seekLoadingTargetSeconds;
    if (Number.isFinite(target) && Math.abs(this.getPlaybackCurrentSeconds() - target) > 0.75)
      return false;
    return this.clearSeekLoading({ hideBuffering: true });
  },

  clearSkipIntroSeekSuppression() {
    this.skipIntroSuppressedKey = "";
    this.skipIntroSuppressedUntil = 0;
  },

  seekPlaybackSeconds(seconds, { preserveSkipIntroSuppression = false } = {}) {
    if (!preserveSkipIntroSuppression) {
      this.clearSkipIntroSeekSuppression();
    }
    // Mark user-initiated seeks so the player can stay responsive while it settles.
    this.seekLoadingBaselineSeconds = this.getPlaybackCurrentSeconds();
    this.seekLoadingTargetSeconds = Number(seconds || 0);
    this.seekLoading = true;
    this.updateLoadingVisibility();
    if (typeof PlayerController.seekToSeconds === "function") {
      const didSeek = Boolean(PlayerController.seekToSeconds(seconds));
      if (!didSeek) {
        this.clearSeekLoading();
      }
      return didSeek;
    }
    const video = PlayerController.video;
    if (!video) {
      this.clearSeekLoading();
      return false;
    }
    video.currentTime = Number(seconds || 0);
    return true;
  },

  finalizePendingPlaybackRestore(restore = this.pendingPlaybackRestore) {
    if (!restore || this.pendingPlaybackRestore !== restore) {
      return;
    }
    this.pendingPlaybackRestore = null;
    const currentSeconds = this.getPlaybackCurrentSeconds();
    this.startupPlaybackBaselineSeconds = Number.isFinite(currentSeconds) ? currentSeconds : null;
    this.startupPlaybackHasAdvanced = false;
    if (restore.paused) {
      PlayerController.pause();
      this.paused = true;
      return;
    }
    this.paused = Boolean(this.startupReadiness?.autoplayBlocked);
    if (!this.paused && !this.startupAudioGateActive && PlayerController.video?.paused) {
      PlayerController.resume();
    }
  },

  attemptPendingPlaybackRestore({ force = false } = {}) {
    const restore = this.pendingPlaybackRestore;
    if (PlayerController.isClientRemuxRestoring()) return;
    if (!restore) {
      return;
    }

    const durationSeconds = this.getPlaybackDurationSeconds();
    let requestedSeconds = Number(restore.timeSeconds || 0);
    if (
      (!Number.isFinite(requestedSeconds) || requestedSeconds <= 0) &&
      Number(restore.progressPercent || 0) > 0
    ) {
      const seededDuration = Number(restore.durationSeconds || 0);
      const effectiveDuration =
        Number.isFinite(durationSeconds) && durationSeconds > 0
          ? durationSeconds
          : Number.isFinite(seededDuration) && seededDuration > 0
            ? seededDuration
            : 0;
      if (effectiveDuration > 0) {
        requestedSeconds =
          (effectiveDuration * Math.max(0, Math.min(100, Number(restore.progressPercent || 0)))) /
          100;
        restore.timeSeconds = requestedSeconds;
      }
    }
    if (!Number.isFinite(requestedSeconds) || requestedSeconds <= 0) {
      restore.attempts = Number(restore.attempts || 0) + 1;
      if (restore.attempts >= 8) {
        this.finalizePendingPlaybackRestore(restore);
      }
      return;
    }

    const targetSeconds =
      Number.isFinite(durationSeconds) && durationSeconds > 0
        ? Math.max(0, Math.min(requestedSeconds, Math.max(0, durationSeconds - 3)))
        : requestedSeconds;
    const currentSeconds = this.getPlaybackCurrentSeconds();
    const toleranceSeconds = Math.max(1.5, Math.min(8, targetSeconds * 0.03));

    if (
      Number.isFinite(currentSeconds) &&
      currentSeconds >= Math.max(0, targetSeconds - toleranceSeconds)
    ) {
      this.finalizePendingPlaybackRestore(restore);
      return;
    }

    const now = Date.now();
    if (!force && now - Number(restore.lastAttemptAt || 0) < 700) {
      return;
    }

    restore.timeSeconds = targetSeconds;
    restore.lastAttemptAt = now;
    restore.attempts = Number(restore.attempts || 0) + 1;

    const didSeek = this.seekPlaybackSeconds(targetSeconds);
    if (!didSeek && restore.attempts >= 8) {
      this.finalizePendingPlaybackRestore(restore);
    }
  },

  updateLoadingVisibility() {
    const unified =
      Environment.isBrowser() &&
      usesUnifiedStartup(undefined, { internalPlayer: true }) &&
      !this.isExternalFrameMode();
    const nextEpisodeLoading = Boolean(
      this.nextEpisodeLaunching && (this.nextEpisodeCardSearching || this.loadingVisible)
    );
    if (
      unified &&
      (StartupLoadingOverlay.probing || this.isStartupLoadingVisible() || nextEpisodeLoading) &&
      !this.isStartupErrorVisible()
    ) {
      StartupLoadingOverlay.begin(
        { ...this.getLoadingOverlayMeta(), itemKey: String(this.params?.itemId || "") },
        this.nextEpisodeCardSearching
          ? "finding"
          : nextEpisodeLoading
            ? "opening"
            : this.startupLoadingStage || "loading"
      );
      StartupLoadingOverlay.setBackHandler(() => this.navigateBackToStreamScreen());
    } else if (unified) {
      StartupLoadingOverlay.finish(this.loadingVisible ? "presenting" : "finished");
    }
    const overlay = this.uiRefs?.loadingOverlay;
    const bufferingSpinner = this.uiRefs?.bufferingSpinner;
    if (!overlay) {
      if (!this.loadingVisible) {
        if (this.isStartupGateReleaseReady()) {
          this.releaseStartupAudioGate();
        }
        this.clearBufferingSpinnerTimer();
      }
      return;
    }
    if (this.isStartupErrorVisible()) {
      overlay.classList.add("hidden");
      bufferingSpinner?.classList.add("hidden");
      this.clearBufferingSpinnerTimer();
      return;
    }
    const showStartupOverlay =
      this.isStartupLoadingVisible() &&
      PlayerSettingsStore.get().loadingOverlayEnabled !== false &&
      !StartupLoadingOverlay.active;
    // Re-applied here because the overlay is re-shown after error and resume paths, and
    // the status text has to survive those.
    if (this.relayStatusText) this.setRelayStatusText(this.relayStatusText);
    const showBufferingSpinner = this.isBufferingSpinnerVisible();
    const preserveProgressFocus = Boolean(
      showStartupOverlay &&
      this.controlsVisible &&
      this.stickyProgressFocus &&
      this.controlFocusZone === "progress" &&
      this.hasPresentedPlaybackFrame
    );
    const preserveHiddenSeekOverlay = Boolean(
      showStartupOverlay && !this.controlsVisible && this.isSeekOverlaySuppressingControls()
    );
    overlay.classList.toggle("hidden", !showStartupOverlay);
    overlay.classList.remove("seek-only", "logo-only");
    bufferingSpinner?.classList.toggle("hidden", !showBufferingSpinner);
    if (!showStartupOverlay && this.loadingProgress != null) {
      this.loadingProgress = 1;
      this.setLoadingLogoFillTarget(1);
    }
    if (!this.loadingVisible && !this.seekLoading) {
      this.clearBufferingSpinnerTimer();
    }
    if (showStartupOverlay) {
      this.dismissPauseOverlay();
      if (
        !preserveProgressFocus &&
        !preserveHiddenSeekOverlay &&
        (this.seekOverlayVisible || this.seekPreviewSeconds != null)
      ) {
        this.cancelSeekPreview({ commit: false });
      }
      if (!preserveProgressFocus && this.controlFocusZone === "progress") {
        this.stickyProgressFocus = false;
        this.autoHideControlsAfterSeek = false;
        this.controlFocusZone = "buttons";
      }
      this.renderControlButtons();
      if (preserveProgressFocus) {
        this.scheduleProgressBarRefocus();
      }
      if (preserveHiddenSeekOverlay) {
        this.renderSeekOverlay();
      }
    } else if (!showBufferingSpinner) {
      if (!this.loadingVisible) {
        this.clearBufferingSpinnerTimer();
      }
      if (this.isStartupGateReleaseReady()) {
        this.releaseStartupAudioGate();
      }
      if (this.paused) {
        this.schedulePauseOverlay();
      }
    }
    this.renderNextEpisodeCard();
  },

  renderNextEpisodeCard() {
    const card = this.uiRefs?.nextEpisodeCard;
    if (!card) {
      return;
    }

    this.ensureNextEpisodeStreamsPrefetch();
    const nextEpisode = this.resolveNextEpisodeInfo();
    const hidden = !this.isNextEpisodeCardVisible();

    card.classList.toggle("hidden", hidden);
    if (hidden) {
      card.innerHTML = "";
      return;
    }

    // The episode number belongs in the kicker beside "Up next", which leaves
    // the title its own two lines instead of being squeezed onto one with a
    // bullet. On a phone that one line was the whole problem.
    const kickerText = [t("next_episode_up_next", {}, "Up next"), nextEpisode.episodeLabel]
      .filter(Boolean)
      .join(" · ");
    const titleLine = nextEpisode.episodeTitle || nextEpisode.episodeLabel || "";
    const statusText = nextEpisode.hasAired
      ? t("next_episode_play_next", {}, "Play next")
      : t("next_episode_unaired", {}, "Unaired");
    const airDateText = nextEpisode.hasAired ? "" : formatNextEpisodeAirDate(nextEpisode.released);
    const progressText = this.nextEpisodeCardSearching
      ? t("next_episode_finding_source", {}, "Finding source…")
      : this.nextEpisodeCardSourceName && this.nextEpisodeCardCountdownSec != null
        ? t(
            "next_episode_playing_via",
            [this.nextEpisodeCardSourceName, this.nextEpisodeCardCountdownSec],
            `Playing via ${this.nextEpisodeCardSourceName} in ${this.nextEpisodeCardCountdownSec}s`
          )
        : airDateText;
    const thumb =
      this.episodes.find((entry) => String(entry?.id || "") === String(nextEpisode.videoId || ""))
        ?.thumbnail || "";

    // The dismiss control is for pointers only. A remote already closes the
    // card with Back, and a second focus stop inside it would sit in the way of
    // the one thing the card is for.
    const dismissMarkup = Environment.isBrowser()
      ? `<button class="player-next-episode-dismiss" type="button" tabindex="-1" data-player-pointer-action="dismissNextEpisode" title="${escapeHtml(t("next_episode_dismiss", {}, "Dismiss"))}" aria-label="${escapeHtml(t("next_episode_dismiss", {}, "Dismiss"))}">&#10005;</button>`
      : "";

    card.innerHTML = `
      <div class="player-next-episode-card-inner${nextEpisode.hasAired ? " focusable is-playable" : ""}${!this.controlsVisible ? " is-selected" : ""}"${nextEpisode.hasAired ? ' data-player-pointer-action="nextEpisode"' : ""}>
        <div class="player-next-episode-head">
          <div class="player-next-episode-thumb-wrap">
            ${thumb ? `<img class="player-next-episode-thumb" src="${escapeHtml(thumb)}" alt="" aria-hidden="true" />` : `<div class="player-next-episode-thumb player-next-episode-thumb-fallback"></div>`}
            <div class="player-next-episode-thumb-shade"></div>
          </div>
          <div class="player-next-episode-copy">
            <div class="player-next-episode-kicker">${escapeHtml(kickerText)}</div>
            <div class="player-next-episode-title">${escapeHtml(titleLine || t("next_episode_up_next", {}, "Up next"))}</div>
            ${progressText ? `<div class="player-next-episode-status">${escapeHtml(progressText)}</div>` : ""}
          </div>
          ${dismissMarkup}
        </div>
        <div class="player-next-episode-pill${nextEpisode.hasAired ? " is-playable" : ""}">
          <span class="player-next-episode-pill-icon">&#9654;</span>
          <span class="player-next-episode-pill-text">${escapeHtml(statusText)}</span>
        </div>
      </div>
    `;
  },

  updateUiTick() {
    if (this.isExternalFrameMode()) {
      return;
    }
    this.ensureNextEpisodeStreamsPrefetch();
    this.shouldShowNextEpisodeCard();
    void this.refreshLoadingOverlayProgress();
    const current = this.getPlaybackCurrentSeconds();
    if (
      this.hasPresentedPlaybackFrame &&
      !this.loadingVisible &&
      !this.startupAudioGateActive &&
      !this.pendingPlaybackRestore &&
      PlayerController.startupPresentationAudioMuted
    ) {
      PlayerController.setStartupPresentationAudioMuted(false);
    }
    this.updateActiveSkipInterval(current);
    this.updateSkipIntroCountdown(Date.now());
    const duration = this.getPlaybackDurationSeconds();
    const effectiveProgressSeconds = this.getDisplayedPlaybackSeconds(current);
    const progress = duration > 0 ? clamp(effectiveProgressSeconds / duration, 0, 1) : 0;
    const uiRefs = this.uiRefs || {};
    const uiState = this.lastUiTickState || (this.lastUiTickState = {});
    const progressBuffered = uiRefs.progressBuffered;
    if (progressBuffered) {
      const bufferedSeconds = this.getPlaybackBufferedSeconds();
      const bufferedVisible =
        Number.isFinite(bufferedSeconds) && duration > 0 && bufferedSeconds > current + 0.25;
      const bufferedProgress = bufferedVisible ? clamp(bufferedSeconds / duration, 0, 1) : 0;
      const nextBufferedWidth = `${Math.round(bufferedProgress * 10000) / 100}%`;
      if (uiState.bufferedWidth !== nextBufferedWidth) {
        progressBuffered.style.width = nextBufferedWidth;
        uiState.bufferedWidth = nextBufferedWidth;
      }
      if (uiState.bufferedVisible !== bufferedVisible) {
        progressBuffered.classList.toggle("is-visible", bufferedVisible);
        uiState.bufferedVisible = bufferedVisible;
      }
    }
    const progressFill = uiRefs.progressFill;
    if (progressFill) {
      const nextWidth = `${Math.round(progress * 10000) / 100}%`;
      if (uiState.progressWidth !== nextWidth) {
        progressFill.style.width = nextWidth;
        uiState.progressWidth = nextWidth;
      }
    }
    this.syncSkipIntroButtonProgress();
    this.renderSkipIntroButton();
    this.syncPlayerOverlayLayoutState();
    this.maybeAutoplayNextEpisode();

    const clock = uiRefs.clock;
    if (clock) {
      const now = new Date();
      const nextClockMinuteKey = `${now.getHours()}:${now.getMinutes()}`;
      if (uiState.clockMinuteKey !== nextClockMinuteKey) {
        const nextClockText = formatClock(now);
        clock.textContent = nextClockText;
        uiState.clockText = nextClockText;
        uiState.clockMinuteKey = nextClockMinuteKey;
      }
    }

    const endsAt = uiRefs.endsAt;
    if (endsAt) {
      const remainingMs = Math.max(0, (Number(duration || 0) - Number(current || 0)) * 1000);
      const nextEndsAtMinuteBucket =
        duration > 0 ? Math.floor((Date.now() + remainingMs) / 60000) : -1;
      if (uiState.endsAtMinuteBucket !== nextEndsAtMinuteBucket) {
        const nextEndsAtText = t(
          "player_ends_at",
          [formatEndsAt(current, duration)],
          "Ends at %1$s"
        );
        endsAt.textContent = nextEndsAtText;
        uiState.endsAtText = nextEndsAtText;
        uiState.endsAtMinuteBucket = nextEndsAtMinuteBucket;
      }
    }

    if (this.pauseOverlayVisible) {
      const overlayClock = this.uiRefs?.pauseOverlay?.querySelector(".player-pause-overlay-clock");
      if (overlayClock && overlayClock.textContent !== uiState.clockText) {
        overlayClock.textContent = uiState.clockText || "--:--";
      }
      const overlayEndsAt = this.uiRefs?.pauseOverlay?.querySelector(
        ".player-pause-overlay-ends-at"
      );
      if (overlayEndsAt && overlayEndsAt.textContent !== uiState.endsAtText) {
        overlayEndsAt.textContent =
          uiState.endsAtText || t("player_ends_at", ["--:--"], "Ends at %1$s");
      }
    }

    this.syncProposalTime?.(effectiveProgressSeconds, duration);
    const timeLabel = uiRefs.timeLabel;
    if (timeLabel) {
      const nextTimeLabel = `${formatTime(effectiveProgressSeconds)} / ${formatTime(duration)}`;
      if (uiState.timeLabelText !== nextTimeLabel) {
        timeLabel.textContent = nextTimeLabel;
        uiState.timeLabelText = nextTimeLabel;
      }
    }

    this.syncPauseOverlayState();
    this.renderNextEpisodeCard();

    if (this.seekOverlayVisible && this.seekPreviewSeconds == null) {
      this.renderSeekOverlay();
    }
  },
  renderSeekOverlay() {
    const overlay = this.uiRefs?.seekOverlay;
    const directionNode = this.uiRefs?.seekDirection;
    const previewNode = this.uiRefs?.seekPreview;
    const fillNode = this.uiRefs?.seekFill;
    if (!overlay || !directionNode || !previewNode || !fillNode) {
      return;
    }

    const duration = this.getPlaybackDurationSeconds();
    const currentPreview =
      this.seekPreviewSeconds != null
        ? Number(this.seekPreviewSeconds)
        : this.getPlaybackCurrentSeconds();

    const shouldShowOverlay = this.seekOverlayVisible && !this.controlsVisible;
    overlay.classList.toggle("hidden", !shouldShowOverlay);
    const uiState = this.lastUiTickState || (this.lastUiTickState = {});
    const nextPreviewText = `${formatTime(currentPreview)} / ${formatTime(duration)}`;
    const nextDirectionText =
      this.seekPreviewDirection < 0 ? "<<" : this.seekPreviewDirection > 0 ? ">>" : "";
    if (uiState.seekPreviewText !== nextPreviewText) {
      previewNode.textContent = nextPreviewText;
      uiState.seekPreviewText = nextPreviewText;
    }
    if (uiState.seekDirectionText !== nextDirectionText) {
      directionNode.textContent = nextDirectionText;
      uiState.seekDirectionText = nextDirectionText;
    }

    const percent = duration > 0 ? clamp(currentPreview / duration, 0, 1) : 0;
    const nextSeekWidth = `${Math.round(percent * 10000) / 100}%`;
    if (uiState.seekWidth !== nextSeekWidth) {
      fillNode.style.width = nextSeekWidth;
      uiState.seekWidth = nextSeekWidth;
    }
  },

  beginSeekPreview(direction, isRepeat = false) {
    if (!this.isSeekBarAvailable()) {
      return;
    }
    const currentTime = this.getPlaybackCurrentSeconds();
    if (Number.isNaN(currentTime)) {
      return;
    }

    if (direction !== this.seekPreviewDirection || !isRepeat) {
      this.seekRepeatCount = 0;
    }
    this.seekPreviewDirection = direction;
    this.seekRepeatCount += 1;

    const stepSeconds =
      this.seekRepeatCount >= 18
        ? 120
        : this.seekRepeatCount >= 12
          ? 60
          : this.seekRepeatCount >= 7
            ? 30
            : this.seekRepeatCount >= 3
              ? 20
              : 10;
    const duration = this.getPlaybackDurationSeconds();
    const base = this.seekPreviewSeconds == null ? currentTime : Number(this.seekPreviewSeconds);
    let next = base + direction * stepSeconds;
    if (duration > 0) {
      next = clamp(next, 0, duration);
    } else {
      next = Math.max(0, next);
    }

    this.seekPreviewSeconds = next;
    this.seekOverlayVisible = !this.controlsVisible;
    this.renderSeekOverlay();

    if (this.seekOverlayTimer) {
      clearTimeout(this.seekOverlayTimer);
      this.seekOverlayTimer = null;
    }

    this.scheduleSeekPreviewCommit();
  },

  scheduleSeekPreviewCommit() {
    if (this.seekCommitTimer) {
      clearTimeout(this.seekCommitTimer);
    }
    this.seekCommitTimer = setTimeout(() => {
      this.commitSeekPreview();
    }, 1000);
  },

  commitSeekPreview() {
    if (!PlayerController.video) {
      this.cancelSeekPreview({ commit: false });
      return;
    }

    if (this.seekPreviewSeconds != null) {
      this.suppressControlsForHiddenSeek();
      this.seekPlaybackSeconds(Number(this.seekPreviewSeconds));
    }

    if (this.stickyProgressFocus && this.controlsVisible) {
      this.focusProgressBar();
      this.scheduleProgressBarRefocus();
    }

    this.seekPreviewSeconds = null;
    this.seekRepeatCount = 0;
    if (this.seekCommitTimer) {
      clearTimeout(this.seekCommitTimer);
      this.seekCommitTimer = null;
    }

    this.seekOverlayVisible = !this.controlsVisible;
    this.renderSeekOverlay();

    if (this.seekOverlayTimer) {
      clearTimeout(this.seekOverlayTimer);
    }
    this.seekOverlayTimer = setTimeout(() => {
      this.seekOverlayVisible = false;
      this.seekPreviewDirection = 0;
      this.renderSeekOverlay();
      if (this.autoHideControlsAfterSeek && this.controlsVisible) {
        this.autoHideControlsAfterSeek = false;
        this.stickyProgressFocus = false;
        this.setControlsVisible(false);
        return;
      }
      if (this.stickyProgressFocus && this.controlsVisible) {
        this.focusProgressBar();
        this.scheduleProgressBarRefocus();
      }
      this.resetControlsAutoHide();
    }, 700);
  },

  cancelSeekPreview({ commit = false } = {}) {
    if (commit) {
      this.commitSeekPreview();
      return;
    }

    if (this.seekCommitTimer) {
      clearTimeout(this.seekCommitTimer);
      this.seekCommitTimer = null;
    }
    if (this.seekOverlayTimer) {
      clearTimeout(this.seekOverlayTimer);
      this.seekOverlayTimer = null;
    }

    this.seekPreviewSeconds = null;
    this.seekPreviewDirection = 0;
    this.seekRepeatCount = 0;
    this.seekOverlayVisible = false;
    this.autoHideControlsAfterSeek = false;
    this.seekOverlaySuppressControlsUntil = 0;
    this.renderSeekOverlay();
  },

  togglePause({ focusControls = true } = {}) {
    const preserveProgressFocus = this.controlFocusZone === "progress";
    if (this.isExternalFrameMode()) {
      return;
    }
    if (this.startupReadiness?.autoplayBlocked) {
      this.retryClientRemuxFromGesture();
      return;
    }
    if (this.paused) {
      this.dismissPauseOverlay();
      PlayerController.resume();
      this.paused = false;
      this.updateMediaSessionPlaybackState();
      this.setControlsVisible(true, { focus: false });
      if (preserveProgressFocus) {
        this.controlFocusZone = "progress";
      }
      this.renderControlButtons();
      return;
    }

    PlayerController.pause();
    this.paused = true;
    this.updateMediaSessionPlaybackState();
    if (!focusControls && !preserveProgressFocus) {
      this.controlFocusZone = "";
    }
    this.setControlsVisible(true, { focus: focusControls && !preserveProgressFocus });
    if (preserveProgressFocus) {
      this.controlFocusZone = "progress";
    }
    this.renderControlButtons();
    this.schedulePauseOverlay();
  },

  resolveMediaAction(event) {
    const key = String(event?.key || "");
    const keyName = String(event?.keyName || "");
    const code = String(event?.code || "");
    const keyCode = Number(event?.originalKeyCode || event?.keyCode || 0);

    const keyMap = {
      MediaPlayPause: "toggle",
      MediaPlay: "play",
      MediaPause: "pause",
      MediaStop: "stop",
      MediaFastForward: "fastForward",
      MediaRewind: "rewind",
      MediaTrackNext: "next",
      MediaTrackPrevious: "previous",
      Play: "play",
      Pause: "pause"
    };

    if (keyMap[key]) {
      return keyMap[key];
    }
    if (keyMap[keyName]) {
      return keyMap[keyName];
    }
    if (keyMap[code]) {
      return keyMap[code];
    }

    const codeMap = {
      179: "toggle",
      10252: "toggle",
      415: "play",
      19: "pause",
      413: "stop",
      178: "stop",
      417: "fastForward",
      412: "rewind",
      176: "next",
      177: "previous"
    };

    return codeMap[keyCode] || null;
  },

  applyMediaAction(action) {
    if (this.isExternalFrameMode() || !action) {
      return;
    }

    if (action === "play") {
      if (this.paused) {
        this.togglePause();
      }
      return;
    }

    if (action === "pause" || action === "stop") {
      if (!this.paused) {
        this.togglePause();
      }
      return;
    }

    if (action === "toggle") {
      this.togglePause();
      return;
    }

    if (action === "fastForward") {
      this.quickSeekBy(30);
      return;
    }

    if (action === "rewind") {
      this.quickSeekBy(-30);
    }
  },

  quickSeekBy(deltaSeconds) {
    if (!this.isSeekBarAvailable()) {
      return false;
    }
    const currentTime = this.getPlaybackCurrentSeconds();
    if (Number.isNaN(currentTime)) {
      return false;
    }
    const duration = this.getPlaybackDurationSeconds();
    let target = currentTime + Number(deltaSeconds || 0);
    if (duration > 0) {
      target = clamp(target, 0, duration);
    } else {
      target = Math.max(0, target);
    }
    this.seekPreviewSeconds = target;
    this.seekPreviewDirection = deltaSeconds < 0 ? -1 : 1;
    this.seekOverlayVisible = !this.controlsVisible;
    this.renderSeekOverlay();
    this.scheduleSeekPreviewCommit();
    return true;
  },

  bindMediaSessionHandlers() {
    const mediaSession = globalThis.navigator?.mediaSession;
    if (!mediaSession || this.mediaSessionHandlersBound) {
      return;
    }
    this.mediaSessionHandlersBound = true;
    this.mediaSessionActions = [];

    const safeBind = (action, handler) => {
      try {
        mediaSession.setActionHandler(action, handler);
        this.mediaSessionActions.push(action);
      } catch (_) {
        // Ignore unsupported actions.
      }
    };

    safeBind("play", () => this.applyMediaAction("play"));
    safeBind("pause", () => this.applyMediaAction("pause"));
    safeBind("stop", () => this.applyMediaAction("stop"));
    safeBind("seekforward", (details) => {
      const offset = Number(details?.seekOffset || 30);
      this.quickSeekBy(Number.isFinite(offset) ? offset : 30);
    });
    safeBind("seekbackward", (details) => {
      const offset = Number(details?.seekOffset || 30);
      this.quickSeekBy(Number.isFinite(offset) ? -offset : -30);
    });

    this.updateMediaSessionPlaybackState();
  },

  clearMediaSessionHandlers() {
    const mediaSession = globalThis.navigator?.mediaSession;
    if (!mediaSession || !this.mediaSessionHandlersBound) {
      return;
    }
    this.mediaSessionActions.forEach((action) => {
      try {
        mediaSession.setActionHandler(action, null);
      } catch (_) {
        // Ignore unsupported actions.
      }
    });
    this.mediaSessionActions = [];
    this.mediaSessionHandlersBound = false;
    try {
      mediaSession.playbackState = "none";
    } catch (_) {
      // Ignore unsupported playback state.
    }
  },

  updateMediaSessionPlaybackState() {
    const mediaSession = globalThis.navigator?.mediaSession;
    if (!mediaSession) {
      return;
    }
    try {
      mediaSession.playbackState = this.paused ? "paused" : "playing";
    } catch (_) {
      // Ignore unsupported playback state.
    }
  },

  releaseOfflineObjectUrl() {
    for (const url of this.offlinePlayerArtworkUrls || []) globalThis.URL?.revokeObjectURL?.(url);
    this.offlinePlayerArtworkUrls?.clear();
    const objectUrl = String(this.offlineObjectUrl || "");
    this.offlineObjectUrl = "";
    if (
      !objectUrl ||
      !Environment.isBrowser() ||
      typeof globalThis.URL?.revokeObjectURL !== "function"
    ) {
      return;
    }
    try {
      globalThis.URL.revokeObjectURL(objectUrl);
    } catch (_) {
      // Object URL cleanup is best effort and must never interrupt playback teardown.
    }
  },

  async playStreamByUrl(
    streamUrl,
    {
      preservePanel = false,
      resetSilentAudioState = true,
      preservePlaybackState = false,
      preservePendingRestore = false,
      forceEngine = null,
      requestedAudioIndex = null,
      rememberRequestedAudio = true,
      sourceCandidate: explicitSourceCandidate = null,
      mountToken = null
    } = {}
  ) {
    if (!this.isActiveMountToken(mountToken)) {
      return;
    }
    if (this.isExternalFrameMode()) {
      return;
    }
    if (!streamUrl) {
      return;
    }

    const urlGeneration = (this._playbackUrlGeneration = (this._playbackUrlGeneration || 0) + 1);
    // A relayed source has to exist before it can produce a frame. Waiting here keeps
    // the spinner up and the stall guard unarmed: a server copying a film is not a
    // playback error, and eighteen seconds is not long enough to copy one.
    if (!(await this.awaitRelayedSource(streamUrl, mountToken))) {
      return;
    }

    if (urlGeneration !== this._playbackUrlGeneration || this.playerBackNavigationInProgress)
      return;
    if (this.offlineObjectUrl && String(streamUrl) !== this.offlineObjectUrl) {
      this.releaseOfflineObjectUrl();
    }

    const previousPlaybackUrl = String(this.activePlaybackUrl || "").trim();
    const shouldReplaceBrowserMediaSession = Boolean(
      Environment.isBrowser() &&
      preservePlaybackState &&
      previousPlaybackUrl &&
      previousPlaybackUrl !== String(streamUrl).trim()
    );

    const selectedIndex = this.streamCandidates.findIndex((entry) => entry.url === streamUrl);
    if (selectedIndex >= 0) {
      this.currentStreamIndex = selectedIndex;
    }
    const sourceCandidate =
      explicitSourceCandidate ||
      this.getStreamCandidateByUrl(streamUrl) ||
      this.getCurrentStreamCandidate();
    const sourceContext = this.getPlaybackSourceContext(sourceCandidate);
    if (sourceContext) {
      this.activePlaybackSourceContext = sourceContext;
    }
    const allowPlaybackDuringStartupAudioGate = shouldAllowPlaybackDuringStartupAudioGate({
      isHlsPlayback: this.isCurrentSourceLikelyHls(streamUrl, sourceCandidate),
      isClientRemuxPlayback:
        this.params?.playbackPlan?.route === "client" &&
        this.params.playbackPlan.sourceUrl === streamUrl
    });

    this.playbackTransitionLightweight = Boolean(
      preservePlaybackState &&
      (this.hasPresentedPlaybackFrame || this.playbackTransitionLightweight)
    );
    this.hasPresentedPlaybackFrame = false;
    this.startupPlaybackBaselineSeconds = null;
    this.startupPlaybackHasAdvanced = false;
    this.bufferingSpinnerBaselineSeconds = null;
    this.clearStartupError();
    this.loadingVisible = true;
    this.updateLoadingVisibility();
    this.clearBufferingSpinnerTimer();
    this.enableStartupAudioGate({
      allowPlayback: allowPlaybackDuringStartupAudioGate
    });
    this.cancelSeekPreview({ commit: false });
    if (preservePlaybackState) {
      const restoreTimeSeconds = this.getPlaybackCurrentSeconds();
      const video = PlayerController.video;
      const hasExistingResumeRestore = Boolean(
        this.pendingPlaybackRestore &&
        (Number(this.pendingPlaybackRestore.timeSeconds || 0) > 1 ||
          Number(this.pendingPlaybackRestore.progressPercent || 0) > 0)
      );
      const hasUsefulCurrentPosition =
        Number.isFinite(restoreTimeSeconds) && restoreTimeSeconds > 1;
      if (!(hasExistingResumeRestore && !hasUsefulCurrentPosition)) {
        this.pendingPlaybackRestore = {
          timeSeconds: Number.isFinite(restoreTimeSeconds) ? restoreTimeSeconds : 0,
          paused: Boolean(this.paused || video?.paused),
          attempts: 0,
          lastAttemptAt: 0
        };
      }
    } else if (!(preservePendingRestore && this.pendingPlaybackRestore)) {
      this.pendingPlaybackRestore = null;
    }
    this.markPlaybackProgress();
    this.clearPlaybackStallGuard();
    this.clearRelayTrackData();
    this.clearSubtitleCueStyleBindings();
    if (resetSilentAudioState) {
      this.silentAudioFallbackAttempts.clear();
      this.silentAudioFallbackCount = 0;
    }

    if (!preservePanel) {
      this.closeSourcesPanel();
    }

    this.subtitleDialogVisible = false;
    this.audioDialogVisible = false;
    this.speedDialogVisible = false;
    this.selectedAddonSubtitleId = null;
    this.selectedSubtitleTrackIndex = -1;
    this.selectedManifestSubtitleTrackId = null;
    this.startupSubtitlePreferenceApplied = false;
    this.startupSubtitlePreferenceApplying = false;
    this.pendingDirectAudioSelection = Number.isInteger(requestedAudioIndex)
      ? { url: streamUrl, index: requestedAudioIndex, remember: rememberRequestedAudio }
      : null;
    this.startupAudioPreferenceApplied = Boolean(this.pendingDirectAudioSelection);
    this.startupAudioPreferenceApplying = false;
    this.startupAudioFallbackApplied = Boolean(this.pendingDirectAudioSelection);
    this.startupAudioTrackSetSignature = "";
    this.clearStartupAudioPreferenceRetry();
    this.failedAutomaticAudioFallbackEntryId = "";
    this.startupTrackPreferenceReady = false;
    this.builtInSubtitleCount = 0;
    this.clearSubtitleCueStyleBindings();
    this.releaseOfflineSubtitleObjectUrls();
    this.clearMountedExternalSubtitleTracks();
    const didReplaceBrowserMediaSession =
      shouldReplaceBrowserMediaSession && this.replaceBrowserMediaSession();
    this.trackDiscoveryInProgress = true;
    this.clearTrackDiscoveryTimer();
    this.trackDiscoveryStartedAt = 0;
    this.trackDiscoveryDeadline = 0;
    this.activePlaybackUrl = streamUrl;
    this.resetPictureInPictureAvailability();
    this.lastTrackWarmupAt = Date.now();
    const playbackContext = {
      ...this.buildPlaybackContext(sourceCandidate),
      forceEngine
    };
    const startPlaybackBeforeAncillaryProbes = Boolean(didReplaceBrowserMediaSession);
    if (startPlaybackBeforeAncillaryProbes) {
      this.startPlayerControllerPlayback(this.activePlaybackUrl, playbackContext, {
        mountToken,
        sourceCandidate
      });
    }
    this.loadSubtitles();
    this.loadManifestTrackDataForCurrentStream(this.activePlaybackUrl);
    this.startTrackDiscoveryWindow({
      durationMs: 7000
    });
    this.updateModalBackdrop();
    this.renderSubtitleDialog();
    this.renderAudioDialog();
    this.renderSpeedDialog();
    if (!startPlaybackBeforeAncillaryProbes) {
      this.startPlayerControllerPlayback(this.activePlaybackUrl, playbackContext, {
        mountToken,
        sourceCandidate
      });
    }
    this.paused = false;
    this.refreshTrackDialogs();
    this.updateUiTick();
    this.setControlsVisible(true, { focus: false });
    this.schedulePlaybackStallGuard();
  },

  async prepareServerVideoPlaylist(url, signal) {
    const delivery = { ...SelectedStreamDelivery, signal };
    if (!url || !(await delivery.isPlayableHlsPlaylist(url))) {
      throw new Error(
        "Server video conversion could not start. Check access or choose another stream."
      );
    }
    return { url, plan: null };
  },

  async readSelectedPlaybackProbe(candidate, onFailure) {
    const cached = this.getPlayerStreamProbe(candidate);
    if (cached) return cached;
    if (PROBE_MODE === "off" || !/^https?:\/\//i.test(candidate.url || "")) {
      onFailure?.(PROBE_MODE === "off" ? "probe-disabled" : "unsupported-url");
      return null;
    }
    const selectionSignal = this._selectedSourceAbort?.signal;
    if (selectionSignal?.aborted) return null;
    const controller = new AbortController();
    const prober = (this._selectedSourceProber ||= createStreamProber({
      endpoint: PROBE_ENDPOINT,
      mode: PROBE_MODE,
      clientConcurrency: PROBE_CLIENT_CONCURRENCY,
      timeoutMs: Infinity,
      assess: (facts) => assessPlaybackCapabilities(facts)
    }));
    const cancel = () => {
      if (controller.signal.aborted) return;
      controller.abort();
      prober.cancelAll();
    };
    selectionSignal?.addEventListener("abort", cancel, { once: true });
    const releaseActions = StartupLoadingOverlay.setProbeActions(
      {
        onSkip: () => {
          if (controller.signal.aborted) return;
          onFailure?.("skipped");
          cancel();
        },
        onChooseStream: () => this.navigateBackToStreamScreen({ chooseStream: true })
      },
      { ...this.getLoadingOverlayMeta(), itemKey: String(this.params?.itemId || "") }
    );
    StartupLoadingOverlay.setBackHandler(() => this.navigateBackToStreamScreen());
    try {
      const probe = await selectedPlaybackTask(
        () =>
          prober.probe(candidate.url, {
            reason: "selected-playback",
            identity: streamProbeIdentity(candidate),
            timeoutMs: Infinity
          }),
        { signal: controller.signal, timeoutMs: Infinity }
      );
      if (controller.signal.aborted) return null;
      if (probe)
        (this._playerListProbeResults ||= new Map()).set(playerStreamProbeKey(candidate), probe);
      else onFailure?.(prober.failureReason(candidate.url));
      return probe;
    } catch (error) {
      if (controller.signal.aborted) return null;
      throw error;
    } finally {
      selectionSignal?.removeEventListener("abort", cancel);
      releaseActions();
    }
  },

  async prepareProbedPlaybackTranscode(sourceUrl, probe, signal, afterPlaybackFailure = false) {
    if (!probe || this._processingUnavailable) return null;
    const delivery = await prepareMeasuredTranscode({ sourceUrl, probe, afterPlaybackFailure });
    if (!delivery || signal?.aborted) return null;
    StartupLoadingOverlay.setPlaybackAttempt?.({ route: delivery.route });
    if (delivery.waitForPlaylist)
      await selectedPlaybackTask(() => this.prepareServerVideoPlaylist(delivery.url, signal), {
        signal,
        timeoutMs: 60000
      });
    return delivery;
  },

  async prepareResolvedCandidatePlayback(
    streamCandidate,
    sourceUrl,
    isCurrent,
    filenameWasUnknown
  ) {
    const candidate = { ...streamCandidate, url: sourceUrl, externalUrl: null };
    const signal = this._selectedSourceAbort?.signal;
    const active = () => isCurrent() && !signal?.aborted && !this.playerBackNavigationInProgress;
    const path = (() => {
      try {
        return new URL(sourceUrl, globalThis.location?.href || "http://localhost/").pathname;
      } catch {
        return "";
      }
    })();
    const readyDelivery =
      /\.(?:m3u8|mpd)$/i.test(path) || /\/api\/(?:remux|transcode)(?:\/|$)/.test(path);
    if (readyDelivery) {
      this.params.playbackPlan = null;
      this.params.unverifiedPlayback = null;
      return { url: sourceUrl, plan: null };
    }
    const settings = PlayerSettingsStore.get();
    const capabilities = getDeviceCapabilities();
    const choose = (probe = null) =>
      selectFilenamePlaybackAttempt({
        stream: candidate,
        probe,
        capabilities,
        enabled: Boolean(probe) || settings.filenamePlaybackRoutingEnabled !== false,
        audioEndpoint: ""
      });
    let attempt = choose();
    const transcodeHint = ["audio-transcode", "transcode"].includes(
      attempt?.filenameVerdict?.method
    );
    let probe = null;
    const filenameUnknown =
      filenameWasUnknown === true ||
      classifyStreamFilename(streamCandidate, capabilities).method === "unknown";
    const shouldProbe = settings.probeStream === "always" || filenameUnknown || transcodeHint;
    let measuredVerdict = null;
    let probeFailure = "";
    const probeStartedAt = Date.now();
    let probeElapsedMs = 0;
    const reportProbeDecision = (route) => {
      if (!shouldProbe || globalThis.__NUVIO_PLAYBACK_STARTUP_DEBUG__ !== true) return;
      const reason = measuredVerdict?.reason || probeFailure;
      const detail = JSON.stringify({
        result: probe ? "metadata" : "unavailable",
        method: measuredVerdict?.method || "unknown",
        route,
        reason:
          /^[a-z0-9-]{1,80}$/i.test(reason) || /^HTTP [45][0-9]{2}$/.test(reason)
            ? reason
            : "metadata-unavailable",
        elapsedMs: probeElapsedMs
      });
      console.warn("[SelectedProbe] " + detail);
      void fetch("/api/debug/log", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "selected-probe",
          message: "Selected stream probe",
          stack: detail
        })
      }).catch(() => {});
    };
    if (shouldProbe) {
      if (!active()) return null;
      probe = this.getPlayerStreamProbe(streamCandidate);
      if (!probe) {
        probe = await this.readSelectedPlaybackProbe(candidate, (reason) => {
          probeFailure = reason;
        });
      }
      if (!active()) return null;
      probeElapsedMs = Date.now() - probeStartedAt;
      StartupLoadingOverlay.setStage("opening");
      measuredVerdict = probe ? classifyPlayback({ url: sourceUrl, probe, capabilities }) : null;
      const measuredMethod = measuredVerdict?.method;
      const delivery = ["audio-transcode", "transcode"].includes(measuredMethod)
        ? await this.prepareProbedPlaybackTranscode(sourceUrl, probe, signal)
        : null;
      if (!active()) return null;
      if (delivery) {
        this.params.playbackPlan = delivery.plan;
        this.params.unverifiedPlayback = {
          ...attempt,
          sourceUrl,
          route: delivery.route,
          mediaUrl: delivery.url,
          rawTried: false,
          remuxTried: false,
          audioTranscodeTried: true,
          measuredTranscode: true,
          output: delivery.output
        };
        reportProbeDecision(delivery.route);
        return delivery;
      }
      if (measuredMethod && measuredMethod !== "unknown") {
        attempt = choose(probe);
        if (attempt) attempt.audioTranscodeTried = true;
      }
    }
    if (!attempt) return { url: sourceUrl, plan: null };
    this.params.unverifiedPlayback = attempt;
    reportProbeDecision(attempt.route);
    StartupLoadingOverlay.setPlaybackAttempt?.({
      route: attempt.route,
      failedRoute: /(?:^|-)timeout$/.test(probeFailure) ? "probe" : undefined
    });
    attempt.routeStartedAt = Date.now();
    this.activePlaybackUrl = sourceUrl;
    attempt.busy = true;
    let delivery = { url: sourceUrl, plan: null };
    try {
      if (this._processingUnavailable && attempt.route !== "direct")
        throw new Error("The processing service is unavailable.");
      if (attempt.route === "remux") {
        if (measuredVerdict?.method === "remux") {
          const owner = { ...SelectedStreamDelivery, signal, getStreamProbe: () => probe };
          delivery = {
            url: await selectedPlaybackTask(() => owner.resolvePlayerSource(candidate), {
              signal,
              timeoutMs: 17000
            }),
            plan: clientRemuxPlan(candidate, probe)
          };
          if (!delivery.plan && (!delivery.url || delivery.url === sourceUrl))
            throw new Error("Verified Remux is unavailable for this stream.");
        } else
          delivery = await selectedPlaybackTask(() => prepareUnverifiedRemux(sourceUrl), {
            signal,
            timeoutMs: 17000
          });
      }
    } catch (error) {
      if (!active()) return null;
      attempt.busy = false;
      if (
        await this.tryUnverifiedRemuxAfterFailure({
          detail: error?.message || "",
          httpStatus: extractPlaybackHttpStatus(error?.message || ""),
          preparationFailed: true
        })
      )
        return null;
      throw error;
    }
    if (!active()) return null;
    attempt.busy = false;
    attempt.mediaUrl = delivery.url;
    this.params.playbackPlan = delivery.plan;
    StartupLoadingOverlay.setStage("loading");
    console.warn(
      `[Playback] resolved route=${attempt.route === "remux" ? REMUX_POLICY.mode + "-remux" : attempt.route} basis=${measuredVerdict?.method === attempt.route ? "probe" : attempt.filenameRouting ? "filename" : "off"} host=${traceHost(sourceUrl)}`
    );
    return delivery;
  },

  async advanceAfterSelectedSourceFailure(message, failure = {}) {
    if (this._startupSourceAdvancing || this.playerBackNavigationInProgress) return;
    this._startupSourceAdvancing = true;
    console.warn(
      "[AutoPlay] " +
        JSON.stringify({
          event: "source-startup-failed",
          automatic: Boolean(this.params.automaticSourceSelection),
          reason: /^[a-z0-9-]{1,40}$/.test(failure.reason || "")
            ? failure.reason
            : "startup-failure",
          mediaErrorCode: Number(failure.mediaErrorCode) || 0,
          httpStatus:
            extractPlaybackHttpStatus(failure.detail || failure.error?.message || "") || 0,
          received: this.streamCandidates.length,
          complete: this.params.streamCandidatesComplete !== false
        })
    );
    const token = this.playerMountToken;
    // Resolution can fail before a candidate has a playable URL. The media
    // accessor may still point at another source, so retain the failed attempt.
    const current = failure.streamCandidate || this.getCurrentStreamCandidate();
    (this._startupSourceFailures ||= new Set()).add(playerStreamProbeKey(current || {}));
    const detail = String(failure.detail || failure.error?.message || "");
    const processingUrl = /\/api\/(?:remux|transcode)/.test(
      failure.playbackUrl || this.activePlaybackUrl || ""
    );
    if (failure.error?.code === "PROCESSING_UNAVAILABLE") this._processingUnavailable = true;
    if (processingUrl && /(?:status|HTTP|responseCode)[^0-9]*(?:401|403|429|5\d\d)/i.test(detail))
      this._processingUnavailable = true;
    this.clearPlaybackStallGuard();
    this._selectedSourceProber?.cancelAll();
    this._selectedSourceAbort?.abort();
    this.activePlaybackUrl = null;
    this.params.unverifiedPlayback = null;
    try {
      PlayerController.stop();
    } catch {
      /* best effort */
    }
    if (this.params.automaticSourceSelection) {
      const settings = PlayerSettingsStore.get();
      const candidates = autoPlayCandidates(this.streamCandidates, {
        ...nextEpisodeSelectionOptions(settings, {
          installedAddonNames: new Set(
            addonRepository
              .getCachedInstalledAddons()
              .map((addon) => String(addon.displayName || addon.name || ""))
          ),
          preferredBingeGroup: this.getCurrentStreamBingeGroup()
        }),
        mode:
          this.params.automaticNextEpisode && settings.streamAutoPlayMode === "MANUAL"
            ? "FIRST_STREAM"
            : settings.streamAutoPlayMode
      });
      let next = candidates.find(
        (stream) => !this._startupSourceFailures.has(playerStreamProbeKey(stream))
      );
      if (
        !next &&
        this.params.streamCandidatesComplete === false &&
        !this._startupDiscoveryCompleted
      ) {
        this._startupDiscoveryCompleted = true;
        const controller = (this._selectedSourceAbort = new AbortController());
        try {
          const rows = await selectedPlaybackTask(
            () =>
              this.getPlayableStreamsForVideo(
                this.params.videoId || this.params.itemId,
                normalizeItemType(this.params.itemType || "movie")
              ),
            { signal: controller.signal, timeoutMs: 45000 }
          );
          if (!this.isActiveMountToken(token) || this.playerBackNavigationInProgress) return;
          this.streamCandidates = this.normalizeStreamCandidates([
            ...this.streamCandidates,
            ...rows
          ]);
          this.params.streamCandidatesComplete = true;
          this._startupSourceAdvancing = false;
          return this.advanceAfterSelectedSourceFailure(message, failure);
        } catch {
          if (!this.isActiveMountToken(token) || this.playerBackNavigationInProgress) return;
        }
      }
      console.warn(
        "[AutoPlay] " +
          JSON.stringify({
            event: next ? "trying-next-source" : "permitted-sources-exhausted",
            eligible: candidates.length,
            failed: this._startupSourceFailures.size
          })
      );
      if (next) {
        // Leave the error callback before replacing the media session. Each identity is tried once.
        await Promise.resolve();
        if (!this.isActiveMountToken(token) || this.playerBackNavigationInProgress) return;
        this._startupSourceAdvancing = false;
        this.loadingVisible = true;
        StartupLoadingOverlay.setStage("opening");
        await this.playStreamCandidate(next, { mountToken: token, preservePendingRestore: true });
        return;
      }
    }
    if (!this.isActiveMountToken(token) || this.playerBackNavigationInProgress) return;
    const params = this.buildReturnStreamRouteParamsFromPlayer();
    StartupLoadingOverlay.finish();
    await Router.navigate(
      "stream",
      {
        ...params,
        manualSelection: true,
        autoSelectionFinished: true,
        autoResolvedStreams: this.streamCandidates,
        autoResolvedStreamsComplete: this.params.streamCandidatesComplete !== false,
        autoResolvedStreamId: null,
        playbackFailureMessage: this.params.automaticSourceSelection
          ? "None of the permitted streams could be played. Choose another stream."
          : String(message || "This stream could not be played. Choose another stream.")
      },
      { skipStackPush: true, replaceHistory: true }
    );
  },
  async playStreamCandidate(streamCandidate, options = {}) {
    const mountToken = options?.mountToken ?? null;
    this.directAudioPreferenceState = null;
    this.pendingAutomaticDirectAudio = null;
    this.directAudioSwitching = null;
    this._preparingSelectedSource = this.params?.prepareSelectedSource === true;
    this._selectedSourceAbort?.abort();
    this._selectedSourceProber?.cancelAll();
    this._selectedSourceAbort = new AbortController();
    const generation = (this._candidatePlaybackGeneration =
      (this._candidatePlaybackGeneration || 0) + 1);
    const isCurrent = () =>
      this.isActiveMountToken(mountToken) &&
      !this.playerBackNavigationInProgress &&
      generation === this._candidatePlaybackGeneration;
    if (!isCurrent()) {
      return;
    }
    if (!streamCandidate) {
      return;
    }
    StartupLoadingOverlay.setPlaybackAttempt?.({
      sourceNumber: this.params?.automaticSourceSelection
        ? (this._startupSourceFailures?.size || 0) + 1
        : null,
      route: "",
      failedRoute: ""
    });

    if (Environment.isBrowser()) {
      const selectedStreamIdentity = streamMergeKey(streamCandidate);
      const selectedStreamIndex = this.streamCandidates.findIndex(
        (entry) => selectedStreamIdentity && streamMergeKey(entry) === selectedStreamIdentity
      );
      if (selectedStreamIndex >= 0) {
        this.currentStreamIndex = selectedStreamIndex;
      }
    }
    let targetUrl = streamDirectPlaybackUrl(streamCandidate);
    let filenameWasUnknown;
    if (!targetUrl) {
      filenameWasUnknown = classifyStreamFilename(streamCandidate).method === "unknown";
      const resolveContext = {
        season: this.params?.season == null ? null : Number(this.params.season),
        episode: this.params?.episode == null ? null : Number(this.params.episode)
      };
      let fallbackError = "";
      let resolveFailureStatus = "";
      let resolveFailureDetail = "";

      if (DirectDebridResolver.canResolveStream(streamCandidate, resolveContext)) {
        let result;
        try {
          result = await selectedPlaybackTask(
            () => DirectDebridResolver.resolve(streamCandidate, resolveContext),
            { signal: this._selectedSourceAbort.signal }
          );
        } catch (error) {
          if (isCurrent())
            this.showStartupError(error.message, {
              error,
              reason: "stream-resolve",
              streamCandidate
            });
          return;
        }
        if (!isCurrent()) {
          return;
        }
        if (result.status === "success" && result.stream?.url) {
          targetUrl = result.stream.url;
          Object.assign(streamCandidate, {
            url: targetUrl,
            externalUrl: null,
            mimeType: result.stream.mimeType || streamCandidate.mimeType,
            sourceType: result.stream.sourceType || streamCandidate.sourceType,
            behaviorHints: result.stream.behaviorHints || streamCandidate.behaviorHints,
            raw: { ...(streamCandidate.raw || {}), ...(result.stream.raw || {}) }
          });
        } else {
          fallbackError =
            result.status === "service_degraded"
              ? t(
                  "stream.debrid.serviceDegraded",
                  {},
                  "The Debrid service is currently degraded. Try again later or choose another source."
                )
              : result.status === "not_cached"
                ? t("stream.debrid.notCached", {}, "Not cached on this service.")
                : result.status === "stale"
                  ? t("stream.debrid.stale", {}, "This Debrid result expired. Refreshing streams.")
                  : t("stream.debrid.failed", {}, "Could not resolve this Debrid stream.");
          resolveFailureStatus = result.status || "debrid-failed";
          resolveFailureDetail = result.detail || result.error || "";
          if (result.status === "service_degraded") {
            if (!this.hasPresentedPlaybackFrame) {
              this.showStartupError(fallbackError, {
                streamCandidate,
                reason: "debrid-resolve",
                resolverStatus: resolveFailureStatus,
                resolverDetail: resolveFailureDetail
              });
            } else {
              this.sourcesError = this.formatPlaybackErrorForSources(fallbackError, {
                streamCandidate,
                reason: "debrid-resolve",
                resolverStatus: resolveFailureStatus,
                resolverDetail: resolveFailureDetail
              });
              this.renderSourcesPanel();
            }
            return;
          }
        }
      }

      if (!targetUrl) {
        if (!isCurrent()) {
          return;
        }
        const startupMessage =
          fallbackError || t("player_error_playback_fallback", {}, "Playback error");
        if (!this.hasPresentedPlaybackFrame) {
          this.showStartupError(startupMessage, {
            streamCandidate,
            reason: "stream-resolve",
            resolverStatus: resolveFailureStatus,
            resolverDetail: resolveFailureDetail
          });
          return;
        }
        const sourceErrorMessage =
          fallbackError ||
          t(
            "stream.debrid.unavailable",
            {},
            "This Debrid source needs a configured Debrid account."
          );
        this.sourcesError = this.formatPlaybackErrorForSources(sourceErrorMessage, {
          streamCandidate,
          reason: "stream-resolve",
          resolverStatus: resolveFailureStatus,
          resolverDetail: resolveFailureDetail
        });
        this.renderSourcesPanel();
        return;
      }

      this.streamCandidates = this.streamCandidates.map((entry) =>
        entry.id === streamCandidate.id ? { ...entry, ...streamCandidate } : entry
      );
    }
    let delivery;
    try {
      delivery = await this.prepareResolvedCandidatePlayback(
        streamCandidate,
        targetUrl,
        isCurrent,
        filenameWasUnknown
      );
    } catch (error) {
      if (isCurrent())
        this.showStartupError(error?.message || "Unable to prepare this stream.", {
          error,
          reason: "resolved-source-prepare",
          playbackUrl: targetUrl,
          streamCandidate
        });
      return;
    }
    if (!delivery || !isCurrent()) return;
    targetUrl = delivery.url;
    this._preparingSelectedSource = false;
    this.activePlaybackUrl = targetUrl;
    try {
      await this.playStreamByUrl(targetUrl, {
        ...options,
        mountToken,
        sourceCandidate: streamCandidate
      });
    } catch (error) {
      if (!isCurrent()) return;
      if (
        await this.tryUnverifiedRemuxAfterFailure({
          detail: error?.message || "",
          preparationFailed: true
        })
      )
        return;
      this.showStartupError(error?.message || "Unable to start this stream.", {
        error,
        playbackUrl: targetUrl,
        streamCandidate
      });
    }
  },

  async switchStream(direction) {
    this.params.automaticSourceSelection = false;
    const visible = this.filterPlayerStreamList(this.streamCandidates);
    if (!visible.length) return;
    const current = playerStreamProbeKey(this.getCurrentStreamCandidate() || {});
    const index = visible.findIndex((stream) => playerStreamProbeKey(stream) === current);
    const next =
      index < 0
        ? direction < 0
          ? visible.length - 1
          : 0
        : (index + direction + visible.length) % visible.length;
    await this.playStreamCandidate(visible[next], { preservePlaybackState: true });
  },
  markPlaybackSourceFailed(url = this.activePlaybackUrl) {
    const normalizedUrl = String(url || "").trim();
    if (normalizedUrl) {
      (this.failedPlaybackUrls || (this.failedPlaybackUrls = new Set())).add(normalizedUrl);
    }
    const currentCandidate = this.getCurrentStreamCandidate?.();
    const currentId = String(currentCandidate?.id || "").trim();
    if (currentId) {
      (this.failedPlaybackStreamIds || (this.failedPlaybackStreamIds = new Set())).add(currentId);
    }
  },

  mediaErrorMessage(
    errorCode = 0,
    detail = "",
    streamCandidate = this.getCurrentStreamCandidate()
  ) {
    const code = Number(errorCode || 0);
    const text = String(detail || "").toLowerCase();
    const httpStatus = extractPlaybackHttpStatus(detail);
    const httpMessage = this.getHttpPlaybackErrorMessage(httpStatus);
    if (httpMessage) {
      return httpMessage;
    }
    const compatibilityMessage = this.getWebHeaderRestrictedStreamMessage(streamCandidate);
    if (compatibilityMessage && (code === 0 || code === 2 || code === 4)) {
      return compatibilityMessage;
    }
    if (code === 1) return "Playback aborted";
    if (code === 2) return "Network error";
    if (code === 3) {
      const unsupported = t(
        "player_error_unsupported_format",
        [this.getPlaybackErrorCodeLabel(code) || "decode"],
        "This stream uses a format your device may not support. Try a different source. [%1$s]"
      );
      return `${t("player_error_decoder", {}, "Decoder error")}\n\n${unsupported}`;
    }
    if (code === 4) {
      if (this.isDebridPlaybackCandidate(streamCandidate)) {
        return t("player_error_stream_load_failed", {}, "Playback failed to load");
      }
      if (
        text.includes("manifestparsingerror") ||
        text.includes("manifest parsing") ||
        text.includes("unrecognized") ||
        text.includes("invalid content") ||
        text.includes("invalid data") ||
        text.includes("text/html") ||
        text.includes("html")
      ) {
        return t(
          "player_error_source_invalid_content",
          [this.getPlaybackErrorCodeLabel(code) || "source"],
          "Source error: The stream source returned invalid or unplayable content. The link may have expired or the server returned an error page instead of video.\n\nTry a different source. [%1$s]"
        );
      }
      if (
        text.includes("no supported source") ||
        text.includes("no supported sources") ||
        text.includes("not supported") ||
        text.includes("unsupported")
      ) {
        return t("player_error_source_not_supported", {}, "Source not supported on this TV");
      }
      return t("player_error_playback_fallback", {}, "Playback error");
    }
    return t("player_error_playback_fallback", {}, "Playback error");
  },

  attemptSilentAudioRecovery(reason = "silent-audio") {
    void reason;
    return false;
  },

  clearPlaybackStallGuard() {
    if (this.playbackStallTimer) {
      clearTimeout(this.playbackStallTimer);
      this.playbackStallTimer = null;
    }
  },

  markPlaybackProgress() {
    const currentSeconds = this.getPlaybackCurrentSeconds();
    if (typeof PlayerController.recordProgressSnapshot === "function") {
      PlayerController.recordProgressSnapshot(
        Math.floor(currentSeconds * 1000),
        Math.floor(this.getPlaybackDurationSeconds() * 1000),
        typeof PlayerController.createProgressContext === "function"
          ? PlayerController.createProgressContext()
          : null
      );
    }
    if (this.seekLoading) {
      const seekBaselineSeconds = Number(this.seekLoadingBaselineSeconds);
      const seekTargetSeconds = Number(this.seekLoadingTargetSeconds);
      const reachedSeekTarget =
        Number.isFinite(currentSeconds) &&
        Number.isFinite(seekTargetSeconds) &&
        Math.abs(currentSeconds - seekTargetSeconds) <= 0.75;
      if (
        (reachedSeekTarget && this.isPlaybackFrameReady()) ||
        (!PlayerController.isClientRemuxRestoring?.() &&
          !Number.isFinite(seekTargetSeconds) &&
          Number.isFinite(currentSeconds) &&
          Number.isFinite(seekBaselineSeconds) &&
          currentSeconds > seekBaselineSeconds + STARTUP_PLAYBACK_ADVANCE_EPSILON_SECONDS)
      ) {
        this.clearSeekLoading({ hideBuffering: reachedSeekTarget });
      }
    }
    this.bufferingSpinnerBaselineSeconds = currentSeconds;
    this.lastPlaybackProgressAt = Date.now();
    this.scheduleBufferingSpinnerRefresh();
  },

  /**
   * Wait for a relayed source to exist before asking for a frame.
   *
   * A remux copies the whole film before it can serve one byte -- minutes, measured --
   * while this screen gives a source eighteen seconds to produce a frame. That is not a
   * playback failure, only a wait that had nowhere to happen, so it happens here: the
   * spinner stays up, the stall guard is not armed yet, and the source is loaded when
   * the server says it is ready.
   *
   * Returns true when the caller may proceed (ready, or nothing to wait for).
   */
  /**
   * Say, on the screen the viewer is looking at, that the relay is working.
   *
   * The splash already has a status slot that nothing ever wrote to, which is why a
   * two-minute copy looked identical to a broken source: the logo just kept animating.
   */
  setRelayStatusText(text, streamUrl = this.activePlaybackUrl) {
    this.relayStatusText = String(text || "");
    let label = "sumber";
    const raw = String(streamUrl || "");
    if (raw.includes("/api/remux")) label = "remuxing";
    else if (raw.includes("/api/transcode")) label = "transcoding";
    const message =
      PlayerSettingsStore.get().showPlayerLoadingStatus !== false && this.relayStatusText
        ? `${this.relayStatusText.replace("{kind}", label)}`
        : "";
    StartupLoadingOverlay.setRelayText(message);
    // The overlay lives under the screen's own root, which is not necessarily the
    // document: searching only `document` found nothing, so the message silently never
    // appeared. Every plausible root is tried, and the write is retried once in case
    // the splash markup is still being built when the wait begins.
    // The player keeps direct references to these nodes; they are the only reliable way
    // in, because the UI is not necessarily anywhere under `document`.
    for (const host of [this.uiRefs?.loadingOverlay, this.uiRefs?.bufferingSpinner]) {
      const node = host?.querySelector?.(".player-loading-status");
      if (!node) continue;
      node.textContent = message;
      node.classList.toggle("hidden", !message);
    }
    const roots = [];
    const push = (candidate) => {
      if (candidate && !roots.includes(candidate)) roots.push(candidate);
    };
    push(this.uiRefs?.root);
    if (typeof document !== "undefined") push(document);
    push(this.video?.getRootNode?.());
    const apply = () => {
      let written = false;
      for (const scope of roots) {
        for (const id of ["playerLoadingOverlay", "playerBufferingSpinner"]) {
          const host = scope?.getElementById?.(id) || scope?.querySelector?.(`#${id}`);
          const node = host?.querySelector?.(".player-loading-status");
          if (!node) continue;
          node.textContent = message;
          node.classList.toggle("hidden", !message);
          written = true;
        }
      }
      return written;
    };
    if (apply()) return;
    if (typeof setTimeout === "function") setTimeout(apply, 400);
  },
  /** Ask the relay how this source is doing, without starting anything. */
  async relayPrepareState(streamUrl) {
    const raw = String(streamUrl || "").trim();
    if (!raw.includes("/api/remux")) return "unknown";
    let prepareUrl = "";
    try {
      const parsed = new URL(
        raw,
        typeof location !== "undefined" ? location.origin : "http://localhost"
      );
      const source = parsed.searchParams.get("u");
      if (!source) return "unknown";
      prepareUrl = `${parsed.origin}/api/remux/status?u=${encodeURIComponent(source)}&ai=${encodeURIComponent(parsed.searchParams.get("ai") || "0")}`;
    } catch {
      return "unknown";
    }
    try {
      const response = await fetch(prepareUrl, { cache: "no-store" });
      if (!response.ok) return "unknown";
      const data = await response.json().catch(() => null);
      return String(data?.state || "unknown");
    } catch {
      return "unknown";
    }
  },
  async awaitRelayedSource(streamUrl, mountToken = null) {
    if (this.relayPrepareDone) return true;
    // Recognise the relay from the URL itself. Depending on a parameter meant that one
    // plumbing mistake -- a value that never reached this screen -- silently disabled
    // the gate, and the only symptom was the same "Playback error" as before.
    let prepareUrl = "";
    const raw = String(streamUrl || "").trim();
    if (raw.includes("/api/remux")) {
      try {
        const parsed = new URL(
          raw,
          typeof location !== "undefined" ? location.origin : "http://localhost"
        );
        const source = parsed.searchParams.get("u");
        if (source)
          prepareUrl = `${parsed.origin}/api/remux/status?u=${encodeURIComponent(source)}&ai=${encodeURIComponent(parsed.searchParams.get("ai") || "0")}`;
      } catch {
        prepareUrl = "";
      }
    }
    if (!prepareUrl) prepareUrl = String(this.relayPrepareUrl || "").trim();
    if (!prepareUrl) return true;
    const boundedFallback = this.params?.unverifiedPlayback?.routeFallbackEnabled;
    const routeGeneration = this._playbackUrlGeneration;
    const remuxBegan = this.params?.unverifiedPlayback?.routeStartedAt;
    const deadline = boundedFallback
      ? (Number.isFinite(remuxBegan) ? remuxBegan : Date.now()) + 17000
      : Date.now() + 15 * 60 * 1000;
    const startedAt = Date.now();
    let asked = false;
    while (Date.now() < deadline) {
      if (
        (mountToken && !this.isActiveMountToken(mountToken)) ||
        this.playerBackNavigationInProgress ||
        routeGeneration !== this._playbackUrlGeneration
      )
        return false;
      let response = null;
      try {
        // `start=1` once, on the first call: it tells the server to begin the copy. The
        // rest only ask how it is going, so a reload of the same source is not restarted.
        response = await fetch(`${prepareUrl}${asked ? "" : "&start=1"}`, { cache: "no-store" });
      } catch {
        return true;
      }
      asked = true;
      if (response.status === 429 || response.status === 503) {
        // Busy or over budget: the server is not refusing the source, only its turn.
        await new Promise((resolve) => setTimeout(resolve, 2000));
        continue;
      }
      if (!response.ok) return true;
      const data = await response.json().catch(() => null);
      if (!data) return true;
      if (data.state === "ready") {
        this.relayPrepareDone = true;
        this.setRelayStatusText("", streamUrl);
        return true;
      }
      this.setRelayStatusText(
        t(
          "playback_preparing_relay",
          {
            kind: String(streamUrl || "").includes("/api/remux") ? "remuxing" : "transcoding",
            seconds: Math.max(0, Math.round((Date.now() - startedAt) / 1000))
          },
          `Preparing ${String(streamUrl || "").includes("/api/remux") ? "remuxing" : "transcoding"} - ${Math.max(0, Math.round((Date.now() - startedAt) / 1000))} seconds`
        ),
        streamUrl
      );
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
    if (boundedFallback) throw new Error("Stream preparation timed out.");
    // Nothing arrived in fifteen minutes: hand it to the normal path, whose error is
    // more truthful than waiting for ever.
    return true;
  },
  noteStartupReadiness(video) {
    const state = this.startupReadiness;
    if (
      !state ||
      state.video !== video ||
      video !== PlayerController.video ||
      state.url !== this.activePlaybackUrl ||
      this.hasPresentedPlaybackFrame ||
      Number(video?.readyState || 0) < 1
    )
      return;
    const errorCode = Number(
      video?.error?.code || PlayerController.getLastPlaybackErrorCode?.() || 0
    );
    if (errorCode) return;
    if (state.metadataAt == null) state.metadataAt = Date.now();
    if (this.isStartupErrorVisible()) {
      if (!state.timeoutError) return;
      state.timeoutError = false;
      state.metadataAt = Date.now();
      this.clearStartupError();
      this.failedPlaybackUrls?.delete(state.url);
      const id = String(this.getCurrentStreamCandidate?.()?.id || "").trim();
      if (id) this.failedPlaybackStreamIds?.delete(id);
      this.loadingVisible = true;
      this.enableStartupAudioGate({ allowPlayback: state.allowPlayback });
      this.updateLoadingVisibility();
    }
    this.schedulePlaybackStallGuard();
  },

  getPlaybackStallTimeoutMs({ startup = false } = {}) {
    if (!startup) return 9000;
    const state = this?.startupReadiness;
    if (!state) return 18000;
    const metadataPending = state.metadataAt == null;
    const attempt = this.params?.unverifiedPlayback;
    if (attempt?.measuredTranscode && attempt.mediaUrl === this.activePlaybackUrl) {
      const budget = metadataPending ? 60000 : 18000;
      return Math.max(
        1,
        budget - Math.max(0, Date.now() - (metadataPending ? state.startedAt : state.metadataAt))
      );
    }
    if (attempt?.routeFallbackEnabled && attempt.mediaUrl === this.activePlaybackUrl)
      return Math.max(
        1,
        (attempt.route === "audio-transcode" ? 30000 : attempt.route === "remux" ? 17000 : 13000) -
          Math.max(
            0,
            Date.now() -
              (attempt.route === "remux" && Number.isFinite(attempt.routeStartedAt)
                ? attempt.routeStartedAt
                : state.startedAt)
          )
      );
    const unverifiedDirect =
      attempt?.route === "direct" &&
      !attempt.remuxTried &&
      attempt.mediaUrl === this.activePlaybackUrl &&
      REMUX_POLICY.mode !== "off";
    if (unverifiedDirect) return Math.max(1, 13000 - Math.max(0, Date.now() - state.startedAt));
    const budget = metadataPending ? 60000 : 18000;
    const startedAt = metadataPending ? state.startedAt : state.metadataAt;
    return Math.max(1, budget - Math.max(0, Date.now() - startedAt));
  },

  schedulePlaybackStallGuard({ timeoutMs: timeoutOverrideMs = null } = {}) {
    this.clearPlaybackStallGuard();
    if (this.isExternalFrameMode() || !this.activePlaybackUrl) {
      return;
    }

    const startup = !this.hasPresentedPlaybackFrame;
    const sourceUrl = this.activePlaybackUrl;
    const readiness = this.startupReadiness;
    const timeoutMs =
      Number.isFinite(Number(timeoutOverrideMs)) && Number(timeoutOverrideMs) > 0
        ? Number(timeoutOverrideMs)
        : this.getPlaybackStallTimeoutMs({ startup });
    this.playbackStallTimer = setTimeout(async () => {
      this.playbackStallTimer = null;
      if (sourceUrl !== this.activePlaybackUrl || readiness !== this.startupReadiness) return;
      if (this.isExternalFrameMode() || !this.loadingVisible || !this.activePlaybackUrl) {
        return;
      }

      // A relay produces nothing until it has copied the film, so the source is not
      // stalled, only early. Asking the relay and keeping the spinner up turns a
      // guaranteed false error into a wait -- and this check sits in the guard itself,
      // so it holds for every way a source reaches the screen.
      if (
        !this.params?.unverifiedPlayback?.routeFallbackEnabled &&
        String(this.activePlaybackUrl || "").includes("/api/remux")
      ) {
        void this.relayPrepareState(this.activePlaybackUrl).then((state) => {
          if (state !== "ready" && this.loadingVisible) {
            this.setRelayStatusText(
              t(
                "playback_preparing_relay",
                { kind: "remuxing", seconds: "" },
                "Preparing remuxing"
              ),
              this.activePlaybackUrl
            );
            this.schedulePlaybackStallGuard({ timeoutMs: 4000 });
          }
        });
        return;
      }

      const readyState =
        typeof PlayerController.getPlaybackReadyState === "function"
          ? Number(PlayerController.getPlaybackReadyState() || 0)
          : Number(PlayerController.video?.readyState || 0);
      if (startup && readiness && readiness.metadataAt == null && readyState > 0) {
        this.noteStartupReadiness(PlayerController.video);
        return;
      }
      if (startup && this.markPlaybackPresentedAfterAdvance()) {
        this.loadingVisible = false;
        this.updateLoadingVisibility();
        this.updateUiTick();
        return;
      }
      if (readyState >= 3) {
        this.loadingVisible = false;
        this.updateLoadingVisibility();
        this.updateUiTick();
        return;
      }

      const mediaErrorCode = Number(PlayerController.getLastPlaybackErrorCode?.() || 0);
      const sourceCandidate =
        this.getStreamCandidateByUrl(this.activePlaybackUrl) || this.getCurrentStreamCandidate();
      const lastHlsErrorDetail =
        typeof PlayerController.getLastHlsErrorDetail === "function"
          ? PlayerController.getLastHlsErrorDetail()
          : "";
      if (startup && this.params?.unverifiedPlayback && this.tryUnverifiedRemuxAfterFailure) {
        if (
          await this.tryUnverifiedRemuxAfterFailure({
            mediaErrorCode,
            detail: lastHlsErrorDetail,
            httpStatus: extractPlaybackHttpStatus(lastHlsErrorDetail),
            startupStall: true
          })
        )
          return;
      }
      if (sourceUrl !== this.activePlaybackUrl || readiness !== this.startupReadiness) return;
      const targetEngine =
        !isTerminalHlsHttpStatus(extractPlaybackHttpStatus(lastHlsErrorDetail)) &&
        typeof PlayerController.getAlternativePlaybackEngine === "function"
          ? PlayerController.getAlternativePlaybackEngine(this.activePlaybackUrl)
          : null;
      if (targetEngine) {
        void this.playStreamByUrl(this.activePlaybackUrl, {
          preservePlaybackState: true,
          resetSilentAudioState: false,
          forceEngine: targetEngine,
          sourceCandidate
        });
        return;
      }

      this.releaseStartupAudioGate({ resume: false });
      if (startup) {
        this.markPlaybackSourceFailed(this.activePlaybackUrl);
        this.showStartupError(this.getStartupErrorMessage(mediaErrorCode, "", sourceCandidate), {
          mediaErrorCode,
          streamCandidate: sourceCandidate,
          playbackUrl: this.activePlaybackUrl,
          reason: "startup-stall"
        });
        return;
      }

      this.loadingVisible = false;
      this.paused = true;
      this.dismissPauseOverlay();
      this.updateLoadingVisibility();
      this.updateMediaSessionPlaybackState();
      this.setControlsVisible(true, { focus: false });
      this.sourcesError = this.formatPlaybackErrorForSources(
        `${this.mediaErrorMessage(mediaErrorCode, "", sourceCandidate)}. Choose another source manually.`,
        {
          mediaErrorCode,
          streamCandidate: sourceCandidate,
          playbackUrl: this.activePlaybackUrl,
          reason: "playback-stall"
        }
      );
      if (this.streamCandidates.length > 1) {
        this.openSourcesPanel();
      } else {
        this.renderSourcesPanel();
      }
      this.updateUiTick();
    }, timeoutMs);
  },

  getSubtitleTabs() {
    return [
      { id: "builtIn", label: t("subtitle_tab_builtin", {}, "Built-in") },
      { id: "addons", label: t("subtitle_tab_addons", {}, "Addons") },
      { id: "style", label: t("subtitle_tab_style", {}, "Style") },
      { id: "delay", label: t("subtitle_tab_delay", {}, "Delay") }
    ];
  },

  refreshTrackDialogs() {
    this.invalidateTrackDialogCaches();
    this.syncTrackState();
    const requestedAudio = this.pendingDirectAudioSelection;
    if (requestedAudio?.url === this.activePlaybackUrl) {
      // A manual source-track choice takes precedence over startup language defaults.
      const selected = this.getAudioEntries().find(
        (entry) =>
          entry.selected &&
          entry.track?.engine !== "direct-source" &&
          entry.track?.index === requestedAudio.index
      );
      if (selected) {
        if (requestedAudio.remember !== false)
          this.rememberAudioTrackSelection(this.getAudioTrackPreference(selected));
        this.pendingDirectAudioSelection = null;
      }
    }
    const audioTrackSetSignature = this.getStartupAudioTrackSetSignature();
    this.startupAudioTrackSetSignature = audioTrackSetSignature;
    this.ensureSupportedAudioTrackSelected();
    if (this.startupTrackPreferenceReady) {
      this.applyStartupAudioPreference();
      this.applyStartupSubtitlePreference();
    }
    this.refreshSubtitleCueStyles();
    this.renderControlButtons();
    if (this.subtitleDialogVisible) {
      this.renderSubtitleDialog();
    }
    if (this.audioDialogVisible) {
      this.renderAudioDialog();
    }
    if (this.playbackInfoVisible && this.moreActionsVisible) this.renderCompactBrowserMorePanel();
  },

  invalidateTrackDialogCaches() {
    this.trackDialogCache = createTrackDialogCache();
  },

  getStartupAudioTrackSetSignature() {
    return this.collectAudioOptionItems()
      .map((option) =>
        [
          option.id,
          option.languageKey,
          option.label,
          option.secondary,
          option.supported ? "supported" : "unsupported"
        ]
          .map((value) => cleanDisplayText(value))
          .join("|")
      )
      .join("||");
  },

  hasAudioTracksAvailable() {
    try {
      const tracks =
        typeof PlayerController.getBrowserAudioTracks === "function"
          ? PlayerController.getBrowserAudioTracks()
          : this.getAudioTracks();
      return tracks.length > 0;
    } catch (_) {
      return false;
    }
  },

  hasSubtitleTracksAvailable() {
    let dashCount = 0;
    try {
      dashCount =
        typeof PlayerController.getDashTextTracks === "function"
          ? PlayerController.getDashTextTracks().length
          : 0;
    } catch (_) {
      dashCount = 0;
    }

    let hlsCount = 0;
    try {
      hlsCount =
        typeof PlayerController.getHlsSubtitleTracks === "function"
          ? PlayerController.getHlsSubtitleTracks().length
          : 0;
    } catch (_) {
      hlsCount = 0;
    }
    let nativeCount = 0;
    try {
      nativeCount = this.getTextTracks().length;
    } catch (_) {
      nativeCount = 0;
    }
    return (
      dashCount > 0 ||
      hlsCount > 0 ||
      nativeCount > 0 ||
      this.manifestSubtitleTracks.length > 0 ||
      this.subtitles.length > 0
    );
  },

  clearTrackDiscoveryTimer() {
    if (this.trackDiscoveryTimer) {
      clearTimeout(this.trackDiscoveryTimer);
      this.trackDiscoveryTimer = null;
    }
  },

  startTrackDiscoveryWindow({ durationMs = 7000, intervalMs = 350 } = {}) {
    const now = Date.now();
    const requestedDeadline = now + Math.max(500, Number(durationMs || 0));
    const existingDeadline =
      this.trackDiscoveryInProgress && Number(this.trackDiscoveryDeadline || 0) > now
        ? Number(this.trackDiscoveryDeadline || 0)
        : 0;
    const token = (this.trackDiscoveryToken || 0) + 1;
    this.trackDiscoveryToken = token;
    this.trackDiscoveryInProgress = true;
    this.trackDiscoveryStartedAt =
      existingDeadline && Number(this.trackDiscoveryStartedAt || 0) > 0
        ? Number(this.trackDiscoveryStartedAt)
        : now;
    this.trackDiscoveryDeadline = Math.max(requestedDeadline, existingDeadline);
    this.clearTrackDiscoveryTimer();

    const tick = () => {
      if (token !== this.trackDiscoveryToken) {
        return;
      }

      const now = Date.now();
      const doneByData = this.hasSubtitleTracksAvailable() || this.hasAudioTracksAvailable();
      const doneByIdle =
        !this.subtitleLoading &&
        !this.manifestLoading &&
        now - Number(this.trackDiscoveryStartedAt || 0) >= 1200;
      const doneByTimeout = now >= this.trackDiscoveryDeadline;
      this.refreshTrackDialogs();

      if (doneByData || doneByIdle || doneByTimeout) {
        this.trackDiscoveryInProgress = false;
        this.clearTrackDiscoveryTimer();
        this.refreshTrackDialogs();
        return;
      }

      this.trackDiscoveryTimer = setTimeout(tick, Math.max(120, Number(intervalMs || 0)));
    };

    tick();
  },

  ensureTrackDataWarmup(force = false) {
    const now = Date.now();
    if (!force && now - Number(this.lastTrackWarmupAt || 0) < 1200) {
      return;
    }
    if (!force && (this.subtitleLoading || this.manifestLoading)) {
      this.startTrackDiscoveryWindow();
      return;
    }
    this.lastTrackWarmupAt = now;
    this.loadSubtitles();
    this.loadManifestTrackDataForCurrentStream(
      this.activePlaybackUrl || this.getCurrentStreamCandidate()?.url || null
    );
    this.startTrackDiscoveryWindow();
  },

  getTextTracks() {
    const trackList = this.getVideoTextTrackList();
    if (!trackList) {
      return [];
    }
    try {
      return trackListToArray(trackList);
    } catch (_) {
      return [];
    }
  },

  getAudioTracks() {
    const trackList = this.getVideoAudioTrackList();
    if (!trackList) {
      return [];
    }
    try {
      return trackListToArray(trackList);
    } catch (_) {
      return [];
    }
  },

  revokeExternalSubtitleObjectUrls() {
    if (
      !Array.isArray(this.externalSubtitleObjectUrls) ||
      !this.externalSubtitleObjectUrls.length
    ) {
      return;
    }
    this.externalSubtitleObjectUrls.forEach((url) => {
      try {
        URL.revokeObjectURL(url);
      } catch (_) {
        // Best effort.
      }
    });
    this.externalSubtitleObjectUrls = [];
  },

  clearMountedExternalSubtitleTracks() {
    this.externalTrackNodes.forEach((node) => node.remove());
    this.externalTrackNodes = [];
    this.revokeExternalSubtitleObjectUrls();
  },

  getSubtitleRequestHeaders() {
    const baseHeaders = this.getCurrentStreamRequestHeaders();
    if (typeof PlayerController.normalizePlaybackHeaders === "function") {
      return PlayerController.normalizePlaybackHeaders(baseHeaders);
    }
    return { ...baseHeaders };
  },

  isLikelySrtSubtitleUrl(url) {
    const value = String(url || "").toLowerCase();
    return value.includes(".srt") || value.includes("format=srt");
  },

  normalizeExternalSubtitleText(body, sourceUrl = "", contentType = "") {
    const normalizedContentType = String(contentType || "").toLowerCase();
    const shouldConvertToVtt =
      this.isLikelySrtSubtitleUrl(sourceUrl) ||
      normalizedContentType.includes("subrip") ||
      (!normalizedContentType.includes("vtt") && !/^\s*WEBVTT/i.test(body));
    return shouldConvertToVtt
      ? this.convertSrtToVtt(body)
      : this.applySubtitleAssAlignmentToVtt(body);
  },

  createSubtitleObjectUrl(
    body,
    sourceUrl = "",
    contentType = "",
    objectUrlCollection = this.externalSubtitleObjectUrls
  ) {
    const vttText = this.normalizeExternalSubtitleText(body, sourceUrl, contentType);
    const objectUrl = URL.createObjectURL(new Blob([vttText], { type: "text/vtt" }));
    objectUrlCollection.push(objectUrl);
    return objectUrl;
  },

  sanitizeSubtitleText(content, { preserveBasicStyle = false } = {}) {
    const source = String(content || "");
    const openTags = [];
    const closeTag = (tag) => {
      const output = [];
      for (let index = openTags.length - 1; index >= 0; index -= 1) {
        const activeTag = openTags[index];
        output.push(`</${activeTag}>`);
        openTags.splice(index, 1);
        if (activeTag === tag) {
          break;
        }
      }
      return output.join("");
    };
    const openTag = (tag) => {
      if (openTags.includes(tag)) {
        return "";
      }
      openTags.push(tag);
      return `<${tag}>`;
    };

    const normalized = source.replace(/\\[Nn]/g, "\n").replace(/\\h/g, " ");

    const converted = normalized.replace(/\{[^}]*\}/g, (block) => {
      if (!preserveBasicStyle) {
        return "";
      }
      let output = "";
      const commandPattern = /\\([ibu])([01])\b|\\r\b/gi;
      let match;
      while ((match = commandPattern.exec(block)) !== null) {
        if (match[0].toLowerCase() === "\\r") {
          output += closeTag("u") + closeTag("i") + closeTag("b");
          continue;
        }
        const tag = String(match[1] || "").toLowerCase();
        const enabled = String(match[2] || "") === "1";
        if (tag === "i") {
          output += enabled ? openTag("i") : closeTag("i");
        } else if (tag === "b") {
          output += enabled ? openTag("b") : closeTag("b");
        } else if (tag === "u") {
          output += enabled ? openTag("u") : closeTag("u");
        }
      }
      return output;
    });

    return `${converted}${closeTag("u")}${closeTag("i")}${closeTag("b")}`;
  },

  buildVttAlignmentSettings(alignment) {
    const settings = this.getSubtitleAssAlignmentSettings(alignment);
    if (!settings) {
      return "";
    }
    return `line:${settings.line}% align:${settings.align}`;
  },

  applySubtitleAssAlignmentToVtt(content) {
    const normalized = String(content || "")
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n");
    if (!this.hasSubtitleAssSyntax(normalized)) {
      return normalized;
    }
    return normalized
      .split(/\n{2,}/)
      .map((block) => {
        const alignment = this.getSubtitleAssAlignment(block);
        const settings = this.buildVttAlignmentSettings(alignment);
        if (!settings) {
          return this.sanitizeSubtitleText(block, { preserveBasicStyle: true });
        }

        const lines = block.split("\n");
        const timingIndex = lines.findIndex((line) => line.includes("-->"));
        if (timingIndex < 0) {
          return this.sanitizeSubtitleText(block, { preserveBasicStyle: true });
        }

        const timingLine = lines[timingIndex];
        const alignmentSettings = this.getSubtitleAssAlignmentSettings(alignment);
        const nextTimingLine = [
          /\sline:/i.test(timingLine) ? "" : `line:${alignmentSettings.line}%`,
          /\salign:/i.test(timingLine) ? "" : `align:${alignmentSettings.align}`
        ]
          .filter(Boolean)
          .join(" ");
        if (nextTimingLine) {
          lines[timingIndex] = `${timingLine} ${nextTimingLine}`;
        }
        return this.sanitizeSubtitleText(lines.join("\n"), { preserveBasicStyle: true });
      })
      .join("\n\n");
  },

  convertSrtToVtt(content) {
    const raw = String(content || "")
      .replace(/^\uFEFF/, "")
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n");
    if (!raw.trim()) {
      return "WEBVTT\n\n";
    }
    if (/^\s*WEBVTT/i.test(raw)) {
      return this.applySubtitleAssAlignmentToVtt(raw);
    }
    const withHours = raw.replace(/(\b\d{1,2}:\d{2}:\d{2}),(\d{3}\b)/g, "$1.$2");
    const normalized = withHours.replace(/(\b\d{1,2}:\d{2}),(\d{3}\b)/g, "00:$1.$2");
    return this.applySubtitleAssAlignmentToVtt(`WEBVTT\n\n${normalized}`);
  },

  async resolveSubtitlePlaybackUrl(url, { timeoutMs = 0 } = {}) {
    const original = String(url || "").trim();
    if (!original) {
      return "";
    }
    if (/^(blob:|data:)/i.test(original)) {
      return original;
    }
    const effectiveTimeoutMs = Number(timeoutMs) > 0 ? Number(timeoutMs) : 0;
    const requestController =
      typeof AbortController === "function" && effectiveTimeoutMs > 0
        ? new AbortController()
        : null;
    let requestTimeoutId = null;
    try {
      const requestPromise = fetch(original, {
        mode: "cors",
        headers: this.getSubtitleRequestHeaders(),
        ...(requestController ? { signal: requestController.signal } : {})
      });
      const response =
        effectiveTimeoutMs > 0
          ? await Promise.race([
              requestPromise,
              new Promise((_, reject) => {
                requestTimeoutId = setTimeout(() => {
                  try {
                    requestController?.abort();
                  } catch (_) {
                    // Ignore abort failures.
                  }
                  reject(new Error("Subtitle request timed out"));
                }, effectiveTimeoutMs);
              })
            ])
          : await requestPromise;
      if (!response.ok) {
        throw new Error(`Subtitle request failed with HTTP ${response.status}`);
      }
      const body = await response.text();
      const contentType = String(response.headers?.get("content-type") || "").toLowerCase();
      return this.createSubtitleObjectUrl(body, original, contentType);
    } catch (_) {
      return original;
    } finally {
      if (requestTimeoutId) {
        clearTimeout(requestTimeoutId);
      }
    }
  },

  parseSubtitleTimestamp(value = "") {
    const match = String(value || "")
      .trim()
      .match(/(?:(\d+):)?(\d{1,2}):(\d{2})[,.](\d{1,3})/);
    if (!match) {
      return NaN;
    }
    const hours = Number(match[1] || 0);
    const minutes = Number(match[2] || 0);
    const seconds = Number(match[3] || 0);
    const milliseconds = Number(
      String(match[4] || "0")
        .padEnd(3, "0")
        .slice(0, 3)
    );
    return hours * 3600 + minutes * 60 + seconds + milliseconds / 1000;
  },

  decodeSubtitleEntities(value = "") {
    const text = String(value || "");
    if (!text.includes("&")) {
      return text;
    }
    try {
      const textarea = document.createElement("textarea");
      textarea.innerHTML = text;
      return textarea.value;
    } catch (_) {
      return text
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'");
    }
  },

  parseSubtitleCueText(text = "") {
    return this.decodeSubtitleEntities(
      this.sanitizeSubtitleText(String(text || ""), { preserveBasicStyle: false }).replace(
        /<[^>]*>/g,
        ""
      )
    ).trim();
  },

  parseSubtitleCues(content = "") {
    const normalized = this.convertSrtToVtt(content)
      .replace(/^\uFEFF/, "")
      .replace(/\r\n/g, "\n")
      .replace(/\r/g, "\n");
    return normalized
      .split(/\n{2,}/)
      .map((block) => {
        const lines = block.split("\n").map((line) => line.trimEnd());
        const timingIndex = lines.findIndex((line) => line.includes("-->"));
        if (timingIndex < 0) {
          return null;
        }
        const timingParts = String(lines[timingIndex] || "").split("-->");
        const start = this.parseSubtitleTimestamp(timingParts[0]);
        const end = this.parseSubtitleTimestamp(timingParts[1]);
        if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
          return null;
        }
        const text = this.parseSubtitleCueText(lines.slice(timingIndex + 1).join("\n"));
        if (!text) {
          return null;
        }
        const layout = parseVttCueLayout(lines[timingIndex]);
        return { start, end, text, line: layout.line, align: layout.align };
      })
      .filter(Boolean)
      .sort((left, right) => left.start - right.start || left.end - right.end);
  },

  clearHtmlSubtitleOverlay() {
    if (this.htmlSubtitleRenderFrame != null) {
      if (typeof cancelAnimationFrame === "function") {
        cancelAnimationFrame(this.htmlSubtitleRenderFrame);
      } else {
        clearTimeout(this.htmlSubtitleRenderFrame);
      }
    }
    this.htmlSubtitleRenderFrame = null;
    if (this.htmlSubtitleRenderTimer != null) {
      clearTimeout(this.htmlSubtitleRenderTimer);
      this.htmlSubtitleRenderTimer = null;
    }
    this.htmlSubtitleCues = [];
    this.htmlSubtitleActiveCueKey = "";
    this.htmlSubtitleSelectedId = null;
    const node = this.uiRefs?.htmlSubtitles || document.getElementById("playerHtmlSubtitles");
    if (node) {
      if (typeof node.replaceChildren === "function") {
        node.replaceChildren();
      } else {
        node.innerHTML = "";
      }
      node.classList.add("hidden");
      node.setAttribute("aria-hidden", "true");
    }
  },

  renderHtmlSubtitleOverlayCue(activeCues = []) {
    const node = this.uiRefs?.htmlSubtitles || document.getElementById("playerHtmlSubtitles");
    if (!node) {
      return;
    }
    const cueKey = activeCues
      .map(
        (cue) =>
          `${cue.start}-${cue.end}-${cue.line ?? "default"}-${cue.align || "center"}-${cue.text}`
      )
      .join("|");
    const hasRenderedActiveCue =
      activeCues.length > 0 &&
      !node.classList.contains("hidden") &&
      node.getAttribute("aria-hidden") === "false" &&
      node.childNodes.length > 0;
    const hasRenderedEmptyCue =
      activeCues.length === 0 && node.classList.contains("hidden") && node.childNodes.length === 0;
    if (cueKey === this.htmlSubtitleActiveCueKey && (hasRenderedActiveCue || hasRenderedEmptyCue)) {
      return;
    }
    this.htmlSubtitleActiveCueKey = cueKey;
    if (typeof node.replaceChildren === "function") {
      node.replaceChildren();
    } else {
      node.innerHTML = "";
    }
    if (!activeCues.length) {
      node.classList.add("hidden");
      node.setAttribute("aria-hidden", "true");
      return;
    }
    const cueGroups = new Map();
    activeCues.forEach((cue) => {
      const line = cue?.line == null ? NaN : Number(cue.line);
      const normalizedLine = Number.isFinite(line) ? clamp(line, 0, 100) : null;
      const align = ["start", "end", "center"].includes(cue?.align) ? cue.align : "center";
      const groupKey = `${normalizedLine ?? "default"}:${align}`;
      if (!cueGroups.has(groupKey)) {
        cueGroups.set(groupKey, { line: normalizedLine, align, cues: [] });
      }
      cueGroups.get(groupKey).cues.push(cue);
    });
    cueGroups.forEach((group) => {
      const cueNode = document.createElement("div");
      cueNode.className = `player-html-subtitle-cue player-html-subtitle-align-${group.align}`;
      if (group.line == null) {
        cueNode.classList.add("player-html-subtitle-default");
      } else {
        cueNode.classList.add("player-html-subtitle-positioned");
        cueNode.style.top = `${group.line}%`;
      }
      group.cues.forEach((cue) =>
        String(cue.text || "")
          .split("\n")
          .forEach((line) => {
            const cleanLine = line.trim();
            if (!cleanLine) {
              return;
            }
            const lineNode = document.createElement("span");
            lineNode.className = "player-html-subtitle-line";
            lineNode.textContent = cleanLine;
            cueNode.appendChild(lineNode);
          })
      );
      if (cueNode.childNodes.length) {
        node.appendChild(cueNode);
      }
    });
    node.classList.remove("hidden");
    node.setAttribute("aria-hidden", "false");
  },

  renderHtmlSubtitleOverlayAtCurrentTime() {
    if (!Array.isArray(this.htmlSubtitleCues) || !this.htmlSubtitleCues.length) {
      return false;
    }
    const currentTime = Number(this.getPlaybackCurrentSeconds() || 0);
    const delaySeconds = Number(this.subtitleDelayMs || 0) / 1000;
    const subtitleTime = currentTime - delaySeconds;
    const activeCues = this.htmlSubtitleCues.filter(
      (cue) => subtitleTime >= cue.start && subtitleTime < cue.end
    );
    this.renderHtmlSubtitleOverlayCue(activeCues);
    return true;
  },

  scheduleHtmlSubtitleOverlayRender() {
    if (!Array.isArray(this.htmlSubtitleCues) || !this.htmlSubtitleCues.length) {
      return;
    }
    if (this.htmlSubtitleRenderTimer != null) {
      clearTimeout(this.htmlSubtitleRenderTimer);
      this.htmlSubtitleRenderTimer = null;
    }
    const render = () => {
      if (!this.renderHtmlSubtitleOverlayAtCurrentTime()) {
        this.htmlSubtitleRenderTimer = null;
        return;
      }
      this.htmlSubtitleRenderTimer = setTimeout(render, 120);
    };
    render();
  },

  activateMountedExternalSubtitleTrack(trackNode) {
    const textTracks = this.getTextTracks();
    const targetTrack = trackNode?.track || null;
    if (!targetTrack && !textTracks.length) {
      return false;
    }

    let activatedIndex = -1;
    textTracks.forEach((textTrack, index) => {
      if (textTrack.kind && !["subtitles", "captions", "forced"].includes(textTrack.kind)) return;
      const shouldShow = targetTrack ? textTrack === targetTrack : index === textTracks.length - 1;
      try {
        textTrack.mode = shouldShow ? "showing" : "disabled";
        if (shouldShow) {
          activatedIndex = index;
        }
      } catch (_) {
        // Best effort.
      }
    });

    if (activatedIndex < 0 && targetTrack) {
      try {
        targetTrack.mode = "showing";
        activatedIndex = textTracks.indexOf(targetTrack);
      } catch (_) {
        // Best effort.
      }
    }

    if (activatedIndex >= 0) {
      this.selectedSubtitleTrackIndex = activatedIndex;
      this.refreshTrackDialogs();
      return true;
    }

    return false;
  },

  resolveBuiltInSubtitleBoundary(textTracks = this.getTextTracks()) {
    const trackCount = textTracks.length;
    if (!trackCount) {
      return 0;
    }

    const mounted = new Set(
      (this.externalTrackNodes || []).map((node) => node.track).filter(Boolean)
    );
    const firstAddon = textTracks.findIndex((track) => mounted.has(track));
    if (firstAddon >= 0) return firstAddon;

    if (Number.isFinite(this.builtInSubtitleCount) && this.builtInSubtitleCount > 0) {
      return clamp(this.builtInSubtitleCount, 0, trackCount);
    }

    if (this.externalTrackNodes.length > 0) {
      const inferred = trackCount - this.externalTrackNodes.length;
      if (inferred >= 0) {
        return clamp(inferred, 0, trackCount);
      }
      return trackCount;
    }

    return trackCount;
  },

  syncTrackState() {
    const textTracks = this.getTextTracks();
    if (
      this.subtitleExplicitlyOff &&
      textTracks.some(
        (track) =>
          track.mode !== "disabled" &&
          (!track.kind || ["subtitles", "captions", "forced"].includes(track.kind))
      )
    ) {
      PlayerController.setNativeTextTrack(-1);
    }
    const audioTracks = this.getAudioTracks();
    const dashSubtitleTracks =
      typeof PlayerController.getDashTextTracks === "function"
        ? PlayerController.getDashTextTracks()
        : [];
    const hlsSubtitleTracks =
      typeof PlayerController.getHlsSubtitleTracks === "function"
        ? PlayerController.getHlsSubtitleTracks()
        : [];

    if (!this.externalTrackNodes.length) {
      this.builtInSubtitleCount = textTracks.length;
    } else if (
      (!Number.isFinite(this.builtInSubtitleCount) || this.builtInSubtitleCount <= 0) &&
      textTracks.length > this.externalTrackNodes.length
    ) {
      this.builtInSubtitleCount = textTracks.length - this.externalTrackNodes.length;
    }

    if (this.subtitleExplicitlyOff) {
      this.selectedSubtitleTrackIndex = -1;
    } else if (dashSubtitleTracks.length) {
      const selectedDashSubtitleTrack =
        typeof PlayerController.getSelectedDashTextTrackIndex === "function"
          ? PlayerController.getSelectedDashTextTrackIndex()
          : -1;
      this.selectedSubtitleTrackIndex = Number.isFinite(selectedDashSubtitleTrack)
        ? selectedDashSubtitleTrack
        : -1;
    } else if (hlsSubtitleTracks.length) {
      const selectedHlsSubtitleTrack =
        typeof PlayerController.getSelectedHlsSubtitleTrackIndex === "function"
          ? PlayerController.getSelectedHlsSubtitleTrackIndex()
          : -1;
      this.selectedSubtitleTrackIndex = Number.isFinite(selectedHlsSubtitleTrack)
        ? selectedHlsSubtitleTrack
        : -1;
      this.selectedManifestSubtitleTrackId = null;
    } else {
      const showingIndex = textTracks.findIndex(
        (track) =>
          track?.mode === "showing" &&
          (!track.kind || ["subtitles", "captions", "forced"].includes(track.kind))
      );
      const previous = textTracks[this.selectedSubtitleTrackIndex];
      this.selectedSubtitleTrackIndex =
        showingIndex >= 0
          ? showingIndex
          : previous?.mode === "hidden" &&
              (!previous.kind || ["subtitles", "captions", "forced"].includes(previous.kind))
            ? this.selectedSubtitleTrackIndex
            : -1;
    }

    this.selectedAudioTrackIndex =
      typeof PlayerController.getSelectedBrowserAudioTrackIndex === "function"
        ? PlayerController.getSelectedBrowserAudioTrackIndex()
        : audioTracks.findIndex((track) => Boolean(track?.enabled || track?.selected));
    this.invalidateTrackDialogCaches();
  },

  isSubtitleOffEntrySelected(nativeTrackIndex = this.selectedSubtitleTrackIndex) {
    return (
      this.subtitleExplicitlyOff ||
      (Number(nativeTrackIndex) < 0 &&
        !this.selectedAddonSubtitleId &&
        !this.selectedManifestSubtitleTrackId)
    );
  },

  getSubtitleEntries(tab = this.subtitleDialogTab) {
    const textTracks = this.getTextTracks();
    const dashSubtitleTracks =
      typeof PlayerController.getDashTextTracks === "function"
        ? PlayerController.getDashTextTracks()
        : [];
    const selectedDashSubtitleTrack =
      typeof PlayerController.getSelectedDashTextTrackIndex === "function"
        ? PlayerController.getSelectedDashTextTrackIndex()
        : -1;
    const hlsSubtitleTracks =
      typeof PlayerController.getHlsSubtitleTracks === "function"
        ? PlayerController.getHlsSubtitleTracks()
        : [];
    const selectedHlsSubtitleTrack =
      typeof PlayerController.getSelectedHlsSubtitleTrackIndex === "function"
        ? PlayerController.getSelectedHlsSubtitleTrackIndex()
        : -1;
    const addonTextTracks = new Set(
      (this.externalTrackNodes || []).map((node) => node.track).filter(Boolean)
    );
    const nativeSelectionActive =
      !this.subtitleExplicitlyOff &&
      !this.selectedAddonSubtitleId &&
      !this.selectedManifestSubtitleTrackId;
    const builtInTracks = textTracks.filter((track) => !addonTextTracks.has(track));
    const addonTracks = textTracks.filter((track) => addonTextTracks.has(track));
    const trackDiscoveryPending =
      this.isCurrentSourceAdaptiveManifest() &&
      (this.trackDiscoveryInProgress || this.subtitleLoading || this.manifestLoading);

    if (tab === "builtIn") {
      if (PlayerController.clientRemux || this.relayTextSubtitles) {
        const embedded =
          this.relayTextSubtitles?.tracks() || PlayerController.getClientSubtitleTracks();
        const status =
          this.relayTextSubtitles?.snapshot() || PlayerController.clientRemux.snapshot().subtitle;
        return [
          {
            id: "subtitle-off",
            label: t("subtitle_none", {}, "None"),
            selected: this.isSubtitleOffEntrySelected(
              embedded.some((track) => track.selected) ? 0 : -1
            ),
            trackIndex: -1,
            clientSubtitleId: null
          },
          ...embedded.map((track, index) => {
            const display = formatSubtitleTrackDisplay(track, index);
            return {
              id: "subtitle-client-" + track.id,
              label: display.label,
              language: track.language,
              languageKey: display.languageKey,
              languageLabel: display.languageLabel,
              secondary: [
                track.codec,
                track.selected && status.state === "loading"
                  ? t("player_loading_subtitles", {}, "Fetching subtitles…")
                  : track.selected && status.state === "error"
                    ? t("subtitle_timing_load_lines_failed", {}, "Failed to load subtitle lines.")
                    : ""
              ]
                .filter(Boolean)
                .join(" · "),
              track,
              isForced: track.forced,
              selected: track.selected,
              disabled: !track.supported,
              clientSubtitleId: track.id,
              trackIndex: null
            };
          })
        ];
      }
      if (dashSubtitleTracks.length) {
        return [
          {
            id: "subtitle-off",
            label: t("subtitle_none", {}, "None"),
            secondary: "",
            selected: this.isSubtitleOffEntrySelected(selectedDashSubtitleTrack),
            trackIndex: -1,
            dashSubtitleTrackIndex: -1
          },
          ...dashSubtitleTracks.map((track, index) => {
            const display = formatSubtitleTrackDisplay(track, index);
            return {
              id: `subtitle-dash-${index}-${track?.id ?? ""}`,
              label: display.label,
              language: display.language,
              secondary: display.secondary,
              languageKey: display.languageKey,
              languageLabel: display.languageLabel,
              track,
              isForced: isForcedSubtitleTrack(track),
              selected: nativeSelectionActive && index === selectedDashSubtitleTrack,
              trackIndex: null,
              dashSubtitleTrackIndex: index
            };
          })
        ];
      }

      if (hlsSubtitleTracks.length) {
        return [
          {
            id: "subtitle-off",
            label: t("subtitle_none", {}, "None"),
            secondary: "",
            selected: this.isSubtitleOffEntrySelected(selectedHlsSubtitleTrack),
            trackIndex: -1,
            hlsSubtitleTrackIndex: -1
          },
          ...hlsSubtitleTracks.map((track, index) => {
            const display = formatSubtitleTrackDisplay(track, index);
            return {
              id: `subtitle-hls-${index}-${track?.id ?? track?.name ?? track?.lang ?? ""}`,
              label: display.label,
              language: display.language,
              secondary: display.secondary,
              languageKey: display.languageKey,
              languageLabel: display.languageLabel,
              track,
              isForced: isForcedSubtitleTrack(track),
              selected: nativeSelectionActive && index === selectedHlsSubtitleTrack,
              trackIndex: null,
              hlsSubtitleTrackIndex: index
            };
          })
        ];
      }

      const entries = [
        {
          id: "subtitle-off",
          label: t("subtitle_none", {}, "None"),
          secondary: "",
          selected: this.isSubtitleOffEntrySelected(this.selectedSubtitleTrackIndex),
          trackIndex: -1
        },
        ...builtInTracks
          .map((track) => {
            const index = textTracks.indexOf(track);
            const display = formatSubtitleTrackDisplay(track, index);
            return {
              id: `subtitle-built-${index}`,
              label: display.label,
              language: display.language,
              secondary: display.secondary,
              languageKey: display.languageKey,
              languageLabel: display.languageLabel,
              track,
              isForced: isForcedSubtitleTrack(track),
              selected: nativeSelectionActive && index === this.selectedSubtitleTrackIndex,
              trackIndex: index
            };
          })
          .filter(
            (entry) =>
              !entry.track?.kind || ["subtitles", "captions", "forced"].includes(entry.track.kind)
          ),
        ...this.manifestSubtitleTracks.map((track, index) => {
          const display = formatSubtitleTrackDisplay(track, index);
          return {
            id: `subtitle-manifest-${track.id}`,
            label: display.label,
            language: display.language,
            secondary: display.secondary,
            languageKey: display.languageKey,
            languageLabel: display.languageLabel,
            track,
            isForced: isForcedSubtitleTrack(track),
            selected:
              !this.subtitleExplicitlyOff &&
              !this.selectedAddonSubtitleId &&
              this.selectedManifestSubtitleTrackId === track.id,
            trackIndex: null,
            manifestSubtitleTrackId: track.id
          };
        })
      ];

      if (builtInTracks.length || !trackDiscoveryPending) {
        return entries;
      }

      return [
        ...entries,
        {
          id: "subtitle-builtin-loading",
          label: "Loading subtitle tracks...",
          secondary: "",
          selected: false,
          disabled: true,
          trackIndex: null
        }
      ];
    }

    if (tab === "addons") {
      if (this.subtitles.length) {
        return this.subtitles.map((subtitle, index) => {
          const subtitleId = addonSubtitleSelectionId(subtitle);
          const display = formatSubtitleTrackDisplay(subtitle, index);
          return {
            id: `subtitle-addon-fallback-${subtitleId}`,
            label: display.label,
            language: display.language,
            secondary: subtitle.addonName || t("nav_addons", {}, "Addon"),
            languageKey: display.languageKey,
            languageLabel: display.languageLabel,
            track: subtitle,
            isForced: isForcedAddonSubtitle(subtitle),
            selected: this.selectedAddonSubtitleId === subtitleId,
            trackIndex: null,
            subtitleIndex: index,
            fallbackAddonSubtitle: true
          };
        });
      }
      if (addonTracks.length) {
        return addonTracks.map((track, relativeIndex) => {
          const absoluteIndex = textTracks.indexOf(track);
          const display = formatSubtitleTrackDisplay(track, relativeIndex);
          return {
            id: `subtitle-addon-${absoluteIndex}`,
            label: display.label,
            language: display.language,
            secondary: display.secondary,
            languageKey: display.languageKey,
            languageLabel: display.languageLabel,
            track,
            isForced: isForcedAddonSubtitle(track),
            selected: absoluteIndex === this.selectedSubtitleTrackIndex,
            trackIndex: absoluteIndex
          };
        });
      }
      if (this.subtitleLoading || this.trackDiscoveryInProgress) {
        return [
          {
            id: "subtitle-addon-loading",
            label: "Loading addon subtitles...",
            secondary: "",
            selected: false,
            disabled: true,
            trackIndex: null
          }
        ];
      }
      return [
        {
          id: "subtitle-addon-empty",
          label: this.getUnavailableTrackMessage("subtitle"),
          secondary: "",
          selected: false,
          disabled: true,
          trackIndex: null
        }
      ];
    }

    if (tab === "style") {
      return [
        {
          id: "subtitle-style-default",
          label: t("subtitle_style_defaults", {}, "Default"),
          secondary: "System style",
          selected: true,
          disabled: true,
          trackIndex: null
        }
      ];
    }

    return [
      {
        id: "subtitle-delay-default",
        label: "0.0s",
        secondary: "Delay control not available in web player",
        selected: true,
        disabled: true,
        trackIndex: null
      }
    ];
  },

  collectSubtitleOptionItems() {
    const cachedOptions = this.trackDialogCache?.subtitleOptions;
    if (cachedOptions) {
      return cachedOptions;
    }
    const builtInEntries = this.getSubtitleEntries("builtIn").filter(
      (entry) => !entry?.disabled || entry?.id === "subtitle-off"
    );
    const addonEntries = this.getSubtitleEntries("addons").filter((entry) => !entry?.disabled);
    const options = [];

    builtInEntries.forEach((entry) => {
      if (!entry) {
        return;
      }
      if (entry.id === "subtitle-off") {
        options.push({
          id: entry.id,
          languageKey: SUBTITLE_LANGUAGE_OFF_KEY,
          languageLabel: t("subtitle_none", {}, "Off"),
          title: entry.label,
          secondary: "",
          selected: Boolean(entry.selected),
          sourceType: "off",
          isForced: false,
          entry
        });
        return;
      }
      const languageSource = getSubtitleEntryLanguageSource(entry);
      const languageKey = normalizeSubtitleLanguageKey(languageSource);
      const languageLabel = subtitleLanguageLabel(languageKey);
      const track = entry.track || entry;
      const isForced = Boolean(entry.isForced) || isForcedSubtitleTrack(track);
      const title =
        cleanDisplayText(track?.name) ||
        cleanDisplayText(track?.label) ||
        cleanDisplayText(track?.title) ||
        entry.label ||
        subtitleLabel(options.length);
      const metaParts = [];
      pushUniqueText(
        metaParts,
        track?.codec || track?.codecs || track?.codec_name || track?.format
      );
      if (isForced) {
        pushUniqueText(metaParts, t("sub_forced_lang", {}, "Forced"));
      }
      options.push({
        id: entry.id,
        languageKey,
        languageLabel,
        title,
        sourceLabel: t("subtitle_built_in", {}, "Built in"),
        meta: metaParts.join(" • "),
        secondary: metaParts.join(" • "),
        selected: Boolean(entry.selected),
        sourceType: "internal",
        isForced,
        entry
      });
    });

    addonEntries.forEach((entry) => {
      if (!entry) {
        return;
      }
      const languageSource = getSubtitleEntryLanguageSource(entry);
      const languageKey = normalizeSubtitleLanguageKey(languageSource);
      const languageLabel = subtitleLanguageLabel(languageKey);
      const track = entry.track || entry;
      const isForced = isForcedAddonSubtitle(track);
      const display = normalizeSubtitleForDisplay(track);
      const meta = display.meta;
      options.push({
        id: entry.id,
        languageKey,
        languageLabel,
        title: display.language || languageLabel,
        sourceLabel: display.provider || entry.secondary || t("subtitle_tab_addons", {}, "Addons"),
        meta,
        secondary: meta,
        selected: Boolean(entry.selected),
        sourceType: "addon",
        isForced,
        entry
      });
    });

    this.trackDialogCache.subtitleOptions = options;
    return options;
  },

  getSubtitleMenuOptionItems() {
    const options = this.collectSubtitleOptionItems();
    if (!Environment.isBrowser()) return options;
    // AVFoundation exposes full and forced-only playback options separately.
    // WebKit's caption menu omits forced-only system choices from normal selection:
    // Source/WebCore/page/CaptionUserPreferencesMediaAF.cpp sortedTrackListForMenu.
    // Keep the raw collection intact for startup forced selection and native indices.
    const completeLanguages = new Set(
      options
        .filter(
          (option) =>
            option.sourceType === "internal" &&
            !option.isForced &&
            ["subtitles", "captions"].includes(option.entry?.track?.kind)
        )
        .map((option) => normalizeTrackLanguageCode(option.entry.track.language))
        .filter(Boolean)
    );
    return options.filter((option) => {
      if (
        option.selected ||
        option.sourceType !== "internal" ||
        option.entry?.track?.kind !== "forced"
      )
        return true;
      const language = normalizeTrackLanguageCode(option.entry.track.language);
      return !language || !completeLanguages.has(language);
    });
  },

  getSelectedSubtitleLanguageKey() {
    const selected = this.collectSubtitleOptionItems().find((entry) => entry.selected);
    return selected?.languageKey || SUBTITLE_LANGUAGE_OFF_KEY;
  },

  getSubtitleLanguageRailItems() {
    const cachedLanguageRail = this.trackDialogCache?.subtitleLanguageRail;
    if (cachedLanguageRail) {
      return cachedLanguageRail;
    }
    const options = this.getSubtitleMenuOptionItems?.() || this.collectSubtitleOptionItems();
    const selectedLanguageKey = this.getSelectedSubtitleLanguageKey();
    const groups = new Map();
    options.forEach((option) => {
      if (option.languageKey === SUBTITLE_LANGUAGE_OFF_KEY) {
        return;
      }
      if (!groups.has(option.languageKey)) {
        groups.set(option.languageKey, {
          key: option.languageKey,
          label: option.languageLabel || subtitleLanguageLabel(option.languageKey),
          selected: false,
          count: 0,
          hasInternalTracks: false
        });
      }
      const group = groups.get(option.languageKey);
      group.count += 1;
      group.selected = group.selected || Boolean(option.selected);
      group.hasInternalTracks = group.hasInternalTracks || option.sourceType === "internal";
    });
    groups.set(SUBTITLE_LANGUAGE_OFF_KEY, {
      key: SUBTITLE_LANGUAGE_OFF_KEY,
      label: t("subtitle_none", {}, "Off"),
      selected: selectedLanguageKey === SUBTITLE_LANGUAGE_OFF_KEY,
      count: 0
    });
    const preferredTargets = this.getStartupPreferredSubtitleLanguageTargets();
    const preferredRankCache = new Map();
    const getPreferredRank = (entry) => {
      const key = String(entry?.key || "");
      if (!key || key === SUBTITLE_LANGUAGE_OFF_KEY) {
        return Number.MAX_SAFE_INTEGER;
      }
      if (preferredRankCache.has(key)) {
        return preferredRankCache.get(key);
      }
      const keyBase = key.split("-")[0];
      const rank = preferredTargets.findIndex((target) => {
        const targetKey = String(target || "");
        const targetBase = targetKey.split("-")[0];
        return key === targetKey || (keyBase && targetBase && keyBase === targetBase);
      });
      const resolvedRank = rank >= 0 ? rank : Number.MAX_SAFE_INTEGER;
      preferredRankCache.set(key, resolvedRank);
      return resolvedRank;
    };
    const locale = typeof I18n.getLocale === "function" ? I18n.getLocale() : undefined;
    const matchesPreferredLanguage = (languageKey) =>
      preferredTargets.some(
        (target) => languageKey === target || (languageKey && target.startsWith(`${languageKey}-`))
      );
    const showOnlyPreferredLanguages = Boolean(
      this.subtitleStyleSettings?.showOnlyPreferredLanguages
    );
    const values = Array.from(groups.values())
      .filter(
        (entry) =>
          !showOnlyPreferredLanguages ||
          entry.key === SUBTITLE_LANGUAGE_OFF_KEY ||
          entry.key === selectedLanguageKey ||
          (entry.key === SUBTITLE_LANGUAGE_UNKNOWN_KEY && entry.hasInternalTracks) ||
          matchesPreferredLanguage(entry.key)
      )
      .sort((left, right) => {
        if (left.key === right.key) return 0;
        if (left.key === SUBTITLE_LANGUAGE_OFF_KEY) return -1;
        if (right.key === SUBTITLE_LANGUAGE_OFF_KEY) return 1;
        // Sink the "Unknown" group below the real languages instead of letting
        // its label sort it into the middle of the alphabetical list.
        const leftUnknown = left.key === SUBTITLE_LANGUAGE_UNKNOWN_KEY;
        const rightUnknown = right.key === SUBTITLE_LANGUAGE_UNKNOWN_KEY;
        if (leftUnknown !== rightUnknown) {
          return leftUnknown ? 1 : -1;
        }
        const preferredDelta = getPreferredRank(left) - getPreferredRank(right);
        if (preferredDelta !== 0) {
          return preferredDelta;
        }
        const labelDelta = String(left.label || "").localeCompare(
          String(right.label || ""),
          locale,
          { sensitivity: "base" }
        );
        if (labelDelta !== 0) {
          return labelDelta;
        }
        return String(left.key || "").localeCompare(String(right.key || ""), "en", {
          sensitivity: "base"
        });
      });
    this.trackDialogCache.subtitleLanguageRail = values;
    return values;
  },

  syncSubtitleOptionIndexForFocusedLanguage() {
    const languages = this.getSubtitleLanguageRailItems();
    const activeLanguage =
      languages[this.subtitleLanguageRailIndex]?.key || SUBTITLE_LANGUAGE_OFF_KEY;
    const options = this.getSubtitleOptionsForLanguage(activeLanguage);
    const selectedIndex = options.findIndex((item) => item.selected);
    this.subtitleOptionRailIndex = Math.max(0, selectedIndex >= 0 ? selectedIndex : 0);
  },

  selectSubtitleOption(option, { focusOptions = true } = {}) {
    if (!option?.entry || !option.languageKey || option.languageKey === SUBTITLE_LANGUAGE_OFF_KEY) {
      return false;
    }
    const languages = this.getSubtitleLanguageRailItems();
    const languageIndex = languages.findIndex((item) => item.key === option.languageKey);
    if (languageIndex >= 0) {
      this.subtitleLanguageRailIndex = languageIndex;
    }

    const options = this.getSubtitleOptionsForLanguage(option.languageKey);
    const optionIndex = options.findIndex((item) => item.id === option.id);
    this.subtitleOptionRailIndex = Math.max(0, optionIndex >= 0 ? optionIndex : 0);
    if (focusOptions) {
      this.subtitleFocusedRail = "options";
    }

    this.applySubtitleEntry(option.entry);
    return true;
  },

  selectFirstSubtitleOptionForLanguage(languageKey, { focusOptions = true } = {}) {
    if (!languageKey || languageKey === SUBTITLE_LANGUAGE_OFF_KEY) {
      return false;
    }
    const options = this.getSubtitleOptionsForLanguage(languageKey);
    if (!options.length) {
      return false;
    }
    return this.selectSubtitleOption(options[0], { focusOptions });
  },

  scrollSubtitleRailNodeIntoView(node, { center = false } = {}) {
    if (!(node instanceof HTMLElement)) {
      return;
    }
    const rail = node.closest(".player-subtitle-rail");
    if (!(rail instanceof HTMLElement)) {
      return;
    }
    const margin = 12;
    const viewTop = Number(rail.scrollTop || 0);
    const maxScrollTop = Math.max(
      0,
      Number(rail.scrollHeight || 0) - Number(rail.clientHeight || 0)
    );
    if (maxScrollTop <= 0) {
      return;
    }
    let nextScrollTop = viewTop;

    const railRect =
      typeof rail.getBoundingClientRect === "function"
        ? playerLocalRect(rail, this.browserOrientation)
        : null;
    const nodeRect =
      typeof node.getBoundingClientRect === "function"
        ? playerLocalRect(node, this.browserOrientation)
        : null;
    if (railRect && nodeRect && Number.isFinite(railRect.top) && Number.isFinite(nodeRect.top)) {
      if (center) {
        nextScrollTop =
          viewTop +
          (nodeRect.top - railRect.top) -
          Math.max(0, (rail.clientHeight - node.offsetHeight) / 2);
      } else if (nodeRect.top < railRect.top + margin) {
        nextScrollTop = viewTop - (railRect.top + margin - nodeRect.top);
      } else if (nodeRect.bottom > railRect.bottom - margin) {
        nextScrollTop = viewTop + (nodeRect.bottom - (railRect.bottom - margin));
      }
    } else {
      const nodeTop = Number(node.offsetTop || 0);
      const nodeBottom = nodeTop + Number(node.offsetHeight || 0);
      const viewBottom = viewTop + Number(rail.clientHeight || 0);
      if (center) {
        nextScrollTop =
          nodeTop -
          Math.max(0, (Number(rail.clientHeight || 0) - Number(node.offsetHeight || 0)) / 2);
      } else if (nodeTop < viewTop + margin) {
        nextScrollTop = nodeTop - margin;
      } else if (nodeBottom > viewBottom - margin) {
        nextScrollTop = nodeBottom - Number(rail.clientHeight || 0) + margin;
      }
    }
    if (nextScrollTop !== viewTop) {
      rail.scrollTop = Math.max(0, Math.min(maxScrollTop, Math.round(nextScrollTop)));
    }
  },

  scheduleSubtitleDialogScrollIntoView() {
    if (this.subtitleDialogScrollTimer) {
      clearTimeout(this.subtitleDialogScrollTimer);
      this.subtitleDialogScrollTimer = null;
    }
    this.subtitleDialogScrollTimer = setTimeout(() => {
      this.subtitleDialogScrollTimer = null;
      if (this.hasActiveSubtitlePointerScrollTransaction()) {
        return;
      }
      this.scrollSubtitleDialogIntoView();
    }, 0);
  },

  scrollSubtitleDialogIntoView() {
    if (Environment.isBrowser() && !this.subtitleKeyboardNavigation) return;
    const dialog = this.uiRefs?.subtitleDialog;
    if (!dialog || !this.subtitleDialogVisible) {
      return;
    }
    const selectedLanguageNode = dialog.querySelector(
      ".player-subtitle-language-rail .player-dialog-item.selected"
    );
    const focusedLanguageNode = dialog.querySelector(
      ".player-subtitle-language-rail .player-dialog-item.focused"
    );
    const languageNode = focusedLanguageNode || selectedLanguageNode;
    const optionNode = dialog.querySelector(
      ".player-subtitle-options-rail .player-dialog-item.focused"
    );
    const styleNode = dialog.querySelector(
      ".player-subtitle-style-rail .player-dialog-item.focused"
    );

    if (this.subtitleFocusedRail === "language") {
      this.scrollSubtitleRailNodeIntoView(languageNode);
    } else if (this.subtitleFocusedRail === "options") {
      this.scrollSubtitleRailNodeIntoView(optionNode);
    } else {
      this.scrollSubtitleRailNodeIntoView(styleNode);
    }
    this.subtitleDialogScrollMode = "nearest";
  },

  preserveSubtitlePointerOptionScroll(target) {
    if (!Environment.isBrowser() || !this.subtitleDialogVisible) {
      return false;
    }
    const option = target?.closest?.("[data-subtitle-rail='options']");
    const rail = option?.closest?.(".player-subtitle-options-rail");
    if (!(option instanceof HTMLElement) || !(rail instanceof HTMLElement)) {
      return false;
    }
    this.cancelSubtitlePointerScrollTransaction();
    this.subtitlePointerScrollTransaction = {
      scrollTop: Number(rail.scrollTop || 0),
      selectionToken: null,
      rail: null,
      removeScrollListener: null
    };
    if (this.subtitleDialogScrollTimer) {
      clearTimeout(this.subtitleDialogScrollTimer);
      this.subtitleDialogScrollTimer = null;
    }
    return true;
  },

  hasActiveSubtitlePointerScrollTransaction() {
    return Boolean(Environment.isBrowser() && this.subtitlePointerScrollTransaction);
  },

  bindSubtitlePointerScrollTransactionRail(rail) {
    const transaction = this.subtitlePointerScrollTransaction;
    if (!transaction || !(rail instanceof HTMLElement)) {
      return;
    }
    transaction.removeScrollListener?.();
    const onScroll = () => {
      if (this.subtitlePointerScrollTransaction === transaction) {
        transaction.scrollTop = Number(rail.scrollTop || 0);
      }
    };
    rail.addEventListener("scroll", onScroll, { passive: true });
    transaction.rail = rail;
    transaction.removeScrollListener = () => rail.removeEventListener("scroll", onScroll);
  },

  settleSubtitlePointerScrollTransaction(selectionToken = null) {
    const transaction = this.subtitlePointerScrollTransaction;
    if (
      !transaction ||
      (selectionToken != null &&
        transaction.selectionToken != null &&
        Number(transaction.selectionToken) !== Number(selectionToken))
    ) {
      return;
    }
    this.cancelSubtitlePointerScrollTransaction();
  },

  cancelSubtitlePointerScrollTransaction() {
    const transaction = this.subtitlePointerScrollTransaction;
    transaction?.removeScrollListener?.();
    this.subtitlePointerScrollTransaction = null;
  },

  getSubtitleOptionsForLanguage(languageKey = this.getSelectedSubtitleLanguageKey()) {
    const normalizedLanguageKey = languageKey || SUBTITLE_LANGUAGE_OFF_KEY;
    const optionsByLanguage = this.trackDialogCache?.subtitleOptionsByLanguage;
    if (optionsByLanguage?.has(normalizedLanguageKey)) {
      return optionsByLanguage.get(normalizedLanguageKey);
    }
    const sourceRank = { internal: 0, addon: 1, off: 2 };
    const locale = typeof I18n.getLocale === "function" ? I18n.getLocale() : undefined;
    const filteredOptions = (
      this.getSubtitleMenuOptionItems?.() || this.collectSubtitleOptionItems()
    )
      .filter(
        (entry) =>
          entry.languageKey === normalizedLanguageKey &&
          entry.languageKey !== SUBTITLE_LANGUAGE_OFF_KEY
      )
      .sort((left, right) => {
        const sourceDelta =
          (sourceRank[left.sourceType] ?? 99) - (sourceRank[right.sourceType] ?? 99);
        if (sourceDelta !== 0) {
          return sourceDelta;
        }
        const secondaryDelta = String(left.secondary || "").localeCompare(
          String(right.secondary || ""),
          locale,
          { sensitivity: "base" }
        );
        if (secondaryDelta !== 0) {
          return secondaryDelta;
        }
        return String(left.title || "").localeCompare(String(right.title || ""), locale, {
          sensitivity: "base"
        });
      });
    optionsByLanguage?.set(normalizedLanguageKey, filteredOptions);
    return filteredOptions;
  },

  isTrackDiscoveryWindowPending() {
    return Number(this.trackDiscoveryDeadline || 0) > Date.now();
  },

  isAudioPreferenceDiscoveryPending() {
    return Boolean(
      this.manifestLoading ||
      this.trackDiscoveryInProgress ||
      (!this.getAudioEntries().length && this.isTrackDiscoveryWindowPending())
    );
  },

  clearStartupAudioPreferenceRetry() {
    if (this.startupAudioPreferenceRetryTimer) {
      clearTimeout(this.startupAudioPreferenceRetryTimer);
      this.startupAudioPreferenceRetryTimer = null;
    }
    this.startupAudioPreferenceRetryDeadline = 0;
  },

  isSubtitlePreferenceDiscoveryPending() {
    const hasSubtitleOptions = this.collectSubtitleOptionItems().some(
      (entry) => entry.languageKey !== SUBTITLE_LANGUAGE_OFF_KEY
    );
    return Boolean(
      this.subtitleLoading ||
      this.manifestLoading ||
      this.trackDiscoveryInProgress ||
      (!hasSubtitleOptions && this.isTrackDiscoveryWindowPending())
    );
  },

  getStartupPreferredSubtitleLanguageKey() {
    const settings = PlayerSettingsStore.get();
    if (!settings.subtitlesEnabled) {
      return SUBTITLE_LANGUAGE_OFF_KEY;
    }

    const configured = extractSubtitleLanguageSetting(
      settings.subtitleStyle?.preferredLanguage || settings.subtitleLanguage || "off"
    )
      .trim()
      .toLowerCase();
    if (!configured || configured === "off" || configured === "none" || configured === "forced") {
      return SUBTITLE_LANGUAGE_OFF_KEY;
    }

    if (configured === "system") {
      const locale =
        typeof I18n.getLocale === "function"
          ? I18n.getLocale()
          : globalThis.navigator?.language || "";
      const systemLanguage = normalizeTrackLanguageCode(locale);
      return systemLanguage
        ? normalizeSubtitleLanguageKey(systemLanguage)
        : SUBTITLE_LANGUAGE_OFF_KEY;
    }

    return normalizeSubtitleLanguageKey(configured);
  },

  getStartupPreferredSubtitleLanguageTargets() {
    const settings = PlayerSettingsStore.get();
    if (!settings.subtitlesEnabled) {
      return [];
    }

    const values = [
      settings.subtitleStyle?.preferredLanguage || settings.subtitleLanguage || "off",
      settings.subtitleStyle?.secondaryPreferredLanguage ||
        settings.secondarySubtitleLanguage ||
        "off"
    ];

    const targets = values
      .map((value) => {
        const configured = String(value || "off")
          .trim()
          .toLowerCase();
        if (
          !configured ||
          configured === "off" ||
          configured === "none" ||
          configured === "forced"
        ) {
          return "";
        }
        if (configured === "system") {
          const locale =
            typeof I18n.getLocale === "function"
              ? I18n.getLocale()
              : globalThis.navigator?.language || "";
          return normalizeSubtitleLanguageKey(normalizeTrackLanguageCode(locale) || "");
        }
        return normalizeSubtitleLanguageKey(configured);
      })
      .filter(Boolean);

    return Array.from(new Set(targets));
  },

  getStartupAutoSelectSubtitleLanguageTargets() {
    // Android treats a primary "None" as no normal auto-selection target;
    // the secondary language remains useful for filtering/loading only.
    if (this.getStartupPreferredSubtitleLanguageKey() === SUBTITLE_LANGUAGE_OFF_KEY) {
      return [];
    }
    return this.getStartupPreferredSubtitleLanguageTargets();
  },

  shouldUseStartupForcedSubtitles(settings = PlayerSettingsStore.get()) {
    const preferred = extractSubtitleLanguageSetting(
      settings.subtitleStyle?.preferredLanguage || settings.subtitleLanguage || "off"
    )
      .trim()
      .toLowerCase();
    const secondary = extractSubtitleLanguageSetting(
      settings.subtitleStyle?.secondaryPreferredLanguage ||
        settings.secondarySubtitleLanguage ||
        "off"
    )
      .trim()
      .toLowerCase();
    return (
      Boolean(settings.subtitleStyle?.useForcedSubtitles || settings.useForcedSubtitles) ||
      preferred === "forced" ||
      secondary === "forced"
    );
  },

  getStartupForcedSubtitleLanguageTarget() {
    const settings = PlayerSettingsStore.get();
    if (!settings.subtitlesEnabled || !this.shouldUseStartupForcedSubtitles(settings)) {
      return null;
    }

    const explicitTargets = this.getStartupAutoSelectSubtitleLanguageTargets();
    const selectedAudioOption = this.collectAudioOptionItems().find(
      (entry) => entry.selected && entry.languageKey
    );
    const primaryTarget = explicitTargets[0] || null;
    if (
      primaryTarget &&
      selectedAudioOption &&
      this.matchesStartupAudioTargetForForced(selectedAudioOption, primaryTarget)
    ) {
      return primaryTarget;
    }

    const preferredAudioTargets = this.getStartupPreferredAudioLanguageTargets();
    if (
      !primaryTarget &&
      selectedAudioOption &&
      preferredAudioTargets.some((target) =>
        this.matchesStartupAudioTarget(selectedAudioOption, target)
      )
    ) {
      return selectedAudioOption.languageKey;
    }

    return null;
  },

  getStartupSubtitlePreferenceMode() {
    const settings = PlayerSettingsStore.get();
    if (!settings.subtitlesEnabled) {
      return "off";
    }
    if (this.shouldUseStartupForcedSubtitles(settings)) {
      return "audio-forced";
    }
    const explicitTargets = this.getStartupAutoSelectSubtitleLanguageTargets();
    if (explicitTargets.length) {
      return "language";
    }
    return "off";
  },

  getStartupPreferredAudioLanguageTargets() {
    const settings = PlayerSettingsStore.get();
    const primary = String(settings.preferredAudioLanguage || "system")
      .trim()
      .toLowerCase();
    const secondary = String(settings.secondaryPreferredAudioLanguage || "none")
      .trim()
      .toLowerCase();
    const originalLanguage = normalizeTrackLanguageCode(this.contentLanguage);
    const systemLanguage = this.getStartupSystemAudioLanguageTarget();
    const resolve = (configured, { primaryPreference = false } = {}) => {
      if (!configured || ["default", "off", "none", "forced"].includes(configured)) {
        return "";
      }
      if (configured === "system" || configured === "device") {
        return primaryPreference ? systemLanguage : "";
      }
      if (configured === "original") {
        return originalLanguage || (primaryPreference ? systemLanguage : "");
      }
      return normalizeTrackLanguageCode(configured);
    };

    return Array.from(
      new Set([resolve(primary, { primaryPreference: true }), resolve(secondary)].filter(Boolean))
    );
  },

  getStartupSystemAudioLanguageTarget() {
    const locale =
      typeof I18n.getLocale === "function"
        ? I18n.getLocale()
        : globalThis.navigator?.language || "";
    return normalizeTrackLanguageCode(locale);
  },

  collectAudioOptionItems() {
    return this.getAudioEntries().map((entry, index) => {
      const track = entry?.track || {};
      const languageKey = inferAudioTrackLanguageKey(track, entry);
      return {
        id: entry?.id || `audio-option-${index}`,
        label: cleanDisplayText(entry?.label || ""),
        secondary: cleanDisplayText(entry?.secondary || ""),
        selected: Boolean(entry?.selected),
        supported: entry?.supported !== false,
        languageKey,
        languageLabel: getAudioTrackLanguageLabel(track, entry),
        entry,
        entryIndex: index
      };
    });
  },

  matchesStartupAudioTarget(option, target) {
    if (!option || !target) {
      return false;
    }
    if (option.languageKey === target) {
      return true;
    }
    const targetBase = String(target).split("-")[0];
    const optionBase = String(option.languageKey || "").split("-")[0];
    if (targetBase && optionBase && targetBase === optionBase) {
      return true;
    }
    const targetLabel = normalizeComparableText(getTrackLanguageLabel({ language: target }) || "");
    if (!targetLabel) {
      return false;
    }
    return [option.languageLabel, option.label, option.secondary]
      .map((value) => normalizeComparableText(value))
      .some((value) => value === targetLabel);
  },

  matchesStartupAudioTargetForForced(option, target) {
    if (!option || !target) {
      return false;
    }
    const normalizedTarget =
      normalizeTrackLanguageCode(target) || String(target).trim().toLowerCase();
    const optionLanguage =
      normalizeTrackLanguageCode(option.languageKey) ||
      String(option.languageKey || "")
        .trim()
        .toLowerCase();
    if (optionLanguage === normalizedTarget) {
      return true;
    }
    const targetBase = normalizedTarget.split("-")[0];
    if (targetBase && targetBase !== normalizedTarget) {
      return optionLanguage === targetBase;
    }
    return this.matchesStartupAudioTarget(option, normalizedTarget);
  },

  findStartupPreferredAudioOption(targets = this.getStartupPreferredAudioLanguageTargets()) {
    const normalizedTargets = Array.isArray(targets) ? targets.filter(Boolean) : [];
    if (!normalizedTargets.length) {
      return null;
    }
    const options = this.collectAudioOptionItems();
    for (const target of normalizedTargets) {
      const exactOption = options.find((entry) => entry.supported && entry.languageKey === target);
      if (exactOption) {
        return exactOption;
      }
      const matchingOption = options.find(
        (entry) => entry.supported && this.matchesStartupAudioTarget(entry, target)
      );
      if (matchingOption) {
        return matchingOption;
      }
    }
    return null;
  },

  applyStartupAudioPreference() {
    if (this.startupAudioPreferenceApplied || this.startupAudioPreferenceApplying) {
      return false;
    }

    const preferredTargets = this.getStartupPreferredAudioLanguageTargets();
    const isStillLoading = this.isAudioPreferenceDiscoveryPending();
    const matchedRememberedOption = this.findRememberedAudioOption();
    const rememberedOption = matchedRememberedOption;
    if (rememberedOption?.entry && Number.isFinite(rememberedOption.entryIndex)) {
      this.startupAudioFallbackApplied = false;
      if (rememberedOption.selected) {
        this.clearStartupAudioPreferenceRetry();
        this.startupAudioPreferenceApplied = true;
        return true;
      }
      this.startupAudioPreferenceApplying = true;
      try {
        this.applyAudioTrack(rememberedOption.entryIndex);
      } finally {
        this.startupAudioPreferenceApplying = false;
      }
      if (this.findRememberedAudioOption()?.selected) {
        this.clearStartupAudioPreferenceRetry();
        this.startupAudioPreferenceApplied = true;
        return true;
      }
    } else if (this.rememberedAudioTrackPreference && isStillLoading) {
      if (this.isAudioPreferenceDiscoveryPending()) {
        return false;
      }
    }
    if (!preferredTargets.length) {
      this.clearStartupAudioPreferenceRetry();
      this.startupAudioFallbackApplied = false;
      this.startupAudioPreferenceApplied = true;
      return true;
    }

    const selectedOption = this.collectAudioOptionItems().find((entry) => entry.selected);
    if (
      selectedOption?.supported &&
      preferredTargets.some((target) => this.matchesStartupAudioTarget(selectedOption, target))
    ) {
      this.clearStartupAudioPreferenceRetry();
      this.startupAudioFallbackApplied = false;
      this.startupAudioPreferenceApplied = true;
      return true;
    }

    const matchedPreferredOption = this.findStartupPreferredAudioOption(preferredTargets);
    const preferredOption = matchedPreferredOption;
    if (!preferredOption?.entry || !Number.isFinite(preferredOption.entryIndex)) {
      if (isStillLoading) {
        if (this.isAudioPreferenceDiscoveryPending()) {
          return false;
        }
      }
      return this.applyStartupAudioFallback();
    }

    this.startupAudioPreferenceApplying = true;
    this.startupAudioFallbackApplied = false;
    try {
      this.applyAudioTrack(preferredOption.entryIndex);
    } finally {
      this.startupAudioPreferenceApplying = false;
    }

    const appliedOption = this.collectAudioOptionItems().find((entry) => entry.selected);
    const applied = Boolean(
      appliedOption?.supported &&
      preferredTargets.some((target) => this.matchesStartupAudioTarget(appliedOption, target))
    );
    this.startupAudioPreferenceApplied = applied;
    if (applied) {
      this.clearStartupAudioPreferenceRetry();
    } else if (!this.isAudioPreferenceDiscoveryPending()) {
      return this.applyStartupAudioFallback();
    }
    return applied;
  },

  applyStartupAudioFallback() {
    this.clearStartupAudioPreferenceRetry();
    this.startupAudioFallbackApplied = true;
    const fallbackOption = selectStartupAudioFallbackOption(this.collectAudioOptionItems());
    if (!fallbackOption?.entry || !Number.isFinite(fallbackOption.entryIndex)) {
      this.startupAudioPreferenceApplied = true;
      return true;
    }

    if (!fallbackOption.selected) {
      this.startupAudioPreferenceApplying = true;
      try {
        this.applyAudioTrack(fallbackOption.entryIndex, { automaticFallback: true });
      } finally {
        this.startupAudioPreferenceApplying = false;
      }
    }

    // The preferred language is unavailable or discovery hit its bounded limit.
    // If the runtime cannot expose/select tracks, its default first track remains
    // the fallback instead of keeping startup muted indefinitely.
    this.startupAudioPreferenceApplied = true;
    return true;
  },

  findStartupPreferredSubtitleOption(
    targets = this.getStartupAutoSelectSubtitleLanguageTargets(),
    mode = "language"
  ) {
    const normalizedTargets = Array.isArray(targets) ? targets.filter(Boolean) : [];
    if (!normalizedTargets.length) {
      return null;
    }

    const options = this.collectSubtitleOptionItems().filter(
      (entry) => entry.languageKey !== SUBTITLE_LANGUAGE_OFF_KEY
    );
    const matchTarget = (entry, target) => this.matchesStartupSubtitleTarget(entry, target);
    const findMatch = (target, { sourceType = null, forced = null } = {}) =>
      options.find((entry) => {
        if (sourceType && entry.sourceType !== sourceType) {
          return false;
        }
        if (forced === true && !entry.isForced) {
          return false;
        }
        if (forced === false && entry.isForced) {
          return false;
        }
        return forced === true
          ? this.matchesStartupSubtitleTargetForForced(entry, target)
          : matchTarget(entry, target);
      });

    for (const target of normalizedTargets) {
      if (mode === "audio-forced") {
        const forcedInternal = findMatch(target, { sourceType: "internal", forced: true });
        if (forcedInternal) return forcedInternal;
        const forcedAddon = findMatch(target, { sourceType: "addon", forced: true });
        if (forcedAddon) return forcedAddon;
        continue;
      }

      const internalMatch = findMatch(target, { sourceType: "internal", forced: false });
      if (internalMatch) return internalMatch;
      const addonMatch = findMatch(target, { sourceType: "addon", forced: false });
      if (addonMatch) return addonMatch;
    }

    return null;
  },

  matchesStartupSubtitleTarget(entry, target) {
    if (!entry || !target) {
      return false;
    }
    if (target === "forced") {
      return Boolean(entry.isForced);
    }
    if (entry.languageKey === target) {
      return true;
    }
    const targetBase = String(target).split("-")[0];
    const entryBase = String(entry.languageKey || "").split("-")[0];
    if (targetBase && entryBase && targetBase === entryBase) {
      return true;
    }
    const normalizedTitle = normalizeComparableText(entry.title || "");
    const normalizedLabel = normalizeComparableText(entry.languageLabel || "");
    const targetLabel = normalizeComparableText(subtitleLanguageLabel(target));
    return Boolean(
      targetLabel && (normalizedTitle === targetLabel || normalizedLabel === targetLabel)
    );
  },

  matchesStartupSubtitleTargetForForced(entry, target) {
    if (!entry || !target) {
      return false;
    }
    const normalizedTarget = normalizeSubtitleLanguageKey(target);
    const entryLanguage = normalizeSubtitleLanguageKey(entry.languageKey);
    if (entryLanguage === normalizedTarget) {
      return true;
    }
    if (normalizedTarget.includes("-")) {
      return false;
    }
    return this.matchesStartupSubtitleTarget(entry, normalizedTarget);
  },

  applyStartupSubtitlePreference() {
    if (
      this.subtitleExplicitlyOff ||
      this.startupSubtitlePreferenceApplied ||
      this.startupSubtitlePreferenceApplying
    ) {
      return false;
    }

    const configuredPreferenceMode = this.getStartupSubtitlePreferenceMode();
    const preferredSubtitleTargets = this.getStartupAutoSelectSubtitleLanguageTargets();
    if (
      configuredPreferenceMode !== "off" &&
      !this.startupAudioPreferenceApplied &&
      this.isAudioPreferenceDiscoveryPending()
    ) {
      return false;
    }
    const forcedTarget =
      configuredPreferenceMode === "audio-forced"
        ? this.getStartupForcedSubtitleLanguageTarget()
        : null;
    // Match Android TV: forced-only applies when the selected audio already
    // matches the subtitle language; foreign audio uses normal subtitles.
    const preferenceMode =
      configuredPreferenceMode === "audio-forced" && !forcedTarget
        ? "language"
        : configuredPreferenceMode;
    const preferredTargets =
      preferenceMode === "audio-forced"
        ? forcedTarget
          ? [forcedTarget]
          : preferredSubtitleTargets
        : preferredSubtitleTargets;
    const isStillLoading = this.isSubtitlePreferenceDiscoveryPending();

    if (
      this.shouldUseStartupForcedSubtitles() &&
      !this.collectAudioOptionItems().some((entry) => entry.selected && entry.languageKey) &&
      this.isAudioPreferenceDiscoveryPending()
    ) {
      return false;
    }

    if (preferenceMode === "off") {
      if (
        this.selectedSubtitleTrackIndex >= 0 ||
        this.selectedAddonSubtitleId ||
        this.selectedManifestSubtitleTrackId
      ) {
        const offEntry = this.getSubtitleEntries("builtIn").find(
          (entry) => entry.id === "subtitle-off"
        ) || { trackIndex: -1 };
        this.startupSubtitlePreferenceApplying = true;
        try {
          this.applySubtitleEntry(offEntry);
        } finally {
          this.startupSubtitlePreferenceApplying = false;
        }
        this.startupSubtitlePreferenceApplied = true;
        return true;
      }
      if (!isStillLoading) {
        this.startupSubtitlePreferenceApplied = true;
        return true;
      }
      return false;
    }

    const selectedOption = this.collectSubtitleOptionItems().find(
      (entry) => entry.selected && entry.languageKey !== SUBTITLE_LANGUAGE_OFF_KEY
    );
    const preferredOption = this.findStartupPreferredSubtitleOption(
      preferredTargets,
      preferenceMode
    );
    if (selectedOption && preferredOption?.id === selectedOption.id) {
      this.startupSubtitlePreferenceApplied = true;
      return true;
    }

    if (!preferredOption?.entry) {
      if (!isStillLoading) {
        if (preferenceMode === "audio-forced" || selectedOption) {
          const offEntry = this.getSubtitleEntries("builtIn").find(
            (entry) => entry.id === "subtitle-off"
          ) || { trackIndex: -1 };
          this.startupSubtitlePreferenceApplying = true;
          try {
            this.applySubtitleEntry(offEntry);
          } finally {
            this.startupSubtitlePreferenceApplying = false;
          }
        }
        this.startupSubtitlePreferenceApplied = true;
        return true;
      }
      return false;
    }

    this.startupSubtitlePreferenceApplying = true;
    try {
      this.selectSubtitleOption(preferredOption, { focusOptions: false });
    } finally {
      this.startupSubtitlePreferenceApplying = false;
    }

    const appliedOption = this.collectSubtitleOptionItems().find(
      (entry) => entry.selected && entry.languageKey !== SUBTITLE_LANGUAGE_OFF_KEY
    );
    const applied = Boolean(
      appliedOption &&
      preferredTargets.some((target) => this.matchesStartupSubtitleTarget(appliedOption, target))
    );
    this.startupSubtitlePreferenceApplied = applied;
    return applied;
  },

  getSubtitleStyleControls() {
    const style = this.subtitleStyleSettings || {};
    return [
      {
        id: "delay",
        label: t("subtitle_tab_delay", {}, "Delay"),
        value: formatSubtitleDelay(this.subtitleDelayMs)
      },
      {
        id: "resetDelay",
        label: t("subtitle_delay_reset", {}, "Reset Delay"),
        value: ""
      },
      {
        id: "fontSize",
        label: t("subtitle_style_font_size", {}, "Font Size"),
        value: `${normalizeSubtitleFontSize(style.fontSize)}%`
      },
      {
        id: "bold",
        label: t("subtitle_style_bold", {}, "Bold"),
        value: style.bold ? t("subtitle_style_on", {}, "On") : t("subtitle_style_off", {}, "Off")
      },
      {
        id: "textColor",
        label: t("subtitle_style_text_color", {}, "Text Color"),
        value: styleChipLabel(style.textColor || "#FFFFFF")
      },
      {
        id: "outlineEnabled",
        label: t("subtitle_style_outline", {}, "Outline"),
        value: style.outlineEnabled
          ? t("subtitle_style_on", {}, "On")
          : t("subtitle_style_off", {}, "Off")
      },
      {
        id: "outlineColor",
        label: t("subtitle_style_outline_color", {}, "Outline Color"),
        value: styleChipLabel(style.outlineColor || "#000000")
      },
      {
        id: "verticalOffset",
        label: t("subtitle_style_bottom_offset", {}, "Bottom Offset"),
        value: formatSubtitleVerticalOffset(style.verticalOffset)
      },
      { id: "reset", label: t("subtitle_style_defaults", {}, "Reset Defaults"), value: "" }
    ];
  },

  schedulePersistPlayerPresentationSettings(delayMs = 400) {
    clearTimeout(this.persistSettingsTimer);
    this.persistSettingsTimer = setTimeout(() => {
      this.persistSettingsTimer = null;
      this.persistPlayerPresentationSettings();
    }, delayMs);
  },

  flushPersistPlayerPresentationSettings() {
    if (this.persistSettingsTimer) {
      clearTimeout(this.persistSettingsTimer);
      this.persistSettingsTimer = null;
      this.persistPlayerPresentationSettings();
    }
  },

  renderSubtitleStyleControlInPlace(controlId) {
    const dialog = this.uiRefs?.subtitleDialog;
    if (!dialog || !this.subtitleDialogVisible) return false;
    const styleControls = this.getSubtitleStyleControls();
    const items =
      controlId === "reset" ? styleControls : styleControls.filter((c) => c.id === controlId);
    items.forEach((item) => {
      const subNode = dialog
        .querySelector(`button[data-style-id="${item.id}"]`)
        ?.closest(".player-dialog-style-item")
        ?.querySelector(".player-dialog-item-sub");
      if (subNode) subNode.textContent = item.value || "";
    });
    return items.length > 0;
  },

  adjustSubtitleStyleControl(controlId, delta = 0, { isRepeat = false } = {}) {
    const activeControl = this.getSubtitleStyleControls().find((item) => item.id === controlId);
    if (!activeControl || activeControl.disabled) {
      return false;
    }
    const style = { ...(this.subtitleStyleSettings || {}) };
    if (controlId === "delay") {
      this.subtitleDelayMs = clamp(
        Number(this.subtitleDelayMs || 0) + delta * SUBTITLE_DELAY_STEP_MS,
        SUBTITLE_DELAY_MIN_MS,
        SUBTITLE_DELAY_MAX_MS
      );
    } else if (controlId === "resetDelay") {
      this.subtitleDelayMs = 0;
    } else if (controlId === "fontSize") {
      style.fontSize = normalizeSubtitleFontSize(
        Number(style.fontSize || 120) + delta * SUBTITLE_FONT_STEP
      );
    } else if (controlId === "bold" && delta !== 0) {
      style.bold = !style.bold;
    } else if (controlId === "textColor" && delta !== 0) {
      const currentIndex = Math.max(
        0,
        SUBTITLE_TEXT_COLORS.indexOf(String(style.textColor || "#FFFFFF").toUpperCase())
      );
      style.textColor =
        SUBTITLE_TEXT_COLORS[clamp(currentIndex + delta, 0, SUBTITLE_TEXT_COLORS.length - 1)];
    } else if (controlId === "outlineEnabled" && delta !== 0) {
      style.outlineEnabled = !style.outlineEnabled;
    } else if (controlId === "outlineColor" && delta !== 0) {
      const currentIndex = Math.max(
        0,
        SUBTITLE_OUTLINE_COLORS.indexOf(String(style.outlineColor || "#000000").toUpperCase())
      );
      style.outlineColor =
        SUBTITLE_OUTLINE_COLORS[clamp(currentIndex + delta, 0, SUBTITLE_OUTLINE_COLORS.length - 1)];
    } else if (controlId === "verticalOffset") {
      style.verticalOffset = normalizeSubtitleVerticalOffset(
        Number(style.verticalOffset ?? SUBTITLE_VERTICAL_OFFSET_DEFAULT) +
          delta * SUBTITLE_VERTICAL_OFFSET_STEP
      );
    } else if (controlId === "reset") {
      const defaults = PlayerSettingsStore.getDefaults().subtitleStyle;
      this.subtitleDelayMs = 0;
      this.subtitleStyleSettings = {
        ...style,
        fontSize: defaults.fontSize,
        textColor: defaults.textColor,
        bold: defaults.bold,
        outlineEnabled: defaults.outlineEnabled,
        outlineColor: defaults.outlineColor,
        verticalOffset: defaults.verticalOffset,
        verticalOffsetContract: defaults.verticalOffsetContract
      };
    }

    if (controlId !== "delay" && controlId !== "reset") {
      this.subtitleStyleSettings = style;
    }
    this.schedulePersistPlayerPresentationSettings();
    this.applySubtitlePresentationSettings({ refreshTrackRendering: !isRepeat });
    if (!this.renderSubtitleStyleControlInPlace(controlId)) {
      this.renderSubtitleDialog();
    }
    return true;
  },

  getSubtitleStyleControlDelta(side = this.subtitleStyleControlSide) {
    return String(side || "").toLowerCase() === "plus" ? 1 : -1;
  },
  openSubtitleDialog() {
    if (Environment.isBrowser()) {
      if (this.episodePanelVisible) this.hideEpisodePanel();
      this.moreActionsVisible = false;
      this.renderCompactBrowserMorePanel?.();
    }

    this.subtitleKeyboardNavigation = false;
    this.proposalSubtitleStyleVisible = false;
    this.proposalSubtitleLanguageFilter = "all";
    this.proposalSubtitleLanguagePickerOpen = false;
    this.cancelSeekPreview({ commit: false });
    this.syncTrackState();
    this.subtitleDialogVisible = true;
    void this.loadDirectTrackData();
    this.audioDialogVisible = false;
    this.speedDialogVisible = false;
    this.sourcesPanelVisible = false;
    const languageRail = this.getSubtitleLanguageRailItems();
    const selectedLanguageKey = this.getSelectedSubtitleLanguageKey();
    this.subtitleLanguageRailIndex = Math.max(
      0,
      languageRail.findIndex((item) => item.key === selectedLanguageKey)
    );
    this.syncSubtitleOptionIndexForFocusedLanguage();
    this.subtitleStyleRailIndex = 0;
    this.subtitleStyleControlSide = "minus";
    this.subtitleFocusedRail =
      selectedLanguageKey === SUBTITLE_LANGUAGE_OFF_KEY ? "language" : "options";
    this.subtitleDialogScrollMode = "start";
    this.setControlsVisible(true, { focus: false });
    this.renderSubtitleDialog();
    this.renderAudioDialog();
    this.renderSpeedDialog();
    this.renderSourcesPanel();
    this.updateModalBackdrop();
  },

  closeSubtitleDialog() {
    this.flushPersistPlayerPresentationSettings();
    this.subtitleDialogVisible = false;
    this.cancelSubtitlePointerScrollTransaction();
    this.subtitleFocusedRail = "language";
    this.subtitleStyleControlSide = "minus";
    this.renderSubtitleDialog();
    this.updateModalBackdrop();
    this.resetControlsAutoHide();
  },

  cycleSubtitleTab(delta) {
    const tabs = this.getSubtitleTabs();
    const index = tabs.findIndex((tab) => tab.id === this.subtitleDialogTab);
    const nextIndex = clamp(index + delta, 0, tabs.length - 1);
    this.subtitleDialogTab = tabs[nextIndex].id;
    const entries = this.getSubtitleEntries(this.subtitleDialogTab);
    const selected = entries.findIndex((entry) => entry.selected);
    this.subtitleDialogIndex = Math.max(0, selected >= 0 ? selected : 0);
    this.renderSubtitleDialog();
  },

  getActiveSubtitleSelectionKey() {
    if (this.selectedAddonSubtitleId) {
      return `addon:${String(this.selectedAddonSubtitleId)}`;
    }
    if (this.selectedManifestSubtitleTrackId) {
      return `manifest:${String(this.selectedManifestSubtitleTrackId)}`;
    }
    const embedded = (
      this.relayTextSubtitles?.tracks() || PlayerController.getClientSubtitleTracks()
    ).find((track) => track.selected);
    if (embedded) return `embedded:${embedded.id}`;
    if (Number(this.selectedSubtitleTrackIndex) >= 0) {
      return `native:${Number(this.selectedSubtitleTrackIndex)}`;
    }
    return "off";
  },

  resetSubtitleDelayAfterSelectionChange(previousSelectionKey) {
    if (previousSelectionKey === this.getActiveSubtitleSelectionKey()) {
      return;
    }
    if (Number(this.subtitleDelayMs || 0) === 0) {
      return;
    }
    this.subtitleDelayMs = 0;
    this.applySubtitlePresentationSettings({ refreshTrackRendering: true });
  },

  applySubtitleEntry(entry) {
    if (!entry || entry.disabled) {
      this.cancelSubtitlePointerScrollTransaction();
      return;
    }
    const selectionToken = Number(this.subtitleSelectionToken || 0) + 1;
    this.subtitleSelectionToken = selectionToken;
    const pointerScrollTransaction = this.subtitlePointerScrollTransaction;
    if (pointerScrollTransaction) {
      pointerScrollTransaction.selectionToken = selectionToken;
    }
    const previousSubtitleSelectionKey = this.getActiveSubtitleSelectionKey();
    const off = entry.id === "subtitle-off" || entry.trackIndex === -1;
    if (!this.startupSubtitlePreferenceApplying) {
      this.subtitleExplicitlyOff = off;
      this.startupSubtitlePreferenceApplied = true;
    }
    if (off) {
      this.selectedSubtitleTrackIndex = -1;
      this.selectedAddonSubtitleId = null;
      this.selectedManifestSubtitleTrackId = null;
      clearTimeout(this.subtitleSelectionTimer);
      this.subtitleSelectionTimer = null;
      this.clearMountedExternalSubtitleTracks();
      this.clearHtmlSubtitleOverlay();
      if (this.relayTextSubtitles) this.relayTextSubtitles.select(null);
      if (PlayerController.clientRemux) PlayerController.selectClientSubtitle(null);
      if (PlayerController.dashInstance) PlayerController.setDashTextTrack(-1);
      if (PlayerController.hlsInstance) PlayerController.setHlsSubtitleTrack(-1);
      PlayerController.setNativeTextTrack(-1);
      this.syncRotatedNativeSubtitles?.();
      this.resetSubtitleDelayAfterSelectionChange(previousSubtitleSelectionKey);
      this.invalidateTrackDialogCaches();
      this.renderControlButtons();
      this.renderSubtitleDialog();
      this.settleSubtitlePointerScrollTransaction(selectionToken);
      return;
    }

    if (!entry.fallbackAddonSubtitle && this.externalTrackNodes.length) {
      this.clearMountedExternalSubtitleTracks();
    }
    if (!entry.fallbackAddonSubtitle) {
      this.clearHtmlSubtitleOverlay();
    }

    if (PlayerController.clientRemux || this.relayTextSubtitles) {
      const id = Object.prototype.hasOwnProperty.call(entry, "clientSubtitleId")
        ? entry.clientSubtitleId
        : null;
      if (this.relayTextSubtitles) this.relayTextSubtitles.select(id);
      else PlayerController.selectClientSubtitle(id);
      if (Object.prototype.hasOwnProperty.call(entry, "clientSubtitleId")) {
        this.selectedSubtitleTrackIndex = -1;
        this.selectedAddonSubtitleId = null;
        this.selectedManifestSubtitleTrackId = null;
        this.resetSubtitleDelayAfterSelectionChange(previousSubtitleSelectionKey);
        this.invalidateTrackDialogCaches();
        this.refreshSubtitleCueStyles();
        this.renderControlButtons();
        this.renderSubtitleDialog();
        this.settleSubtitlePointerScrollTransaction(selectionToken);
        return;
      }
    }
    if (Object.prototype.hasOwnProperty.call(entry, "dashSubtitleTrackIndex")) {
      const targetTrackIndex = Number(entry.dashSubtitleTrackIndex);
      const applied =
        typeof PlayerController.setDashTextTrack === "function"
          ? PlayerController.setDashTextTrack(targetTrackIndex)
          : false;
      if (!applied) {
        this.settleSubtitlePointerScrollTransaction(selectionToken);
        return;
      }
      this.selectedSubtitleTrackIndex = Number.isFinite(targetTrackIndex) ? targetTrackIndex : -1;
      this.selectedAddonSubtitleId = null;
      this.selectedManifestSubtitleTrackId = null;
      this.resetSubtitleDelayAfterSelectionChange(previousSubtitleSelectionKey);
      this.invalidateTrackDialogCaches();
      this.refreshSubtitleCueStyles();
      this.renderControlButtons();
      this.renderSubtitleDialog();
      this.settleSubtitlePointerScrollTransaction(selectionToken);
      return;
    }

    if (Object.prototype.hasOwnProperty.call(entry, "hlsSubtitleTrackIndex")) {
      const targetTrackIndex = Number(entry.hlsSubtitleTrackIndex);
      const applied =
        typeof PlayerController.setHlsSubtitleTrack === "function"
          ? PlayerController.setHlsSubtitleTrack(targetTrackIndex)
          : false;
      if (!applied) {
        this.settleSubtitlePointerScrollTransaction(selectionToken);
        return;
      }
      this.selectedSubtitleTrackIndex = Number.isFinite(targetTrackIndex) ? targetTrackIndex : -1;
      this.selectedAddonSubtitleId = null;
      this.selectedManifestSubtitleTrackId = null;
      this.resetSubtitleDelayAfterSelectionChange(previousSubtitleSelectionKey);
      this.invalidateTrackDialogCaches();
      this.refreshSubtitleCueStyles();
      this.renderControlButtons();
      this.renderSubtitleDialog();
      this.settleSubtitlePointerScrollTransaction(selectionToken);
      return;
    }

    if (Object.prototype.hasOwnProperty.call(entry, "manifestSubtitleTrackId")) {
      this.applyManifestTrackSelection({ subtitleTrackId: entry.manifestSubtitleTrackId });
      this.selectedSubtitleTrackIndex = -1;
      this.selectedAddonSubtitleId = null;
      this.resetSubtitleDelayAfterSelectionChange(previousSubtitleSelectionKey);
      this.invalidateTrackDialogCaches();
      this.refreshSubtitleCueStyles();
      this.renderControlButtons();
      this.renderSubtitleDialog();
      this.settleSubtitlePointerScrollTransaction(selectionToken);
      return;
    }

    if (entry.fallbackAddonSubtitle) {
      this.clearMountedExternalSubtitleTracks();
      this.clearHtmlSubtitleOverlay();
      if (this.subtitleSelectionTimer) {
        clearTimeout(this.subtitleSelectionTimer);
        this.subtitleSelectionTimer = null;
      }
      const subtitle = this.subtitles[entry.subtitleIndex];
      const subtitleId = subtitle ? addonSubtitleSelectionId(subtitle) : null;
      this.selectedAddonSubtitleId = subtitleId;
      this.selectedSubtitleTrackIndex = -1;
      this.selectedManifestSubtitleTrackId = null;
      this.resetSubtitleDelayAfterSelectionChange(previousSubtitleSelectionKey);
      this.invalidateTrackDialogCaches();
      this.refreshSubtitleCueStyles();
      this.renderControlButtons();
      this.renderSubtitleDialog();
      void this.applyFallbackAddonSubtitle(entry.subtitleIndex, selectionToken);
      return;
    }

    if (this.externalTrackNodes.length) {
      this.clearMountedExternalSubtitleTracks();
    }

    const textTracks = this.getTextTracks();
    const targetIndex = Number(entry.trackIndex);
    this.selectedManifestSubtitleTrackId = null;

    const appliedByController =
      typeof PlayerController.setNativeTextTrack === "function"
        ? PlayerController.setNativeTextTrack(targetIndex)
        : false;
    if (appliedByController) {
      this.selectedAddonSubtitleId = null;
      this.selectedSubtitleTrackIndex = targetIndex;
      this.resetSubtitleDelayAfterSelectionChange(previousSubtitleSelectionKey);
      this.invalidateTrackDialogCaches();
      this.refreshSubtitleCueStyles();
      this.renderControlButtons();
      this.renderSubtitleDialog();
      this.settleSubtitlePointerScrollTransaction(selectionToken);
      return;
    }

    textTracks.forEach((track, index) => {
      try {
        track.mode = index === targetIndex ? "showing" : "disabled";
      } catch (_) {
        // Best effort.
      }
    });

    this.selectedAddonSubtitleId = null;
    this.selectedSubtitleTrackIndex = targetIndex;
    this.resetSubtitleDelayAfterSelectionChange(previousSubtitleSelectionKey);
    this.invalidateTrackDialogCaches();
    this.refreshSubtitleCueStyles();
    this.renderControlButtons();
    this.renderSubtitleDialog();
    this.settleSubtitlePointerScrollTransaction(selectionToken);
  },

  async applyFallbackAddonSubtitle(subtitleIndex, selectionToken = this.subtitleSelectionToken) {
    const subtitle = this.subtitles[subtitleIndex];
    if (!subtitle?.url) {
      this.settleSubtitlePointerScrollTransaction(selectionToken);
      return;
    }
    const subtitleId = addonSubtitleSelectionId(subtitle);
    const isCurrentSelection = () => Number(selectionToken) === Number(this.subtitleSelectionToken);
    if (!isCurrentSelection()) {
      this.settleSubtitlePointerScrollTransaction(selectionToken);
      return;
    }

    const video = PlayerController.video;
    if (!video) {
      this.settleSubtitlePointerScrollTransaction(selectionToken);
      return;
    }

    const currentTracks = this.getTextTracks();
    this.builtInSubtitleCount = this.externalTrackNodes.length
      ? Math.max(0, currentTracks.length - this.externalTrackNodes.length)
      : currentTracks.length;

    this.clearMountedExternalSubtitleTracks();

    const resolvedSubtitleUrl = await this.resolveSubtitlePlaybackUrl(subtitle.url);
    if (!isCurrentSelection() || !resolvedSubtitleUrl) {
      this.settleSubtitlePointerScrollTransaction(selectionToken);
      return;
    }

    const track = document.createElement("track");
    track.kind = "subtitles";
    track.label = subtitle.lang || subtitleLabel(subtitleIndex);
    track.srclang = normalizeTrackLanguageCode(subtitle.lang) || "und";
    track.src = resolvedSubtitleUrl;
    track.default = true;
    track.setAttribute("data-addon-subtitle-id", subtitleId);
    this.externalTrackNodes.push(track);
    video.appendChild(track);

    const failOfflineSubtitleLoad = () => {
      if (!subtitle.isOffline || !isCurrentSelection()) {
        return;
      }
      this.clearMountedExternalSubtitleTracks();
      this.clearHtmlSubtitleOverlay();
      this.selectedAddonSubtitleId = null;
      this.selectedSubtitleTrackIndex = -1;
      this.selectedManifestSubtitleTrackId = null;
      this.refreshSubtitleCueStyles();
      this.renderControlButtons();
      this.renderSubtitleDialog();
    };

    try {
      if (track.track) {
        track.track.mode = "hidden";
      }
    } catch (_) {
      // Best effort.
    }

    const activateTrack = () => {
      if (!isCurrentSelection()) {
        return false;
      }
      return this.activateMountedExternalSubtitleTrack(track);
    };
    track.addEventListener(
      "load",
      () => {
        const mountedCueCount = this.getSubtitleCueArray(track.track?.cues).length;
        if (subtitle.isOffline && !mountedCueCount) {
          failOfflineSubtitleLoad();
          this.settleSubtitlePointerScrollTransaction(selectionToken);
          return;
        }
        const activated = activateTrack();
        if (activated) {
          this.settleSubtitlePointerScrollTransaction(selectionToken);
        }
      },
      { once: true }
    );
    track.addEventListener(
      "error",
      () => {
        failOfflineSubtitleLoad();
        console.warn("Subtitle track failed to load");
        this.settleSubtitlePointerScrollTransaction(selectionToken);
      },
      { once: true }
    );

    const preferredIndex = this.builtInSubtitleCount;
    this.selectedAddonSubtitleId = subtitleId;
    this.selectedSubtitleTrackIndex = preferredIndex;
    this.selectedManifestSubtitleTrackId = null;
    this.renderControlButtons();
    this.renderSubtitleDialog();

    if (this.subtitleSelectionTimer) {
      clearTimeout(this.subtitleSelectionTimer);
      this.subtitleSelectionTimer = null;
    }

    let activationAttempts = 0;
    const scheduleActivation = () => {
      this.subtitleSelectionTimer = setTimeout(
        () => {
          if (!isCurrentSelection()) {
            this.subtitleSelectionTimer = null;
            return;
          }
          activationAttempts += 1;
          const activated = activateTrack();
          if (!activated && activationAttempts < 6) {
            scheduleActivation();
            return;
          }
          if (!activated) {
            this.selectedSubtitleTrackIndex = -1;
            this.refreshTrackDialogs();
            this.settleSubtitlePointerScrollTransaction(selectionToken);
            return;
          }
          this.refreshSubtitleCueStyles();
          this.settleSubtitlePointerScrollTransaction(selectionToken);
        },
        activationAttempts === 0 ? 80 : 140
      );
    };
    scheduleActivation();
  },

  renderSubtitleDialog() {
    if (Environment.isBrowser() && this.renderProposalSubtitle?.()) return;
    const dialog = this.uiRefs?.subtitleDialog;
    if (!dialog) {
      return;
    }

    dialog.classList.toggle("hidden", !this.subtitleDialogVisible);
    if (!this.subtitleDialogVisible) {
      dialog.innerHTML = "";
      return;
    }

    const styleExpanded = Boolean(
      dialog.querySelector?.(".player-subtitle-style-disclosure")?.open
    );
    const pointerScrollTransaction = this.hasActiveSubtitlePointerScrollTransaction()
      ? this.subtitlePointerScrollTransaction
      : null;
    const pointerMode = Environment.isBrowser() && !this.subtitleKeyboardNavigation;
    const railScroll = pointerMode
      ? Array.from(dialog.querySelectorAll(".player-subtitle-rail"), (rail) => rail.scrollTop)
      : [];

    const languages = this.getSubtitleLanguageRailItems();
    this.subtitleLanguageRailIndex = clamp(
      this.subtitleLanguageRailIndex,
      0,
      Math.max(0, languages.length - 1)
    );
    const activeLanguage =
      languages[this.subtitleLanguageRailIndex]?.key || SUBTITLE_LANGUAGE_OFF_KEY;
    const options = this.getSubtitleOptionsForLanguage(activeLanguage);
    this.subtitleOptionRailIndex = clamp(
      this.subtitleOptionRailIndex,
      0,
      Math.max(0, options.length - 1)
    );
    const styleItems = this.getSubtitleStyleControls();
    this.subtitleStyleRailIndex = clamp(
      this.subtitleStyleRailIndex,
      0,
      Math.max(0, styleItems.length - 1)
    );
    const subtitleLoadingVisible = Boolean(
      this.subtitleLoading || this.manifestLoading || this.trackDiscoveryInProgress
    );
    const showOptionsRail = activeLanguage !== SUBTITLE_LANGUAGE_OFF_KEY || subtitleLoadingVisible;
    dialog.classList.toggle("is-empty", languages.length <= 1 && !subtitleLoadingVisible);
    const focusedStyleSide =
      this.subtitleStyleControlSide === "plus"
        ? "plus"
        : this.subtitleStyleControlSide === "reset"
          ? "reset"
          : "minus";
    const emptySubtitleOptionsMarkup = subtitleLoadingVisible
      ? `
        <div class="player-dialog-empty player-dialog-loading">
          ${renderLoadingIndicator()}
          <span>${escapeHtml(t("subtitle_loading_builtin", {}, "Loading subtitle tracks..."))}</span>
        </div>
      `
      : `<div class="player-dialog-empty">${escapeHtml(t("subtitle_none", {}, "No subtitles"))}</div>`;

    dialog.innerHTML = `
      <div class="player-dialog-title">${escapeHtml(t("subtitle_dialog_title", {}, "Subtitles"))}</div>
      <div class="player-subtitle-overlay-grid">
        <div class="player-subtitle-rail player-subtitle-language-rail">
          ${languages
            .map(
              (item, index) => `
          <div class="player-dialog-item focusable${item.selected ? " selected" : ""}${!pointerMode && this.subtitleFocusedRail === "language" && index === this.subtitleLanguageRailIndex ? " focused" : ""}" data-subtitle-rail="language" data-subtitle-index="${index}">
              <div class="player-dialog-item-main">${escapeHtml(item.label)}${item.count > 0 ? `<span class="player-subtitle-language-count">${item.count}</span>` : ""}</div>
              <div class="player-dialog-item-sub">${item.key === SUBTITLE_LANGUAGE_OFF_KEY && subtitleLoadingVisible ? escapeHtml(t("subtitle_loading_builtin", {}, "Loading subtitle tracks...")) : ""}</div>
            </div>
          `
            )
            .join("")}
        </div>
        <div class="player-subtitle-rail player-subtitle-options-rail${showOptionsRail ? "" : " hidden"}">
          ${
            options.length
              ? options
                  .map(
                    (item, index) => `
            <div class="player-dialog-item focusable${item.selected ? " selected" : ""}${!pointerMode && this.subtitleFocusedRail === "options" && index === this.subtitleOptionRailIndex ? " focused" : ""}" data-subtitle-rail="options" data-subtitle-index="${index}">
              <div class="player-subtitle-option-copy">
                <span class="player-subtitle-source-chip">${escapeHtml(item.sourceLabel || "")}</span>
                <div class="player-dialog-item-main">${escapeHtml(item.title || "")}</div>
                ${item.meta ? `<div class="player-dialog-item-sub">${escapeHtml(item.meta)}</div>` : ""}
              </div>
              <div class="player-dialog-item-check">${item.selected ? "&#10003;" : ""}</div>
            </div>
          `
                  )
                  .join("")
              : emptySubtitleOptionsMarkup
          }
        </div>
        <div class="player-subtitle-rail player-subtitle-style-rail${showOptionsRail ? "" : " hidden"}">
          ${styleItems
            .map(
              (item, index) => `
            <div class="player-dialog-item player-dialog-style-item${item.id === "reset" ? " player-dialog-style-reset" : ""}${item.disabled ? " disabled" : ""}${!pointerMode && this.subtitleFocusedRail === "style" && index === this.subtitleStyleRailIndex ? " focused" : ""}" data-subtitle-rail="style" data-subtitle-index="${index}" aria-disabled="${item.disabled ? "true" : "false"}">
              ${
                item.id === "reset"
                  ? `
                    <div class="player-dialog-item-center">
                      <div class="player-dialog-item-main">${escapeHtml(item.label)}</div>
                    </div>
                    <button class="${Environment.isBrowser() ? "player-dialog-reset-button" : "player-dialog-step player-dialog-step-plus player-dialog-reset"}${item.disabled ? "" : " focusable"}${!item.disabled && !pointerMode && this.subtitleFocusedRail === "style" && index === this.subtitleStyleRailIndex && focusedStyleSide === "reset" ? " focused" : ""}" type="button" data-subtitle-style-action="reset" data-subtitle-rail="style" data-subtitle-index="${index}" data-style-id="${escapeAttribute(item.id)}" aria-label="${escapeAttribute(t("subtitle_style_reset_action", {}, "Reset Defaults"))}"${item.disabled ? " disabled" : ""}>${escapeHtml(t("subtitle_style_reset_action", {}, "Reset Defaults"))}</button>
                  `
                  : `
                    <button class="player-dialog-step player-dialog-step-minus${item.disabled ? "" : " focusable"}${!item.disabled && !pointerMode && this.subtitleFocusedRail === "style" && index === this.subtitleStyleRailIndex && focusedStyleSide === "minus" ? " focused" : ""}" type="button" data-subtitle-style-action="decrease" data-subtitle-rail="style" data-subtitle-index="${index}" data-style-id="${escapeAttribute(item.id)}" aria-label="${escapeAttribute(`${item.label} -`)}"${item.disabled ? " disabled" : ""}>&#8722;</button>
                    <div class="player-dialog-item-center">
                      <div class="player-dialog-item-main">${escapeHtml(item.label)}</div>
                      <div class="player-dialog-item-sub">${escapeHtml(item.value || "")}</div>
                    </div>
                    <button class="player-dialog-step player-dialog-step-plus${item.disabled ? "" : " focusable"}${!item.disabled && !pointerMode && this.subtitleFocusedRail === "style" && index === this.subtitleStyleRailIndex && focusedStyleSide === "plus" ? " focused" : ""}" type="button" data-subtitle-style-action="increase" data-subtitle-rail="style" data-subtitle-index="${index}" data-style-id="${escapeAttribute(item.id)}" aria-label="${escapeAttribute(`${item.label} +`)}"${item.disabled ? " disabled" : ""}>&#43;</button>
                  `
              }
            </div>
          `
            )
            .join("")}
        </div>
      </div>
    `;
    this.decorateBrowserTrackPanel?.(
      dialog,
      t("subtitle_dialog_title", {}, "Subtitles"),
      "subtitleDialog"
    );
    if (Environment.isBrowser()) {
      const styles = dialog.querySelector(".player-subtitle-style-rail");
      if (styles) {
        const disclosure = document.createElement("details");
        disclosure.className = "player-subtitle-style-disclosure";
        disclosure.open = styleExpanded || (!pointerMode && this.subtitleFocusedRail === "style");
        disclosure.innerHTML = `<summary>${escapeHtml(t("player_subtitle_appearance_sync", {}, "Appearance & synchronization"))}</summary>`;
        styles.before(disclosure);
        disclosure.append(styles);
      }
    }
    if (pointerScrollTransaction) {
      const optionRail = dialog.querySelector(".player-subtitle-options-rail");
      if (optionRail instanceof HTMLElement && !optionRail.classList.contains("hidden")) {
        const maxScrollTop = Math.max(0, optionRail.scrollHeight - optionRail.clientHeight);
        optionRail.scrollTop = Math.max(
          0,
          Math.min(maxScrollTop, Number(pointerScrollTransaction.scrollTop || 0))
        );
        this.bindSubtitlePointerScrollTransactionRail(optionRail);
      }
      return;
    }
    if (pointerMode) {
      dialog.querySelectorAll(".player-subtitle-rail").forEach((rail, index) => {
        rail.scrollTop = railScroll[index] || 0;
      });
      return;
    }
    this.scrollSubtitleDialogIntoView();
    this.scheduleSubtitleDialogScrollIntoView();
  },

  handleSubtitleDialogKey(event) {
    this.subtitleKeyboardNavigation = !event?.fromPointer;
    const keyCode = Number(event?.keyCode || 0);
    const languages = this.getSubtitleLanguageRailItems();
    const activeLanguage =
      languages[this.subtitleLanguageRailIndex]?.key || SUBTITLE_LANGUAGE_OFF_KEY;
    const options = this.getSubtitleOptionsForLanguage(activeLanguage);
    const styleItems = this.getSubtitleStyleControls();
    const styleItem = styleItems[this.subtitleStyleRailIndex];

    if (keyCode === 38) {
      if (this.subtitleFocusedRail === "language") {
        this.subtitleLanguageRailIndex = clamp(
          this.subtitleLanguageRailIndex - 1,
          0,
          Math.max(0, languages.length - 1)
        );
        this.syncSubtitleOptionIndexForFocusedLanguage();
      } else if (this.subtitleFocusedRail === "options") {
        this.subtitleOptionRailIndex = clamp(
          this.subtitleOptionRailIndex - 1,
          0,
          Math.max(0, options.length - 1)
        );
      } else {
        this.subtitleStyleRailIndex = clamp(
          this.subtitleStyleRailIndex - 1,
          0,
          Math.max(0, styleItems.length - 1)
        );
        this.subtitleStyleControlSide =
          styleItems[this.subtitleStyleRailIndex]?.id === "reset" ? "reset" : "minus";
      }
      this.renderSubtitleDialog();
      return true;
    }
    if (keyCode === 40) {
      if (this.subtitleFocusedRail === "language") {
        this.subtitleLanguageRailIndex = clamp(
          this.subtitleLanguageRailIndex + 1,
          0,
          Math.max(0, languages.length - 1)
        );
        this.syncSubtitleOptionIndexForFocusedLanguage();
      } else if (this.subtitleFocusedRail === "options") {
        this.subtitleOptionRailIndex = clamp(
          this.subtitleOptionRailIndex + 1,
          0,
          Math.max(0, options.length - 1)
        );
      } else {
        this.subtitleStyleRailIndex = clamp(
          this.subtitleStyleRailIndex + 1,
          0,
          Math.max(0, styleItems.length - 1)
        );
        this.subtitleStyleControlSide =
          styleItems[this.subtitleStyleRailIndex]?.id === "reset" ? "reset" : "minus";
      }
      this.renderSubtitleDialog();
      return true;
    }
    if (keyCode === 37) {
      if (this.subtitleFocusedRail === "style") {
        if (this.subtitleStyleControlSide === "plus") {
          this.subtitleStyleControlSide = "minus";
          this.renderSubtitleDialog();
          return true;
        } else {
          this.subtitleFocusedRail = options.length ? "options" : "language";
          this.subtitleStyleControlSide = "minus";
          this.renderSubtitleDialog();
          return true;
        }
      } else if (this.subtitleFocusedRail === "options") {
        this.subtitleFocusedRail = "language";
        this.renderSubtitleDialog();
        return true;
      }
      return true;
    }
    if (keyCode === 39) {
      if (
        this.subtitleFocusedRail === "language" &&
        activeLanguage !== SUBTITLE_LANGUAGE_OFF_KEY &&
        options.length
      ) {
        this.subtitleFocusedRail = "options";
        this.renderSubtitleDialog();
        return true;
      }
      if (this.subtitleFocusedRail === "options") {
        this.subtitleFocusedRail = "style";
        this.subtitleStyleControlSide = "minus";
        this.renderSubtitleDialog();
        return true;
      }
      if (this.subtitleFocusedRail === "style") {
        if (this.subtitleStyleControlSide === "minus") {
          this.subtitleStyleControlSide = "plus";
          this.renderSubtitleDialog();
          return true;
        }
      }
      return true;
    }
    if (isSelectKeyCode(keyCode)) {
      if (this.subtitleFocusedRail === "language") {
        const language = languages[this.subtitleLanguageRailIndex];
        if (!language) {
          return true;
        }
        if (language.key === SUBTITLE_LANGUAGE_OFF_KEY) {
          this.applySubtitleEntry(
            this.getSubtitleEntries("builtIn").find((entry) => entry.id === "subtitle-off") || {
              trackIndex: -1
            }
          );
        } else {
          const selected = this.selectFirstSubtitleOptionForLanguage(language.key, {
            focusOptions: true
          });
          if (!selected) {
            const nextOptions = this.getSubtitleOptionsForLanguage(language.key);
            if (nextOptions.length) {
              this.subtitleFocusedRail = "options";
              this.subtitleOptionRailIndex = 0;
            }
          }
        }
        this.renderSubtitleDialog();
        return true;
      }
      if (this.subtitleFocusedRail === "options") {
        const option = options[this.subtitleOptionRailIndex];
        if (option?.entry) {
          this.applySubtitleEntry(option.entry);
        }
        return true;
      }
      if (styleItem && !styleItem.disabled) {
        this.adjustSubtitleStyleControl(
          styleItem.id,
          this.getSubtitleStyleControlDelta(this.subtitleStyleControlSide),
          { isRepeat: Boolean(event?.repeat) }
        );
      }
      return true;
    }
    if (this.subtitleFocusedRail === "style" && (keyCode === 10009 || keyCode === 461)) {
      this.subtitleFocusedRail = options.length ? "options" : "language";
      this.subtitleStyleControlSide = "minus";
      this.renderSubtitleDialog();
      return true;
    }
    return (
      keyCode === 37 ||
      keyCode === 38 ||
      keyCode === 39 ||
      keyCode === 40 ||
      isSelectKeyCode(keyCode)
    );
  },

  getAudioEntries() {
    const cachedEntries = this.trackDialogCache?.audioEntries;
    if (cachedEntries) {
      return cachedEntries;
    }
    const browserTracks = this.relayTrackContext?.audioIndices
      ? mergeRelayRenditionTracks(
          this.relayTrackContext,
          this.relayAudioTracks || [],
          PlayerController.getBrowserAudioTracks()
        )
      : this.relayAudioTracks?.length
        ? this.relayAudioTracks
        : typeof PlayerController.getBrowserAudioTracks === "function"
          ? PlayerController.getBrowserAudioTracks()
          : this.getAudioTracks();
    const tracks = browserTracks.length ? browserTracks : this.directAudioTracks || [];
    const entries = tracks.map((track, index) => {
      const display = formatAudioTrackDisplay(track, index);
      const support =
        track.supported === false
          ? {
              supported: false,
              unsupportedReason: t("player.audio.unsupported", {}, "Unsupported")
            }
          : getAudioTrackSupportState(track);
      return {
        id: `audio-${track.engine || "native"}-${track.id || index}`,
        label: display.label,
        secondary: display.secondary,
        selected: Boolean(track.selected),
        supported: support.supported,
        unsupportedReason: support.unsupportedReason,
        browserAudioTrackIndex: index,
        track: {
          ...track,
          ...support
        }
      };
    });

    if (!browserTracks.length && tracks.some((track) => track.engine === "direct-source")) {
      entries.unshift({
        id: "audio-direct-default",
        label: t("player_audio_direct_default", {}, "Player default audio"),
        secondary: t(
          "player_audio_direct_default_help",
          {},
          "The browser chooses the track during Direct playback."
        ),
        selected: true,
        supported: true,
        unsupportedReason: null,
        browserAudioTrackIndex: -1,
        track: { engine: "direct-default", selected: true }
      });
    }
    this.trackDialogCache.audioEntries = entries;
    return entries;
  },

  ensureSupportedAudioTrackSelected() {
    if (this.audioFallbackApplying) {
      return false;
    }
    const entries = this.getAudioEntries();
    if (entries.some((entry) => entry.track?.engine === "direct-source")) return false;
    const supportedEntryIndex = entries.findIndex((entry) => entry?.supported !== false);
    if (supportedEntryIndex < 0) {
      return false;
    }
    const supportedEntry = entries[supportedEntryIndex];
    if (supportedEntry?.id && supportedEntry.id === this.failedAutomaticAudioFallbackEntryId) {
      return false;
    }
    const selectedEntry = entries.find((entry) => entry?.selected);
    const shouldFallback = selectedEntry
      ? selectedEntry.supported === false
      : entries[0]?.supported === false;
    if (!shouldFallback) {
      return false;
    }

    this.audioFallbackApplying = true;
    try {
      this.applyAudioTrack(supportedEntryIndex, { automaticFallback: true });
    } finally {
      this.audioFallbackApplying = false;
    }
    return true;
  },

  adjustAudioAmplification(delta = 0) {
    const nextDb = clamp(
      Number(this.audioAmplificationDb || 0) + Number(delta || 0),
      AUDIO_AMPLIFICATION_MIN_DB,
      AUDIO_AMPLIFICATION_MAX_DB
    );
    this.audioAmplificationDb = nextDb;
    this.persistPlayerPresentationSettings();
    this.applyAudioAmplification();
    this.renderAudioDialog();
  },

  togglePersistAudioAmplification() {
    this.persistAudioAmplification = !this.persistAudioAmplification;
    this.persistPlayerPresentationSettings();
    this.renderAudioDialog();
  },

  openAudioDialog() {
    if (Environment.isBrowser()) {
      if (this.episodePanelVisible) this.hideEpisodePanel();
      this.moreActionsVisible = false;
      this.renderCompactBrowserMorePanel?.();
    }

    this.cancelSeekPreview({ commit: false });
    this.syncTrackState();
    this.applyAudioAmplification();
    this.audioDialogVisible = true;
    void this.loadDirectTrackData();
    this.subtitleDialogVisible = false;
    this.speedDialogVisible = false;
    this.sourcesPanelVisible = false;
    let entries = this.getAudioEntries();
    if (!entries.length) {
      this.ensureTrackDataWarmup();
      entries = this.getAudioEntries();
    }
    const selectedEntry = entries.findIndex((entry) => entry.selected);
    this.audioDialogIndex = Math.max(0, selectedEntry >= 0 ? selectedEntry : 0);
    this.setControlsVisible(true, { focus: false });
    this.renderSubtitleDialog();
    this.renderAudioDialog();
    this.renderSpeedDialog();
    this.renderSourcesPanel();
    this.updateModalBackdrop();
  },

  closeAudioDialog() {
    this.audioDialogVisible = false;
    this.renderAudioDialog();
    this.updateModalBackdrop();
    this.resetControlsAutoHide();
  },

  applyAudioTrack(index, { automaticFallback = false, rememberSelection = false } = {}) {
    const entries = this.getAudioEntries();
    const selectedEntry = entries[index] || null;
    if (!selectedEntry) return;
    if (selectedEntry.track?.engine === "direct-default") {
      if (rememberSelection) {
        this.directAudioPreferenceState = { url: this.activePlaybackUrl, attempted: true };
        if (this.directAudioSwitching?.automatic && !this.directAudioSwitching.started)
          this.directAudioSwitching = null;
      }
      return;
    }
    if (!automaticFallback) {
      this.failedAutomaticAudioFallbackEntryId = "";
    }
    if (rememberSelection) {
      this.startupAudioFallbackApplied = false;
    }
    if (selectedEntry.supported === false) {
      this.invalidateTrackDialogCaches();
      this.renderAudioDialog();
      return;
    }

    const browserAudioTrackIndex = Number(selectedEntry.browserAudioTrackIndex);
    if (!Number.isFinite(browserAudioTrackIndex)) {
      return;
    }

    if (selectedEntry.track?.engine === "direct-source") {
      // Discovering tracks in a dialog must not restart working Direct playback.
      if (!rememberSelection) return;
      this.directAudioPreferenceState = { url: this.activePlaybackUrl, attempted: true };
      void this.switchDirectAudioTrack(selectedEntry);
      return;
    }

    if (selectedEntry.track?.engine === "relay") {
      const target = relayAudioUrl(this.relayTrackContext, selectedEntry.track.index);
      if (!target || selectedEntry.selected || this.relayAudioSwitching) return;
      this.relayAudioSwitching = true;
      if (rememberSelection)
        this.rememberAudioTrackSelection(this.getAudioTrackPreference(selectedEntry));
      void this.playStreamByUrl(target, {
        preservePanel: true,
        preservePlaybackState: true,
        resetSilentAudioState: false
      })
        .catch(() => {
          console.warn("[Playback] relay audio switch failed");
        })
        .finally(() => {
          this.relayAudioSwitching = false;
        });
      return;
    }

    const applied =
      typeof PlayerController.setBrowserAudioTrack === "function"
        ? PlayerController.setBrowserAudioTrack(browserAudioTrackIndex)
        : false;
    if (!applied) {
      this.invalidateTrackDialogCaches();
      this.renderAudioDialog();
      return;
    }

    this.selectedAudioTrackIndex = browserAudioTrackIndex;
    if (rememberSelection) {
      this.rememberAudioTrackSelection(this.getAudioTrackPreference(selectedEntry));
    }
    this.invalidateTrackDialogCaches();
    this.renderControlButtons();
    this.renderAudioDialog();
  },

  renderAudioDialog() {
    if (Environment.isBrowser() && this.renderProposalAudio?.()) return;
    const dialog = this.uiRefs?.audioDialog;
    if (!dialog) {
      return;
    }

    dialog.classList.toggle("hidden", !this.audioDialogVisible);
    if (!this.audioDialogVisible) {
      dialog.innerHTML = "";
      return;
    }

    const entries = this.getAudioEntries();
    dialog.classList.toggle("is-empty", !entries.length);
    const hasSupportedEntries = entries.some((entry) => entry?.supported !== false);
    const audioControls = [
      {
        id: "amplification",
        title: t("audio_mix_label", {}, "Audio boost"),
        value: `${Math.round(Number(this.audioAmplificationDb || 0))} dB`,
        helper: this.audioAmplificationAvailable
          ? t(
              "audio_mix_range",
              { min: AUDIO_AMPLIFICATION_MIN_DB, max: AUDIO_AMPLIFICATION_MAX_DB },
              `Range ${AUDIO_AMPLIFICATION_MIN_DB}-${AUDIO_AMPLIFICATION_MAX_DB} dB`
            )
          : t("audio_mix_unavailable", {}, "Unavailable on this device"),
        enabled: Boolean(this.audioAmplificationAvailable),
        canDecrease:
          this.audioAmplificationAvailable &&
          Number(this.audioAmplificationDb || 0) > AUDIO_AMPLIFICATION_MIN_DB,
        canIncrease:
          this.audioAmplificationAvailable &&
          Number(this.audioAmplificationDb || 0) < AUDIO_AMPLIFICATION_MAX_DB
      },
      {
        id: "persist",
        title: this.persistAudioAmplification
          ? t("audio_mix_persist_on", {}, "Save audio boost: On")
          : t("audio_mix_persist_off", {}, "Save audio boost: Off"),
        value: "",
        helper: t("audio_mix_persist_help", {}, "Remember boost for future playback"),
        enabled: true,
        toggle: true
      }
    ];
    this.audioMixFocusIndex = clamp(this.audioMixFocusIndex, 0, audioControls.length - 1);
    if (!entries.length) {
      this.audioFocusedColumn = "controls";
      const loading =
        this.isCurrentSourceAdaptiveManifest() &&
        (this.manifestLoading || this.trackDiscoveryInProgress);
      const emptyMessage = loading
        ? "Loading audio tracks..."
        : this.getUnavailableTrackMessage("audio");
      dialog.innerHTML = `
        <div class="player-dialog-title">${escapeHtml(t("audio_dialog_title", {}, "Audio"))}</div>
        <div class="player-dialog-empty${loading ? " player-dialog-loading" : ""}">
          ${loading ? renderLoadingIndicator() : ""}
          <span>${escapeHtml(emptyMessage)}</span>
        </div>
        <div class="player-audio-controls-list">
          ${audioControls.map((control, index) => this.renderAudioControlItem(control, index)).join("")}
        </div>
      `;
      this.decorateBrowserTrackPanel?.(dialog, t("audio_dialog_title", {}, "Audio"), "audioTrack");
      return;
    }

    this.audioDialogIndex = clamp(this.audioDialogIndex, 0, entries.length - 1);
    dialog.innerHTML = `
      <div class="player-dialog-title">${escapeHtml(t("audio_dialog_title", {}, "Audio"))}</div>
      ${hasSupportedEntries ? "" : `<div class="player-audio-support-message">${escapeHtml(t("player.audio.noSupportedTracks", {}, "No supported audio tracks available"))}</div>`}
      <div class="player-audio-overlay-grid">
        <div class="player-dialog-list player-audio-track-list">
          ${entries
            .map((entry, index) => {
              const selected = entry.selected;
              const focused =
                this.audioFocusedColumn === "tracks" && index === this.audioDialogIndex;
              const disabled = entry.supported === false;
              const label = disabled
                ? `${entry.label || ""} · ${t("player.audio.unsupported", {}, "Unsupported")}`
                : entry.label || "";
              const secondary = disabled
                ? [
                    entry.secondary,
                    t("player.audio.unsupportedCodec", {}, "Codec not supported by this device")
                  ]
                    .filter(Boolean)
                    .join(" · ")
                : entry.secondary || "";
              return `
              <div class="player-dialog-item focusable${selected ? " selected" : ""}${focused ? " focused" : ""}${disabled ? " disabled" : ""}" data-audio-column="tracks" data-audio-index="${index}" aria-disabled="${disabled ? "true" : "false"}">
                <div class="player-dialog-item-main">${escapeHtml(label)}</div>
                <div class="player-dialog-item-sub">${escapeHtml(secondary)}</div>
                <div class="player-dialog-item-check">${selected ? "&#10003;" : ""}</div>
              </div>
            `;
            })
            .join("")}
        </div>
        <div class="player-audio-controls-list">
          ${audioControls.map((control, index) => this.renderAudioControlItem(control, index)).join("")}
        </div>
      </div>
    `;
    this.decorateBrowserTrackPanel?.(dialog, t("audio_dialog_title", {}, "Audio"), "audioTrack");
    this.scrollAudioDialogIntoView();
  },

  renderAudioControlItem(control, index) {
    const focused = this.audioFocusedColumn === "controls" && index === this.audioMixFocusIndex;
    if (control.toggle) {
      return `
        <div class="player-audio-control-card player-audio-toggle focusable${this.persistAudioAmplification ? " selected" : ""}${focused ? " focused" : ""}" data-audio-column="controls" data-audio-index="${index}">
          <div class="player-dialog-item-main">${escapeHtml(control.title)}</div>
          <div class="player-dialog-item-sub">${escapeHtml(control.helper || "")}</div>
        </div>
      `;
    }
    return `
      <div class="player-audio-control-card focusable${focused ? " focused" : ""}${!control.enabled ? " disabled" : ""}" data-audio-column="controls" data-audio-index="${index}">
        <div class="player-audio-control-title">${escapeHtml(control.title)}</div>
        <div class="player-audio-control-value">${escapeHtml(control.value)}</div>
        <div class="player-audio-step-row">
          <button class="player-dialog-step player-dialog-step-minus focusable${focused ? " focused" : ""}${!control.canDecrease ? " disabled" : ""}" type="button" tabindex="-1" data-audio-column="controls" data-audio-index="${index}" data-audio-step="-1">&#8722;</button>
          <button class="player-dialog-step player-dialog-step-plus focusable${focused ? " focused" : ""}${!control.canIncrease ? " disabled" : ""}" type="button" tabindex="-1" data-audio-column="controls" data-audio-index="${index}" data-audio-step="1">&#43;</button>
        </div>
        <div class="player-dialog-item-sub">${escapeHtml(control.helper || "")}</div>
      </div>
    `;
  },

  activateAudioControl(direction = 0) {
    if (this.audioMixFocusIndex === 0) {
      if (!this.audioAmplificationAvailable) {
        return;
      }
      this.adjustAudioAmplification(direction < 0 ? -1 : 1);
      return;
    }
    this.togglePersistAudioAmplification();
  },

  scrollAudioDialogIntoView() {
    const dialog = this.uiRefs?.audioDialog;
    if (!dialog || !this.audioDialogVisible) {
      return;
    }
    const target = dialog.querySelector(".player-audio-track-list .player-dialog-item.focused");
    target?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  },

  handleAudioDialogKey(event) {
    const keyCode = Number(event?.keyCode || 0);
    const entries = this.getAudioEntries();
    const isNavigationKey =
      keyCode === 37 ||
      keyCode === 38 ||
      keyCode === 39 ||
      keyCode === 40 ||
      isSelectKeyCode(keyCode);

    if (keyCode === 37) {
      if (this.audioFocusedColumn === "controls") {
        if (this.audioMixFocusIndex === 0) {
          this.activateAudioControl(-1);
        } else if (entries.length) {
          this.audioFocusedColumn = "tracks";
          this.renderAudioDialog();
        }
      }
      return true;
    }

    if (keyCode === 39) {
      if (this.audioFocusedColumn === "tracks") {
        if (!entries.length) {
          this.audioFocusedColumn = "controls";
          this.renderAudioDialog();
          return true;
        }
        this.audioFocusedColumn = "controls";
        this.renderAudioDialog();
      } else if (this.audioMixFocusIndex === 0) {
        this.activateAudioControl(1);
      }
      return true;
    }

    if (keyCode === 38) {
      if (this.audioFocusedColumn === "tracks") {
        this.audioDialogIndex = clamp(this.audioDialogIndex - 1, 0, entries.length - 1);
      } else {
        this.audioMixFocusIndex = clamp(this.audioMixFocusIndex - 1, 0, 1);
      }
      this.renderAudioDialog();
      return true;
    }

    if (keyCode === 40) {
      if (this.audioFocusedColumn === "tracks") {
        this.audioDialogIndex = clamp(this.audioDialogIndex + 1, 0, entries.length - 1);
      } else {
        this.audioMixFocusIndex = clamp(this.audioMixFocusIndex + 1, 0, 1);
      }
      this.renderAudioDialog();
      return true;
    }

    if (isSelectKeyCode(keyCode)) {
      if (this.audioFocusedColumn === "tracks") {
        this.applyAudioTrack(this.audioDialogIndex, { rememberSelection: true });
      } else {
        this.activateAudioControl(this.audioMixFocusIndex === 0 ? 1 : 0);
      }
      return true;
    }

    return isNavigationKey;
  },

  openSpeedDialog() {
    if (Environment.isBrowser()) {
      if (this.episodePanelVisible) this.hideEpisodePanel();
      this.moreActionsVisible = false;
      this.renderCompactBrowserMorePanel?.();
    }

    const currentSpeed = this.getPlaybackSpeed();
    const speedOptions = this.getPlaybackSpeedOptions();
    this.speedDialogVisible = true;
    this.subtitleDialogVisible = false;
    this.audioDialogVisible = false;
    this.sourcesPanelVisible = false;
    this.speedDialogIndex = Math.max(
      0,
      speedOptions.findIndex((value) => value === currentSpeed)
    );
    this.renderSubtitleDialog();
    this.renderAudioDialog();
    this.renderSourcesPanel();
    this.renderSpeedDialog();
    this.updateModalBackdrop();
  },

  closeSpeedDialog() {
    this.speedDialogVisible = false;
    this.renderSpeedDialog();
    this.updateModalBackdrop();
    this.resetControlsAutoHide();
  },

  async applyPlaybackSpeed(speed = 1) {
    let applied = false;
    try {
      applied =
        typeof PlayerController.setPlaybackRate === "function"
          ? await PlayerController.setPlaybackRate(speed)
          : false;
    } catch (_) {
      applied = false;
    }
    if (!applied) {
      this.renderControlButtons();
      this.renderSpeedDialog();
      return false;
    }
    this.renderControlButtons();
    this.renderSpeedDialog();
    return true;
  },

  renderSpeedDialog() {
    const dialog = this.uiRefs?.speedDialog;
    if (!dialog) {
      return;
    }
    dialog.classList.toggle("hidden", !this.speedDialogVisible);
    if (!this.speedDialogVisible) {
      dialog.innerHTML = "";
      return;
    }
    const currentSpeed = this.getPlaybackSpeed();
    const speedOptions = this.getPlaybackSpeedOptions();
    this.speedDialogIndex = clamp(this.speedDialogIndex, 0, speedOptions.length - 1);
    dialog.innerHTML = `
      <div class="player-dialog-title">${escapeHtml(t("player_playback_speed", {}, "Playback speed"))}</div>
      <div class="player-dialog-list">
        ${speedOptions
          .map(
            (speed, index) => `
          <div class="player-dialog-item focusable${speed === currentSpeed ? " selected" : ""}${index === this.speedDialogIndex ? " focused" : ""}" data-speed-index="${index}">
            <div class="player-dialog-item-main">${escapeHtml(`${speed}x`)}</div>
            <div class="player-dialog-item-sub">${escapeHtml(speed === 1 ? t("common.normal", {}, "Normal") : t("player_playback_speed", {}, "Playback speed"))}</div>
            <div class="player-dialog-item-check">${speed === currentSpeed ? "&#10003;" : ""}</div>
          </div>
        `
          )
          .join("")}
      </div>
    `;
    this.decorateBrowserTrackPanel?.(
      dialog,
      t("player_playback_speed", {}, "Playback speed"),
      "speed"
    );
  },

  handleSpeedDialogKey(event) {
    const keyCode = Number(event?.keyCode || 0);
    const speedOptions = this.getPlaybackSpeedOptions();
    if (keyCode === 38) {
      this.speedDialogIndex = clamp(this.speedDialogIndex - 1, 0, speedOptions.length - 1);
      this.renderSpeedDialog();
      return true;
    }
    if (keyCode === 40) {
      this.speedDialogIndex = clamp(this.speedDialogIndex + 1, 0, speedOptions.length - 1);
      this.renderSpeedDialog();
      return true;
    }
    if (isSelectKeyCode(keyCode)) {
      this.applyPlaybackSpeed(speedOptions[this.speedDialogIndex] || 1);
      return true;
    }
    return (
      keyCode === 37 ||
      keyCode === 38 ||
      keyCode === 39 ||
      keyCode === 40 ||
      isSelectKeyCode(keyCode)
    );
  },

  getPlayerStreamProbe(stream) {
    return (
      this._playerListProbeResults?.get(playerStreamProbeKey(stream)) ||
      this._nextEpisodeProbeResults?.get(playerStreamProbeKey(stream)) ||
      this._nextEpisodeProbeResults?.get(stream.url || stream.externalUrl || "") ||
      null
    );
  },

  filterPlayerStreamList(streams) {
    return filterPlayerStreams(streams, {
      mode: PROBE_MODE,
      limit: globalThis.__NUVIO_ENV__?.PROBE_PAGE_LIMIT ?? 20,
      settings: PlayerSettingsStore.get(),
      labels: StreamBadgeSettingsStore.snapshot(),
      capabilities: getDeviceCapabilities(),
      probeForStream: (stream) => this.getPlayerStreamProbe(stream)
    });
  },

  getSourceFilters(orderedStreams = this.getOrderedStreamCandidates()) {
    const addons = [];
    orderedStreams.forEach((stream) => {
      const addonName = String(stream?.addonName || "").trim();
      if (addonName && !addons.includes(addonName)) {
        addons.push(addonName);
      }
    });
    return ["all", ...addons];
  },

  getOrderedStreamCandidates() {
    return (this.streamCandidates || [])
      .map((stream, index) => ({ stream, index }))
      .sort((left, right) => {
        const leftOrder = Number(left.stream?.addonOrderIndex ?? Number.MAX_SAFE_INTEGER);
        const rightOrder = Number(right.stream?.addonOrderIndex ?? Number.MAX_SAFE_INTEGER);
        if (leftOrder !== rightOrder) {
          return leftOrder - rightOrder;
        }
        return left.index - right.index;
      })
      .map((entry) => entry.stream);
  },

  getFilteredSources(orderedStreams = this.getOrderedStreamCandidates()) {
    const visible = this.filterPlayerStreamList(orderedStreams);
    return this.sourceFilter === "all"
      ? visible
      : visible.filter((stream) => stream.addonName === this.sourceFilter);
  },

  ensureSourcesFocus(filters = null, list = null) {
    const availableFilters = Array.isArray(filters) ? filters : this.getSourceFilters();
    const availableSources = Array.isArray(list) ? list : this.getFilteredSources();

    if (!this.sourcesFocus || !["top", "filter", "list"].includes(this.sourcesFocus.zone)) {
      this.sourcesFocus = { zone: "filter", index: 0 };
    }

    if (this.sourcesFocus.zone === "top") {
      this.sourcesFocus.index = clamp(this.sourcesFocus.index, 0, 1);
      return;
    }

    if (this.sourcesFocus.zone === "filter") {
      this.sourcesFocus.index = clamp(
        this.sourcesFocus.index,
        0,
        Math.max(0, availableFilters.length - 1)
      );
      return;
    }

    this.sourcesFocus.index = clamp(
      this.sourcesFocus.index,
      0,
      Math.max(0, availableSources.length - 1)
    );
    if (!availableSources.length && availableFilters.length) {
      this.sourcesFocus = { zone: "filter", index: 0 };
    }
  },
  setSourceFilter(filter) {
    const available = this.getSourceFilters();
    if (!available.includes(filter)) {
      this.sourceFilter = "all";
      return;
    }
    this.sourceFilter = filter;
    this.sourcesFocus = {
      zone: "filter",
      index: clamp(available.indexOf(filter), 0, available.length - 1)
    };
  },

  replaceBrowserStreamCandidates(nextStreams = []) {
    const currentStream = this.getCurrentStreamCandidate();
    const currentIdentity = streamMergeKey(currentStream);
    const activePlaybackUrl = String(this.activePlaybackUrl || "").trim();
    const canonicalStreams = this.normalizeStreamCandidates(nextStreams);

    this.streamCandidates = canonicalStreams;

    const currentIndex = canonicalStreams.findIndex((stream) => {
      if (currentIdentity && streamMergeKey(stream) === currentIdentity) {
        return true;
      }
      if (!activePlaybackUrl) {
        return false;
      }
      const candidateUrl = streamDirectPlaybackUrl(stream);
      return candidateUrl === activePlaybackUrl || stream.url === activePlaybackUrl;
    });

    // A reload only updates the Sources panel. It must never redirect playback
    // to whichever source happens to occupy the old array index.
    this.currentStreamIndex =
      currentIndex >= 0 ? currentIndex : activePlaybackUrl ? -1 : canonicalStreams.length ? 0 : -1;

    if (!this.getSourceFilters().includes(this.sourceFilter)) {
      this.sourceFilter = "all";
    }
  },

  openSourcesPanel({ forceReload = false } = {}) {
    if (this.offlineDownloadId) {
      this.sourcesPanelVisible = true;
      this.subtitleDialogVisible = false;
      this.audioDialogVisible = false;
      this.speedDialogVisible = false;
      this.moreActionsVisible = false;
      if (this.episodePanelVisible) this.hideEpisodePanel();
      this.renderControlButtons();
      this.renderSubtitleDialog();
      this.renderAudioDialog();
      this.renderSpeedDialog();
      this.renderSourcesPanel();
      this.updateModalBackdrop();
      return;
    }
    if (Environment.isBrowser()) {
      this.moreActionsVisible = false;
      this.renderCompactBrowserMorePanel?.();
    }
    this.cancelSeekPreview({ commit: false });
    this.sourcesPanelVisible = true;
    this.subtitleDialogVisible = false;
    this.audioDialogVisible = false;
    this.speedDialogVisible = false;
    this.moreActionsVisible = false;

    const filters = this.getSourceFilters();
    this.sourcesFocus = {
      zone: "filter",
      index: clamp(filters.indexOf(this.sourceFilter), 0, Math.max(0, filters.length - 1))
    };

    this.renderControlButtons();
    this.renderSubtitleDialog();
    this.renderAudioDialog();
    this.renderSpeedDialog();
    this.renderSourcesPanel();
    this.updateModalBackdrop();

    const sourceRequestKey = this.getSourceRequestKey();
    // Stream Selection already passes its normalized/deduped candidates into
    // the browser player. Keep that canonical list intact until the user asks
    // to reload. Direct player entries still fetch once as a fallback.
    const shouldLoadBrowserFallback =
      !this.hasPrecomputedStreamCandidates &&
      (!sourceRequestKey || sourceRequestKey !== this.completedSourceRequestKey);
    const shouldLoadSources = Environment.isBrowser()
      ? forceReload || shouldLoadBrowserFallback
      : forceReload || !sourceRequestKey || sourceRequestKey !== this.completedSourceRequestKey;
    if (shouldLoadSources) {
      this.reloadSources();
    }
  },

  getSourceRequestKey() {
    const type = normalizeItemType(this.params?.itemType || "movie");
    const videoId = String(this.params?.videoId || this.params?.itemId || "").trim();
    if (!videoId) {
      return "";
    }
    return [type, videoId, this.params?.season ?? "", this.params?.episode ?? ""].join("|");
  },

  closeSourcesPanel() {
    this.panelAddonPickerOpen = null;
    this.sourcesPanelVisible = false;
    this.sourcesError = "";
    this.renderSourcesPanel();
    this.updateModalBackdrop();
    this.resetControlsAutoHide();
  },

  async reloadSources() {
    if (this.offlineDownloadId) return;
    if (this.sourcesLoading) {
      return;
    }

    const type = normalizeItemType(this.params?.itemType || "movie");
    const videoId = String(this.params?.videoId || this.params?.itemId || "");
    if (!videoId) {
      return;
    }
    const sourceRequestKey = this.getSourceRequestKey();

    const token = this.sourceLoadToken + 1;
    this.sourceLoadToken = token;
    this.sourcesLoading = true;
    this.sourcesError = "";
    this.renderSourcesPanel();

    // Browser reloads accumulate incremental addon chunks in a temporary
    // generation, then atomically replace the current canonical list. Native
    // platforms retain their existing incremental stream-list behavior.
    let nextCanonicalStreams = [];

    const options = {
      itemId: String(this.params?.itemId || ""),
      tmdbId: this.params?.tmdbId ?? this.params?.tmdb_id,
      imdbId: this.params?.imdbId,
      season: this.params?.season ?? null,
      episode: this.params?.episode ?? null,
      onChunk: (chunkResult) => {
        if (token !== this.sourceLoadToken) {
          return;
        }
        const chunkItems = flattenStreamGroups(chunkResult);
        if (!chunkItems.length) {
          return;
        }
        if (Environment.isBrowser()) {
          nextCanonicalStreams = mergeStreamItems(nextCanonicalStreams, chunkItems);
        } else {
          this.streamCandidates = mergeStreamItems(this.streamCandidates, chunkItems);
          this.renderSourcesPanel();
        }
      }
    };

    try {
      const result = await streamRepository.getStreamsFromAllAddons(type, videoId, options);
      if (token !== this.sourceLoadToken) {
        return;
      }
      const resultStreams = flattenStreamGroups(result);
      if (Environment.isBrowser()) {
        nextCanonicalStreams = mergeStreamItems(nextCanonicalStreams, resultStreams);
        this.replaceBrowserStreamCandidates(nextCanonicalStreams);
      } else {
        const merged = mergeStreamItems(this.streamCandidates, resultStreams);
        if (merged.length) {
          this.streamCandidates = merged;
        }
      }
    } catch (error) {
      if (token === this.sourceLoadToken) {
        this.sourcesError = this.formatPlaybackErrorForSources(
          t("panel_failed_load_streams", {}, "Failed to load streams"),
          {
            error,
            streamCandidate: this.getCurrentStreamCandidate(),
            playbackUrl: this.activePlaybackUrl,
            reason: "reload-sources"
          }
        );
      }
    } finally {
      if (token === this.sourceLoadToken) {
        this.completedSourceRequestKey = sourceRequestKey;
        this.sourcesLoading = false;
        this.renderSourcesPanel();
      }
    }
  },

  scheduleSourceLogoRender() {
    if (this.sourceLogoRenderTimer) {
      return;
    }
    this.sourceLogoRenderTimer = setTimeout(() => {
      this.sourceLogoRenderTimer = null;
      if (this.sourcesPanelVisible) {
        this.renderSourcesPanel();
      }
      if (this.episodePanelVisible) {
        this.renderEpisodePanel();
      }
    }, 120);
  },

  getPlayerDrawerIdentity(episode = null) {
    const meta = this.pauseOverlayMeta || this.buildPauseOverlayMeta();
    const title = meta.title || this.params?.playerTitle || this.params?.itemTitle || "Untitled";
    const isSeries = normalizeItemType(this.params?.itemType || "movie") === "series";
    let subtitle = "";
    if (isSeries) {
      const current = episode || this.resolvePauseOverlayEpisodeEntry(this.episodes || []);
      const season = current?.season ?? this.params?.season;
      const number = current?.episode ?? this.params?.episode;
      const code = season != null && number != null ? `S${season} E${number}` : meta.episodeCode;
      subtitle = [code, current?.title || current?.name || meta.episodeTitle]
        .filter(Boolean)
        .join(" • ");
    } else {
      const genres = this.params?.playerGenres || this.params?.genres || meta.genres || "";
      const genreText = Array.isArray(genres) ? genres.join(", ") : String(genres);
      subtitle =
        [genreText, meta.releaseYear].filter(Boolean).join(" • ") ||
        this.params?.itemSubtitle ||
        "";
    }
    return {
      title,
      subtitle,
      logo: meta.logoUrl || this.params?.playerLogoUrl || this.params?.logo || ""
    };
  },

  applyPlayerDrawerHeader(panel, { sources = false, streams = false } = {}) {
    if (!Environment.isBrowser() || !panel) return;
    if (this.renderProposalDrawerHeader?.(panel, { sources, streams })) return;
    const nested = streams && !sources;
    const identity = this.getPlayerDrawerIdentity(
      nested ? this.episodes?.[this.episodePanelIndex] : null
    );
    const close = panel.querySelector(
      sources ? '[data-top-action="close"]' : '[data-episode-action="close"]'
    );
    const back = nested ? panel.querySelector('[data-episode-stream-action="back"]') : null;
    const refresh = panel.querySelector(
      sources ? '[data-top-action="reload"]' : '[data-episode-stream-action="reload"]'
    );
    const header = document.createElement("header");
    header.className = "player-drawer-header";
    header.innerHTML = `<div class="player-drawer-heading">
      <div class="player-drawer-back-slot"></div>
      <div class="player-drawer-identity">
        <div class="player-drawer-brand">${identity.logo ? `<img src="${escapeAttribute(identity.logo)}" alt="${escapeAttribute(identity.title)}" hidden />` : ""}<span class="player-drawer-title">${escapeHtml(identity.title)}</span></div>
        ${identity.subtitle ? `<div class="player-drawer-subtitle">${escapeHtml(identity.subtitle)}</div>` : ""}
      </div><div class="player-drawer-close-slot"></div>
    </div><div class="player-drawer-toolbar"><div class="player-drawer-section-title">${escapeHtml(streams ? t("stream_panel_title", {}, "Streams") : t("episodes_panel_title", {}, "Episodes"))}</div><div class="player-drawer-filter-slot"></div></div>`;
    const icons = {
      close: '<path d="m6 6 12 12M18 6 6 18" />',
      back: '<path d="m14 6-6 6 6 6" />',
      refresh: '<path d="M20 7v5h-5M20 12a8 8 0 1 0-2.3 5.7" />'
    };
    const prepareIcon = (button, icon, label) => {
      if (!button) return;
      button.classList.add("player-drawer-icon");
      button.setAttribute("aria-label", label);
      button.setAttribute("title", label);
      button.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${icons[icon]}</svg>`;
    };
    prepareIcon(close, "close", t("sources_close", {}, "Close"));
    prepareIcon(back, "back", t("episodes_panel_back", {}, "Back"));
    if (close) header.querySelector(".player-drawer-close-slot").append(close);
    if (back) header.querySelector(".player-drawer-back-slot").append(back);
    const slot = header.querySelector(".player-drawer-filter-slot");
    if (sources) {
      const filters = this.getSourceFilters();
      slot.innerHTML = `<label class="player-drawer-picker"><span>${escapeHtml(t("stream_filter_source", {}, "Source"))}</span><select data-player-source-filter aria-label="${escapeAttribute(t("stream_filter_source", {}, "Source"))}">${filters.map((filter) => `<option value="${escapeAttribute(filter)}"${filter === this.sourceFilter ? " selected" : ""}>${escapeHtml(filter === "all" ? t("subtitle_all", {}, "All") : filter)}</option>`).join("")}</select></label>`;
    } else if (streams) {
      const picker = panel.querySelector(".player-episode-source-picker");
      if (picker) {
        picker.classList.add("player-drawer-picker");
        slot.append(picker);
      }
    } else {
      const select = panel.querySelector("[data-player-episode-season]");
      if (select) {
        const picker = document.createElement("label");
        picker.className = "player-drawer-picker season";
        picker.append(select);
        slot.append(picker);
      }
    }
    if (streams && refresh) {
      prepareIcon(refresh, "refresh", t("stream_refresh_sources", {}, "Refresh sources"));
      refresh.classList.add("player-drawer-refresh");
      slot.append(refresh);
    }
    panel
      .querySelectorAll(
        ".player-episode-panel-header, .player-episode-stream-actions, .player-episode-stream-filters, .player-sources-header, .player-source-current-meta, .player-sources-filters"
      )
      .forEach((node) => node.remove());
    panel.prepend(header);
    const image = header.querySelector(".player-drawer-brand img");
    const fallback = header.querySelector(".player-drawer-title");
    if (image) {
      const showLogo = () => {
        if (image.naturalWidth > 0) {
          image.hidden = false;
          fallback.hidden = true;
        }
      };
      image.addEventListener("load", showLogo, { once: true });
      image.addEventListener(
        "error",
        () => {
          image.hidden = true;
          fallback.hidden = false;
        },
        { once: true }
      );
      if (image.complete) showLogo();
    }
  },

  renderSourcesPanel() {
    if (Environment.isBrowser() && this.renderProposalFile?.()) return;
    const panel = this.uiRefs?.sourcesPanel;
    if (!panel) {
      return;
    }

    panel.classList.toggle("hidden", !this.sourcesPanelVisible);
    if (!this.sourcesPanelVisible) {
      panel.innerHTML = "";
      return;
    }

    if (this.offlineDownloadId) {
      const file = this.offlinePlayerDownloads?.find(
        (d) => d.downloadId === this.offlineDownloadId
      );
      panel.innerHTML = `<header class="player-panel-heading"><strong>${escapeHtml(t("player_local_file", {}, "File"))}</strong><button type="button" class="player-control-btn player-panel-close" data-action="source" aria-label="${escapeAttribute(t("common_close", {}, "Close"))}">×</button></header><div class="player-local-file"><strong>${escapeHtml(file?.filename || this.getCurrentStreamCandidate()?.title || this.params.playerTitle || "Offline")}</strong><p>${escapeHtml(t("player_file_on_device", {}, "Saved on this device"))}</p><p>${escapeHtml(file?.mimeType || "")}</p></div>`;
      return;
    }
    const orderedSources = this.getOrderedStreamCandidates();
    const filters = this.getSourceFilters(orderedSources);
    const filtered = this.getFilteredSources(orderedSources);
    const badgeSettings = StreamBadgeSettingsStore.snapshot();
    const showAddonLogo = badgeSettings.showAddonLogo === true;
    const badgePlacement = resolvePlayerSourceBadgePlacement(badgeSettings);
    this.ensureSourcesFocus(filters, filtered);

    panel.innerHTML = `
      <div class="player-sources-header">
        <div class="player-sources-title">${escapeHtml(t("sources_title", {}, "Sources"))}</div>
        <div class="player-sources-actions">
          <button class="player-sources-top-btn focusable${this.sourcesFocus.zone === "top" && this.sourcesFocus.index === 0 ? " focused" : ""}" data-top-action="reload" data-sources-zone="top" data-sources-index="0">${escapeHtml(t("sources_reload", {}, "Reload"))}</button>
          <button class="player-sources-top-btn focusable${this.sourcesFocus.zone === "top" && this.sourcesFocus.index === 1 ? " focused" : ""}" data-top-action="close" data-sources-zone="top" data-sources-index="1">${escapeHtml(t("sources_close", {}, "Close"))}</button>
        </div>
      </div>

      <div class="player-source-current-meta">
        ${escapeHtml(
          this.params?.season != null && this.params?.episode != null
            ? `S${this.params.season} E${this.params.episode}${this.params.playerSubtitle ? ` • ${this.params.playerSubtitle}` : ""}`
            : this.params?.playerTitle || this.params?.itemId || ""
        )}
      </div>

      <div class="player-sources-filters">
        ${filters
          .map((filter, index) => {
            const selected = this.sourceFilter === filter;
            const focused =
              this.sourcesFocus.zone === "filter" && this.sourcesFocus.index === index;
            return `
            <div class="player-sources-filter focusable${selected ? " selected" : ""}${focused ? " focused" : ""}" data-sources-zone="filter" data-sources-index="${index}">
              ${escapeHtml(filter === "all" ? t("subtitle_all", {}, "All") : filter)}
            </div>
          `;
          })
          .join("")}
      </div>

      <div class="player-sources-list">
        ${this.sourcesLoading ? `<div class="player-sources-empty">${escapeHtml(t("stream_finding_source", {}, "Finding stream source"))}</div>` : ""}
        ${this.sourcesError ? `<div class="player-sources-empty">${escapeHtml(this.sourcesError)}</div>` : ""}
        ${
          !this.sourcesLoading && !filtered.length
            ? `<div class="player-sources-empty">${escapeHtml(this._playerListProbePending?.size ? t("stream_finding_source", {}, "Finding stream source") : t("sources_no_streams", {}, "No streams found"))}</div>`
            : filtered
                .map((stream, index) => {
                  const focused =
                    this.sourcesFocus.zone === "list" && this.sourcesFocus.index === index;
                  const currentStream = Environment.isBrowser()
                    ? this.getCurrentStreamCandidate()
                    : null;
                  const isCurrent = Environment.isBrowser()
                    ? Boolean(currentStream) &&
                      streamMergeKey(currentStream) === streamMergeKey(stream)
                    : this.streamCandidates[this.currentStreamIndex]?.url === stream.url;
                  if (Environment.isBrowser()) {
                    const model = normalizeSourceForDisplay(
                      {
                        ...stream,
                        name: stream.raw?.name || stream.name || stream.label,
                        description:
                          stream.raw?.description || stream.raw?.title || stream.description
                      },
                      { badgeSettings }
                    );
                    if (model.showAddonLogo && stream.addonLogo)
                      model.addonLogoUrl = getPlayerSourceLogoDisplayUrl(stream.addonLogo, () =>
                        this.scheduleSourceLogoRender()
                      );
                    return `<article class="stream-route-card stream-route-card-action player-source-card focusable${focused ? " focused" : ""}${isCurrent ? " selected" : ""}" data-sources-zone="list" data-sources-index="${index}" aria-label="${escapeAttribute(model.accessibleLabel)}">${renderBrowserSourceCardContent(model)}${this.renderPanelDownloadButton(index, "source", stream)}${isCurrent ? `<div class="player-source-playing">${escapeHtml(t("sources_playing", {}, "Playing"))}</div>` : ""}</article>`;
                  }
                  const badges = renderPlayerSourceBadges(stream, badgeSettings);
                  const topBadges = badgePlacement === "TOP" ? badges : "";
                  const bottomBadges = badgePlacement === "BOTTOM" ? badges : "";
                  const addonLogoUrl = showAddonLogo
                    ? getPlayerSourceLogoDisplayUrl(stream.addonLogo, () =>
                        this.scheduleSourceLogoRender()
                      )
                    : "";
                  const playingMarker = isCurrent
                    ? `<div class="player-source-playing">${escapeHtml(t("sources_playing", {}, "Playing"))}</div>`
                    : "";
                  const sourceTitle = `<div class="player-source-title">${escapeHtml(stream.label || "Stream")}</div>`;
                  const mainTitle =
                    !showAddonLogo && playingMarker
                      ? `<div class="player-source-title-row">${sourceTitle}${playingMarker}</div>`
                      : sourceTitle;
                  const sourceSide = showAddonLogo
                    ? `<div class="player-source-side">
                  ${addonLogoUrl ? `<img class="player-source-logo" src="${escapeAttribute(addonLogoUrl)}" alt="" decoding="async" loading="lazy" referrerpolicy="no-referrer" />` : ""}
                  <div class="player-source-addon">${escapeHtml(stream.addonName || t("nav_addons", {}, "Addon"))}</div>
                  ${playingMarker}
                </div>`
                    : "";
                  return `
              <article class="player-source-card${sourceSide ? "" : " no-side"} focusable${focused ? " focused" : ""}${isCurrent ? " selected" : ""}" data-sources-zone="list" data-sources-index="${index}">
                <div class="player-source-main">
                  ${topBadges}
                  ${mainTitle}
                  <div class="player-source-desc">${escapeHtml(stream.description || stream.addonName || "")}</div>
                  ${bottomBadges}
                </div>
                ${sourceSide}
              </article>
            `;
                })
                .join("")
        }
      </div>
    `;

    this.applyPlayerDrawerHeader(panel, { sources: true, streams: true });
    const focusedCard = panel.querySelector(".player-source-card.focused");
    if (focusedCard) {
      focusedCard.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  },

  syncSourcesFocusDom() {
    const panel = this.uiRefs?.sourcesPanel;
    if (!panel || !this.sourcesPanelVisible) {
      return;
    }

    const zone = String(this.sourcesFocus?.zone || "filter");
    const index = Number(this.sourcesFocus?.index || 0);
    const focusedNode = panel.querySelector(
      `[data-sources-zone="${zone}"][data-sources-index="${index}"]`
    );
    // Source/filter data can change asynchronously while the panel is open.
    // If the live DOM no longer represents the state, retain the existing full
    // render path so content and focus cannot become misaligned.
    if (!focusedNode) {
      this.renderSourcesPanel();
      return;
    }

    panel.querySelectorAll("[data-sources-zone].focused").forEach((node) => {
      if (node !== focusedNode) {
        node.classList.remove("focused");
      }
    });
    focusedNode.classList.add("focused");
    if (focusedNode.classList.contains("player-source-card")) {
      focusedNode.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  },

  moveSourcesFocus(direction) {
    const orderedSources = this.getOrderedStreamCandidates();
    const filters = this.getSourceFilters(orderedSources);
    const list = this.getFilteredSources(orderedSources);
    this.ensureSourcesFocus(filters, list);
    const zone = this.sourcesFocus.zone;
    let index = Number(this.sourcesFocus.index || 0);

    if (zone === "top") {
      if (direction === "left") {
        this.sourcesFocus = { zone: "top", index: clamp(index - 1, 0, 1) };
        return;
      }
      if (direction === "right") {
        this.sourcesFocus = { zone: "top", index: clamp(index + 1, 0, 1) };
        return;
      }
      if (direction === "down") {
        if (filters.length) {
          this.sourcesFocus = {
            zone: "filter",
            index: clamp(filters.indexOf(this.sourceFilter), 0, filters.length - 1)
          };
        } else if (list.length) {
          this.sourcesFocus = { zone: "list", index: 0 };
        }
        return;
      }
      return;
    }

    if (zone === "filter") {
      if (direction === "left") {
        this.sourcesFocus = {
          zone: "filter",
          index: clamp(index - 1, 0, Math.max(0, filters.length - 1))
        };
        return;
      }
      if (direction === "right") {
        this.sourcesFocus = {
          zone: "filter",
          index: clamp(index + 1, 0, Math.max(0, filters.length - 1))
        };
        return;
      }
      if (direction === "up") {
        this.sourcesFocus = { zone: "top", index: 0 };
        return;
      }
      if (direction === "down" && list.length) {
        this.sourcesFocus = { zone: "list", index: clamp(index, 0, list.length - 1) };
      }
      return;
    }

    if (zone === "list") {
      if (direction === "up") {
        if (index > 0) {
          this.sourcesFocus = { zone: "list", index: index - 1 };
        } else if (filters.length) {
          this.sourcesFocus = {
            zone: "filter",
            index: clamp(filters.indexOf(this.sourceFilter), 0, filters.length - 1)
          };
        } else {
          this.sourcesFocus = { zone: "top", index: 0 };
        }
        return;
      }
      if (direction === "down") {
        this.sourcesFocus = {
          zone: "list",
          index: clamp(index + 1, 0, Math.max(0, list.length - 1))
        };
      }
    }
  },

  async activateSourcesFocus() {
    const zone = this.sourcesFocus.zone;
    const index = Number(this.sourcesFocus.index || 0);
    const orderedSources = this.getOrderedStreamCandidates();
    const filters = this.getSourceFilters(orderedSources);
    const list = this.getFilteredSources(orderedSources);

    if (zone === "top") {
      if (index === 0) {
        await this.reloadSources();
        return;
      }
      this.closeSourcesPanel();
      return;
    }

    if (zone === "filter") {
      const selected = filters[clamp(index, 0, Math.max(0, filters.length - 1))] || "all";
      this.setSourceFilter(selected);
      this.renderSourcesPanel();
      return;
    }

    const selectedStream = list[clamp(index, 0, Math.max(0, list.length - 1))] || null;
    if (selectedStream) {
      this.params.automaticSourceSelection = false;
      await this.playStreamCandidate(selectedStream, { preservePlaybackState: true });
    }
  },

  async handleSourcesPanelKey(event) {
    const keyCode = Number(event?.keyCode || 0);
    if (keyCode === 82) {
      await this.reloadSources();
      return true;
    }

    if (keyCode === 37) {
      this.moveSourcesFocus("left");
      this.syncSourcesFocusDom();
      return true;
    }
    if (keyCode === 39) {
      this.moveSourcesFocus("right");
      this.syncSourcesFocusDom();
      return true;
    }
    if (keyCode === 38) {
      this.moveSourcesFocus("up");
      this.syncSourcesFocusDom();
      return true;
    }
    if (keyCode === 40) {
      this.moveSourcesFocus("down");
      this.syncSourcesFocusDom();
      return true;
    }
    if (isSelectKeyCode(keyCode)) {
      await this.activateSourcesFocus();
      return true;
    }

    return false;
  },

  showAspectToast(label, { durationMs = 1400 } = {}) {
    const toast = this.uiRefs?.aspectToast;
    if (!toast) {
      return;
    }

    toast.textContent = label;
    toast.classList.remove("hidden");

    if (this.aspectToastTimer) {
      clearTimeout(this.aspectToastTimer);
    }

    this.aspectToastTimer = setTimeout(() => {
      toast.classList.add("hidden");
    }, durationMs);
  },

  applyAspectMode({ showToast = false } = {}) {
    const mode = this.aspectModes[this.aspectModeIndex] || this.aspectModes[0];
    const video = PlayerController.video;
    if (video) {
      const rect = this.calculateAspectRect(mode.objectFit, video);
      video.style.position = "fixed";
      video.style.left = `${Math.round(rect.x)}px`;
      video.style.top = `${Math.round(rect.y)}px`;
      video.style.width = `${Math.round(rect.width)}px`;
      video.style.height = `${Math.round(rect.height)}px`;
      video.style.objectFit = "fill";
      video.style.maxWidth = "none";
      video.style.maxHeight = "none";
      video.style.background = "black";
    }
    if (showToast) {
      this.showAspectToast(mode.label);
    }
  },

  calculateAspectRect(objectFit = "contain", video = PlayerController.video) {
    const viewport =
      typeof PlayerController.getPlayerViewportSize === "function"
        ? PlayerController.getPlayerViewportSize()
        : {
            width: Math.max(
              1,
              Number(
                window.innerWidth ||
                  document.documentElement?.clientWidth ||
                  globalThis.screen?.width ||
                  1920
              )
            ),
            height: Math.max(
              1,
              Number(
                window.innerHeight ||
                  document.documentElement?.clientHeight ||
                  globalThis.screen?.height ||
                  1080
              )
            )
          };
    const viewportWidth = this.browserOrientation?.mobile
      ? this.browserOrientation.width
      : viewport.width;
    const portraitBand = this.getProposalLayout?.().portrait && !this.getProposalLayout?.().desktop;
    const videoTop = portraitBand ? 120 : 0;
    const viewportHeight = portraitBand
      ? 210
      : this.browserOrientation?.mobile
        ? this.browserOrientation.height
        : viewport.height;
    if (objectFit === "fill") {
      return {
        x: 0,
        y: videoTop,
        width: viewportWidth,
        height: viewportHeight,
        displayMethod: "PLAYER_DISPLAY_MODE_FULL_SCREEN"
      };
    }

    const videoWidth = Number(video?.videoWidth || 0);
    const videoHeight = Number(video?.videoHeight || 0);
    const mediaRatio = videoWidth > 0 && videoHeight > 0 ? videoWidth / videoHeight : 16 / 9;
    const viewportRatio = viewportWidth / viewportHeight;
    const shouldCover = objectFit === "cover";
    const widthLimited = shouldCover ? viewportRatio > mediaRatio : viewportRatio < mediaRatio;
    const width = widthLimited ? viewportWidth : viewportHeight * mediaRatio;
    const height = widthLimited ? viewportWidth / mediaRatio : viewportHeight;

    return {
      x: (viewportWidth - width) / 2,
      y: videoTop + (viewportHeight - height) / 2,
      width,
      height,
      displayMethod: shouldCover
        ? "PLAYER_DISPLAY_MODE_FULL_SCREEN"
        : "PLAYER_DISPLAY_MODE_LETTER_BOX"
    };
  },

  cycleAspectMode() {
    this.aspectModeIndex = (this.aspectModeIndex + 1) % this.aspectModes.length;
    this.applyAspectMode({ showToast: true });
  },
  renderParentalGuideOverlay() {
    if (Environment.isBrowser() && this.renderProposalWarning?.()) return;
    const overlay = this.uiRefs?.parentalGuide;
    if (!overlay) {
      return;
    }

    const shouldRender =
      (this.parentalGuideVisible || this.parentalGuideExiting) && this.parentalWarnings.length;
    overlay.classList.toggle("hidden", !shouldRender);
    overlay.classList.toggle("is-exiting", Boolean(this.parentalGuideExiting));
    if (!shouldRender) {
      overlay.innerHTML = "";
      overlay.style.removeProperty("animation-delay");
      overlay.style.removeProperty("--parental-item-count");
      overlay.style.removeProperty("--parental-line-height");
      overlay.style.removeProperty("--parental-line-exit-delay");
      overlay.style.removeProperty("--parental-container-exit-delay");
      this.stopParentalGuideLineAnimation();
      return;
    }

    const total = this.parentalWarnings.length;
    const firstItemDelay =
      PARENTAL_GUIDE_CONTAINER_IN_MS + PARENTAL_GUIDE_LINE_IN_MS + PARENTAL_GUIDE_ITEM_STAGGER_MS;
    const lineExitDelay =
      Math.max(0, total * (PARENTAL_GUIDE_ITEM_EXIT_STAGGER_MS + PARENTAL_GUIDE_ITEM_EXIT_MS)) +
      PARENTAL_GUIDE_LINE_OUT_DELAY_MS;
    const containerExitDelay =
      lineExitDelay + PARENTAL_GUIDE_LINE_OUT_MS + PARENTAL_GUIDE_CONTAINER_OUT_DELAY_MS;
    const rowHeight = Environment.isBrowser() ? 28 : PARENTAL_GUIDE_ROW_HEIGHT;
    const rowGap = Environment.isBrowser() ? 3 : PARENTAL_GUIDE_ROW_GAP;
    const lineHeight = rowHeight * total + rowGap * Math.max(0, total - 1);
    const currentLineHeight = clamp(Number(this.parentalGuideLineProgress || 0), 0, lineHeight);
    const rootStyle = getComputedStyle(document.documentElement);
    const parentalAccent = rootStyle.getPropertyValue("--secondary-color").trim() || "#f5f5f5";
    overlay.style.animationDelay = this.parentalGuideExiting ? `${containerExitDelay}ms` : "0ms";
    overlay.style.setProperty("--parental-row-height", `${rowHeight}px`);
    overlay.style.setProperty("--parental-row-gap", `${rowGap}px`);
    overlay.style.setProperty("--parental-item-count", String(total));
    overlay.style.setProperty("--parental-line-height", `${lineHeight}px`);
    overlay.style.setProperty("--parental-line-exit-delay", `${lineExitDelay}ms`);
    overlay.style.setProperty("--parental-container-exit-delay", `${containerExitDelay}ms`);
    overlay.style.setProperty("--parental-accent", parentalAccent);
    overlay.innerHTML = `
      <div class="player-parental-line">
        <div class="player-parental-line-fill"></div>
      </div>
      <div class="player-parental-list">
        ${this.parentalWarnings
          .map((warning, index) => {
            const enterDelay =
              firstItemDelay + index * (PARENTAL_GUIDE_ITEM_STAGGER_MS + PARENTAL_GUIDE_ITEM_IN_MS);
            const exitDelay =
              PARENTAL_GUIDE_ITEM_EXIT_STAGGER_MS +
              (total - index - 1) *
                (PARENTAL_GUIDE_ITEM_EXIT_STAGGER_MS + PARENTAL_GUIDE_ITEM_EXIT_MS);
            const activeDelay = this.parentalGuideExiting ? exitDelay : enterDelay;
            return `
          <div class="player-parental-item" style="animation-delay:${activeDelay}ms;--parental-enter-delay:${enterDelay}ms;--parental-exit-delay:${exitDelay}ms">
            <span class="player-parental-label">${escapeHtml(warning.label)}</span>
            <span class="player-parental-separator"> · </span>
            <span class="player-parental-severity">${escapeHtml(warning.severity)}</span>
          </div>
        `;
          })
          .join("")}
      </div>
    `;

    const line = overlay.querySelector(".player-parental-line");
    const lineFill = overlay.querySelector(".player-parental-line-fill");
    if (line) {
      line.style.height = `${currentLineHeight.toFixed(2)}px`;
    }
    if (lineFill) {
      lineFill.style.background = parentalAccent;
    }
  },

  stopParentalGuideLineAnimation({ reset = true } = {}) {
    if (this.parentalGuideLineEnterTimer) {
      clearTimeout(this.parentalGuideLineEnterTimer);
      this.parentalGuideLineEnterTimer = null;
    }
    if (this.parentalGuideLineExitTimer) {
      clearTimeout(this.parentalGuideLineExitTimer);
      this.parentalGuideLineExitTimer = null;
    }
    if (
      this.parentalGuideLineAnimationFrame != null &&
      typeof cancelAnimationFrame === "function"
    ) {
      cancelAnimationFrame(this.parentalGuideLineAnimationFrame);
    }
    this.parentalGuideLineAnimationFrame = null;
    if (reset) {
      this.parentalGuideLineProgress = 0;
      const line = this.uiRefs?.parentalGuide?.querySelector(".player-parental-line");
      if (line) {
        line.style.height = "0px";
      }
    }
  },

  animateParentalGuideLine(targetProgress, durationMs = 1) {
    const line = this.uiRefs?.parentalGuide?.querySelector(".player-parental-line");
    if (!line) {
      return;
    }

    const target = Math.max(0, Number(targetProgress || 0));
    const from = Math.max(0, Number(this.parentalGuideLineProgress || 0));
    if (typeof requestAnimationFrame !== "function") {
      this.parentalGuideLineProgress = target;
      line.style.height = `${Math.max(0, target).toFixed(2)}px`;
      return;
    }

    if (this.parentalGuideLineAnimationFrame != null) {
      cancelAnimationFrame(this.parentalGuideLineAnimationFrame);
      this.parentalGuideLineAnimationFrame = null;
    }

    const startedAt = performance?.now?.() ?? Date.now();
    const tick = (timestamp) => {
      const elapsed = Math.max(0, Number(timestamp || Date.now()) - startedAt);
      const progress = clamp(elapsed / Math.max(1, Number(durationMs || 1)), 0, 1);
      this.parentalGuideLineProgress = from + (target - from) * progress;
      line.style.height = `${Math.max(0, this.parentalGuideLineProgress).toFixed(2)}px`;
      if (progress < 1) {
        this.parentalGuideLineAnimationFrame = requestAnimationFrame(tick);
        return;
      }
      this.parentalGuideLineAnimationFrame = null;
    };

    this.parentalGuideLineAnimationFrame = requestAnimationFrame(tick);
  },

  scheduleParentalGuideLineAnimation(targetProgress, delayMs, durationMs) {
    const start = () => {
      this.parentalGuideLineEnterTimer = null;
      this.animateParentalGuideLine(targetProgress, durationMs);
    };
    if (delayMs > 0) {
      this.parentalGuideLineEnterTimer = setTimeout(start, delayMs);
      return;
    }
    start();
  },

  showParentalGuideOverlay() {
    if (!this.parentalWarnings.length) {
      return;
    }

    this.parentalGuideVisible = true;
    this.parentalGuideExiting = false;
    this.parentalGuideShown = true;
    this.renderParentalGuideOverlay();
    this.stopParentalGuideLineAnimation({ reset: true });
    const rowHeight = Environment.isBrowser() ? 28 : PARENTAL_GUIDE_ROW_HEIGHT;
    const rowGap = Environment.isBrowser() ? 3 : PARENTAL_GUIDE_ROW_GAP;
    const lineHeight =
      rowHeight * this.parentalWarnings.length +
      rowGap * Math.max(0, this.parentalWarnings.length - 1);
    this.scheduleParentalGuideLineAnimation(
      lineHeight,
      PARENTAL_GUIDE_CONTAINER_IN_MS,
      PARENTAL_GUIDE_LINE_IN_MS
    );

    if (this.parentalGuideTimer) {
      clearTimeout(this.parentalGuideTimer);
    }
    if (this.parentalGuideExitTimer) {
      clearTimeout(this.parentalGuideExitTimer);
      this.parentalGuideExitTimer = null;
    }

    const enterDuration =
      PARENTAL_GUIDE_CONTAINER_IN_MS +
      PARENTAL_GUIDE_LINE_IN_MS +
      this.parentalWarnings.length * (PARENTAL_GUIDE_ITEM_STAGGER_MS + PARENTAL_GUIDE_ITEM_IN_MS);
    this.parentalGuideTimer = setTimeout(() => {
      this.hideParentalGuideOverlay();
    }, enterDuration + PARENTAL_GUIDE_HOLD_MS);
  },

  hideParentalGuideOverlay() {
    if (this.parentalGuideTimer) {
      clearTimeout(this.parentalGuideTimer);
      this.parentalGuideTimer = null;
    }
    if (!this.parentalGuideVisible || !this.parentalWarnings.length) {
      this.parentalGuideVisible = false;
      this.parentalGuideExiting = false;
      this.renderParentalGuideOverlay();
      return;
    }

    this.parentalGuideVisible = false;
    this.parentalGuideExiting = true;
    this.renderParentalGuideOverlay();
    this.stopParentalGuideLineAnimation({ reset: false });

    if (this.parentalGuideExitTimer) {
      clearTimeout(this.parentalGuideExitTimer);
    }
    const total = this.parentalWarnings.length;
    const lineExitDelay =
      Math.max(0, total * (PARENTAL_GUIDE_ITEM_EXIT_STAGGER_MS + PARENTAL_GUIDE_ITEM_EXIT_MS)) +
      PARENTAL_GUIDE_LINE_OUT_DELAY_MS;
    const containerExitDelay =
      lineExitDelay + PARENTAL_GUIDE_LINE_OUT_MS + PARENTAL_GUIDE_CONTAINER_OUT_DELAY_MS;
    this.parentalGuideLineExitTimer = setTimeout(() => {
      this.parentalGuideLineExitTimer = null;
      this.animateParentalGuideLine(0, PARENTAL_GUIDE_LINE_OUT_MS);
    }, lineExitDelay);
    this.parentalGuideExitTimer = setTimeout(() => {
      this.parentalGuideExiting = false;
      this.parentalGuideExitTimer = null;
      this.stopParentalGuideLineAnimation();
      this.renderParentalGuideOverlay();
    }, containerExitDelay + PARENTAL_GUIDE_CONTAINER_OUT_MS);
  },

  async loadOfflinePlayerLibrary() {
    const id = this.offlineDownloadId;
    if (!id || this.offlinePlayerLibraryLoaded) return;
    const downloads = await listOfflineDownloads().catch(() => []);
    if (this.offlineDownloadId !== id) return;
    const current = downloads.find((d) => d.downloadId === id);
    this.offlinePlayerDownloads = current
      ? selectCompletedOfflineDetailDownloads(downloads, {
          itemType: this.params.itemType,
          itemIds: [current.seriesId, current.mediaId, this.params.itemId]
        })
      : [];
    if (normalizeItemType(this.params.itemType) === "series") {
      const stored = createOfflineEpisodeEntries(this.offlinePlayerDownloads);
      for (const episode of stored) {
        const artwork = await getBrowserOfflineArtwork(episode.offlineDownloadId, "backdrop").catch(
          () => null
        );
        if (this.offlineDownloadId !== id) return;
        episode.thumbnail = artwork?.file ? URL.createObjectURL(artwork.file) : null;
        if (episode.thumbnail) this.offlinePlayerArtworkUrls.add(episode.thumbnail);
      }
      this.episodes = stored.map((episode) => ({
        ...this.episodes.find(
          (e) => Number(e.season) === episode.season && Number(e.episode) === episode.episode
        ),
        ...episode
      }));
      this.episodePanelIndex = Math.max(
        0,
        this.episodes.findIndex(
          (e) =>
            Number(e.season) === Number(this.params.season) &&
            Number(e.episode) === Number(this.params.episode)
        )
      );
    }
    this.offlinePlayerLibraryLoaded = true;
    this.renderControlButtons();
    if (this.episodePanelVisible) this.renderEpisodePanel();
    if (this.sourcesPanelVisible) this.renderSourcesPanel();
  },

  async playOfflinePlayerEpisode(episode) {
    if (!episode?.offlineDownloadId || this.switchingEpisode) return false;
    this.switchingEpisode = true;
    let playback;
    try {
      playback = await createBrowserOfflinePlayback(episode.offlineDownloadId);
      if (!playback) {
        this.showAspectToast(
          t("player_offline_file_unavailable", {}, "Downloaded file is unavailable")
        );
        return false;
      }
      const source = {
        id: `offline-${playback.download.downloadId}`,
        url: playback.objectUrl,
        title: playback.download.filename || episode.title,
        addonName: "Offline",
        mimeType: playback.download.mimeType
      };
      await PlayerController.flushCurrentProgress({ allowCloudSync: false });
      await Router.navigate("player", {
        ...this.params,
        videoId: episode.id,
        season: episode.season,
        episode: episode.episode,
        playerSubtitle: `S${episode.season} E${episode.episode} · ${episode.title || ""}`,
        playerEpisodeTitle: episode.title,
        streamUrl: playback.objectUrl,
        streamCandidates: [source],
        preferredStreamId: source.id,
        offlineDownloadId: playback.download.downloadId,
        offlineObjectUrl: playback.objectUrl,
        playbackSourceContext: { addonName: source.addonName, selectedStreamId: source.id },
        unverifiedPlayback: null,
        episodes: this.episodes,
        automaticSourceSelection: false,
        prepareSelectedSource: false,
        resumePositionMs: 0,
        resumeDurationMs: 0
      });
      return true;
    } catch (_) {
      releaseBrowserOfflinePlayback(playback);
      return false;
    } finally {
      this.switchingEpisode = false;
    }
  },

  toggleEpisodePanel() {
    if (Environment.isBrowser()) {
      this.moreActionsVisible = false;
      this.renderCompactBrowserMorePanel?.();
    }

    if (!this.episodes.length) {
      return;
    }
    if (this.episodePanelVisible) {
      this.hideEpisodePanel();
      return;
    }
    this.episodePanelVisible = true;
    this.episodePanelMode = "episodes";
    this.episodePanelStreamsError = "";
    this.episodePanelStreamsLoading = false;
    this.subtitleDialogVisible = false;
    this.audioDialogVisible = false;
    this.speedDialogVisible = false;
    this.sourcesPanelVisible = false;
    this.syncEpisodePanelSeasonToIndex();
    this.episodePanelFocusZone = "episodes";
    this.updateModalBackdrop();
    this.setControlsVisible(true, { focus: false });
    this.renderSubtitleDialog();
    this.renderAudioDialog();
    this.renderSpeedDialog();
    this.renderSourcesPanel();
    this.renderEpisodePanel();
  },

  getEpisodePanelSeasons() {
    const seen = new Set();
    const seasons = [];
    this.episodes.forEach((episode) => {
      const season = Number(episode?.season);
      if (!Number.isFinite(season) || seen.has(season)) {
        return;
      }
      seen.add(season);
      seasons.push(season);
    });
    const regular = seasons.filter((season) => season > 0).sort((left, right) => left - right);
    const specials = seasons.filter((season) => season === 0);
    return [...regular, ...specials];
  },

  getEpisodePanelSeasonLabel(season) {
    if (!Number.isFinite(Number(season))) {
      return t("episodes_panel_title", {}, "Episodes");
    }
    return Number(season) === 0
      ? t("episodes_specials", {}, "Specials")
      : t("episodes_season", [Number(season)], "Season %1$d");
  },

  syncEpisodePanelSeasonToIndex() {
    const seasons = this.getEpisodePanelSeasons();
    if (seasons.length <= 1) {
      this.episodePanelSeason = null;
      this.episodePanelSeasonIndex = 0;
      return;
    }
    const selectedEpisode = this.episodes[this.episodePanelIndex] || null;
    const selectedSeason = Number(selectedEpisode?.season);
    const fallbackSeason = Number(this.params?.season);
    const resolvedSeason = Number.isFinite(selectedSeason)
      ? selectedSeason
      : Number.isFinite(fallbackSeason)
        ? fallbackSeason
        : seasons[0];
    const seasonIndex = Math.max(0, seasons.indexOf(resolvedSeason));
    this.episodePanelSeasonIndex = seasonIndex;
    this.episodePanelSeason = seasons[seasonIndex] ?? seasons[0];
  },

  getEpisodePanelEntries() {
    const seasons = this.getEpisodePanelSeasons();
    const activeSeason = seasons.length > 1 ? Number(this.episodePanelSeason) : null;
    return this.episodes
      .map((episode, index) => ({ episode, index }))
      .filter(({ episode }) => activeSeason == null || Number(episode?.season) === activeSeason);
  },

  moveEpisodePanel(delta) {
    if (!this.episodePanelVisible || !this.episodes.length) {
      return;
    }
    const entries = this.getEpisodePanelEntries();
    if (!entries.length) {
      return;
    }
    const currentPosition = Math.max(
      0,
      entries.findIndex((entry) => entry.index === this.episodePanelIndex)
    );
    const nextPosition = clamp(currentPosition + delta, 0, entries.length - 1);
    this.episodePanelIndex = entries[nextPosition]?.index ?? this.episodePanelIndex;
    this.episodePanelFocusZone = "episodes";
    this.renderEpisodePanel();
  },

  renderEpisodeSeasonSelect(seasons) {
    return (
      '<select class="player-episode-season-select" data-player-episode-season aria-label="Season">' +
      seasons
        .map(
          (season) =>
            '<option value="' +
            season +
            '"' +
            (Number(season) === Number(this.episodePanelSeason) ? " selected" : "") +
            ">" +
            escapeHtml(this.getEpisodePanelSeasonLabel(season)) +
            "</option>"
        )
        .join("") +
      "</select>"
    );
  },

  selectEpisodePanelSeason(season) {
    const seasons = this.getEpisodePanelSeasons();
    const index = seasons.indexOf(Number(season));
    if (index < 0) return false;
    this.episodePanelSeasonIndex = index;
    this.episodePanelSeason = seasons[index];
    const first = this.getEpisodePanelEntries()[0];
    if (first) this.episodePanelIndex = first.index;
    this.episodePanelFocusZone = "episodes";
    this.renderEpisodePanel();
    return true;
  },

  moveEpisodePanelSeason(delta) {
    const seasons = this.getEpisodePanelSeasons();
    if (seasons.length <= 1) {
      return;
    }
    const currentIndex = seasons.indexOf(Number(this.episodePanelSeason));
    const nextIndex = clamp(
      (currentIndex >= 0 ? currentIndex : this.episodePanelSeasonIndex) + delta,
      0,
      seasons.length - 1
    );
    this.episodePanelSeasonIndex = nextIndex;
    this.episodePanelSeason = seasons[nextIndex];
    const firstEntry = this.getEpisodePanelEntries()[0];
    if (firstEntry) {
      this.episodePanelIndex = firstEntry.index;
    }
    this.episodePanelFocusZone = "seasons";
    this.renderEpisodePanel();
  },

  getEpisodePanelStreamFilters() {
    const addons = [];
    (this.episodePanelStreams || []).forEach((stream) => {
      const addonName = String(stream?.addonName || "").trim();
      if (addonName && !addons.includes(addonName)) {
        addons.push(addonName);
      }
    });
    return ["all", ...addons];
  },

  selectEpisodePanelSource(source) {
    const filters = this.getEpisodePanelStreamFilters();
    if (!filters.includes(source)) return false;
    this.episodePanelStreamFilter = source;
    this.episodePanelStreamFocus = { zone: "filters", index: filters.indexOf(source) };
    this.renderEpisodePanel();
    this.uiRefs?.root
      ?.querySelector("[data-player-episode-source]")
      ?.focus({ preventScroll: true });
    return true;
  },

  getFilteredEpisodePanelStreams() {
    const streams = Array.isArray(this.episodePanelStreams) ? this.episodePanelStreams : [];
    const visible = this.filterPlayerStreamList(streams);
    if (this.episodePanelStreamFilter === "all") {
      return visible;
    }
    return visible.filter(
      (stream) => String(stream?.addonName || "") === this.episodePanelStreamFilter
    );
  },

  closeEpisodeStreamsView() {
    this.episodePanelMode = "episodes";
    this.episodePanelStreamsLoading = false;
    this.episodePanelStreamsError = "";
    this.episodePanelFocusZone = "episodes";
    this.renderEpisodePanel();
  },

  async openEpisodeStreamsView({ forceReload = true, automatic = false } = {}) {
    const selected = this.episodes[this.episodePanelIndex] || null;
    if (!selected?.id) {
      return;
    }
    this.episodePanelMode = "streams";
    this.episodePanelStreamVideoId = String(selected.id);
    this.episodePanelStreamFilter = "all";
    this.episodePanelStreamFocus = { zone: "actions", index: 0 };
    this.episodePanelStreamsError = "";
    this.episodePanelStreamsLoading = true;
    this.renderEpisodePanel();

    const itemType = this.params?.itemType || "series";
    const cacheKey = this.getStreamCacheKey(selected.id, normalizeItemType(itemType));
    if (forceReload) {
      this.streamCandidatesByVideoId?.delete?.(cacheKey);
    }
    const token = Number(this.episodePanelStreamLoadToken || 0) + 1;
    this.episodePanelStreamLoadToken = token;
    try {
      const settings = PlayerSettingsStore.get();
      const selection =
        automatic && isAutoPlayEffectivelyEnabled(settings)
          ? await this.resolveNextEpisodeStreamByAutoPlayPolicy(
              { videoId: selected.id, season: selected.season, episode: selected.episode },
              itemType,
              settings
            )
          : null;
      const streams =
        selection?.streamItems ??
        (await this.getPlayableStreamsForVideo(selected.id, itemType, {
          season: selected.season,
          episode: selected.episode
        }));
      if (
        token !== this.episodePanelStreamLoadToken ||
        !this.episodePanelVisible ||
        this.episodePanelMode !== "streams" ||
        String(this.episodePanelStreamVideoId || "") !== String(selected.id)
      ) {
        return;
      }
      this.episodePanelStreams = streams;
      this.episodePanelStreamsLoading = false;
      if (selection?.selectedStream) {
        await this.playEpisodeFromPanel(selection.selectedStream, {
          automatic: true,
          complete: selection.complete
        });
        return;
      }
      this.episodePanelStreamFocus = streams.length
        ? { zone: "streams", index: 0 }
        : { zone: "actions", index: 0 };
    } catch (_error) {
      if (token !== this.episodePanelStreamLoadToken) {
        return;
      }
      this.episodePanelStreams = [];
      this.episodePanelStreamsLoading = false;
      this.episodePanelStreamsError = t("panel_failed_load_streams", {}, "Failed to load streams");
      this.episodePanelStreamFocus = { zone: "actions", index: 0 };
    }
    this.renderEpisodePanel();
  },

  moveEpisodeStreamFocus(direction) {
    const filters = this.getEpisodePanelStreamFilters();
    const streams = this.getFilteredEpisodePanelStreams();
    const focus = this.episodePanelStreamFocus || { zone: "actions", index: 0 };
    let index = Number(focus.index || 0);

    if (focus.zone === "close") {
      if (direction === "down") {
        this.episodePanelStreamFocus = { zone: "actions", index: 0 };
      }
      return;
    }
    if (focus.zone === "actions") {
      if (direction === "left" || direction === "right") {
        this.episodePanelStreamFocus = {
          zone: "actions",
          index: clamp(index + (direction === "right" ? 1 : -1), 0, 1)
        };
      } else if (direction === "up") {
        this.episodePanelStreamFocus = { zone: "close", index: 0 };
      } else if (direction === "down") {
        this.episodePanelStreamFocus = filters.length
          ? {
              zone: "filters",
              index: clamp(filters.indexOf(this.episodePanelStreamFilter), 0, filters.length - 1)
            }
          : { zone: "streams", index: 0 };
      }
      return;
    }
    if (focus.zone === "filters") {
      if (direction === "left" || direction === "right") {
        this.episodePanelStreamFocus = {
          zone: "filters",
          index: clamp(index + (direction === "right" ? 1 : -1), 0, Math.max(0, filters.length - 1))
        };
      } else if (direction === "up") {
        this.episodePanelStreamFocus = { zone: "actions", index: 0 };
      } else if (direction === "down" && streams.length) {
        this.episodePanelStreamFocus = { zone: "streams", index: 0 };
      }
      return;
    }
    if (focus.zone === "streams") {
      if (direction === "up") {
        this.episodePanelStreamFocus =
          index > 0
            ? { zone: "streams", index: index - 1 }
            : {
                zone: "filters",
                index: clamp(
                  filters.indexOf(this.episodePanelStreamFilter),
                  0,
                  Math.max(0, filters.length - 1)
                )
              };
      } else if (direction === "down") {
        this.episodePanelStreamFocus = {
          zone: "streams",
          index: clamp(index + 1, 0, Math.max(0, streams.length - 1))
        };
      }
    }
  },

  async activateEpisodeStreamFocus() {
    const focus = this.episodePanelStreamFocus || { zone: "actions", index: 0 };
    if (focus.zone === "close") {
      this.hideEpisodePanel();
      return;
    }
    if (focus.zone === "actions") {
      if (Number(focus.index || 0) === 0) {
        this.closeEpisodeStreamsView();
      } else {
        await this.openEpisodeStreamsView({ forceReload: true });
      }
      return;
    }
    if (focus.zone === "filters") {
      const filters = this.getEpisodePanelStreamFilters();
      this.episodePanelStreamFilter =
        filters[clamp(Number(focus.index || 0), 0, Math.max(0, filters.length - 1))] || "all";
      this.episodePanelStreamFocus = {
        zone: "filters",
        index: Math.max(0, filters.indexOf(this.episodePanelStreamFilter))
      };
      this.renderEpisodePanel();
      return;
    }
    const streams = this.getFilteredEpisodePanelStreams();
    const selectedStream =
      streams[clamp(Number(focus.index || 0), 0, Math.max(0, streams.length - 1))] || null;
    if (selectedStream) {
      await this.playEpisodeFromPanel(selectedStream);
    }
  },

  handleEpisodePanelKey(event) {
    if (!this.episodePanelVisible) {
      return false;
    }
    const keyCode = Number(event?.keyCode || event?.which || event?.originalKeyCode || 0);
    const isNavigationKey =
      keyCode === 37 ||
      keyCode === 38 ||
      keyCode === 39 ||
      keyCode === 40 ||
      isSelectKeyCode(keyCode);
    if (!isNavigationKey) {
      return false;
    }
    event?.preventDefault?.();
    event?.stopPropagation?.();
    event?.stopImmediatePropagation?.();

    if (this.episodePanelMode === "streams") {
      if (keyCode === 37) {
        this.moveEpisodeStreamFocus("left");
      } else if (keyCode === 38) {
        this.moveEpisodeStreamFocus("up");
      } else if (keyCode === 39) {
        this.moveEpisodeStreamFocus("right");
      } else if (keyCode === 40) {
        this.moveEpisodeStreamFocus("down");
      } else if (isSelectKeyCode(keyCode)) {
        void this.activateEpisodeStreamFocus();
        return true;
      }
      this.renderEpisodePanel();
      return true;
    }

    const seasons = this.getEpisodePanelSeasons();
    const hasSeasonTabs = seasons.length > 1;
    const entries = this.getEpisodePanelEntries();
    const currentPosition = Math.max(
      0,
      entries.findIndex((entry) => entry.index === this.episodePanelIndex)
    );

    if (keyCode === 38) {
      if (this.episodePanelFocusZone === "episodes") {
        if (currentPosition > 0) {
          this.moveEpisodePanel(-1);
        } else {
          this.episodePanelFocusZone = hasSeasonTabs ? "seasons" : "close";
          this.renderEpisodePanel();
        }
        return true;
      }
      if (this.episodePanelFocusZone === "seasons") {
        this.episodePanelFocusZone = "close";
        this.renderEpisodePanel();
        return true;
      }
      return true;
    }

    if (keyCode === 40) {
      if (this.episodePanelFocusZone === "close") {
        this.episodePanelFocusZone = hasSeasonTabs ? "seasons" : "episodes";
        this.renderEpisodePanel();
        return true;
      }
      if (this.episodePanelFocusZone === "seasons") {
        this.episodePanelFocusZone = "episodes";
        this.renderEpisodePanel();
        return true;
      }
      this.moveEpisodePanel(1);
      return true;
    }

    if (keyCode === 37 || keyCode === 39) {
      if (this.episodePanelFocusZone === "seasons") {
        this.moveEpisodePanelSeason(keyCode === 37 ? -1 : 1);
      }
      return true;
    }

    if (isSelectKeyCode(keyCode)) {
      if (this.episodePanelFocusZone === "close") {
        this.hideEpisodePanel();
        return true;
      }
      if (this.episodePanelFocusZone === "seasons") {
        this.episodePanelFocusZone = "episodes";
        this.renderEpisodePanel();
        return true;
      }
      this.playEpisodeFromPanel();
      return true;
    }

    return true;
  },

  scrollEpisodePanelIntoView() {
    const panel = this.uiRefs?.root?.querySelector("#episodeSidePanel");
    if (!panel || !this.episodePanelVisible) {
      return;
    }

    const scrollVerticallyWithin = (container, target, padding = 12) => {
      if (!container || !target) {
        return;
      }
      const containerRect = playerLocalRect(container, this.browserOrientation);
      const targetRect = playerLocalRect(target, this.browserOrientation);
      if (targetRect.top < containerRect.top + padding) {
        container.scrollTop -= containerRect.top + padding - targetRect.top;
      } else if (targetRect.bottom > containerRect.bottom - padding) {
        container.scrollTop += targetRect.bottom - (containerRect.bottom - padding);
      }
    };

    const scrollHorizontallyWithin = (container, target, padding = 8) => {
      if (!container || !target) {
        return;
      }
      const containerRect = playerLocalRect(container, this.browserOrientation);
      const targetRect = playerLocalRect(target, this.browserOrientation);
      if (targetRect.left < containerRect.left + padding) {
        container.scrollLeft -= containerRect.left + padding - targetRect.left;
      } else if (targetRect.right > containerRect.right - padding) {
        container.scrollLeft += targetRect.right - (containerRect.right - padding);
      }
    };

    const selected =
      panel.querySelector(".player-episode-item.focused") ||
      panel.querySelector(".player-episode-item.selected");
    scrollVerticallyWithin(panel.querySelector(".player-episode-list"), selected);

    const focusedSeason = panel.querySelector(".player-episode-season-tab.focused");
    scrollHorizontallyWithin(panel.querySelector(".player-episode-season-tabs"), focusedSeason);

    const focusedStream = panel.querySelector(".player-episode-stream-card.focused");
    scrollVerticallyWithin(panel.querySelector(".player-episode-stream-list"), focusedStream);

    const focusedFilter = panel.querySelector(".player-episode-stream-filter.focused");
    scrollHorizontallyWithin(panel.querySelector(".player-episode-stream-filters"), focusedFilter);

    try {
      const focused = panel.querySelector(".focused");
      focused?.focus?.({ preventScroll: true });
    } catch (_) {
      // Some TV WebKit builds reject programmatic focus during DOM replacement.
    }
  },

  renderEpisodeStreamsView() {
    const selectedEpisode = this.episodes[this.episodePanelIndex] || null;
    const filters = this.getEpisodePanelStreamFilters();
    const streams = this.getFilteredEpisodePanelStreams();
    const focus = this.episodePanelStreamFocus || { zone: "actions", index: 0 };
    const badgeSettings = StreamBadgeSettingsStore.snapshot();
    const showAddonLogo = badgeSettings.showAddonLogo === true;
    const badgePlacement = resolvePlayerSourceBadgePlacement(badgeSettings);
    const episodeCode = episodeDisplayCode(selectedEpisode);
    const episodeTitle = String(
      selectedEpisode?.title || t("episodes_episode", {}, "Episode")
    ).trim();

    return `
      <div class="player-episode-stream-actions">
        <button type="button"
                class="player-episode-stream-action focusable${focus.zone === "actions" && focus.index === 0 ? " focused" : ""}"
                data-episode-stream-action="back" aria-label="${escapeAttribute(t("episodes_panel_back", {}, "Back"))}">
          ${Environment.isBrowser() ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14 6-6 6 6 6" /></svg>' : escapeHtml(t("episodes_panel_back", {}, "Back"))}
        </button>
${!Environment.isBrowser() ? `<button type="button" class="player-episode-stream-action focusable${focus.zone === "actions" && focus.index === 1 ? " focused" : ""}" data-episode-stream-action="reload">${escapeHtml(t("episodes_panel_reload", {}, "Reload"))}</button>` : ""}
        <div class="player-episode-stream-meta">
          ${escapeHtml([episodeCode, episodeTitle].filter(Boolean).join(" • "))}
        </div>
      </div>

      ${
        Environment.isBrowser() || (!this.episodePanelStreamsLoading && filters.length > 1)
          ? Environment.isBrowser()
            ? `<div class="player-episode-stream-filters">
              <label class="player-episode-source-picker">
                <span>${escapeHtml(t("stream_filter_source", {}, "Source"))}</span>
                <select data-player-episode-source aria-label="${escapeAttribute(t("stream_filter_source", {}, "Source"))}">
                  ${filters.map((filter) => `<option value="${escapeAttribute(filter)}"${this.episodePanelStreamFilter === filter ? " selected" : ""}>${escapeHtml(filter === "all" ? t("subtitle_all", {}, "All") : filter)}</option>`).join("")}
                </select>
              </label>
              <button type="button" class="player-episode-stream-action player-episode-stream-refresh focusable${focus.zone === "actions" && focus.index === 1 ? " focused" : ""}" data-episode-stream-action="reload" aria-label="${escapeAttribute(t("episodes_panel_reload", {}, "Reload"))}" title="${escapeAttribute(t("episodes_panel_reload", {}, "Reload"))}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 7v5h-5M20 12a8 8 0 1 0-2.3 5.7" /></svg></button>
            </div>`
            : `<div class="player-episode-stream-filters">
              ${filters
                .map((filter, index) => {
                  const selected = this.episodePanelStreamFilter === filter;
                  const focused = focus.zone === "filters" && focus.index === index;
                  return `
                    <button type="button"
                            class="player-episode-stream-filter focusable${selected ? " selected" : ""}${focused ? " focused" : ""}"
                            data-episode-stream-filter-index="${index}">
                      ${escapeHtml(filter === "all" ? t("subtitle_all", {}, "All") : filter)}
                    </button>
                  `;
                })
                .join("")}
            </div>`
          : ""
      }

      <div class="player-episode-stream-list">
        ${
          this.episodePanelStreamsLoading
            ? `<div class="player-episode-stream-empty">${escapeHtml(t("stream_finding_source", {}, "Finding stream source"))}</div>`
            : ""
        }
        ${
          this.episodePanelStreamsError
            ? `<div class="player-episode-stream-empty">${escapeHtml(this.episodePanelStreamsError)}</div>`
            : ""
        }
        ${
          !this.episodePanelStreamsLoading && !this.episodePanelStreamsError && !streams.length
            ? `<div class="player-episode-stream-empty">${escapeHtml(this._playerListProbePending?.size ? t("stream_finding_source", {}, "Finding stream source") : t("episodes_panel_no_streams", {}, "No streams found"))}</div>`
            : streams
                .map((stream, index) => {
                  const focused = focus.zone === "streams" && focus.index === index;
                  if (Environment.isBrowser()) {
                    const model = normalizeSourceForDisplay(
                      {
                        ...stream,
                        name: stream.raw?.name || stream.name || stream.label,
                        description:
                          stream.raw?.description || stream.raw?.title || stream.description
                      },
                      { badgeSettings }
                    );
                    if (model.showAddonLogo && stream.addonLogo) {
                      model.addonLogoUrl = getPlayerSourceLogoDisplayUrl(stream.addonLogo, () =>
                        this.scheduleSourceLogoRender()
                      );
                    }
                    return `<article class="stream-route-card stream-route-card-action player-episode-stream-card focusable${focused ? " focused" : ""}"
                      data-episode-stream-index="${index}" aria-label="${escapeAttribute(model.accessibleLabel)}">
                      ${renderBrowserSourceCardContent(model)}
                      ${this.renderPanelDownloadButton(index, "episode", stream)}
                    </article>`;
                  }
                  const badges = renderPlayerSourceBadges(stream, badgeSettings);
                  const topBadges = badgePlacement === "TOP" ? badges : "";
                  const bottomBadges = badgePlacement === "BOTTOM" ? badges : "";
                  const addonLogoUrl = showAddonLogo
                    ? getPlayerSourceLogoDisplayUrl(stream.addonLogo, () =>
                        this.scheduleSourceLogoRender()
                      )
                    : "";
                  const sourceSide = showAddonLogo
                    ? `<div class="player-source-side">
                        ${addonLogoUrl ? `<img class="player-source-logo" src="${escapeAttribute(addonLogoUrl)}" alt="" decoding="async" loading="lazy" referrerpolicy="no-referrer" />` : ""}
                        <div class="player-source-addon">${escapeHtml(stream.addonName || t("nav_addons", {}, "Addon"))}</div>
                      </div>`
                    : "";
                  return `
                    <article class="player-source-card player-episode-stream-card${sourceSide ? "" : " no-side"} focusable${focused ? " focused" : ""}"
                             data-episode-stream-index="${index}">
                      <div class="player-source-main">
                        ${topBadges}
                        <div class="player-source-title">${escapeHtml(stream.label || "Stream")}</div>
                        <div class="player-source-desc">${escapeHtml(stream.description || stream.addonName || "")}</div>
                        ${bottomBadges}
                            </div>
                      ${sourceSide}
                    </article>
                  `;
                })
                .join("")
        }
      </div>
    `;
  },

  renderEpisodePanel() {
    if (this.episodePanelExitTimer) {
      clearTimeout(this.episodePanelExitTimer);
      this.episodePanelExitTimer = null;
    }
    const panelHost = this.uiRefs?.root;
    if (!panelHost) {
      return;
    }
    const existingPanel = panelHost.querySelector("#episodeSidePanel");
    const shouldAnimateEntry = !existingPanel || existingPanel.classList.contains("is-exiting");
    existingPanel?.remove();
    if (!this.episodePanelVisible) {
      return;
    }
    const panel = document.createElement("div");
    panel.id = "episodeSidePanel";
    panel.className = "player-episode-panel nv-panel";

    this.syncEpisodePanelSeasonToIndex();
    const seasons = this.getEpisodePanelSeasons();
    const hasSeasonTabs = seasons.length > 1;
    panel.classList.toggle("has-season-tabs", hasSeasonTabs);
    const focusedZone = this.episodePanelFocusZone || "episodes";
    const seasonTabs =
      Environment.isBrowser() && seasons.length > 0
        ? this.renderEpisodeSeasonSelect(seasons)
        : hasSeasonTabs
          ? `<div class="player-episode-season-tabs">
          ${seasons
            .map((season, index) => {
              const selected = Number(season) === Number(this.episodePanelSeason);
              const focused = focusedZone === "seasons" && selected;
              return `
              <button
                type="button"
                class="player-episode-season-tab focusable${selected ? " selected" : ""}${focused ? " focused" : ""}"
                tabindex="-1"
                data-episode-season-index="${index}"
                data-episode-season="${escapeAttribute(season)}"
              >${escapeHtml(this.getEpisodePanelSeasonLabel(season))}</button>
            `;
            })
            .join("")}
        </div>`
          : "";
    const entries = this.getEpisodePanelEntries();
    const cards = entries
      .map(({ episode, index }) => {
        const selected = index === this.episodePanelIndex;
        const focused = focusedZone === "episodes" && selected;
        const selectedClass = `${selected ? " selected" : ""}${focused ? " focused" : ""}`;
        const current =
          (episode?.id && episode.id === this.params?.videoId) ||
          (Number(episode?.season) === Number(this.params?.season) &&
            Number(episode?.episode) === Number(this.params?.episode));
        const code = episodeDisplayCode(episode);
        const thumbnail = episodeThumbnailUrl(episode);
        const date = formatEpisodePanelDate(episode.released);
        if (Environment.isBrowser() && this.renderProposalEpisodeCard)
          return this.renderProposalEpisodeCard(episode, index, {
            thumbnail,
            date,
            current,
            duration: formatRuntimeLabel(episode.runtimeMinutes || episode.runtime || 0)
          });
        return `
        <div class="player-episode-item focusable${selectedClass}" tabindex="-1" data-episode-index="${index}">
          <div class="player-episode-thumb-wrap">
            ${thumbnail ? `<img class="player-episode-thumb" src="${escapeAttribute(thumbnail)}" alt="" loading="lazy" decoding="async" />` : `<div class="player-episode-thumb-fallback"></div>`}
            ${code ? `<div class="player-episode-code">${escapeHtml(code)}</div>` : ""}
            ${current ? `<div class="player-episode-current">&#10003;</div>` : ""}
          </div>
          <div class="player-episode-copy">
            <div class="player-episode-item-title">${escapeHtml(episode.title || t("episodes_episode", {}, "Episode"))}</div>
            ${date ? `<div class="player-episode-date">${escapeHtml(date)}</div>` : ""}
            <div class="player-episode-item-subtitle">${escapeHtml(episode.overview || "")}</div>
          </div>
        </div>
      `;
      })
      .join("");

    const isStreamsView = this.episodePanelMode === "streams";
    panel.classList.toggle("streams-view", isStreamsView);
    const streamFocus = this.episodePanelStreamFocus || { zone: "actions", index: 0 };
    panel.innerHTML = `
      <div class="player-episode-panel-header">
        <div class="player-episode-panel-title">${escapeHtml(isStreamsView ? t("episodes_panel_streams_title", {}, "Streams") : t("episodes_panel_title", {}, "Episodes"))}</div>
        <button type="button" class="player-episode-close-btn focusable${isStreamsView ? (streamFocus.zone === "close" ? " focused" : "") : focusedZone === "close" ? " focused" : ""}" tabindex="-1" data-episode-action="close" aria-label="${escapeAttribute(t("episodes_panel_close", {}, "Close"))}">
          ${Environment.isBrowser() ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>' : escapeHtml(t("episodes_panel_close", {}, "Close"))}
        </button>
      </div>
      ${
        isStreamsView
          ? this.renderEpisodeStreamsView()
          : `${seasonTabs}
             <div class="player-episode-list">${cards}</div>`
      }
    `;
    this.applyPlayerDrawerHeader(panel, { streams: isStreamsView });
    panelHost.appendChild(panel);
    panel.querySelectorAll("img.player-episode-thumb").forEach((image) => {
      image.addEventListener(
        "error",
        () => {
          const fallback = document.createElement("div");
          fallback.className = "player-episode-thumb-fallback";
          image.replaceWith(fallback);
        },
        { once: true }
      );
    });
    if (shouldAnimateEntry) {
      panel.classList.add("is-entering");
      const finishEntry = () => {
        panel.classList.remove("is-entering");
        this.scrollEpisodePanelIntoView();
      };
      if (typeof requestAnimationFrame === "function") {
        requestAnimationFrame(() => requestAnimationFrame(finishEntry));
      } else {
        setTimeout(finishEntry, 32);
      }
      return;
    }
    this.scrollEpisodePanelIntoView();
  },

  hideEpisodePanel() {
    this.episodeSeasonPickerOpen = false;
    this.panelAddonPickerOpen = null;
    this.episodePanelVisible = false;
    this.episodePanelStreamLoadToken = Number(this.episodePanelStreamLoadToken || 0) + 1;
    const panel = this.uiRefs?.root?.querySelector("#episodeSidePanel");
    panel?.classList.add("is-exiting");
    if (this.episodePanelExitTimer) {
      clearTimeout(this.episodePanelExitTimer);
    }
    this.episodePanelExitTimer = setTimeout(() => {
      panel?.remove();
      this.episodePanelExitTimer = null;
    }, EPISODE_PANEL_TRANSITION_MS);
    this.updateModalBackdrop();
    this.resetControlsAutoHide();
  },

  async playEpisodeFromPanel(selectedStream = null, { automatic = false, complete } = {}) {
    if (this.switchingEpisode || !this.episodes.length) {
      return;
    }
    const selected = this.episodes[this.episodePanelIndex];
    if (!selected?.id) {
      return;
    }
    if (this.offlineDownloadId) return this.playOfflinePlayerEpisode(selected);
    if (!selectedStream && this.episodePanelMode !== "streams") {
      await this.openEpisodeStreamsView({ forceReload: true, automatic: true });
      return;
    }
    this.switchingEpisode = true;
    try {
      const itemType = this.params?.itemType || "series";
      const streamItems = selectedStream
        ? automatic
          ? this.episodePanelStreams
          : this.getFilteredEpisodePanelStreams()
        : await this.getPlayableStreamsForVideo(selected.id, itemType, {
            season: selected.season,
            episode: selected.episode
          });
      if (!streamItems.length) {
        return;
      }
      const bestStreamCandidate = selectedStream || this.selectBestStreamCandidate(streamItems);
      if (!bestStreamCandidate) return;
      const bestStream = streamDirectPlaybackUrl(bestStreamCandidate) || null;
      const nextEpisode = this.episodes[this.episodePanelIndex + 1] || null;
      await PlayerController.flushCurrentProgress({ allowCloudSync: false });
      void PlayerController.pushProgressIfDue?.(true);
      await Router.navigate(
        "player",
        {
          streamUrl: bestStream,
          prepareSelectedSource: true,
          automaticSourceSelection: automatic,
          streamCandidatesComplete: complete ?? !this.episodePanelStreamsLoading,
          itemId: this.params?.itemId,
          itemType,
          imdbId: this.params?.imdbId || null,
          tmdbId: this.params?.tmdbId || this.params?.tmdb_id || null,
          traktId: this.params?.traktId || this.params?.trakt_id || null,
          contentLanguage: this.contentLanguage || null,
          videoId: selected.id,
          season: selected.season ?? null,
          episode: selected.episode ?? null,
          episodeLabel: `S${selected.season}E${selected.episode}`,
          playerTitle: this.params?.playerTitle || this.params?.itemId,
          playerReleaseYear: this.params?.playerReleaseYear || this.params?.year || "",
          playerSubtitle:
            `${selected.title || ""}`.trim() || `S${selected.season}E${selected.episode}`,
          playerBackdropUrl: this.params?.playerBackdropUrl || null,
          playerPosterUrl: this.params?.playerPosterUrl || this.params?.poster || null,
          textlessPoster: this.params?.textlessPoster || null,
          playerOrientationPreference:
            this.browserOrientation?.preference ||
            this.params?.playerOrientationPreference ||
            "landscape",
          playerLogoUrl: this.params?.playerLogoUrl || null,
          castItems: this.pauseOverlayMeta?.cast?.length
            ? this.pauseOverlayMeta.cast
            : this.params?.castItems || [],
          episodes: this.episodes,
          streamCandidates: streamItems,
          preferredStreamId: bestStreamCandidate.id || null,
          playbackSourceContext: this.getPlaybackSourceContext(bestStreamCandidate),
          returnToStreamOnBack: this.shouldReturnToStreamOnBack(),
          handoffReturnRoute:
            this.params?.handoffReturnRoute ||
            (this.shouldReturnToStreamOnBack() ? "stream" : "detail"),
          streamRouteParams: this.params?.streamRouteParams || null,
          fromDetailRoute: this.params?.fromDetailRoute || false,
          nextEpisodeVideoId: nextEpisode?.id || null,
          nextEpisodeLabel: nextEpisode ? `S${nextEpisode.season}E${nextEpisode.episode}` : null,
          nextEpisodeSeason: nextEpisode?.season ?? null,
          nextEpisodeEpisode: nextEpisode?.episode ?? null,
          nextEpisodeTitle: nextEpisode?.title || "",
          nextEpisodeReleased: nextEpisode?.released || ""
        },
        {
          replaceHistory: true
        }
      );
    } finally {
      this.switchingEpisode = false;
    }
  },

  async loadSubtitles() {
    const requestToken = (this.subtitleLoadToken || 0) + 1;
    this.subtitleLoadToken = requestToken;
    this.subtitleLoading = true;

    const sidecarSubtitles = this.collectStreamSidecarSubtitles();
    const subtitleLookup = this.buildSubtitleLookupContext();
    try {
      const offlineSubtitles = await this.loadOfflineSubtitleTracks().catch(() => []);
      if (requestToken !== this.subtitleLoadToken) return;
      this.subtitles = this.mergeSubtitleCandidates(offlineSubtitles, sidecarSubtitles);
      this.refreshTrackDialogs();

      let repositorySubtitles = [];

      try {
        if (subtitleLookup.id && subtitleLookup.type) {
          repositorySubtitles = await subtitleRepository.getSubtitles(
            subtitleLookup.type,
            subtitleLookup.id,
            subtitleLookup.videoId || null,
            {
              season: subtitleLookup.season,
              episode: subtitleLookup.episode,
              title: subtitleLookup.title,
              year: subtitleLookup.year,
              videoHash: subtitleLookup.videoHash || null,
              videoSize: subtitleLookup.videoSize || null,
              filename: subtitleLookup.filename || null
            }
          );
        }
      } catch (error) {
        console.error("Subtitle fetch failed", error);
      }

      if (requestToken !== this.subtitleLoadToken) {
        return;
      }

      const subtitleSettings = PlayerSettingsStore.get();
      const preferredOnly =
        subtitleSettings.addonSubtitleStartupMode === "PREFERRED_ONLY" ||
        (subtitleSettings.addonSubtitleStartupMode === "ALL_SUBTITLES" &&
          subtitleSettings.subtitleStyle?.showOnlyPreferredLanguages);
      if (preferredOnly) {
        const preferredTargets = new Set(this.getStartupPreferredSubtitleLanguageTargets());
        repositorySubtitles = repositorySubtitles.filter((entry) => {
          const language = normalizeSubtitleLanguageKey(
            entry?.lang || entry?.language || entry?.languageCode || ""
          );
          return Array.from(preferredTargets).some((target) => {
            if (language === target) return true;
            if (target === "pt" || target === "es") return false;
            return language.startsWith(`${target}-`);
          });
        });
      }

      this.remoteSubtitleCandidates = this.mergeSubtitleCandidates(
        sidecarSubtitles,
        repositorySubtitles
      );
      this.subtitles = this.mergeSubtitleCandidates(
        offlineSubtitles,
        this.remoteSubtitleCandidates
      );
      if (this.subtitleDialogVisible && this.subtitleDialogTab === "builtIn") {
        const builtInBoundary = this.resolveBuiltInSubtitleBoundary(this.getTextTracks());
        const hasUsableBuiltIns = Environment.isBrowser()
          ? this.getSubtitleEntries("builtIn").some(
              (entry) => !entry?.disabled && entry?.id !== "subtitle-off"
            )
          : builtInBoundary > 0;
        if (!hasUsableBuiltIns && this.subtitles.length > 0) {
          this.subtitleDialogTab = "addons";
          this.subtitleDialogIndex = 0;
        }
      }
      this.refreshTrackDialogs();
    } catch (error) {
      if (requestToken !== this.subtitleLoadToken) return;
      console.error("Subtitle attach failed", error);
      this.remoteSubtitleCandidates = this.mergeSubtitleCandidates(sidecarSubtitles, []);
      this.subtitles = this.mergeSubtitleCandidates(
        this.offlineSubtitleTracks,
        this.remoteSubtitleCandidates
      );
      this.refreshTrackDialogs();
    } finally {
      if (requestToken === this.subtitleLoadToken) {
        this.subtitleLoading = false;
        this.refreshTrackDialogs();
      }
    }
  },

  attachExternalSubtitles() {
    const video = PlayerController.video;
    if (!video) {
      return;
    }

    this.clearMountedExternalSubtitleTracks();

    this.builtInSubtitleCount = this.getTextTracks().length;

    this.subtitles.forEach((subtitle, index) => {
      if (!subtitle.url) {
        return;
      }
      const subtitleId = addonSubtitleSelectionId(subtitle);
      const track = document.createElement("track");
      track.kind = "subtitles";
      track.label = subtitle.lang || subtitleLabel(index);
      track.srclang = normalizeTrackLanguageCode(subtitle.lang) || "und";
      track.src = subtitle.url;
      track.default = false;
      track.setAttribute("data-addon-subtitle-id", subtitleId);
      this.externalTrackNodes.push(track);
      video.appendChild(track);
    });
  },
  moveControlFocus(delta) {
    const controls = this.getControlDefinitions();
    if (!controls.length) {
      return;
    }
    this.stickyProgressFocus = false;
    this.autoHideControlsAfterSeek = false;
    if (this.controlFocusZone === "progress") {
      this.controlFocusZone = "buttons";
      this.controlFocusIndex = delta < 0 ? 0 : 0;
      this.syncControlFocusDom();
      return;
    }
    const nextIndex = clamp(this.controlFocusIndex + delta, 0, controls.length - 1);
    this.controlFocusZone = "buttons";
    this.controlFocusIndex = nextIndex;
    this.syncControlFocusDom();
    this.resetControlsAutoHide();
  },

  performFocusedControl() {
    if (this.controlFocusZone === "progress") {
      this.cancelSeekPreview({ commit: true });
      this.resetControlsAutoHide();
      return;
    }
    const controls = this.getControlDefinitions();
    const current = controls[this.controlFocusIndex] || null;
    if (!current) {
      return;
    }
    this.performControlAction(current.action || "");
  },

  performControlAction(action) {
    if (this.handleProposalAction?.(action)) return;
    if (action === "playPause") {
      this.togglePause();
      this.renderControlButtons();
      return;
    }

    if (action === "playNextEpisode") {
      void this.playNextEpisode({ userInitiated: true });
      return;
    }

    if (action === "stillWatchingContinue") {
      void this.onStillWatchingContinue();
      return;
    }

    if (action === "stillWatchingExit") {
      this.onDismissStillWatchingPrompt();
      return;
    }

    if (action === "subtitleDialog") {
      if (this.subtitleDialogVisible) {
        this.closeSubtitleDialog();
      } else {
        this.openSubtitleDialog();
      }
      return;
    }

    if (action === "audioTrack") {
      if (this.audioDialogVisible) {
        this.closeAudioDialog();
      } else {
        this.openAudioDialog();
      }
      return;
    }

    if (action === "source") {
      if (this.sourcesPanelVisible) {
        this.closeSourcesPanel();
      } else {
        this.openSourcesPanel();
      }
      return;
    }

    if (action === "switchEngine") {
      this.switchPlaybackEngine();
      return;
    }

    if (action === "episodes") {
      this.toggleEpisodePanel();
      return;
    }

    if (Environment.isBrowser() && (action === "more" || action === "backFromMore")) {
      const opening = action === "more" && !this.moreActionsVisible;
      if (opening) {
        this.subtitleDialogVisible = false;
        this.audioDialogVisible = false;
        this.speedDialogVisible = false;
        this.sourcesPanelVisible = false;
        this.hideEpisodePanel();
        this.renderSubtitleDialog();
        this.renderAudioDialog();
        this.renderSpeedDialog();
        this.renderSourcesPanel();
      }
      this.moreActionsVisible = opening;
      this.playbackInfoVisible = false;
      this.renderCompactBrowserMorePanel();
      this.updateModalBackdrop();
      this.resetControlsAutoHide();
      return;
    }
    if (action === "rotate") {
      if (!this.browserOrientation?.mobile) return;
      this.browserOrientation.toggle();
      this.params.playerOrientationPreference = this.browserOrientation.preference;
      this.moreActionsVisible = false;
      this.renderControlButtons();
      this.updateModalBackdrop();
      return;
    }
    if (action === "seekBack10" || action === "seekForward10") {
      this.seekPlaybackSeconds(
        Math.max(
          0,
          Math.min(
            this.getPlaybackDurationSeconds() || Infinity,
            this.getPlaybackCurrentSeconds() + (action === "seekBack10" ? -10 : 10)
          )
        )
      );
      this.resetControlsAutoHide();
      return;
    }
    if (action === "presentationPip") {
      void this.toggleDesktopPictureInPicture();
      return;
    }
    if (action === "playbackInfo" || action === "moreInfoBack") {
      this.playbackInfoVisible = action === "playbackInfo";
      this.renderCompactBrowserMorePanel();
      return;
    }
    if (action === "externalPlayer") {
      void this.openExternalPlayerChooser();
      return;
    }
    if (action === "more") {
      this.stickyProgressFocus = false;
      const compactBrowserToolbar = this.isCompactBrowserPlayerToolbar();
      this.moreActionsVisible = compactBrowserToolbar ? !this.moreActionsVisible : true;
      this.controlFocusZone = "buttons";
      this.controlFocusIndex = Math.max(
        0,
        this.getControlDefinitions().findIndex(
          (entry) => entry.action === (compactBrowserToolbar ? "more" : "speed")
        )
      );
      this.renderControlButtons();
      return;
    }

    if (action === "backFromMore") {
      this.stickyProgressFocus = false;
      this.moreActionsVisible = false;
      this.controlFocusZone = "buttons";
      this.controlFocusIndex = Math.max(
        0,
        this.getControlDefinitions().findIndex((entry) => entry.action === "more")
      );
      this.renderControlButtons();
      return;
    }

    if (action === "speed") {
      if (Environment.isBrowser() && this.speedDialogVisible) {
        this.closeSpeedDialog();
        return;
      }
      if (this.isCompactBrowserPlayerToolbar()) {
        this.moreActionsVisible = false;
        this.renderControlButtons();
      }
      this.openSpeedDialog();
      return;
    }

    if (action === "aspect") {
      this.cycleAspectMode();
      return;
    }
  },

  syncPointerFocus(target) {
    if (!Environment.isBrowser()) {
      const skipIntroNode = target?.closest?.("[data-player-pointer-action='skipIntro']");
      if (skipIntroNode && this.isSkipIntroButtonFocusable()) {
        this.stickyProgressFocus = false;
        this.autoHideControlsAfterSeek = false;
        this.controlFocusZone = "skipIntro";
        this.resetControlsAutoHide();
        this.renderControlButtons();
        this.syncSkipIntroFocusState();
        return;
      }

      const controlButton = target?.closest?.(".player-control-btn[data-action]");
      if (controlButton) {
        const buttons = Array.from(
          this.uiRefs?.controlButtons?.querySelectorAll?.(".player-control-btn[data-action]") || []
        );
        const index = buttons.indexOf(controlButton);
        if (index >= 0) {
          this.stickyProgressFocus = false;
          this.autoHideControlsAfterSeek = false;
          this.controlFocusZone = "buttons";
          this.controlFocusIndex = index;
          this.resetControlsAutoHide();
        }
        return;
      }

      if (target?.closest?.(".player-progress-shell")) {
        this.stickyProgressFocus = true;
        this.controlFocusZone = "progress";
        this.resetControlsAutoHide();
        return;
      }
    }

    const sourcesNode = target?.closest?.("[data-sources-zone]");
    if (sourcesNode && this.sourcesPanelVisible) {
      this.sourcesFocus = {
        zone: sourcesNode.dataset.sourcesZone || "filter",
        index: Number(sourcesNode.dataset.sourcesIndex || 0)
      };
      return;
    }

    const subtitleNode = target?.closest?.("[data-subtitle-rail]");
    if (subtitleNode && Environment.isBrowser()) this.subtitleKeyboardNavigation = false;
    if (subtitleNode && this.subtitleDialogVisible) {
      this.subtitleFocusedRail = subtitleNode.dataset.subtitleRail || "language";
      const index = Number(subtitleNode.dataset.subtitleIndex || 0);
      if (this.subtitleFocusedRail === "language") {
        this.subtitleLanguageRailIndex = index;
        this.syncSubtitleOptionIndexForFocusedLanguage();
      } else if (this.subtitleFocusedRail === "options") {
        this.subtitleOptionRailIndex = index;
      } else {
        this.subtitleStyleRailIndex = index;
        const action = String(subtitleNode.dataset.subtitleStyleAction || "").toLowerCase();
        this.subtitleStyleControlSide =
          action === "increase" ? "plus" : action === "reset" ? "reset" : "minus";
      }
      return;
    }

    const audioNode = target?.closest?.("[data-audio-column]");
    if (audioNode && this.audioDialogVisible) {
      this.audioFocusedColumn = audioNode.dataset.audioColumn || "tracks";
      const index = Number(audioNode.dataset.audioIndex || 0);
      if (this.audioFocusedColumn === "tracks") {
        this.audioDialogIndex = index;
      } else {
        this.audioMixFocusIndex = index;
      }
      return;
    }

    const speedNode = target?.closest?.("[data-speed-index]");
    if (speedNode && this.speedDialogVisible) {
      this.speedDialogIndex = Number(speedNode.dataset.speedIndex || 0);
      return;
    }

    const episodeCloseNode = target?.closest?.("[data-episode-action='close']");
    if (episodeCloseNode && this.episodePanelVisible) {
      if (this.episodePanelMode === "streams") {
        this.episodePanelStreamFocus = { zone: "close", index: 0 };
      } else {
        this.episodePanelFocusZone = "close";
      }
      return;
    }

    const episodeStreamAction = target?.closest?.("[data-episode-stream-action]");
    if (episodeStreamAction && this.episodePanelVisible) {
      this.episodePanelStreamFocus = {
        zone: "actions",
        index: episodeStreamAction.dataset.episodeStreamAction === "reload" ? 1 : 0
      };
      return;
    }

    const episodeStreamFilter = target?.closest?.("[data-episode-stream-filter-index]");
    if (episodeStreamFilter && this.episodePanelVisible) {
      this.episodePanelStreamFocus = {
        zone: "filters",
        index: Number(episodeStreamFilter.dataset.episodeStreamFilterIndex || 0)
      };
      return;
    }

    const episodeStreamNode = target?.closest?.("[data-episode-stream-index]");
    if (episodeStreamNode && this.episodePanelVisible) {
      this.episodePanelStreamFocus = {
        zone: "streams",
        index: Number(episodeStreamNode.dataset.episodeStreamIndex || 0)
      };
      return;
    }

    const episodeSeasonNode = target?.closest?.("[data-episode-season-index]");
    if (episodeSeasonNode && this.episodePanelVisible) {
      const seasonIndex = Number(episodeSeasonNode.dataset.episodeSeasonIndex || 0);
      const seasons = this.getEpisodePanelSeasons();
      this.episodePanelSeasonIndex = clamp(seasonIndex, 0, Math.max(0, seasons.length - 1));
      this.episodePanelSeason = seasons[this.episodePanelSeasonIndex] ?? this.episodePanelSeason;
      const firstEntry = this.getEpisodePanelEntries()[0];
      if (firstEntry) {
        this.episodePanelIndex = firstEntry.index;
      }
      this.episodePanelFocusZone = "seasons";
      return;
    }

    const episodeNode = target?.closest?.("[data-episode-index]");
    if (episodeNode && this.episodePanelVisible) {
      this.episodePanelIndex = Number(episodeNode.dataset.episodeIndex || 0);
      this.episodePanelFocusZone = "episodes";
    }
  },

  fitPauseOverlay() {
    const overlay = this.uiRefs?.pauseOverlay;
    const content = overlay?.querySelector(".player-pause-overlay-content");
    if (
      !Environment.isBrowser() ||
      !content ||
      !this.pauseOverlayVisible ||
      this.stillWatchingPromptVisible
    )
      return;
    const title = content.querySelector?.(".player-pause-title");
    const titleText = title?.querySelector("span");
    if (titleText) {
      const distance = Math.max(0, titleText.scrollWidth - title.clientWidth);
      title.classList.toggle("is-overflowing", distance > 1);
      title.style.setProperty("--pause-title-travel", -distance + "px");
      title.style.setProperty("--pause-title-duration", Math.max(8, distance / 35 + 4) + "s");
      title.tabIndex = distance > 1 ? 0 : -1;
    }
    content.style.transform = "none";
    const rect = playerLocalRect(overlay, this.browserOrientation);
    const style = getComputedStyle(overlay);
    const top = Number.parseFloat(style.paddingTop) || 16;
    const bottom = Number.parseFloat(style.paddingBottom) || 16;
    // Equal clearance keeps the full content centered even when it must shrink.
    const inset = Math.max(top, bottom);
    const available = Math.max(1, rect.height - 2 * inset);
    const height = Math.max(1, content.scrollHeight);
    const scale = Math.min(1, available / height);
    const y = clamp(
      (rect.height - height * scale) / 2,
      inset,
      Math.max(inset, rect.height - inset - height * scale)
    );
    content.style.top = y + "px";
    content.style.transformOrigin = "left top";
    content.style.transform = scale < 1 ? "scale(" + scale + ")" : "none";
  },

  updateProgressHover(event) {
    const preview = this.container?.querySelector("#playerProgressHover");
    if (!preview) return;
    const shell = event?.target?.closest?.(".player-progress-shell");
    const duration = this.getPlaybackDurationSeconds();
    const rect = playerLocalRect(shell, this.browserOrientation);
    const visible = Boolean(
      event &&
      (!event.pointerType || event.pointerType === "mouse") &&
      shell &&
      this.container.contains(shell) &&
      rect?.width > 0 &&
      Number.isFinite(duration) &&
      duration > 0
    );
    preview.classList.toggle("hidden", !visible);
    if (!visible) return;
    const ratio = clamp(
      (playerLocalPoint(event, this.browserOrientation).x - rect.left) / rect.width,
      0,
      1
    );
    preview.textContent = formatTime(duration * ratio);
    preview.style.left = clamp(ratio * rect.width, 28, Math.max(28, rect.width - 28)) + "px";
  },

  seekProgressFromPointer(event, target) {
    const shell = target?.closest?.(".player-progress-shell") || this.uiRefs?.progressShell;
    const rect = playerLocalRect(shell, this.browserOrientation);
    const duration = this.getPlaybackDurationSeconds();
    if (!rect || rect.width <= 0 || !Number.isFinite(duration) || duration <= 0) {
      return false;
    }
    const x = playerLocalPoint(event, this.browserOrientation).x;
    const ratio = clamp((x - rect.left) / rect.width, 0, 1);
    this.seekPreviewSeconds = null;
    this.seekRepeatCount = 0;
    this.seekPlaybackSeconds(duration * ratio);
    this.updateUiTick();
    this.resetControlsAutoHide();
    return true;
  },

  onPointerFocus(target) {
    this.syncPointerFocus(target);
  },

  releaseBrowserToolbarFocusAfterPointer(target, event) {
    if (!Environment.isBrowser() || !(target instanceof Element)) {
      return;
    }
    if (!shouldBlurBrowserPlayerToolbarAfterPointer(event)) {
      return;
    }
    const controlButton = target.closest?.(
      ".player-control-btn[data-action], [data-player-desktop-action], [data-player-desktop-back]"
    );
    if (!controlButton) {
      return;
    }
    setTimeout(() => {
      if (document.activeElement === controlButton) {
        controlButton.blur?.();
      }
    }, 0);
  },

  async onPointerActivate(target, event) {
    const seasonPicker = target?.closest?.(
      "[data-action='toggleEpisodeSeasonPicker'], [data-action='selectEpisodeSeasonOption']"
    );
    if (seasonPicker && this.episodePanelVisible) {
      if (seasonPicker.dataset.action === "toggleEpisodeSeasonPicker") {
        this.episodeSeasonPickerOpen = !this.episodeSeasonPickerOpen;
        this.renderEpisodePanel();
      } else {
        this.episodeSeasonPickerOpen = false;
        const season = this.getEpisodePanelSeasons()[Number(seasonPicker.dataset.optionIndex)];
        if (season !== undefined) this.selectEpisodePanelSeason(season);
        else this.renderEpisodePanel();
      }
      return true;
    }
    const subtitleLanguagePicker = target?.closest?.(
      "[data-action='proposalSubtitleLanguageToggle'], [data-action='proposalSubtitleLanguageFilter']"
    );
    if (subtitleLanguagePicker && this.subtitleDialogVisible) {
      if (subtitleLanguagePicker.dataset.action === "proposalSubtitleLanguageToggle") {
        this.proposalSubtitleLanguagePickerOpen = !this.proposalSubtitleLanguagePickerOpen;
      } else {
        const key = subtitleLanguagePicker.dataset.proposalSubtitleFilter;
        if (
          key === "all" ||
          this.getSubtitleLanguageRailItems().some((language) => language.key === key)
        ) {
          this.proposalSubtitleLanguageFilter = key;
        }
        this.proposalSubtitleLanguagePickerOpen = false;
      }
      this.renderSubtitleDialog();
      this.uiRefs?.subtitleDialog
        ?.querySelector("[data-action='proposalSubtitleLanguageToggle']")
        ?.focus({ preventScroll: true });
      return true;
    }
    const panelPicker = target?.closest?.(
      "[data-action='togglePanelAddonPicker'], [data-action='selectPanelAddonOption']"
    );
    if (panelPicker) {
      const scope = panelPicker.dataset.picker;
      const sources = scope === "player-source";
      if (panelPicker.dataset.action === "togglePanelAddonPicker") {
        this.panelAddonPickerOpen = this.panelAddonPickerOpen === scope ? null : scope;
      } else {
        const filters = sources ? this.getSourceFilters() : this.getEpisodePanelStreamFilters();
        const selected = filters[Number(panelPicker.dataset.optionIndex)];
        this.panelAddonPickerOpen = null;
        if (selected !== undefined) {
          if (sources) this.setSourceFilter(selected);
          else this.selectEpisodePanelSource(selected);
        }
      }
      if (sources) this.renderSourcesPanel();
      else this.renderEpisodePanel();
      return true;
    }
    const download = target?.closest?.("[data-player-download-index]");
    if (download) {
      const episodeScope = download.dataset.playerDownloadScope === "episode";
      const stream = (
        episodeScope ? this.getFilteredEpisodePanelStreams() : this.getFilteredSources()
      )[Number(download.dataset.playerDownloadIndex)];
      if (!stream) return false;
      const episode = episodeScope ? this.episodes[this.episodePanelIndex] : null;
      await this.openOfflineDownloadOptions(stream, this.getPanelDownloadContext(stream, episode));
      return true;
    }
    if (!target || this.isExternalFrameMode()) {
      return false;
    }
    this.syncPointerFocus(target);
    this.releaseBrowserToolbarFocusAfterPointer(target, event);

    const desktopAction = target.closest?.("[data-player-desktop-action]");
    if (desktopAction && Environment.isBrowser()) {
      this.revealDesktopPlayerControls();
      if (desktopAction.dataset.playerDesktopAction === "mute") {
        const toggled = await this.toggleDesktopMute();
        this.renderCompactBrowserMorePanel();
        return toggled;
      }
      if (desktopAction.dataset.playerDesktopAction === "fullscreen") {
        return this.toggleDesktopFullscreen();
      }
      if (desktopAction.dataset.playerDesktopAction === "picture-in-picture") {
        return this.toggleDesktopPictureInPicture();
      }
      if (desktopAction.dataset.playerDesktopAction === "external-player") {
        return this.openExternalPlayerChooser();
      }
    }

    const loadingBack = target.closest?.("[data-player-loading-back]");
    if (loadingBack) {
      this.navigateBackToStreamScreen();
      return true;
    }
    const errorAction = target.closest?.("[data-player-error-action]");
    if (errorAction && this.isStartupErrorVisible()) {
      const action = errorAction.dataset.playerErrorAction;
      if (action === "retry-current") {
        const source = this.getCurrentStreamCandidate();
        if (!source) return false;
        this.clearStartupError();
        await this.playStreamCandidate(source, { preservePlaybackState: true });
        return true;
      }
      if (action === "choose-source") {
        this.clearStartupError();
        if (this.offlineDownloadId && this.episodes.length) this.toggleEpisodePanel();
        else this.openSourcesPanel();
        return true;
      }
      if (action === "copy-details") {
        const text = [this.startupErrorMessage, ...(this.startupErrorDetails || [])]
          .filter(Boolean)
          .join("\n");
        try {
          await navigator.clipboard.writeText(text);
          this.showAspectToast(t("automation_return_copied", {}, "Copied"));
        } catch (_) {
          this.showAspectToast(t("player_copy_failed", {}, "Could not copy details"));
        }
        return true;
      }
      if (this.handleUnverifiedPlaybackAction?.(errorAction.dataset.playerErrorAction)) return true;
      if (errorAction.dataset.playerErrorAction === "play")
        return this.retryClientRemuxFromGesture();
      if (String(errorAction.dataset.playerErrorAction || "") === "back") {
        this.navigateBackToStreamScreen();
        return true;
      }
      return false;
    }

    if (target.closest?.("[data-player-pointer-action='skipIntro']")) {
      return this.skipActiveInterval();
    }

    // Checked first: the dismiss control sits inside the card, and the card
    // itself carries the play action.
    if (target.closest?.("[data-player-pointer-action='dismissNextEpisode']")) {
      this.dismissNextEpisodeCard();
      return true;
    }

    if (target.closest?.("[data-player-pointer-action='nextEpisode']")) {
      await this.playNextEpisode({ userInitiated: true });
      return true;
    }

    if (target.closest?.("[data-player-pointer-action='stillWatchingContinue']")) {
      await this.onStillWatchingContinue();
      return true;
    }

    if (target.closest?.("[data-player-pointer-action='stillWatchingExit']")) {
      this.onDismissStillWatchingPrompt();
      return true;
    }

    if (target.closest?.(".player-progress-shell")) {
      return this.seekProgressFromPointer(event, target);
    }

    const controlButton = target.closest?.(".player-control-btn[data-action]");
    if (controlButton) {
      this.performControlAction(controlButton.dataset.action || "");
      return true;
    }

    const sourcesNode = target.closest?.("[data-sources-zone]");
    if (sourcesNode && this.sourcesPanelVisible) {
      await this.activateSourcesFocus();
      return true;
    }

    const subtitleStep = target.closest?.("[data-subtitle-style-action]");
    if (subtitleStep && this.subtitleDialogVisible) {
      this.cancelSubtitlePointerScrollTransaction();
      const styleItems = this.getSubtitleStyleControls();
      const styleIndex = Number(subtitleStep.dataset.subtitleIndex);
      const styleItem = styleItems[styleIndex];
      if (styleItem && !styleItem.disabled) {
        this.subtitleStyleRailIndex = styleIndex;
        const action = String(subtitleStep.dataset.subtitleStyleAction || "").toLowerCase();
        const side = action === "increase" ? "plus" : action === "reset" ? "reset" : "minus";
        this.subtitleStyleControlSide = side;
        this.adjustSubtitleStyleControl(
          styleItem.id,
          action === "reset" ? 0 : this.getSubtitleStyleControlDelta(side)
        );
      }
      return true;
    }

    const proposalSubtitle = target.closest?.("[data-proposal-subtitle-language]");
    if (proposalSubtitle && this.subtitleDialogVisible) {
      const options = this.getSubtitleOptionsForLanguage(
        proposalSubtitle.dataset.proposalSubtitleLanguage
      );
      this.selectSubtitleOption(options[Number(proposalSubtitle.dataset.proposalSubtitleIndex)]);
      return true;
    }
    const subtitleNode = target.closest?.("[data-subtitle-rail]");
    if (subtitleNode && this.subtitleDialogVisible) {
      const isOptionSelection = this.preserveSubtitlePointerOptionScroll(subtitleNode);
      if (!isOptionSelection) {
        this.cancelSubtitlePointerScrollTransaction();
      }
      const handled = this.handleSubtitleDialogKey({ keyCode: 13, fromPointer: true });
      if (isOptionSelection && !this.subtitlePointerScrollTransaction?.selectionToken) {
        this.cancelSubtitlePointerScrollTransaction();
      }
      return handled;
    }

    const audioStep = target.closest?.("[data-audio-step]");
    if (audioStep && this.audioDialogVisible) {
      this.activateAudioControl(Number(audioStep.dataset.audioStep || 1));
      return true;
    }

    const audioNode = target.closest?.("[data-audio-column]");
    if (audioNode && this.audioDialogVisible) {
      if (this.audioFocusedColumn === "tracks") {
        this.applyAudioTrack(this.audioDialogIndex, { rememberSelection: true });
      } else {
        this.activateAudioControl(this.audioMixFocusIndex === 0 ? 1 : 0);
      }
      return true;
    }

    const speedNode = target.closest?.("[data-speed-index]");
    if (speedNode && this.speedDialogVisible) {
      const speedOptions = this.getPlaybackSpeedOptions();
      this.applyPlaybackSpeed(speedOptions[this.speedDialogIndex] || 1);
      return true;
    }

    const episodeCloseNode = target.closest?.("[data-episode-action='close']");
    if (episodeCloseNode && this.episodePanelVisible) {
      this.hideEpisodePanel();
      return true;
    }

    const episodeStreamAction = target.closest?.("[data-episode-stream-action]");
    if (episodeStreamAction && this.episodePanelVisible) {
      await this.activateEpisodeStreamFocus();
      return true;
    }

    const episodeStreamFilter = target.closest?.("[data-episode-stream-filter-index]");
    if (episodeStreamFilter && this.episodePanelVisible) {
      await this.activateEpisodeStreamFocus();
      return true;
    }

    const episodeStreamNode = target.closest?.("[data-episode-stream-index]");
    if (episodeStreamNode && this.episodePanelVisible) {
      await this.activateEpisodeStreamFocus();
      return true;
    }

    const episodeSeasonNode = target.closest?.("[data-episode-season-index]");
    if (episodeSeasonNode && this.episodePanelVisible) {
      this.episodePanelFocusZone = "episodes";
      this.renderEpisodePanel();
      return true;
    }

    const episodeNode = target.closest?.("[data-episode-index]");
    if (episodeNode && this.episodePanelVisible) {
      await this.playEpisodeFromPanel();
      return true;
    }

    return false;
  },

  switchPlaybackEngine() {
    const targetEngine =
      typeof PlayerController.getAlternativePlaybackEngine === "function"
        ? PlayerController.getAlternativePlaybackEngine(this.activePlaybackUrl)
        : null;
    if (!targetEngine || !this.activePlaybackUrl) {
      this.showAspectToast(t("player_engine_switch_unavailable", {}, "No alternate player engine"));
      return;
    }
    this.showAspectToast(t("player_engine_switching_title", {}, "Switching player"));
    void this.playStreamByUrl(this.activePlaybackUrl, {
      preservePlaybackState: true,
      resetSilentAudioState: false,
      forceEngine: targetEngine
    });
  },

  hasBackDismissableOverlay() {
    return Boolean(
      this.stillWatchingPromptVisible ||
      this.seekOverlayVisible ||
      this.seekPreviewSeconds != null ||
      (!this.controlsVisible && this.isNextEpisodeCardVisible()) ||
      this.sourcesPanelVisible ||
      this.subtitleDialogVisible ||
      this.audioDialogVisible ||
      this.speedDialogVisible ||
      this.episodePanelVisible ||
      this.moreActionsVisible ||
      this.pauseOverlayVisible ||
      this.pauseOverlayTimer
    );
  },

  consumeBackRequest() {
    if (this.isStartupErrorVisible()) {
      const navigation = this.navigateBackToStreamScreen();
      if (navigation) return navigation;
      Router.back();
      return true;
    }

    if (this.stillWatchingPromptVisible) {
      return this.onDismissStillWatchingPrompt();
    }

    if (this.seekOverlayVisible || this.seekPreviewSeconds != null) {
      this.cancelSeekPreview({ commit: false });
      return true;
    }

    if (!this.controlsVisible && this.isNextEpisodeCardVisible()) {
      this.dismissNextEpisodeCard({ revealControls: true, armExitOnNextBack: true });
      return true;
    }

    if (!this.controlsVisible && this.activeSkipInterval && !this.skipIntervalDismissed) {
      this.skipIntervalDismissed = true;
      this.skipIntroAutoHidden = false;
      this.stopSkipIntroCountdownAnimation();
      this.renderSkipIntroButton();
      return true;
    }

    if (this.sourcesPanelVisible) {
      this.closeSourcesPanel();
      return true;
    }

    if (this.subtitleDialogVisible) {
      this.closeSubtitleDialog();
      return true;
    }

    if (this.audioDialogVisible) {
      this.closeAudioDialog();
      return true;
    }

    if (this.speedDialogVisible) {
      this.closeSpeedDialog();
      return true;
    }

    if (this.episodePanelVisible) {
      if (this.episodePanelMode === "streams") {
        this.closeEpisodeStreamsView();
      } else {
        this.hideEpisodePanel();
      }
      return true;
    }

    if (this.moreActionsVisible) {
      this.moreActionsVisible = false;
      this.renderControlButtons();
      this.updateModalBackdrop();
      this.focusFirstControl();
      return true;
    }

    if (this.pauseOverlayVisible || this.pauseOverlayTimer) {
      this.dismissPauseOverlay({ revealControls: false, focus: false });
    }

    if (this.loadingVisible && !this.hasPresentedPlaybackFrame) {
      return this.navigateBackToStreamScreen();
    }

    // Match Android TV: when the on screen controls are showing, Back hides
    // them and keeps the video playing. The player only leaves on a Back press
    // once the controls are already hidden.
    if (this.controlsVisible && !this.nextEpisodeBackExitArmed) {
      this.setControlsVisible(false, { focus: false });
      return true;
    }

    this.nextEpisodeBackExitArmed = false;
    return this.navigateBackToStreamScreen();
  },

  async handleBrowserDialogKey(event) {
    if (this.episodePanelVisible && this.handleEpisodePanelKey(event)) {
      return true;
    }
    if (this.sourcesPanelVisible && (await this.handleSourcesPanelKey(event))) {
      return true;
    }
    if (this.subtitleDialogVisible && this.handleSubtitleDialogKey(event)) {
      return true;
    }
    if (this.audioDialogVisible && this.handleAudioDialogKey(event)) {
      return true;
    }
    if (this.speedDialogVisible && this.handleSpeedDialogKey(event)) {
      return true;
    }
    return false;
  },

  async handleBrowserKeyDown(event) {
    const keyCode = Number(event?.keyCode || 0);
    const isBackKey = isBackEvent(event);
    const eventTarget = event?.target instanceof Element ? event.target : document.activeElement;
    const activeTarget =
      document.activeElement instanceof Element ? document.activeElement : eventTarget;
    const shortcutRoute = resolveBrowserPlayerShortcutRoute({
      keyCode,
      code: event?.code || "",
      isBackKey,
      fullscreen: this.isDesktopPlayerFullscreen(),
      editable:
        this.isDesktopEditableTarget(eventTarget) || this.isDesktopEditableTarget(activeTarget),
      pauseOverlayVisible: this.pauseOverlayVisible,
      dialogOpen: this.isDialogOpen()
    });

    // Escape belongs to the browser while fullscreen is active. The native
    // fullscreenchange event updates Player state after the browser exits it.
    if (shortcutRoute === "allow-fullscreen-exit") {
      return false;
    }

    if (keyCode === 9) return false;
    const focusedAction = activeTarget?.closest?.(
      "button[data-action], button[data-player-error-action], button[data-proposal-subtitle-language], button[data-audio-column], button[data-sources-zone], button[data-episode-index], button[data-episode-action], button[data-episode-stream-action], button[data-episode-stream-filter-index]"
    );
    const focusedSummary = activeTarget?.closest?.("summary");
    if ((keyCode === 13 || keyCode === 32) && focusedSummary) return false;
    if (
      (keyCode === 13 ||
        (keyCode === 32 && (this.isDialogOpen() || this.isStartupErrorVisible()))) &&
      focusedAction
    ) {
      event?.preventDefault?.();
      event?.stopPropagation?.();
      if (!event?.repeat) await this.onPointerActivate(focusedAction, event);
      return true;
    }
    if (this.isStartupErrorVisible()) {
      if (keyCode === 9) return false;
      event?.preventDefault?.();
      event?.stopPropagation?.();
      if (
        isSelectKeyCode(keyCode) &&
        this.handleUnverifiedPlaybackAction?.(document.activeElement?.dataset?.playerErrorAction)
      )
        return true;
      if (
        isSelectKeyCode(keyCode) &&
        document.activeElement?.dataset?.playerErrorAction === "play"
      ) {
        this.retryClientRemuxFromGesture();
        return true;
      }
      if (isBackKey || isSelectKeyCode(keyCode) || keyCode === 66) {
        if (!this.navigateBackToStreamScreen()) {
          Router.back();
        }
      }
      return true;
    }

    if (shortcutRoute === "back") {
      event?.preventDefault?.();
      event?.stopPropagation?.();
      event?.stopImmediatePropagation?.();
      this.consumeBackRequest();
      return true;
    }

    // Real form controls retain their native keyboard behavior. Toolbar
    // buttons deliberately are not part of this exception: Player shortcuts
    // are screen-scoped rather than tied to the last clicked control.
    if (shortcutRoute === "native-input") {
      return false;
    }

    if (shortcutRoute === "pause-overlay") {
      const mediaAction = this.resolveMediaAction(event);
      event?.preventDefault?.();
      event?.stopPropagation?.();
      event?.stopImmediatePropagation?.();
      if (this.stillWatchingPromptVisible) {
        if (keyCode === 37 || keyCode === 39) {
          this.stillWatchingPromptFocus =
            this.stillWatchingPromptFocus === "continue" ? "exit" : "continue";
          this.renderPauseOverlay();
          return true;
        }
        if (
          mediaAction === "play" ||
          mediaAction === "toggle" ||
          keyCode === 32 ||
          isSelectKeyCode(keyCode)
        ) {
          if (this.stillWatchingPromptFocus === "exit") {
            this.onDismissStillWatchingPrompt();
          } else {
            await this.onStillWatchingContinue();
          }
        }
        return true;
      }
      if (
        mediaAction === "play" ||
        mediaAction === "toggle" ||
        keyCode === 32 ||
        isSelectKeyCode(keyCode)
      ) {
        this.dismissPauseOverlay();
        this.togglePause();
        this.renderControlButtons();
        return true;
      }
      this.dismissPauseOverlay({ revealControls: true, focus: false });
      return true;
    }

    // Dialogs and panels own their keyboard interaction. Do not let a player
    // shortcut pass through to playback while an interactive chooser is open.
    if (shortcutRoute === "dialog") {
      await this.handleBrowserDialogKey(event);
      event?.preventDefault?.();
      event?.stopPropagation?.();
      return true;
    }

    if (shortcutRoute === "fullscreen") {
      event?.preventDefault?.();
      if (!event?.repeat) {
        void this.toggleDesktopFullscreen();
      }
      return true;
    }

    if (shortcutRoute === "mute") {
      event?.preventDefault?.();
      if (!event?.repeat) {
        this.toggleDesktopMute();
      }
      return true;
    }

    if (!this.controlsVisible && this.activeSkipInterval && !this.skipIntervalDismissed) {
      if (isSelectKeyCode(keyCode) && this.skipActiveInterval()) {
        event?.preventDefault?.();
        return true;
      }
    }

    if (!this.controlsVisible && this.isNextEpisodeCardVisible() && isSelectKeyCode(keyCode)) {
      event?.preventDefault?.();
      await this.playNextEpisode({ userInitiated: true });
      return true;
    }

    const mediaAction = this.resolveMediaAction(event);
    if (mediaAction) {
      event?.preventDefault?.();
      event?.stopPropagation?.();
      event?.stopImmediatePropagation?.();
      this.applyMediaAction(mediaAction);
      return true;
    }

    if (shortcutRoute === "play-pause") {
      event?.preventDefault?.();
      this.revealDesktopPlayerControls();
      this.togglePause();
      this.renderControlButtons();
      return true;
    }

    if (shortcutRoute === "seek") {
      event?.preventDefault?.();
      this.revealDesktopPlayerControls();
      this.beginSeekPreview(keyCode === 39 ? 1 : -1, false);
      this.commitSeekPreview();
      return true;
    }

    if (shortcutRoute === "volume") {
      event?.preventDefault?.();
      this.revealDesktopPlayerControls();
      const currentVolume = this.getDesktopVolumeState().volume;
      this.setDesktopVolume(currentVolume + (keyCode === 38 ? 0.05 : -0.05));
      return true;
    }

    if (keyCode === 83) {
      this.openSubtitleDialog();
      return true;
    }
    if (keyCode === 84) {
      this.openAudioDialog();
      return true;
    }
    if (keyCode === 67) {
      this.openSourcesPanel();
      return true;
    }
    if (keyCode === 69) {
      this.toggleEpisodePanel();
      return true;
    }
    if (keyCode === 80) {
      this.togglePause();
      this.renderControlButtons();
      return true;
    }

    this.resetControlsAutoHide();
    return false;
  },

  async onKeyDown(event) {
    const fallback = event.target?.closest?.("[data-action='labelFallbackReason']");
    if (fallback && ["Enter", " "].includes(event.key)) {
      event.preventDefault();
      event.stopPropagation();
      this.showAspectToast(fallback.dataset.reason, { durationMs: 10000 });
      return;
    }
    if (Environment.isBrowser()) {
      return this.handleBrowserKeyDown(event);
    }
    const keyCode = Number(event?.keyCode || 0);
    const isBackKey = isBackEvent(event);
    // Let the browser consume Escape while the Player owns fullscreen. The
    // fullscreenchange listener will refresh the button state, while Player
    // navigation remains untouched until fullscreen has already exited.
    if (Environment.isBrowser() && isBackKey && this.isDesktopPlayerFullscreen()) {
      return;
    }
    if (this.isStartupErrorVisible()) {
      if (keyCode === 9) return false;
      event?.preventDefault?.();
      event?.stopPropagation?.();
      if (
        isSelectKeyCode(keyCode) &&
        this.handleUnverifiedPlaybackAction?.(document.activeElement?.dataset?.playerErrorAction)
      )
        return true;
      if (
        isSelectKeyCode(keyCode) &&
        document.activeElement?.dataset?.playerErrorAction === "play"
      ) {
        this.retryClientRemuxFromGesture();
        return true;
      }
      if (isBackKey || isSelectKeyCode(keyCode) || keyCode === 66) {
        if (!this.navigateBackToStreamScreen()) {
          Router.back();
        }
      }
      return;
    }
    if (isBackKey) {
      event?.preventDefault?.();
      event?.stopPropagation?.();
      event?.stopImmediatePropagation?.();
      this.consumeBackRequest();
      return;
    }
    if (
      Environment.isBrowser() &&
      (keyCode === 70 || event?.code === "KeyF" || keyCode === 77 || event?.code === "KeyM")
    ) {
      const eventTarget = event?.target instanceof Element ? event.target : document.activeElement;
      const activeTarget =
        document.activeElement instanceof Element ? document.activeElement : eventTarget;
      if (this.isDesktopEditableTarget(eventTarget) || this.isDesktopEditableTarget(activeTarget)) {
        return;
      }
      if (
        this.isDesktopPanelInteractiveTarget(eventTarget) ||
        this.isDesktopPanelInteractiveTarget(activeTarget)
      ) {
        return;
      }
      event?.preventDefault?.();
      if (event?.repeat) {
        return;
      }
      if (keyCode === 70 || event?.code === "KeyF") {
        void this.toggleDesktopFullscreen();
      } else {
        this.toggleDesktopMute();
      }
      return;
    }
    if (Environment.isBrowser() && (keyCode === 32 || event?.code === "Space")) {
      const eventTarget = event?.target instanceof Element ? event.target : document.activeElement;
      const activeTarget =
        document.activeElement instanceof Element ? document.activeElement : eventTarget;
      if (this.isDesktopEditableTarget(eventTarget) || this.isDesktopEditableTarget(activeTarget)) {
        return;
      }

      const interactiveTarget =
        this.getDesktopPlayerInteractiveTarget(eventTarget) ||
        this.getDesktopPlayerInteractiveTarget(activeTarget);
      event?.preventDefault?.();
      if (interactiveTarget) {
        if (interactiveTarget.matches("[data-player-desktop-back]")) {
          this.navigateBackToStreamScreen();
        } else {
          void this.onPointerActivate(interactiveTarget, event);
        }
        return;
      }

      this.performControlAction("playPause");
      return;
    }
    if (
      Environment.isBrowser() &&
      !this.isDialogOpen() &&
      !this.pauseOverlayVisible &&
      (keyCode === 37 || keyCode === 38 || keyCode === 39 || keyCode === 40)
    ) {
      const eventTarget = event?.target instanceof Element ? event.target : document.activeElement;
      const activeTarget =
        document.activeElement instanceof Element ? document.activeElement : eventTarget;
      // Let native text and range controls keep their own Arrow-key behavior.
      if (this.isDesktopEditableTarget(eventTarget) || this.isDesktopEditableTarget(activeTarget)) {
        return;
      }

      event?.preventDefault?.();
      this.revealDesktopPlayerControls();
      if (keyCode === 37 || keyCode === 39) {
        // Commit the existing seek calculation immediately for browser key presses.
        this.beginSeekPreview(keyCode === 39 ? 1 : -1, false);
        this.commitSeekPreview();
        return;
      }

      const currentVolume = this.getDesktopVolumeState().volume;
      this.setDesktopVolume(currentVolume + (keyCode === 38 ? 0.05 : -0.05));
      return;
    }
    if (this.nextEpisodeBackExitArmed) {
      this.nextEpisodeBackExitArmed = false;
    }
    if (
      keyCode === 37 ||
      keyCode === 38 ||
      keyCode === 39 ||
      keyCode === 40 ||
      isSelectKeyCode(keyCode)
    ) {
      event?.preventDefault?.();
    }
    const mediaAction = this.resolveMediaAction(event);
    if (this.pauseOverlayVisible) {
      event?.preventDefault?.();
      event?.stopPropagation?.();
      event?.stopImmediatePropagation?.();
      if (this.stillWatchingPromptVisible) {
        if (keyCode === 37 || keyCode === 39) {
          this.stillWatchingPromptFocus =
            this.stillWatchingPromptFocus === "continue" ? "exit" : "continue";
          this.renderPauseOverlay();
          return;
        }
        if (mediaAction === "play" || mediaAction === "toggle" || isSelectKeyCode(keyCode)) {
          if (this.stillWatchingPromptFocus === "exit") {
            this.onDismissStillWatchingPrompt();
          } else {
            await this.onStillWatchingContinue();
          }
          return;
        }
        return;
      }
      if (mediaAction === "play" || mediaAction === "toggle" || isSelectKeyCode(keyCode)) {
        this.dismissPauseOverlay();
        this.togglePause();
        this.renderControlButtons();
        return;
      }
      this.dismissPauseOverlay({ revealControls: true, focus: false });
      if (this.paused) {
        this.schedulePauseOverlay({ restart: true });
      }
      return;
    }
    if (this.paused) {
      this.schedulePauseOverlay({ restart: true });
    }

    if (this.episodePanelVisible && this.handleEpisodePanelKey(event)) {
      return;
    }

    if (mediaAction) {
      event?.preventDefault?.();
      event?.stopPropagation?.();
      event?.stopImmediatePropagation?.();
      this.applyMediaAction(mediaAction);
      return;
    }

    if (this.sourcesPanelVisible) {
      if (await this.handleSourcesPanelKey(event)) {
        return;
      }
    }

    if (this.subtitleDialogVisible) {
      if (this.handleSubtitleDialogKey(event)) {
        return;
      }
    }

    if (this.audioDialogVisible) {
      if (this.handleAudioDialogKey(event)) {
        return;
      }
    }

    if (this.speedDialogVisible) {
      if (this.handleSpeedDialogKey(event)) {
        return;
      }
    }

    if (keyCode === 83) {
      if (this.subtitleDialogVisible) {
        this.closeSubtitleDialog();
      } else {
        this.openSubtitleDialog();
      }
      return;
    }

    if (keyCode === 84) {
      if (this.audioDialogVisible) {
        this.closeAudioDialog();
      } else {
        this.openAudioDialog();
      }
      return;
    }

    if (keyCode === 67) {
      if (this.sourcesPanelVisible) {
        this.closeSourcesPanel();
      } else {
        this.openSourcesPanel();
      }
      return;
    }

    if (keyCode === 69) {
      this.toggleEpisodePanel();
      return;
    }

    if (keyCode === 80) {
      this.togglePause();
      this.renderControlButtons();
      return;
    }

    if (
      !this.controlsVisible &&
      this.activeSkipInterval &&
      !this.skipIntervalDismissed &&
      !this.skipIntroAutoHidden
    ) {
      if (isSelectKeyCode(keyCode)) {
        if (this.skipActiveInterval()) {
          return;
        }
      }
    }

    if (!this.controlsVisible && this.isNextEpisodeCardVisible()) {
      if (isSelectKeyCode(keyCode)) {
        await this.playNextEpisode({ userInitiated: true });
        return;
      }
      if (keyCode === 38 || keyCode === 40) {
        this.setControlsVisible(true, { focus: true });
        return;
      }
    }

    if (
      !this.paused &&
      this.controlsVisible &&
      !this.isDialogOpen() &&
      Boolean(event?.repeat) &&
      (keyCode === 37 || keyCode === 39)
    ) {
      this.focusProgressBar();
      this.beginSeekPreview(keyCode === 37 ? -1 : 1, true);
      return;
    }

    if (!this.controlsVisible) {
      if (keyCode === 37) {
        this.autoHideControlsAfterSeek = false;
        this.beginSeekPreview(-1, Boolean(event?.repeat));
        return;
      }
      if (keyCode === 39) {
        this.autoHideControlsAfterSeek = false;
        this.beginSeekPreview(1, Boolean(event?.repeat));
        return;
      }
      if (keyCode === 38) {
        this.autoHideControlsAfterSeek = false;
        this.setControlsVisible(true, { focus: true });
        return;
      }
      if (keyCode === 40) {
        this.autoHideControlsAfterSeek = false;
        this.setControlsVisible(true, { focus: true });
        return;
      }
      if (isSelectKeyCode(keyCode)) {
        event?.stopPropagation?.();
        event?.stopImmediatePropagation?.();
        this.autoHideControlsAfterSeek = false;
        if (this.seekPreviewSeconds != null) {
          this.cancelSeekPreview({ commit: true });
        } else if (this.seekOverlayVisible) {
          this.cancelSeekPreview({ commit: false });
        }
        this.togglePause({ focusControls: true });
        this.renderControlButtons();
      }
      return;
    }

    if (this.controlFocusZone === "skipIntro") {
      if (isSelectKeyCode(keyCode)) {
        if (this.skipActiveInterval()) {
          return;
        }
      }
      if (keyCode === 40) {
        this.focusProgressBar();
        return;
      }
      if (keyCode === 38 || keyCode === 37 || keyCode === 39) {
        this.resetControlsAutoHide();
        return;
      }
    }

    if (this.controlFocusZone === "progress") {
      if (keyCode === 37) {
        this.beginSeekPreview(-1, Boolean(event?.repeat));
        return;
      }
      if (keyCode === 39) {
        this.beginSeekPreview(1, Boolean(event?.repeat));
        return;
      }
      if (keyCode === 38) {
        this.stickyProgressFocus = false;
        this.autoHideControlsAfterSeek = false;
        if (this.focusSkipIntroButton()) {
          return;
        }
        this.setControlsVisible(false);
        return;
      }
      if (keyCode === 40) {
        this.stickyProgressFocus = false;
        this.autoHideControlsAfterSeek = false;
        this.controlFocusZone = "buttons";
        this.syncControlFocusDom();
        return;
      }
      if (isSelectKeyCode(keyCode)) {
        this.autoHideControlsAfterSeek = false;
        this.togglePause();
        this.focusProgressBar();
        this.renderControlButtons();
        return;
      }
    }

    if (keyCode === 37) {
      this.moveControlFocus(-1);
      return;
    }
    if (keyCode === 39) {
      this.moveControlFocus(1);
      return;
    }
    if (keyCode === 38) {
      this.focusProgressBar();
      return;
    }
    if (keyCode === 40) {
      this.setControlsVisible(false);
      return;
    }
    if (isSelectKeyCode(keyCode)) {
      this.performFocusedControl();
      return;
    }

    this.resetControlsAutoHide();
  },

  selectBestStreamCandidate(streams = []) {
    streams = filterFilenameStreams(streams, PlayerSettingsStore.get());
    if (!Array.isArray(streams) || !streams.length) {
      return null;
    }

    const hasCapabilityProbe = Boolean(PlayerController?.video);
    const capabilities =
      hasCapabilityProbe && typeof PlayerController.getPlaybackCapabilities === "function"
        ? PlayerController.getPlaybackCapabilities()
        : null;
    const supports = (key, fallback = true) => {
      if (!capabilities) {
        return fallback;
      }
      return Boolean(capabilities[key]);
    };

    const resolveContext = {
      season: this.params?.season == null ? null : Number(this.params.season),
      episode: this.params?.episode == null ? null : Number(this.params.episode)
    };

    const scored = streams
      .filter((stream) =>
        Boolean(
          stream?.url ||
          stream?.externalUrl ||
          DirectDebridResolver.canResolveStream(stream, resolveContext)
        )
      )
      .map((stream) => {
        const presentation = stream.streamPresentation || stream.raw?.streamPresentation || {};
        const text = [
          stream.title,
          stream.label,
          stream.name,
          stream.description,
          stream.behaviorHints?.filename,
          stream.raw?.behaviorHints?.filename,
          stream.raw?.filename,
          presentation.resolution,
          presentation.quality,
          presentation.encode,
          ...(Array.isArray(presentation.visualTags) ? presentation.visualTags : []),
          ...(Array.isArray(presentation.audioTags) ? presentation.audioTags : []),
          ...(Array.isArray(presentation.audioChannels) ? presentation.audioChannels : []),
          stream.url,
          stream.externalUrl,
          stream.infoHash
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        let score = 0;

        if (text.includes("2160") || text.includes("4k")) score += 60;
        else if (text.includes("1080")) score += 40;
        else if (text.includes("720")) score += 20;
        else if (text.includes("480")) score += 10;

        if (text.includes("web")) score += 8;
        if (text.includes("bluray")) score += 8;
        if (hasReleaseToken(text, "cam")) score -= 70;
        if (hasReleaseToken(text, "ts")) score -= 40;

        if (text.includes("hevc") || text.includes("h265") || text.includes("x265")) {
          score += supports("mp4Hevc", true) || supports("mp4HevcMain10", true) ? 12 : -90;
        }
        if (text.includes("av1")) {
          score += supports("mp4Av1", true) ? 10 : -80;
        }
        if (text.includes("vp9")) {
          score += supports("webmVp9", true) ? 8 : -50;
        }
        if (text.includes(".mkv") || text.includes("matroska")) {
          score += supports("mkvH264", true) ? 8 : -120;
        }
        if (text.includes(".webm")) {
          score += supports("webmVp9", true) ? 6 : -45;
        }

        if (
          hasReleaseToken(text, "hdr") ||
          hasReleaseToken(text, "hdr10") ||
          hasReleaseToken(text, "hlg")
        ) {
          score += supports("hdrLikely", true) ? 16 : -35;
        }
        if (
          text.includes("dolby vision") ||
          hasReleaseToken(text, "dv") ||
          hasReleaseToken(text, "dovi")
        ) {
          score += supports("dolbyVision", true) ? 18 : -45;
        }
        if (text.includes("atmos") || text.includes("eac3") || text.includes("ec-3")) {
          score += supports("atmosLikely", true) || supports("audioEac3", true) ? 14 : -30;
        }
        if (/\b(aac|mp4a)\b/.test(text)) {
          score += 16;
        }
        if (/\b(ac3|dolby digital)\b/.test(text) && !/\b(eac3|ec-3|ddp|atmos)\b/.test(text)) {
          score += 10;
        }
        if (/\b(eac3|ec-3|ddp|atmos)\b/.test(text)) {
          score -= 18;
        }
        if (/\b(truehd|dts-hd|dts:x|dts)\b/.test(text)) {
          score -= 40;
        }
        if (/\b(stereo|2\.0|2ch)\b/.test(text)) {
          score += 4;
        }

        if (
          !stream.url &&
          !stream.externalUrl &&
          DirectDebridResolver.canResolveStream(stream, resolveContext)
        ) {
          score += 2;
        }

        return { stream, score };
      })
      .sort((left, right) => right.score - left.score);

    return scored[0]?.stream || null;
  },

  selectBestStreamUrl(streams = []) {
    const candidate = this.selectBestStreamCandidate(streams);
    return streamDirectPlaybackUrl(candidate) || null;
  },

  selectBestStreamCandidateForAddon(streams = [], addonName = "") {
    const normalizedAddonName = String(addonName || "").trim();
    if (!normalizedAddonName || !Array.isArray(streams) || !streams.length) {
      return null;
    }

    const addonStreams = streams.filter(
      (stream) => String(stream?.addonName || "").trim() === normalizedAddonName
    );
    if (!addonStreams.length) {
      return null;
    }

    return this.selectBestStreamCandidate(addonStreams);
  },

  selectBestStreamUrlForAddon(streams = [], addonName = "") {
    const candidate = this.selectBestStreamCandidateForAddon(streams, addonName);
    return streamDirectPlaybackUrl(candidate) || null;
  },

  async handlePlaybackEnded() {
    if (PlayerController.isClientRemuxRestoring()) return;
    // Immediate scrobble stop (may trigger mark-as-watched)
    if (TrackingScrobbleService.isEnabled() && !PlayerController.shouldSuppressOfflineProgress()) {
      TrackingScrobbleService.stop(this.buildScrobbleContext());
    }
    this.clearPlaybackStallGuard();
    this.releaseStartupAudioGate({ resume: false });
    const settings = PlayerSettingsStore.get();
    const autoplayEnabled = Boolean(settings.autoplayNextEpisode);
    const canAutoplayNext = autoplayEnabled && this.hasPlaybackReachedNaturalEnd();
    if (canAutoplayNext) {
      const nextEpisode = this.resolveNextEpisodeInfo();
      if (
        shouldEnterStillWatchingPrompt({
          stillWatchingEnabled: settings.stillWatchingEnabled,
          autoPlayNextEpisodeEnabled: settings.autoplayNextEpisode,
          nextEpisodeHasAired: nextEpisode?.hasAired,
          consecutiveAutoPlayCount: this.consecutiveAutoPlayCount,
          threshold: settings.stillWatchingEpisodeThreshold
        })
      ) {
        this.enterStillWatchingPromptMode();
        return;
      }
      const nextEpisodeHandled = await this.playNextEpisode({ userInitiated: false });
      if (nextEpisodeHandled || this.nextEpisodeLaunching || Router.getCurrent() !== "player") {
        return;
      }
    }

    // A finished film leaves the player for the same place a finished episode
    // does. This asked for the item's type instead, so a film sat in a stopped
    // player on its own last frame while an episode went back to Detail. The
    // destination was never about the type: Back already answers it, and a
    // Player entry carrying an itemId is the one with a Detail page behind it.
    if (this.params?.itemId) {
      void Router.navigate("detail", this.buildDetailRouteParamsFromPlayer(), {
        skipStackPush: true,
        replaceHistory: true
      });
      return;
    }

    // Nothing to go back to -- a direct or manual stream. Settle in place.
    this.loadingVisible = false;
    this.paused = true;
    this.dismissPauseOverlay();
    this.updateLoadingVisibility();
    this.updateMediaSessionPlaybackState();
    this.setControlsVisible(true, { focus: false });
    this.renderControlButtons();
    this.renderNextEpisodeCard();
    this.updateUiTick();
  },

  cleanup({ preserveStartupLoading = false } = {}) {
    this.closeOfflineDownloadOptions?.();
    this._nextSourceDiscoveryCancel?.();
    this._candidatePlaybackGeneration = (this._candidatePlaybackGeneration || 0) + 1;
    this._selectedSourceAbort?.abort();
    this._selectedSourceProber?.cancelAll();
    this._selectedSourceProber = null;
    this._fallbackAudioProber?.cancelAll();
    this._fallbackAudioProber = null;
    this.clearRelayTrackData();
    if (!preserveStartupLoading) StartupLoadingOverlay.finish();
    this.startupLoadingStage = "loading";
    try {
      this.playerRouteActive = false;
      this.externalPlayerChooserDialog?.destroy?.();
      this.externalPlayerChooserDialog = null;
      this.releaseOfflineObjectUrl();
      this.releaseOfflineSubtitleObjectUrls();
      if (this.isDesktopPlayerPictureInPicture()) {
        void this.exitDesktopPictureInPicture().catch(() => {});
      }
      this.unbindDesktopPlayerPointerBridge();
      this.browserOrientation?.destroy();
      this.browserOrientation = null;
      this.playerMountToken = Number(this.playerMountToken || 0) + 1;
      this.nextEpisodeLaunchToken = Number(this.nextEpisodeLaunchToken || 0) + 1;
      this.nextEpisodeLaunching = false;
      this.resetNextEpisodeLaunchPresentation();
      this.nextEpisodeAutoplayAttemptedKey = "";
      this.resetStillWatchingPromptState({ render: false });
      this.consecutiveAutoPlayCount = 0;
      this.unbindVideoEvents();
      if (this.endedHandler && PlayerController.video) {
        PlayerController.video.removeEventListener("ended", this.endedHandler);
        this.endedHandler = null;
      }
      TrackingScrobbleService.cancel();
      this.cancelSeekPreview({ commit: false });
      this.dismissPauseOverlay();
      this.pauseOverlayMetaRequestToken = Number(this.pauseOverlayMetaRequestToken || 0) + 1;
      this.nextEpisodeTransitionMeta = null;
      this.streamCandidatesByVideoId?.clear?.();
      this.streamCandidatesLoadPromises?.clear?.();
      this.hlsManifestSubtitlePromotionUrls?.clear?.();
      this.failedPlaybackUrls?.clear?.();
      this.failedPlaybackStreamIds?.clear?.();
      this.skipIntervalsRequestToken = Number(this.skipIntervalsRequestToken || 0) + 1;
      this.subtitleLoadToken = (this.subtitleLoadToken || 0) + 1;
      this.subtitleSelectionToken = Number(this.subtitleSelectionToken || 0) + 1;
      this.manifestLoadToken = (this.manifestLoadToken || 0) + 1;
      this.trackDiscoveryToken = (this.trackDiscoveryToken || 0) + 1;
      this.clearStartupAudioPreferenceRetry();
      this.trackDiscoveryInProgress = false;
      this.trackDiscoveryStartedAt = 0;
      this.trackDiscoveryDeadline = 0;
      this.subtitleLoading = false;
      this.manifestLoading = false;
      this.clearHtmlSubtitleOverlay();
      if (this.sourceLogoRenderTimer) {
        clearTimeout(this.sourceLogoRenderTimer);
        this.sourceLogoRenderTimer = null;
      }
      this.clearTrackDiscoveryTimer();
      this.stopLoadingLogoFillAnimation();
      this.clearPlaybackStallGuard();
      this.clearSubtitleCueStyleBindings();
      this.clearMountedExternalSubtitleTracks();

      this.clearControlsAutoHide();
      this.skipIntroAutoHidden = false;
      this.skipIntroCountdownProgress = 0;
      this.skipIntroCountdownLastTickAt = 0;
      this.skipIntroCountdownStartAt = 0;
      this.skipIntroSuppressedKey = "";
      this.skipIntroSuppressedUntil = 0;
      this.stopSkipIntroCountdownAnimation();
      if (this.skipIntroFocusFrame != null && typeof cancelAnimationFrame === "function") {
        cancelAnimationFrame(this.skipIntroFocusFrame);
      }
      this.skipIntroFocusFrame = null;

      if (this.tickTimer) {
        clearInterval(this.tickTimer);
        this.tickTimer = null;
      }

      this.stopSkipIntervalCheckTimer();

      if (this.aspectToastTimer) {
        clearTimeout(this.aspectToastTimer);
        this.aspectToastTimer = null;
      }

      if (this.parentalGuideTimer) {
        clearTimeout(this.parentalGuideTimer);
        this.parentalGuideTimer = null;
      }
      if (this.parentalGuideExitTimer) {
        clearTimeout(this.parentalGuideExitTimer);
        this.parentalGuideExitTimer = null;
      }
      this.parentalGuideExiting = false;
      this.stopParentalGuideLineAnimation({ reset: true });

      if (this.subtitleSelectionTimer) {
        clearTimeout(this.subtitleSelectionTimer);
        this.subtitleSelectionTimer = null;
      }
      if (this.subtitleDialogScrollTimer) {
        clearTimeout(this.subtitleDialogScrollTimer);
        this.subtitleDialogScrollTimer = null;
      }
      this.cancelSubtitlePointerScrollTransaction();

      this.clearMediaSessionHandlers();

      this.releaseStartupAudioGate({ resume: false });
    } catch (error) {
      try {
        console.warn("Player cleanup error suppressed to keep navigation working", error);
      } catch (_) {}
    } finally {
      // Always stop playback and hide the player surface, even if the teardown
      // above threw, so the user is never left stuck in the player with the
      // video still playing if a teardown step aborts route navigation.
      try {
        PlayerController.stop();
      } catch (_) {}
      try {
        if (this.container) {
          this.container.style.display = "none";
          this.container.querySelector("#playerUiRoot")?.remove();
          this.container.querySelector("#episodeSidePanel")?.remove();
        }
      } catch (_) {}
      this.uiRefs = null;
      this.lastUiTickState = null;
    }
  }
};
