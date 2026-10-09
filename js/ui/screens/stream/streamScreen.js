import { Router } from "../../navigation/router.js";
import { subtitleReleaseName } from "../../../domain/model/subtitle.js";
import { ScreenUtils } from "../../navigation/screen.js";
import { streamRepository } from "../../../data/repository/streamRepository.js";
import { addonRepository } from "../../../data/repository/addonRepository.js";
import { watchProgressRepository } from "../../../data/repository/watchProgressRepository.js";
import { isWatchProgressInProgress } from "../../../domain/model/watchProgress.js";
import { PlayerSettingsStore } from "../../../data/local/playerSettingsStore.js";
import { StreamPreferencesStore } from "../../../data/local/streamPreferencesStore.js";
import {
  selectAutoPlayStream,
  isAutoPlayEffectivelyEnabled,
  collectInstalledAddonNames,
  resolvePreferredBingeGroup
} from "../../../core/streams/streamAutoPlaySelector.js";
import {
  orderSourceNames,
  orderStreamsByAddonOrder
} from "../../../core/streams/streamOrdering.js";
import { buildStreamResumeIdentity } from "../../../core/streams/streamResumeIdentity.js";
import {
  flattenStreams,
  mergeStreamItems,
  streamMergeKey
} from "../../../core/streams/streamList.js";
import {
  DirectDebridStreamPreparer,
  directDebridPreparationKey
} from "../../../core/debrid/directDebridStreamPreparer.js";
import { DebridStreamPresentation } from "../../../core/debrid/directDebridStreamPresentation.js";
import { DebridSettingsStore } from "../../../data/local/debridSettingsStore.js";
import { StreamBadgeSettingsStore } from "../../../data/local/streamBadgeSettingsStore.js";
import {
  getCachedAddonLogoDisplayUrl,
  hasFailedAddonLogo,
  normalizeAddonLogoLookup,
  normalizeAddonLogoUrl,
  preloadAddonLogoImages,
  preloadAddonLogoUrls,
  rememberAddonLogoLookup,
  rememberFailedAddonLogo,
  requestAddonLogo,
  resolveAddonLogo
} from "../../../core/media/addonLogoCache.js";
import { renderContentFilterPicker } from "../../components/filterPicker.js";
import { Platform } from "../../../platform/index.js";
import { Environment } from "../../../platform/environment.js";
import { I18n } from "../../../i18n/index.js";
import {
  matchStreamBadges,
  normalizeStreamBadgeChipColor,
  normalizeStreamBadgeRules
} from "../../../core/streams/streamBadgeRules.js";
import {
  normalizeSourceForDisplay,
  renderBrowserSourceCardContent
} from "../../components/browserStreamSourceCard.js";
import { resolveBrowserStreamCardClickAction } from "../../components/browserStreamCardClick.js";
import { renderRouteHandoffShell } from "../../components/routeHandoffShell.js";
import { resolveHandoffReturnRoute } from "../../../core/streams/streamAutoResolve.js";
import {
  shouldRevealFocusedStreamItem,
  streamFocusRevealKey
} from "../../../core/streams/streamFocusReveal.js";
import { NuvioDialog } from "../../components/nuvioDialog.js";
import { renderLoadingIndicator } from "../../components/loadingIndicator.js";
import {
  getBrowserExternalPlayerOptions,
  getBrowserExternalPlayerPlatform,
  launchBrowserExternalPlayer,
  normalizeBrowserExternalPlayer,
  prepareBrowserExternalPlaybackLaunch
} from "../../components/browserExternalPlayer.js";
import { resolveExternalHandoffMediaUrl } from "../../components/externalHandoffMediaUrl.js";
import { resolveExternalResumeSeconds } from "../../components/externalPlayerResume.js";
import { bindBrowserPushReturn } from "../../components/browserPushReturn.js";
import { normalizeSubtitleForDisplay } from "../../components/browserSubtitleDisplay.js";
import {
  createBrowserOfflineSubtitlePicker,
  createBrowserOfflineSubtitleSnapshot
} from "../../components/browserOfflineSubtitlePicker.js";
import { subtitleRepository } from "../../../data/repository/subtitleRepository.js";
import {
  canQueueBrowserOfflineDownload,
  createOfflineDownloadId,
  createOfflineSubtitleFingerprint,
  getOfflineSubtitleIdentityParts,
  getSafeOfflineSubtitleDescriptors,
  deleteBrowserOfflineDownload,
  getOfflineDownload,
  isBrowserOfflineDownloadSupported,
  listOfflineDownloads,
  listOfflineDownloadsForMedia,
  listOfflineSubtitles,
  subscribeToOfflineDownloads
} from "../../../core/offline/browserOfflineDownloads.js";
import { summariseOfflineDownloads } from "../../../core/offline/offlineDownloadSummary.js";
import {
  createBrowserOfflinePlayback,
  releaseBrowserOfflinePlayback
} from "../../../core/offline/browserOfflinePlayback.js";
import {
  canOfferOfflineSubtitleHandoff,
  sendOfflineSubtitleFor,
  startOfflinePlayback
} from "../../components/browserOfflinePlaybackChoice.js";
import {
  cancelQueuedBrowserOfflineDownload,
  enqueueBrowserOfflineDownload,
  initializeBrowserOfflineDownloadQueue,
  pauseQueuedBrowserOfflineDownload,
  resumeQueuedBrowserOfflineDownload
} from "../../../core/offline/browserOfflineDownloadQueue.js";

const STREAM_BADGE_LIMIT = 9;

// Stands in for the source list while comparing one render of the page against
// the last. A comment cannot appear in generated markup, so it cannot collide.
const STREAM_LIST_BODY_TOKEN = "<!--nuvio-stream-list-body-->";

// How long to keep the waiting screen up while an external player is asked to
// open, before concluding that nothing is coming. Generous on purpose: iOS can
// put a "Open in...?" confirmation in front of the launch, and the page is
// still visible the whole time that sits there. Treating that as a failure
// would restore the picker underneath the dialog.
const EXTERNAL_HANDOFF_GRACE_MS = 4000;
// Number of rows on each side of the focused source to keep badge-hydrated.
// Windowing by row index (instead of measuring every card) keeps a single
// focus move O(1) in layout reads on TV browsers, where measuring every card
// forced a full list reflow on each keypress in long source lists.
function t(key, params = {}, fallback = key) {
  return I18n.t(key, params, { fallback });
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function escapeHtml(value = "") {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function guessMimeTypeFromUrl(url = "") {
  const value = String(url || "")
    .trim()
    .toLowerCase();
  if (!value) {
    return null;
  }
  const extensionMatch = value.match(
    /\.(m3u8|mpd|mp4|m4v|mov|mkv|webm|ts|m2ts|mp3|aac|flac)(?=($|[/?#&]))/i
  );
  if (!extensionMatch) {
    return null;
  }
  const extension = String(extensionMatch[1] || "").toLowerCase();
  const mimeMap = {
    aac: "audio/aac",
    flac: "audio/flac",
    m2ts: "video/mp2t",
    m3u8: "application/vnd.apple.mpegurl",
    m4v: "video/mp4",
    mkv: "video/x-matroska",
    mov: "video/quicktime",
    mp3: "audio/mpeg",
    mp4: "video/mp4",
    mpd: "application/dash+xml",
    ts: "video/mp2t",
    webm: "video/webm"
  };
  return mimeMap[extension] || null;
}

function getDpadDirection(event) {
  const keyCode = Number(event?.keyCode || 0);
  const key = String(event?.key || "").toLowerCase();
  if (keyCode === 37 || key === "arrowleft" || key === "left") return "left";
  if (keyCode === 39 || key === "arrowright" || key === "right") return "right";
  if (keyCode === 38 || key === "arrowup" || key === "up") return "up";
  if (keyCode === 40 || key === "arrowdown" || key === "down") return "down";
  return null;
}

function isBackEvent(event) {
  const key = String(event?.key || "").toLowerCase();
  const keyCode = Number(event?.keyCode || 0);
  return key === "escape" || key === "browserback" || keyCode === 27;
}

function normalizeType(itemType) {
  const normalized = String(itemType || "movie").toLowerCase();
  return normalized || "movie";
}

function detectQuality(text = "") {
  const value = String(text).toLowerCase();
  if (value.includes("2160") || value.includes("4k")) return "4k";
  if (value.includes("1080")) return "1080p";
  if (value.includes("720")) return "720p";
  if (value.includes("480")) return "480p";
  return "Auto";
}

function formatBytes(value) {
  const size = Number(value || 0);
  if (!Number.isFinite(size) || size <= 0) {
    return "";
  }
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

function normalizeEpisodeCode(season, episode) {
  const seasonNumber = Number(season);
  const episodeNumber = Number(episode || 0);
  if (season == null || !Number.isFinite(seasonNumber) || seasonNumber < 0 || episodeNumber <= 0) {
    return "";
  }
  return `S${seasonNumber} E${episodeNumber}`;
}

function getAddonBadgeLabel(name = "") {
  const cleaned = String(name || "").trim();
  if (!cleaned) {
    return "A";
  }
  if (/torrentio|torbox|torrent/i.test(cleaned)) {
    return "µ";
  }
  const letters = cleaned
    .split(/\s+/)
    .map((part) => part.charAt(0).toUpperCase())
    .join("")
    .slice(0, 2);
  return letters || cleaned.charAt(0).toUpperCase();
}

export async function preloadStreamBadgeImages(settings = StreamBadgeSettingsStore.snapshot()) {
  const rules = normalizeStreamBadgeRules(settings?.rules);
  const urls = new Set();
  rules.imports.forEach((importItem) => {
    (importItem.filters || []).forEach((filter) => {
      const url = normalizeAddonLogoUrl(filter.imageURL);
      if (url) {
        urls.add(url);
      }
    });
  });
  await preloadAddonLogoUrls(urls);
}

async function preloadMatchedStreamBadgeImages(
  streams = [],
  settings = StreamBadgeSettingsStore.snapshot()
) {
  const urls = new Set();
  (streams || []).forEach((stream) => {
    matchStreamBadges(stream, settings?.rules)
      .slice(0, STREAM_BADGE_LIMIT)
      .forEach((badge) => {
        const url = normalizeAddonLogoUrl(badge.imageURL);
        if (url) {
          urls.add(url);
        }
      });
  });
  await preloadAddonLogoUrls(urls);
}

function getStreamHeadline(stream = {}) {
  const primary = [stream.name, stream.title, stream.description].find((value) =>
    String(value || "").trim()
  );
  if (!primary) {
    return stream.addonName || "Unknown source";
  }
  const firstLine = String(primary).split(/\r?\n/)[0].trim();
  return firstLine || stream.addonName || "Unknown source";
}

function getStreamQuality(stream = {}) {
  const qualityLines = [];
  [stream.name, stream.title, stream.description].forEach((value) => {
    String(value || "")
      .split(/\r?\n/)
      .forEach((line) => {
        const normalized = String(line || "").trim();
        if (normalized) {
          qualityLines.push(normalized);
        }
      });
  });
  const qualityCandidate = qualityLines.find(
    (line, index) => index > 0 && /(2160|4k|1080|720|480)/i.test(line)
  );
  if (qualityCandidate) {
    return detectQuality(qualityCandidate);
  }
  return detectQuality(
    [
      stream.name || "",
      stream.title || "",
      stream.description || "",
      stream.behaviorHints?.filename || "",
      stream.sourceType || ""
    ].join(" ")
  );
}

function getStreamDescriptionLines(stream = {}) {
  const displayDescription = String(stream.description || stream.title || "").trim();
  const displayName = String(stream.name || stream.title || stream.description || "").trim();
  if (!displayDescription || displayDescription === displayName) {
    return [];
  }
  return displayDescription
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 12);
}

function renderImageBadgeChip(badge = {}) {
  const imageUrl = normalizeAddonLogoUrl(badge.imageURL);
  if (!imageUrl) {
    return "";
  }
  let displayImageUrl = getCachedAddonLogoDisplayUrl(imageUrl);
  if (imageUrl && !displayImageUrl && !hasFailedAddonLogo(imageUrl)) {
    requestAddonLogo(imageUrl);
  }
  const backgroundColor = normalizeStreamBadgeChipColor(badge.tagColor);
  const outlineColor = normalizeStreamBadgeChipColor(badge.borderColor);
  const textColor = normalizeStreamBadgeChipColor(badge.textColor);
  const filled =
    String(badge.tagStyle || "")
      .trim()
      .toLowerCase() === "filled";
  const safeImageUrl = displayImageUrl || imageUrl;
  if (!safeImageUrl) {
    return "";
  }
  const style = [
    filled && backgroundColor ? `background:${backgroundColor};` : "",
    outlineColor ? `border-color:${outlineColor};` : "",
    textColor ? `color:${textColor};` : ""
  ].join("");
  return `
    <span class="stream-route-stream-badge image${filled ? " filled" : ""}"${style ? ` style="${escapeHtml(style)}"` : ""}>
      <img src="${escapeHtml(safeImageUrl)}" alt="${escapeHtml(badge.name || "")}" loading="lazy" decoding="async" referrerpolicy="no-referrer" />
    </span>
  `;
}

function renderImportedStreamBadgeChipContents(
  stream = {},
  badges = [],
  showFileSizeBadges = true
) {
  const sizeBytes = stream.behaviorHints?.videoSize;
  const chips = [];
  badges.slice(0, STREAM_BADGE_LIMIT).forEach((badge) => {
    const chip = renderImageBadgeChip(badge);
    if (chip) {
      chips.push(chip);
    }
  });
  if (showFileSizeBadges && sizeBytes != null) {
    chips.push(
      `<span class="stream-route-stream-badge size">${escapeHtml(t("streams_size", [formatBytes(sizeBytes)], `SIZE ${formatBytes(sizeBytes)}`))}</span>`
    );
  }
  return chips.join("");
}

function renderImportedStreamBadgeChips(stream = {}, badges = [], showFileSizeBadges = true) {
  const contents = renderImportedStreamBadgeChipContents(stream, badges, showFileSizeBadges);
  return contents
    ? `<div class="stream-route-card-badges" aria-label="${escapeHtml(t("settings_stream_badges_section", {}, "Fusion Style"))}">${contents}</div>`
    : "";
}

function renderStreamBadges(stream = {}, enabled = true, badgeSettings = null) {
  if (!enabled) {
    return "";
  }
  const currentBadgeSettings = badgeSettings || StreamBadgeSettingsStore.snapshot();
  const importedBadges = matchStreamBadges(stream, currentBadgeSettings.rules);
  return renderImportedStreamBadgeChips(
    stream,
    importedBadges,
    currentBadgeSettings.showFileSizeBadges !== false
  );
}

function resolveStreamBadgePlacement(badgeSettings = null) {
  const placement = String(
    (badgeSettings || StreamBadgeSettingsStore.snapshot()).badgePlacement || "BOTTOM"
  )
    .trim()
    .toUpperCase();
  return placement === "TOP" ? "TOP" : "BOTTOM";
}

function getOrderedFilterNames(sourceChips = [], streams = []) {
  return orderSourceNames(streams, sourceChips, {
    isDirectDebrid: (stream) => DebridStreamPresentation.isDirectDebrid(stream)
  });
}

function sortStreamsByAddonOrder(streams = [], sourceChips = []) {
  return orderStreamsByAddonOrder(streams, sourceChips, {
    isDirectDebrid: (stream) => DebridStreamPresentation.isDirectDebrid(stream)
  });
}

export const StreamScreen = {
  cancelScheduledRender() {
    if (this.renderDelayTimer) {
      clearTimeout(this.renderDelayTimer);
      this.renderDelayTimer = null;
    }
    if (this.renderFrame) {
      cancelAnimationFrame(this.renderFrame);
      this.renderFrame = null;
    }
  },

  requestRender({ delayMs = 0 } = {}) {
    if (!this.container || Router.getCurrent() !== "stream") {
      return;
    }
    const delay = Math.max(0, Number(delayMs || 0));
    if (delay > 0) {
      if (this.renderFrame || this.renderDelayTimer) {
        return;
      }
      this.renderDelayTimer = setTimeout(() => {
        this.renderDelayTimer = null;
        this.requestRender();
      }, delay);
      return;
    }
    if (this.renderFrame) {
      return;
    }
    this.renderFrame = requestAnimationFrame(() => {
      this.renderFrame = null;
      if (!this.container || Router.getCurrent() !== "stream") {
        return;
      }
      this.render();
    });
  },

  applyAddonLogos(streams = []) {
    const lookup = this.addonLogoLookup || {};
    return (streams || []).map((stream) => {
      const currentLogo = normalizeAddonLogoUrl(stream?.addonLogo);
      if (currentLogo) {
        return stream;
      }
      const addonLogo = resolveAddonLogo(stream?.addonName, lookup);
      return addonLogo ? { ...stream, addonLogo } : stream;
    });
  },

  areAddonLogosReady(streams = []) {
    if (StreamBadgeSettingsStore.snapshot().showAddonLogo !== true) {
      return true;
    }
    return (streams || []).every((stream) => {
      const addonLogoUrl =
        normalizeAddonLogoUrl(stream?.addonLogo) ||
        resolveAddonLogo(stream?.addonName, this.addonLogoLookup);
      if (!addonLogoUrl || hasFailedAddonLogo(addonLogoUrl)) {
        return true;
      }
      return Boolean(getCachedAddonLogoDisplayUrl(addonLogoUrl));
    });
  },

  requestAddonLogoPrerender(streams = []) {
    if (StreamBadgeSettingsStore.snapshot().showAddonLogo !== true) {
      return;
    }
    const urls = Array.from(
      new Set(
        (streams || [])
          .map(
            (stream) =>
              normalizeAddonLogoUrl(stream?.addonLogo) ||
              resolveAddonLogo(stream?.addonName, this.addonLogoLookup)
          )
          .filter((url) => url && !hasFailedAddonLogo(url) && !getCachedAddonLogoDisplayUrl(url))
      )
    );
    if (!urls.length) {
      return;
    }
    const key = urls.sort().join("|");
    if (this.pendingAddonLogoPrerenderKey === key) {
      return;
    }
    const token = this.loadToken || 0;
    this.pendingAddonLogoPrerenderKey = key;
    void preloadAddonLogoImages(streams, this.addonLogoLookup).finally(() => {
      if (this.pendingAddonLogoPrerenderKey === key) {
        this.pendingAddonLogoPrerenderKey = "";
      }
      if (this.container && Router.getCurrent() === "stream" && token === this.loadToken) {
        this.requestRender();
      }
    });
  },

  scheduleDebridPreparation() {
    const token = this.loadToken || 0;
    if (this.debridPreparationScheduled) {
      return;
    }
    this.debridPreparationScheduled = true;
    setTimeout(() => {
      this.debridPreparationScheduled = false;
      if (!this.container || Router.getCurrent() !== "stream" || token !== this.loadToken) {
        return;
      }
      const season = this.params?.season == null ? null : Number(this.params.season);
      const episode = this.params?.episode == null ? null : Number(this.params.episode);
      const playerSettings = PlayerSettingsStore.get();
      const installedAddonNames = new Set(
        (addonRepository.getCachedInstalledAddons() || [])
          .map((addon) => String(addon?.displayName || addon?.name || "").trim())
          .filter(Boolean)
      );
      void DirectDebridStreamPreparer.prepare(this.streams, {
        season,
        episode,
        playerSettings,
        installedAddonNames,
        onPrepared: (original, prepared) => {
          if (!this.container || Router.getCurrent() !== "stream" || token !== this.loadToken) {
            return;
          }
          const originalKey = directDebridPreparationKey(original);
          this.streams = this.streams.map((stream) =>
            directDebridPreparationKey(stream) === originalKey
              ? {
                  ...stream,
                  ...prepared,
                  addonName: stream.addonName,
                  addonLogo: stream.addonLogo,
                  badges: stream.badges
                }
              : stream
          );
          this.requestRender();
        }
      });
    }, 0);
  },

  getBackdropUrl() {
    return this.params?.backdrop || this.params?.landscapePoster || this.params?.poster || "";
  },

  getRouteStateKey(params = {}) {
    const itemType = normalizeType(params?.itemType);
    const itemId = String(params?.itemId || "").trim();
    const videoId = String(params?.videoId || "").trim();
    if (!itemId && !videoId) {
      return null;
    }
    return `stream:${itemType}:${itemId}:${videoId}`;
  },

  navigateBackFromStream({ fallbackToHome = false } = {}) {
    if (this.params?.continueWatchingBackHome) {
      // Continue Watching always returns Home. Detail is only a transient
      // metadata/stream-resolution route for this flow.
      void Router.navigate(
        "home",
        {},
        {
          skipStackPush: true,
          replaceHistory: true,
          isBackNavigation: true
        }
      );
      return true;
    }
    const itemId = String(this.params?.itemId || "").trim();
    if (!itemId) {
      return false;
    }
    const itemType = normalizeType(this.params?.itemType);
    void Router.navigate(
      "detail",
      {
        itemId,
        itemType,
        imdbId: this.params?.imdbId || null,
        tmdbId: this.params?.tmdbId || null,
        traktId: this.params?.traktId || null,
        originalItemId: this.params?.originalItemId || null,
        fallbackTitle: this.params?.itemTitle || this.params?.playerTitle || "Untitled",
        returnToSearchOnBack: Boolean(this.params?.returnToSearchOnBack),
        returnHomeOnBack: Boolean(
          !this.params?.returnToSearchOnBack && (this.params?.returnHomeOnBack || fallbackToHome)
        )
      },
      {
        skipStackPush: true,
        replaceHistory: true,
        isBackNavigation: true
      }
    );
    return true;
  },

  consumeBackRequest(backContext = {}) {
    // A normal Detail -> Stream transition has a durable Detail entry directly
    // behind it. Let Router move through that entry instead of replacing Stream
    // with a synthetic Detail that no longer knows its original parent route.
    if (backContext?.hasValidHistoryTarget) {
      return false;
    }
    if (backContext?.source === "app" && backContext?.hasPreviousBrowserHistoryEntry) {
      return false;
    }
    return this.navigateBackFromStream({
      fallbackToHome: !backContext?.hasPreviousBrowserHistoryEntry
    });
  },

  renderDesktopBackButton() {
    return `
      <button class="stream-desktop-back-button" type="button" data-stream-desktop-back
              aria-label="${escapeHtml(t("common.back", {}, "Back"))}">
        <span class="material-icons" aria-hidden="true">chevron_left</span>
      </button>
    `;
  },

  handleStreamBack() {
    Router.back();
  },

  captureRouteState() {
    const list = this.container?.querySelector(".stream-route-list");
    return {
      params: this.params ? { ...this.params } : {},
      loading: Boolean(this.loading),
      error: String(this.error || ""),
      streams: Array.isArray(this.streams) ? this.streams.map((stream) => ({ ...stream })) : [],
      addonFilter: String(this.addonFilter || "all"),
      focusState: this.focusState ? { ...this.focusState } : { zone: "filter", index: 0 },
      sourceChips: Array.isArray(this.sourceChips)
        ? this.sourceChips.map((chip) => ({ ...chip }))
        : [],
      addonLogoLookup: this.addonLogoLookup ? { ...this.addonLogoLookup } : {},
      listScrollTop: this.getListScrollTop(list)
    };
  },

  async mount(params = {}, navigationContext = {}) {
    this.container = document.getElementById("stream");
    ScreenUtils.show(this.container);
    if (this.hasAutoResolvedChoice(params)) {
      this.autoResolvedPlaybackPending = true;
      this.renderAutoResolvedHandoff(params?.backdrop || "");
    }
    this.params = params || {};
    this.loadToken = (this.loadToken || 0) + 1;
    const token = this.loadToken;
    this.focusState = { zone: "filter", index: 0 };
    this.listScrollTop = 0;
    this.appliedFocusKey = null;
    this.error = "";
    this.loading = true;
    this.streams = [];
    this.sourceChips = [];
    this.addonLogoLookup = {};
    this.addonFilter = "all";
    this.hasRenderedStreamRouteShell = false;
    // Returning here from the player is a back navigation, not a fresh open, so
    // do not auto-resume or auto-play again. Otherwise exiting the player drops
    // back onto the stream list and immediately relaunches, looping forever.
    const returningFromPlayer = Boolean(navigationContext?.isBackNavigation);
    this.autoResumeAttempted = returningFromPlayer;
    const playerSettings = PlayerSettingsStore.get();
    const reusableStream = playerSettings.streamReuseLastLinkEnabled
      ? StreamPreferencesStore.getValid(
          this.params?.itemId,
          this.params?.videoId || this.params?.itemId,
          Number(playerSettings.streamReuseLastLinkCacheHours || 24) * 60 * 60 * 1000
        )
      : null;
    this.autoResumeUiActive = Boolean(
      !navigationContext?.isBackNavigation &&
      this.params?.continueWatchingBackHome &&
      !this.params?.manualSelection &&
      reusableStream?.streamId &&
      (String(this.params?.resumeStreamIdentity || "").trim() ||
        String(this.params?.preferredStreamId || "").trim())
    );
    this.autoPlayAttempted = returningFromPlayer;
    this.cancelAutoPlayCountdown();
    this.cancelAutoPlaySelectionWait();
    const autoPlayWaitSeconds = Math.max(
      0,
      Math.trunc(Number(playerSettings.streamAutoPlayTimeoutSeconds || 0))
    );
    this.autoPlaySelectionReady = autoPlayWaitSeconds === 0;
    if (autoPlayWaitSeconds > 0 && autoPlayWaitSeconds !== 2147483647) {
      this.autoPlaySelectionWaitTimer = setTimeout(() => {
        this.autoPlaySelectionWaitTimer = null;
        this.autoPlaySelectionReady = true;
        this.maybeAutoResumeStream();
        this.maybeAutoPlayStream();
      }, autoPlayWaitSeconds * 1000);
    }
    this.offlineDownloadsSupported = false;
    this.offlineDownloadMetadata = new Map();
    this.offlineLocalCopies = [];
    this.offlineSubtitleByDownload = new Map();
    this.offlineDownloadsUnsubscribe?.();
    this.offlineDownloadsUnsubscribe = null;
    if (isBrowserOfflineDownloadSupported()) {
      void initializeBrowserOfflineDownloadQueue()
        .then((capabilities) => {
          if (token !== this.loadToken || Router.getCurrent() !== "stream") return;
          this.offlineDownloadsSupported = capabilities.supported === true;
          if (this.offlineDownloadsSupported) {
            this.offlineDownloadsUnsubscribe = subscribeToOfflineDownloads(() => {
              void this.refreshOfflineDownloadMetadata();
            });
            void this.refreshOfflineDownloadMetadata();
          }
          this.requestRender();
        })
        .catch(() => {
          // Offline storage is optional. Streaming remains available.
        });
    }
    // Match Android TV: restore the selected source only when returning from
    // playback. A fresh open of the same item must start from the first source
    // instead of inheriting an old list scroll/focus snapshot.
    const restored =
      navigationContext?.isBackNavigation &&
      navigationContext?.restoredState &&
      typeof navigationContext.restoredState === "object"
        ? navigationContext.restoredState
        : null;
    if (restored) {
      this.loading = Boolean(restored.loading);
      this.error = String(restored.error || "");
      this.streams = Array.isArray(restored.streams)
        ? restored.streams.map((stream) => ({ ...stream }))
        : [];
      this.addonFilter = String(restored.addonFilter || "all");
      this.focusState = restored.focusState
        ? { ...restored.focusState }
        : { zone: "filter", index: 0 };
      this.sourceChips = Array.isArray(restored.sourceChips)
        ? restored.sourceChips.map((chip) => ({ ...chip }))
        : [];
      this.addonLogoLookup =
        restored.addonLogoLookup && typeof restored.addonLogoLookup === "object"
          ? normalizeAddonLogoLookup(restored.addonLogoLookup)
          : {};
      this.listScrollTop = Number(restored.listScrollTop || 0);
    }

    const showAddonLogo = StreamBadgeSettingsStore.snapshot().showAddonLogo === true;
    if (restored && this.streams.length && showAddonLogo) {
      this.streams = this.applyAddonLogos(this.streams);
      await preloadAddonLogoImages(this.streams, this.addonLogoLookup);
      if (token !== this.loadToken || Router.getCurrent() !== "stream") {
        return;
      }
    }

    // A restored snapshot already holds the finished list, so settle `loading`
    // before the first paint. Flipping it afterwards used to force a second
    // full render of an identical list - ~170ms on a 180-stream result.
    const restoringFromBack = Boolean(
      restored && navigationContext?.isBackNavigation && this.streams.length
    );
    if (restoringFromBack) {
      this.loading = false;
    }

    this.autoResolvedPlaybackPending = !restoringFromBack && this.hasAutoResolvedChoice();
    if (!this.autoResolvedPlaybackPending) {
      // Not handing off after all: drop any handoff markup painted above so the
      // ordinary render is not mistaken for an unchanged one.
      this.renderedMarkup = null;
    }

    this.render();

    if (restoringFromBack) {
      return;
    }

    if (this.adoptAutoResolvedStreams()) {
      return;
    }
    void this.loadStreams();
  },

  // The detail screen resolved this route in the background, so the picker has
  // nothing left to fetch. With a stream chosen it never paints at all: the
  // list is held back and the screen shows its own loading state until playback
  // takes over, which is the whole point of the setting. With nothing chosen it
  // paints what was found and stays, exactly as it would have after its own
  // fetch.
  //
  // Whether this route was entered with the answer already in hand. Read
  // before the first paint, so the screen knows not to draw itself at all.
  hasAutoResolvedChoice(params = this.params) {
    const prefetched = params?.autoResolvedStreams;
    const chosenId = String(params?.autoResolvedStreamId || "").trim();
    return Boolean(
      chosenId &&
      Array.isArray(prefetched) &&
      prefetched.some((stream) => String(stream?.id || "") === chosenId)
    );
  },

  adoptAutoResolvedStreams() {
    const prefetched = Array.isArray(this.params?.autoResolvedStreams)
      ? this.params.autoResolvedStreams
      : [];
    if (!prefetched.length) {
      return false;
    }
    this.streams = mergeStreamItems([], this.applyAddonLogos(prefetched));
    this.loading = false;
    this.autoPlaySelectionReady = true;
    this.sourceChips = this.buildSourceChipsFromStreams(this.streams);
    void this.refreshOfflineDownloadMetadata();
    this.scheduleDebridPreparation();

    const chosenId = String(this.params?.autoResolvedStreamId || "").trim();
    const chosen = chosenId
      ? this.streams.find((stream) => String(stream?.id || "") === chosenId)
      : null;
    if (!chosen) {
      this.requestRender({ delayMs: 0 });
      return true;
    }

    this.autoPlayAttempted = true;
    this.autoResolvedPlaybackPending = true;
    void Promise.resolve(this.playStream(chosen.id)).finally(() => {
      this.restoreListAfterHandoff();
    });
    return true;
  },

  // Leave for the origin route the moment the other app actually takes over.
  //
  // Leaving when the launch is merely issued means the destination mounts in
  // front of the viewer during the seconds before the app switch -- Detail's
  // loading skeleton most visibly. Waiting for the page to be hidden puts that
  // mounting behind the other app, so it is never seen and the destination is
  // settled by the time the screen comes back.
  //
  // A fixed delay cannot do this: too short still shows the skeleton, too long
  // wastes the background time. Hidden is the event itself rather than a guess
  // at when it happens.
  //
  // Still visible when the grace period ends means nothing took the launch --
  // the player app is missing, or the scheme was refused -- and then the picker
  // is what the person needs.
  leaveForOriginWhenHidden() {
    this.clearExternalHandoffWatch();
    const leave = () => {
      this.clearExternalHandoffWatch();
      this.autoResolvedPlaybackPending = false;
      this.navigateBackFromStream();
    };
    if (document.visibilityState === "hidden") {
      leave();
      return;
    }
    this.externalHandoffVisibilityHandler = () => {
      if (document.visibilityState === "hidden") {
        leave();
      }
    };
    document.addEventListener("visibilitychange", this.externalHandoffVisibilityHandler, false);
    this.externalHandoffTimer = setTimeout(() => {
      this.clearExternalHandoffWatch();
      this.restoreListAfterHandoff();
    }, EXTERNAL_HANDOFF_GRACE_MS);
  },

  clearExternalHandoffWatch() {
    if (this.externalHandoffVisibilityHandler) {
      document.removeEventListener(
        "visibilitychange",
        this.externalHandoffVisibilityHandler,
        false
      );
      this.externalHandoffVisibilityHandler = null;
    }
    if (this.externalHandoffTimer) {
      clearTimeout(this.externalHandoffTimer);
      this.externalHandoffTimer = null;
    }
  },

  // When the list may be shown again after a handoff.
  //
  // The internal player navigates away, so this screen is already gone. An
  // external player does not: it backgrounds the whole app and leaves this
  // route current, so clearing the handoff the moment playStream resolved
  // painted the picker in the instant before the other app came forward --
  // which is the flash this feature exists to remove. The list comes back when
  // this screen is being looked at again, not before.
  restoreListAfterHandoff() {
    // An external launch is being watched for, and that watch owns what happens
    // next. Without this the 900ms branch below would put the picker back while
    // the other app is still coming forward.
    if (this.externalHandoffVisibilityHandler || this.externalHandoffTimer) {
      return;
    }
    const showList = () => {
      this.autoResolvedPlaybackPending = false;
      if (Router.getCurrent() === "stream") {
        this.requestRender({ delayMs: 0 });
        return;
      }
      // Off screen, so there is nothing to repaint -- but the handoff markup is
      // still sitting in this container, and whatever reveals this route next
      // would show "Opening player…" over a route that is opening nothing. It
      // outlived its moment, so it goes.
      this.renderedMarkup = null;
      if (this.container) {
        this.container.innerHTML = "";
      }
    };
    if (Router.getCurrent() !== "stream") {
      showList();
      return;
    }
    const whenVisibleAgain = () => {
      document.addEventListener(
        "visibilitychange",
        function once() {
          if (document.visibilityState !== "visible") return;
          document.removeEventListener("visibilitychange", once);
          showList();
        },
        false
      );
    };
    if (document.visibilityState === "hidden") {
      whenVisibleAgain();
      return;
    }
    // Still here and still on screen a moment later means nothing took over:
    // the launch failed, and the person needs the picker to choose by hand.
    setTimeout(() => {
      if (document.visibilityState === "visible") {
        showList();
      } else {
        whenVisibleAgain();
      }
    }, 900);
  },

  // Source chips normally accumulate as each addon answers. A prefetched list
  // has already been answered, so they are read back off the streams instead.
  buildSourceChipsFromStreams(streams = []) {
    const chips = new Map();
    streams.forEach((stream) => {
      const name = String(stream?.addonName || "").trim();
      if (!name || chips.has(name)) {
        return;
      }
      const orderIndex = Number(stream?.addonOrderIndex);
      chips.set(name, {
        name,
        logo: resolveAddonLogo(name, this.addonLogoLookup),
        status: "success",
        orderIndex: Number.isFinite(orderIndex) ? orderIndex : Number.MAX_SAFE_INTEGER
      });
    });
    return [...chips.values()].sort(
      (left, right) => Number(left.orderIndex) - Number(right.orderIndex)
    );
  },

  async loadStreams() {
    const token = this.loadToken;
    const itemType = normalizeType(this.params?.itemType);
    const videoId = String(this.params?.videoId || this.params?.itemId || "");

    this.loading = true;
    this.error = "";
    this.streams = [];
    this.offlineDownloadMetadata = new Map();
    this.offlineLocalCopies = [];
    this.offlineSubtitleByDownload = new Map();
    this.addonFilter = "all";
    this.addonPickerOpen = false;
    this.focusState = { zone: "filter", index: 0 };
    this.listScrollTop = 0;
    this.appliedFocusKey = null;
    this.addonLogoLookup = {};

    this.sourceChips = [];
    if (!this.hasRenderedStreamRouteShell) {
      this.requestRender();
    }
    const pendingChunkTasks = new Set();
    const badgeSettings = StreamBadgeSettingsStore.snapshot();
    const showAddonLogo = badgeSettings.showAddonLogo === true;

    const upsertSourceChip = (addon, status = "loading") => {
      const name = String(addon?.displayName || addon?.name || "").trim();
      if (!name) {
        return;
      }
      const orderIndex = Number(addon?.orderIndex);
      const nextChip = {
        name,
        logo: normalizeAddonLogoUrl(addon.logo),
        status,
        orderIndex: Number.isFinite(orderIndex) ? orderIndex : Number.MAX_SAFE_INTEGER
      };
      const existingIndex = this.sourceChips.findIndex((chip) => chip.name === name);
      if (existingIndex >= 0) {
        this.sourceChips[existingIndex] = { ...this.sourceChips[existingIndex], ...nextChip };
      } else {
        this.sourceChips.push(nextChip);
      }
      rememberAddonLogoLookup(this.addonLogoLookup, name, addon.logo || nextChip.logo);
      this.sourceChips = this.sourceChips
        .slice()
        .sort((left, right) => Number(left.orderIndex || 0) - Number(right.orderIndex || 0));
    };

    const markSuccessfulSources = (names = []) => {
      if (!Array.isArray(names) || !names.length) {
        return;
      }
      const entries = names
        .map((entry) => {
          if (entry && typeof entry === "object") {
            return {
              name: String(entry.name || entry.addonName || "").trim(),
              logo: normalizeAddonLogoUrl(entry.logo || entry.addonLogo),
              orderIndex: Number(entry.orderIndex ?? entry.addonOrderIndex)
            };
          }
          const name = String(entry || "").trim();
          const existingStream = this.streams.find((stream) => stream.addonName === name);
          return {
            name,
            logo: resolveAddonLogo(name, this.addonLogoLookup),
            orderIndex: Number(existingStream?.addonOrderIndex)
          };
        })
        .filter((entry) => entry.name);
      const successSet = new Set(entries.map((entry) => entry.name));
      const known = new Set(this.sourceChips.map((chip) => chip.name));
      this.sourceChips = this.sourceChips.map((chip) =>
        successSet.has(chip.name) ? { ...chip, status: "success" } : chip
      );
      entries.forEach((entry) => {
        if (!known.has(entry.name)) {
          const orderIndex = Number.isFinite(entry.orderIndex)
            ? entry.orderIndex
            : Number.MAX_SAFE_INTEGER;
          this.sourceChips.push({
            name: entry.name,
            logo: entry.logo || resolveAddonLogo(entry.name, this.addonLogoLookup),
            status: "success",
            orderIndex
          });
        }
      });
      this.sourceChips = this.sourceChips
        .slice()
        .sort(
          (left, right) =>
            Number(left.orderIndex ?? Number.MAX_SAFE_INTEGER) -
            Number(right.orderIndex ?? Number.MAX_SAFE_INTEGER)
        );
    };

    const displayChunkGroups = async (groups = []) => {
      if (token !== this.loadToken) {
        return;
      }
      const chunkStreams = mergeStreamItems(
        [],
        this.applyAddonLogos(flattenStreams({ status: "success", data: groups }))
      );
      if (!chunkStreams.length) {
        return;
      }
      await Promise.all([
        preloadMatchedStreamBadgeImages(chunkStreams, badgeSettings),
        ...(showAddonLogo ? [preloadAddonLogoImages(chunkStreams, this.addonLogoLookup)] : [])
      ]);
      if (token !== this.loadToken) {
        return;
      }
      this.streams = mergeStreamItems(this.streams, chunkStreams);
      void this.refreshOfflineDownloadMetadata();
      this.scheduleDebridPreparation();
      markSuccessfulSources(
        groups.map((group) => ({
          name: group?.addonName || "",
          logo: group?.addonLogo || "",
          orderIndex: group?.addonOrderIndex
        }))
      );
      if (this.streams.length && this.focusState?.zone !== "card") {
        this.focusState = { zone: "card", row: 0, action: "play" };
      }
      this.requestRender({ delayMs: 120 });
      this.maybeAutoResumeStream();
      this.maybeAutoPlayStream();
    };

    const queueChunkGroups = (groups = []) => {
      const task = displayChunkGroups(groups)
        .catch((error) => {
          console.warn("Stream chunk prerender failed", error);
        })
        .finally(() => {
          pendingChunkTasks.delete(task);
        });
      pendingChunkTasks.add(task);
      return task;
    };

    const options = {
      itemId: String(this.params?.itemId || ""),
      season: this.params?.season ?? null,
      episode: this.params?.episode ?? null,
      onAddon: (addon) => {
        if (token !== this.loadToken) {
          return;
        }
        upsertSourceChip(addon, "loading");
        this.requestRender({ delayMs: 120 });
      },
      onChunk: (chunkResult) => {
        if (token !== this.loadToken || chunkResult?.status !== "success") {
          return;
        }
        const groups = Array.isArray(chunkResult.data) ? chunkResult.data : [];
        queueChunkGroups(groups);
      }
    };

    try {
      const streamResult = await streamRepository.getStreamsFromAllAddons(
        itemType,
        videoId,
        options
      );
      if (token !== this.loadToken) {
        return;
      }
      const loadedStreams = mergeStreamItems(
        [],
        this.applyAddonLogos(flattenStreams(streamResult))
      );
      await Promise.allSettled(Array.from(pendingChunkTasks));
      if (token !== this.loadToken) {
        return;
      }
      const existingKeys = new Set(
        this.streams.map((stream) => streamMergeKey(stream)).filter(Boolean)
      );
      const missingStreams = loadedStreams.filter((stream) => {
        const key = streamMergeKey(stream);
        return key && !existingKeys.has(key);
      });
      if (missingStreams.length) {
        await Promise.all([
          preloadMatchedStreamBadgeImages(missingStreams, badgeSettings),
          ...(showAddonLogo ? [preloadAddonLogoImages(missingStreams, this.addonLogoLookup)] : [])
        ]);
        if (token !== this.loadToken) {
          return;
        }
        this.streams = mergeStreamItems(this.streams, missingStreams);
      }
      void this.refreshOfflineDownloadMetadata();
      this.scheduleDebridPreparation();
      markSuccessfulSources(this.streams.map((stream) => stream.addonName));
      if (this.streams.length && showAddonLogo) {
        await preloadAddonLogoImages(this.streams, this.addonLogoLookup);
      }
      this.sourceChips = this.sourceChips.map((chip) =>
        chip.status === "loading" ? { ...chip, status: "error" } : chip
      );
      this.loading = false;
      if (this.streams.length) {
        const visibleStreams = this.getFilteredStreams();
        const maxCardIndex = Math.max(0, visibleStreams.length - 1);
        let initialIndex = clamp(Number(this.focusState?.index || 0), 0, maxCardIndex);
        const preferred = String(this.params?.preferredStreamId || "").trim();
        if (preferred) {
          const prefIdx = visibleStreams.findIndex((s) => String(s?.id || "") === preferred);
          if (prefIdx >= 0) {
            initialIndex = prefIdx;
          }
        }
        const rowIndex = clamp(initialIndex, 0, this.streams.length - 1);
        this.focusState = {
          zone: "card",
          index: clamp(initialIndex, 0, maxCardIndex),
          row: rowIndex,
          action: String(this.focusState?.action || "play")
        };
      } else {
        this.focusState = { zone: "filter", index: 0 };
      }
      this.requestRender();
      this.scheduleErrorChipCleanup();
      this.maybeAutoResumeStream({ allLoaded: true });
      this.maybeAutoPlayStream({ allLoaded: true });
    } catch (error) {
      if (token !== this.loadToken) {
        return;
      }
      this.loading = false;
      this.autoResumeUiActive = false;
      this.error = error?.message || "Failed to load streams.";
      this.sourceChips = this.sourceChips.map((chip) =>
        chip.status === "loading" ? { ...chip, status: "error" } : chip
      );
      this.requestRender();
      this.scheduleErrorChipCleanup();
    }
  },

  // Continue Watching can pass the identity of the stream that was playing.
  // If that same source shows up again, resume it directly.
  maybeAutoResumeStream({ allLoaded = false } = {}) {
    if (this.autoResumeAttempted) {
      return;
    }
    const settings = PlayerSettingsStore.get();
    const reusableStream = settings.streamReuseLastLinkEnabled
      ? StreamPreferencesStore.getValid(
          this.params?.itemId,
          this.params?.videoId || this.params?.itemId,
          Number(settings.streamReuseLastLinkCacheHours || 24) * 60 * 60 * 1000
        )
      : null;
    const progressIdentity = reusableStream
      ? String(this.params?.resumeStreamIdentity || "").trim()
      : "";
    const preferredStreamId = String(reusableStream?.streamId || "").trim();
    const canReuseStoredStream = Boolean(
      this.params?.continueWatchingBackHome && !this.params?.manualSelection && reusableStream
    );
    const cachedIdentity = canReuseStoredStream
      ? String(reusableStream?.resumeIdentity || "").trim()
      : "";
    const canReusePreferredStream = Boolean(canReuseStoredStream && preferredStreamId);
    if (!progressIdentity && !cachedIdentity && !canReusePreferredStream) {
      this.autoResumeUiActive = false;
      return;
    }
    if (!this.streams.length) {
      if (!this.loading) {
        this.autoResumeAttempted = true;
        this.autoResumeUiActive = false;
        this.requestRender({ delayMs: 0 });
      }
      return;
    }
    const identityMatch =
      this.streams.find((stream) => {
        const stableIdentity = buildStreamResumeIdentity(stream);
        return Boolean(
          (cachedIdentity && stableIdentity === cachedIdentity) ||
          (progressIdentity &&
            (stableIdentity === progressIdentity || streamMergeKey(stream) === progressIdentity))
        );
      }) || null;
    // Stream preferences are stored per profile and per video. They are the
    // Web equivalent of Android's local stream-link cache and remain available
    // even when the selected progress source cannot carry stream metadata.
    const match =
      identityMatch ||
      (canReusePreferredStream
        ? this.streams.find((stream) => String(stream?.id || "") === preferredStreamId)
        : null);
    if (match?.id) {
      this.autoResumeAttempted = true;
      void this.playStream(match.id);
      return;
    }
    if (!allLoaded && this.loading) {
      return;
    }
    // The remembered source is no longer available. Fall back to the normal
    // source panel instead of leaving the direct-resume loading state visible.
    this.autoResumeAttempted = true;
    this.autoResumeUiActive = false;
    this.requestRender({ delayMs: 0 });
  },

  maybeAutoPlayStream({ allLoaded = false } = {}) {
    if (this.autoResumeUiActive || this.autoPlayAttempted || this.autoPlayCountdown) {
      return;
    }
    // Resume already navigated away, or there is nothing to play.
    if (Router.getCurrent() !== "stream" || !this.streams.length) {
      return;
    }
    const settings = PlayerSettingsStore.get();
    if (this.params?.manualSelection) {
      return;
    }
    if (!allLoaded && !this.autoPlaySelectionReady) {
      return;
    }
    // "Manual (choose stream)" is authoritative for a fresh stream screen.
    // Persisted binge groups may still guide an enabled auto-play mode and the
    // next-episode player flow, but must not turn Continue Watching or Details
    // into an implicit auto-play entry point.
    const autoPlayMode = String(settings.streamAutoPlayMode || "MANUAL").toUpperCase();
    if (autoPlayMode === "MANUAL" || !isAutoPlayEffectivelyEnabled(settings)) {
      return;
    }
    const preferredBingeGroup = resolvePreferredBingeGroup(settings, () =>
      StreamPreferencesStore.getEntry(
        this.params?.itemId,
        this.params?.videoId || this.params?.itemId
      )
    );
    const installedAddonNames = collectInstalledAddonNames(
      addonRepository.getCachedInstalledAddons()
    );
    const selected = selectAutoPlayStream(this.getFilteredStreams(), {
      mode: settings.streamAutoPlayMode,
      source: settings.streamAutoPlaySource,
      regexPattern: settings.streamAutoPlayRegex,
      installedAddonNames,
      selectedAddons: settings.streamAutoPlaySelectedAddons,
      selectedPlugins: settings.streamAutoPlaySelectedPlugins,
      preferredBingeGroup,
      preferBingeGroupInSelection: Boolean(preferredBingeGroup)
    });
    if (!selected?.id) {
      if (allLoaded) {
        this.autoPlayAttempted = true;
      }
      return;
    }
    this.autoPlayAttempted = true;
    this.cancelAutoPlaySelectionWait();
    void this.playStream(selected.id);
  },

  cancelAutoPlaySelectionWait() {
    if (this.autoPlaySelectionWaitTimer) {
      clearTimeout(this.autoPlaySelectionWaitTimer);
      this.autoPlaySelectionWaitTimer = null;
    }
  },

  startAutoPlayCountdown(stream, seconds) {
    this.cancelAutoPlayCountdown();
    // Focus the chosen stream so cancelling leaves the user on it.
    const visible = this.getFilteredStreams();
    const idx = visible.findIndex((entry) => String(entry?.id || "") === String(stream.id || ""));
    if (idx >= 0) {
      this.focusState = { zone: "card", index: idx, row: idx, action: "play" };
    }
    const total = Math.max(0, Math.trunc(Number(seconds) || 0));
    if (total <= 0) {
      void this.playStream(stream.id);
      return;
    }
    this.autoPlayCountdown = {
      streamId: stream.id,
      label: getStreamHeadline(stream) || stream.addonName || "stream",
      secondsLeft: total
    };
    this.requestRender({ delayMs: 0 });
    this.autoPlayTimer = setInterval(() => {
      if (!this.autoPlayCountdown) {
        return;
      }
      this.autoPlayCountdown.secondsLeft -= 1;
      if (this.autoPlayCountdown.secondsLeft <= 0) {
        const targetId = this.autoPlayCountdown.streamId;
        this.cancelAutoPlayCountdown();
        void this.playStream(targetId);
        return;
      }
      this.requestRender({ delayMs: 0 });
    }, 1000);
  },

  cancelAutoPlayCountdown() {
    if (this.autoPlayTimer) {
      clearInterval(this.autoPlayTimer);
      this.autoPlayTimer = null;
    }
    if (this.autoPlayCountdown) {
      this.autoPlayCountdown = null;
      this.requestRender({ delayMs: 0 });
    }
  },

  renderAutoPlayOverlay() {
    if (!this.autoPlayCountdown) {
      return "";
    }
    const { label, secondsLeft } = this.autoPlayCountdown;
    return `
      <div class="stream-route-autoplay">
        <div class="stream-route-autoplay-card">
          <div class="stream-route-autoplay-title">${escapeHtml(t("stream_autoplay_title", {}, "Auto-playing"))}</div>
          <div class="stream-route-autoplay-name">${escapeHtml(label)}</div>
          <div class="stream-route-autoplay-count">${escapeHtml(t("stream_autoplay_countdown", [secondsLeft], `Starting in ${secondsLeft}s`))}</div>
          <div class="stream-route-autoplay-hint">${escapeHtml(t("stream_autoplay_hint", {}, "Press OK to play now, or any key to choose manually"))}</div>
        </div>
      </div>`;
  },

  renderContinueWatchingResumeOverlay() {
    if (!this.autoResumeUiActive) {
      return "";
    }
    const title = String(
      this.params?.episodeTitle || this.params?.itemTitle || this.params?.playerTitle || ""
    ).trim();
    return `
      <div class="stream-route-autoplay">
        <div class="stream-route-autoplay-card">
          <div class="stream-route-autoplay-title">${escapeHtml(
            t("stream_finding_source", {}, "Finding stream source")
          )}</div>
          ${title ? `<div class="stream-route-autoplay-name">${escapeHtml(title)}</div>` : ""}
        </div>
      </div>`;
  },

  scheduleErrorChipCleanup() {
    if (this.errorChipTimer) {
      clearTimeout(this.errorChipTimer);
      this.errorChipTimer = null;
    }
    if (!this.sourceChips.some((chip) => chip.status === "error")) {
      return;
    }
    this.errorChipTimer = setTimeout(() => {
      this.sourceChips = this.sourceChips.filter((chip) => chip.status !== "error");
      this.requestRender();
    }, 1600);
  },

  getOrderedFilterNames() {
    return getOrderedFilterNames(this.sourceChips, this.streams);
  },

  getFilteredStreams(filter = this.addonFilter) {
    // Cache the sorted/filtered result so focus navigation (which re-requests
    // this on every move via badge hydration) does not re-sort and re-parse
    // the whole source list each keypress. The cache is keyed on the inputs
    // that affect the result and is cleared in render() when data changes.
    const cache = this._filteredStreamsCache;
    if (
      cache &&
      cache.streams === this.streams &&
      cache.chips === this.sourceChips &&
      cache.filter === filter
    ) {
      return cache.result;
    }
    const orderedStreams = sortStreamsByAddonOrder(this.streams, this.sourceChips);
    const result =
      filter === "all"
        ? orderedStreams
        : orderedStreams.filter((stream) => stream.addonName === filter);
    this._filteredStreamsCache = {
      streams: this.streams,
      chips: this.sourceChips,
      filter,
      result
    };
    return result;
  },

  hasPendingSourceLoads(filter = this.addonFilter) {
    if (!Array.isArray(this.sourceChips) || !this.sourceChips.length) {
      return Boolean(this.loading);
    }
    if (filter === "all") {
      return this.sourceChips.some((chip) => chip.status === "loading");
    }
    return this.sourceChips.some((chip) => chip.name === filter && chip.status === "loading");
  },

  setAddonFilter(nextFilter, preferredZone = "filter", preferredIndex = 0) {
    const targetFilter = String(nextFilter || "all");
    this.addonFilter = targetFilter;
    const filtered = this.getFilteredStreams(targetFilter);
    if (preferredZone === "card" && filtered.length) {
      this.focusState = {
        zone: "card",
        row: clamp(preferredIndex, 0, filtered.length - 1),
        action: "play"
      };
    } else {
      const ordered = ["all", ...this.getOrderedFilterNames()];
      this.focusState = {
        zone: "filter",
        index: clamp(ordered.indexOf(targetFilter), 0, Math.max(0, ordered.length - 1))
      };
    }
    this.listScrollTop = 0;
    this.appliedFocusKey = null;
    this.render();
  },

  resolveCardActionForRow(row = null, preferredAction = "play") {
    if (!row) {
      return null;
    }
    if (preferredAction === "native" && row.native) {
      return row.native;
    }
    return row.play || row.native || null;
  },

  getCardRows() {
    return Array.from(
      this.container?.querySelectorAll(".stream-route-card-row[data-stream-row]") || []
    )
      .map((rowNode) => ({
        row: Number(rowNode.dataset.streamRow || 0),
        play: rowNode.querySelector('[data-card-action="play"]'),
        native: rowNode.querySelector('[data-card-action="native"]')
      }))
      .filter((row) => row.play || row.native);
  },

  isCardActionFocused(rowIndex, action) {
    return (
      this.focusState?.zone === "card" &&
      Number(this.focusState?.row || 0) === Number(rowIndex) &&
      String(this.focusState?.action || "play") === String(action || "play")
    );
  },

  // `revealInList` is what separates a person moving the focus from a render
  // re-asserting the focus that was already there. Only the first is a reason
  // to move the list.
  focusElement(target, { revealInList = true } = {}) {
    if (!target) {
      return false;
    }
    // Long source lists used to scan every focusable node on every D-pad
    // press just to clear one class. Keep the active node instead: focus
    // movement now updates only the previous and next cards, matching the
    // bounded work Android gets from LazyColumn focus navigation.
    const previous =
      this.focusedElement && this.container?.contains(this.focusedElement)
        ? this.focusedElement
        : this.container?.querySelector(".focusable.focused");
    if (previous && previous !== target) {
      previous.classList.remove("focused");
    }
    target.classList.add("focused");
    this.focusedElement = target;
    try {
      target.focus({ preventScroll: true });
    } catch (_) {
      target.focus();
    }

    const chipTrack = target.closest(".stream-route-chip-track");
    if (chipTrack) {
      const left = target.offsetLeft;
      const right = left + target.offsetWidth;
      const viewLeft = chipTrack.scrollLeft;
      const viewRight = viewLeft + chipTrack.clientWidth;
      const pad = 24;
      if (right > viewRight - pad) {
        chipTrack.scrollLeft = Math.max(0, right - chipTrack.clientWidth + pad);
      } else if (left < viewLeft + pad) {
        chipTrack.scrollLeft = Math.max(0, left - pad);
      }
    }

    const listNode = target.closest(".stream-route-list");
    if (listNode && revealInList) {
      this.ensureListItemVisible(listNode, target);
      this.listScrollTop = this.getListScrollTop(listNode);
      this.scheduleFocusedListItemVisibilityCheck(listNode, target);
    }
    return true;
  },

  focusList(list, index) {
    if (!Array.isArray(list) || !list.length) {
      return false;
    }
    const targetIndex = clamp(index, 0, list.length - 1);
    const target = list[targetIndex];
    if (!target) {
      return false;
    }
    return this.focusElement(target);
  },

  getListScrollTop(listNode) {
    if (!listNode) {
      return 0;
    }
    return Number(listNode.scrollTop || 0);
  },

  setListScrollTop(listNode, nextScrollTop) {
    if (!listNode) {
      return;
    }
    const maxScrollTop = Math.max(
      0,
      Number(listNode.scrollHeight || 0) - Number(listNode.clientHeight || 0)
    );
    const normalized = clamp(Number(nextScrollTop || 0), 0, maxScrollTop);
    listNode.scrollTop = normalized;
    if (typeof listNode.scrollTo === "function") {
      try {
        listNode.scrollTo(0, normalized);
      } catch (_) {
        listNode.scrollTop = normalized;
      }
    }
    this.listScrollTop = Number(listNode.scrollTop || normalized || 0);
  },

  ensureListItemVisible(listNode, target) {
    if (!listNode || !target) {
      return;
    }
    const viewTop = this.getListScrollTop(listNode);
    let itemTop = Number(target.offsetTop || 0);
    let itemBottom = itemTop + Number(target.offsetHeight || 0);
    if (
      typeof listNode.getBoundingClientRect === "function" &&
      typeof target.getBoundingClientRect === "function"
    ) {
      const listRect = listNode.getBoundingClientRect();
      const targetRect = target.getBoundingClientRect();
      if (
        listRect &&
        targetRect &&
        Number.isFinite(targetRect.top) &&
        Number.isFinite(listRect.top)
      ) {
        itemTop = viewTop + (targetRect.top - listRect.top);
        itemBottom = viewTop + (targetRect.bottom - listRect.top);
      }
    }
    const viewHeight = Number(listNode.clientHeight || 0);
    if (!viewHeight) {
      return;
    }
    const viewBottom = viewTop + viewHeight;
    const pad = 16;
    if (itemBottom > viewBottom - pad) {
      this.setListScrollTop(listNode, itemBottom - viewHeight + pad);
    } else if (itemTop < viewTop + pad) {
      this.setListScrollTop(listNode, itemTop - pad);
    }
  },

  scheduleFocusedListItemVisibilityCheck(listNode, target) {
    if (!listNode || !target) {
      return;
    }
    const run = () => {
      const root = document.documentElement || document.body;
      if (!this.container || !root?.contains?.(listNode) || !root?.contains?.(target)) {
        return;
      }
      this.ensureListItemVisible(listNode, target);
    };
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(run);
      return;
    }
    setTimeout(run, 0);
  },

  getFocusLists() {
    const listNode = this.container?.querySelector(".stream-route-list") || null;
    if (this.streamFocusDomCache?.listNode === listNode) {
      return this.streamFocusDomCache.value;
    }
    const chips = Array.from(this.container.querySelectorAll(".stream-route-chip.focusable"));
    const rows = this.getCardRows();
    const value = { chips, rows };
    this.streamFocusDomCache = { listNode, value };
    return value;
  },

  applyFocus() {
    const { chips, rows } = this.getFocusLists();
    if (!chips.length && !rows.length) {
      return;
    }
    const zone = this.focusState?.zone || (rows.length ? "card" : "filter");
    const index = Number(this.focusState?.index || 0);
    if (zone === "card" && rows.length) {
      const rowIndex = clamp(Number(this.focusState?.row || 0), 0, rows.length - 1);
      const preferredAction = String(this.focusState?.action || "play");
      const target = this.resolveCardActionForRow(rows[rowIndex], preferredAction);
      const resolvedAction = target?.dataset?.cardAction || "play";
      this.focusState = { zone: "card", row: rowIndex, action: resolvedAction };
      // Every render ends here, including the ones a download.s progress sets
      // off a few times a second. Scrolling the focused card back into view on
      // each of those drags the list out from under whoever is reading it, and
      // scrolling back only buys them until the next byte arrives. The reveal
      // belongs to the focus moving, so it happens when the focus moves.
      const focusKey = streamFocusRevealKey(this.focusState);
      const revealInList = shouldRevealFocusedStreamItem(this.appliedFocusKey, focusKey);
      this.appliedFocusKey = focusKey;
      this.focusElement(target, { revealInList });
      return;
    }
    this.focusState = { zone: "filter", index: clamp(index, 0, Math.max(0, chips.length - 1)) };
    this.appliedFocusKey = streamFocusRevealKey(this.focusState);
    this.focusList(chips, this.focusState.index);
  },

  restoreScrollPosition() {
    const list = this.container?.querySelector(".stream-route-list");
    if (!list) {
      return;
    }
    this.setListScrollTop(list, Number(this.listScrollTop || 0));
  },

  getHeaderMeta() {
    const isSeries = normalizeType(this.params?.itemType) === "series";
    const title = String(this.params?.itemTitle || this.params?.playerTitle || "Untitled");
    const subtitle = isSeries
      ? String(this.params?.episodeTitle || this.params?.playerSubtitle || "").trim()
      : String(this.params?.itemSubtitle || "").trim();
    const episodeLabel = normalizeEpisodeCode(this.params?.season, this.params?.episode);
    const detailLine = isSeries
      ? ""
      : [String(this.params?.genres || "").trim(), String(this.params?.year || "").trim()]
          .filter(Boolean)
          .join(" • ");
    return { isSeries, title, subtitle, episodeLabel, detailLine };
  },

  showStreamToast(message) {
    if (!this.container) {
      return;
    }
    const shell = this.container.querySelector(".stream-route-shell");
    if (!shell) {
      return;
    }
    let toast = shell.querySelector(".stream-route-toast");
    if (!toast) {
      toast = document.createElement("div");
      toast.className = "stream-route-toast";
      shell.appendChild(toast);
    }
    toast.textContent = String(message || "").trim();
    toast.classList.add("visible");
    if (this.streamToastTimer) {
      clearTimeout(this.streamToastTimer);
    }
    this.streamToastTimer = setTimeout(() => {
      toast?.classList.remove("visible");
    }, 2600);
  },

  getStreamRequestHeaders(stream = {}) {
    const raw = stream?.raw || stream || {};
    const requestHeaders =
      raw?.behaviorHints?.proxyHeaders?.request || stream?.behaviorHints?.proxyHeaders?.request;
    return requestHeaders && typeof requestHeaders === "object" ? { ...requestHeaders } : {};
  },

  resolveStreamMimeType(stream = {}, fallbackUrl = "") {
    const raw = stream?.raw || stream || {};
    const candidates = [
      stream?.mimeType,
      raw?.mimeType,
      stream?.sourceType,
      raw?.sourceType,
      raw?.type,
      raw?.source
    ]
      .map((value) => String(value || "").trim())
      .filter(Boolean);
    const explicit = candidates.find((value) => value.includes("/"));
    if (explicit) {
      return explicit;
    }
    const alias = String(candidates[0] || "").toLowerCase();
    const aliasMap = {
      dash: "application/dash+xml",
      hls: "application/vnd.apple.mpegurl",
      m3u8: "application/vnd.apple.mpegurl",
      m4v: "video/mp4",
      mkv: "video/x-matroska",
      mov: "video/quicktime",
      mp4: "video/mp4",
      mpd: "application/dash+xml",
      ts: "video/mp2t",
      webm: "video/webm"
    };
    return aliasMap[alias] || guessMimeTypeFromUrl(fallbackUrl) || "video/mp4";
  },

  getAddonFilterLabel(name) {
    return String(name) === "all" ? t("common.all", {}, "All") : String(name);
  },

  getAddonFilterOptions() {
    return ["all", ...this.getOrderedFilterNames()].map((name) => ({
      value: name,
      label: this.getAddonFilterLabel(name)
    }));
  },

  // One addon per chip put a scrolling rail above the sources, and the sources
  // are what the screen is for. It becomes a dropdown -- the app's own menu,
  // the one Library and Discover already use, rather than a native select whose
  // panel is drawn by the operating system and cannot be styled to match
  // anything around it.
  renderAddonFilterPicker() {
    const options = this.getAddonFilterOptions();
    const selectedIndex = Math.max(
      0,
      options.findIndex((option) => option.value === this.addonFilter)
    );
    return renderContentFilterPicker({
      picker: "addon",
      title: t("stream_filter_source", {}, "Source"),
      value: this.getAddonFilterLabel(this.addonFilter),
      options,
      open: Boolean(this.addonPickerOpen),
      focusIndex: selectedIndex,
      selectedIndex,
      widthClass: "library-picker-flex",
      anchorAction: "toggleAddonPicker",
      optionAction: "selectAddonOption"
    });
  },
  renderStreamRefreshAction() {
    const label = t("stream_refresh_sources", {}, "Refresh sources");
    return `
      <button type="button" class="stream-route-refresh focusable" data-action="refreshStreams"
              aria-label="${escapeHtml(label)}" title="${escapeHtml(label)}">
        <span class="material-icons" aria-hidden="true">refresh</span>
      </button>
    `;
  },

  renderChip(name, selected, status) {
    const chipStatus = String(status || "success");
    const classes = [
      "stream-route-chip",
      "focusable",
      selected ? "selected" : "",
      chipStatus !== "success" ? chipStatus : ""
    ]
      .filter(Boolean)
      .join(" ");
    const spinner =
      chipStatus === "loading"
        ? renderLoadingIndicator({ className: "stream-route-chip-spinner" })
        : "";
    return `
      <button class="${classes}" data-action="setFilter" data-addon="${escapeHtml(name)}">
        ${spinner}
        <span>${escapeHtml(name === "all" ? t("common.all", {}, "All") : name)}</span>
      </button>
    `;
  },

  getOfflineDownloadContext(stream = {}) {
    const itemType = normalizeType(this.params?.itemType);
    const isEpisode = itemType === "series" || itemType === "tv";
    return {
      contentType: isEpisode ? "episode" : "movie",
      itemType,
      itemId: this.params?.itemId || this.params?.tmdbId || this.params?.imdbId || "",
      mediaId: this.params?.itemId || this.params?.tmdbId || this.params?.imdbId || "",
      tmdbId: this.params?.tmdbId || this.params?.tmdb_id || "",
      imdbId: this.params?.imdbId || "",
      seriesId: isEpisode
        ? this.params?.itemId || this.params?.tmdbId || this.params?.imdbId || ""
        : "",
      seriesTitle: isEpisode ? this.params?.itemTitle || this.params?.playerTitle || "" : "",
      season: this.params?.season,
      episode: this.params?.episode,
      videoId: this.params?.videoId || "",
      title: isEpisode
        ? this.params?.episodeTitle || this.params?.itemTitle || this.params?.playerTitle || ""
        : this.params?.itemTitle || this.params?.playerTitle || "",
      year: this.params?.year || this.params?.releaseYear || this.params?.releaseInfo || "",
      poster: this.params?.poster || this.params?.posterUrl || "",
      backdrop: this.getBackdropUrl() || "",
      description: this.params?.description || this.params?.overview || "",
      genres: this.params?.genres || [],
      runtimeMinutes: this.params?.runtime || this.params?.runtimeMinutes || 0,
      episodeOverview: isEpisode ? this.params?.episodeOverview || "" : "",
      episodeRuntimeMinutes: isEpisode
        ? this.params?.runtime || this.params?.runtimeMinutes || 0
        : 0,
      sourceName: stream.addonName || "",
      filename: stream.behaviorHints?.filename || stream.raw?.behaviorHints?.filename || "",
      mimeType: this.resolveStreamMimeType(stream),
      stream
    };
  },

  getOfflineDownloadId(stream = {}) {
    return createOfflineDownloadId(this.getOfflineDownloadContext(stream));
  },

  async refreshOfflineDownloadMetadata() {
    if (!this.offlineDownloadsSupported || !Array.isArray(this.streams)) return;
    const allDownloads = await listOfflineDownloads();
    const queued = allDownloads
      .filter((download) => download?.status === "queued")
      .sort(
        (left, right) =>
          Number(left.queueSequence || Number.MAX_SAFE_INTEGER) -
            Number(right.queueSequence || Number.MAX_SAFE_INTEGER) ||
          Number(left.queuedAt || 0) - Number(right.queuedAt || 0)
      );
    this.offlineQueuePositions = new Map(
      queued.map((download, index) => [String(download.downloadId || ""), index + 1])
    );
    this.hasActiveOfflineDownload = allDownloads.some(
      (download) => download?.status === "downloading"
    );
    const entries = await Promise.all(
      this.streams.map(async (stream) => {
        const downloadId = this.getOfflineDownloadId(stream);
        return [downloadId, downloadId ? await getOfflineDownload(downloadId) : null];
      })
    );
    this.offlineDownloadMetadata = new Map(entries.filter(([downloadId]) => Boolean(downloadId)));
    this.offlineLocalCopies = await listOfflineDownloadsForMedia(this.getOfflineDownloadContext());
    // offlineSubtitleStatus only says whether the subtitle step finished. Which
    // subtitles landed, and their ids, lives in the subtitle store -- and the id
    // is what a hand-over needs.
    const subtitles = await listOfflineSubtitles(this.getOfflineDownloadContext()).catch(() => []);
    // Keyed to a single id this collapsed every extra language into whichever
    // record happened to come last, so a download with three subtitles could
    // only ever hand over one of them.
    this.offlineSubtitleByDownload = subtitles
      .filter((subtitle) => subtitle?.offlineCopyId && subtitle?.subtitleId)
      .reduce((byDownload, subtitle) => {
        const key = String(subtitle.offlineCopyId);
        byDownload.set(key, [...(byDownload.get(key) || []), subtitle]);
        return byDownload;
      }, new Map());
    if (this.applyOfflineDownloadProgressPatch()) {
      return;
    }
    this.requestRender();
  },

  // The panel header says what is going on inside it without anybody having to
  // scroll the list to find out. It counts the same metadata the cards read, so
  // the header cannot disagree with the rows underneath it, and it says nothing
  // at all when there is nothing to report rather than printing three zeroes.
  renderStreamPanelSummary() {
    if (!Environment.isBrowser() || !this.offlineDownloadsSupported) return "";
    const summary = summariseOfflineDownloads(
      this.offlineDownloadMetadata ? [...this.offlineDownloadMetadata.values()] : []
    );
    if (!summary) return "";
    return `<span class="stream-route-panel-summary">${escapeHtml(summary)}</span>`;
  },

  // What a download is doing reads as a sentence on its own line, the way the
  // card's other facts do, and the controls for it sit on the card's last row
  // beside the source. Before this the state was a bare "19%" wedged in among
  // the buttons, which said what was happening only if you already knew.
  renderOfflineDownloadStatus(tone, icon, text) {
    return `<div class="stream-route-card-status ${escapeHtml(tone)}"><span class="stream-route-card-status-icon" aria-hidden="true">${escapeHtml(icon)}</span><span class="stream-route-card-status-text">${escapeHtml(text)}</span></div>`;
  },

  // What a download's own line says, in one place, because both the renderer
  // and the in-place patch below have to agree on it to the character.
  describeOfflineDownload(download = null, downloadId = "") {
    const status = String(download?.status || "idle");
    if (status === "downloading") {
      const total = Number(download?.totalBytes || 0);
      const current = Number(download?.downloadedBytes || 0);
      const percent = total > 0 ? Math.min(100, Math.round((current / total) * 100)) : null;
      const detail =
        total > 0
          ? `${formatBytes(current)} of ${formatBytes(total)}`
          : formatBytes(current) || "starting";
      return { status, tone: "downloading", icon: "↓", text: `Downloading · ${detail}`, percent };
    }
    if (status === "queued") {
      const position = this.offlineQueuePositions?.get(downloadId);
      return {
        status,
        tone: "queued",
        icon: "⌛",
        text: position
          ? `Queued #${position} · starts after the current download`
          : "Queued · starts after the current download",
        percent: null
      };
    }
    if (status === "completed") {
      return {
        status,
        tone: "offline",
        icon: "⬇",
        text: "Downloaded · available offline",
        percent: null
      };
    }
    if (["paused", "interrupted", "failed"].includes(status)) {
      return {
        status,
        tone: "paused",
        icon: status === "failed" ? "!" : "⏸",
        text:
          status === "paused"
            ? "Paused"
            : status === "interrupted"
              ? "Interrupted · resume to continue"
              : "Download failed · retry to start again",
        percent: null
      };
    }
    return { status, tone: "", icon: "", text: "", percent: null };
  },

  // A download reports progress several times a second, and the only thing that
  // moves with it is a line of text and a dial. Rebuilding the screen for that
  // threw the list away and built it again, which showed as a flicker and took
  // the reader's scroll position with it -- the node their finger was on no
  // longer existed.
  //
  // So progress patches what moved. A full render is still the answer whenever
  // the shape of the page changes, and a status changing is exactly that: a
  // different status means different buttons. The statuses the last render drew
  // are kept for that comparison, since the DOM alone cannot say which of them
  // a card was built from.
  applyOfflineDownloadProgressPatch() {
    if (!this.container || !this.offlineDownloadsSupported) return false;
    if (!(this.renderedDownloadStatuses instanceof Map)) return false;
    const list = this.container.querySelector(".stream-route-list");
    if (!list) return false;

    const next = this.collectOfflineDownloadStatuses();
    if (next.size !== this.renderedDownloadStatuses.size) return false;
    for (const [downloadId, status] of next) {
      if (this.renderedDownloadStatuses.get(downloadId) !== status) return false;
    }
    // An offline copy appearing or going is a row of its own, not a text change.
    if ((this.offlineLocalCopies || []).length !== Number(this.renderedOfflineCopyCount || 0)) {
      return false;
    }

    (Array.isArray(this.streams) ? this.streams : []).forEach((stream) => {
      const downloadId = this.getOfflineDownloadId(stream);
      if (!downloadId) return;
      const download = this.offlineDownloadMetadata?.get(downloadId) || null;
      const described = this.describeOfflineDownload(download, downloadId);
      if (!described.text) return;
      const card = this.findStreamCardNode(stream.id);
      if (!card) return;
      const text = card.querySelector(".stream-route-card-status-text");
      if (text && text.textContent !== described.text) {
        text.textContent = described.text;
      }
      const ring = card.querySelector(".stream-route-offline-ring");
      if (ring && described.percent !== null) {
        const percent = String(described.percent);
        if (ring.textContent !== `${percent}%`) {
          ring.textContent = `${percent}%`;
          ring.style.setProperty("--offline-progress", percent);
          ring.setAttribute("aria-label", `${percent}% downloaded`);
        }
      }
    });

    const summary = this.container.querySelector(".stream-route-panel-summary");
    const summaryText = summariseOfflineDownloads(
      this.offlineDownloadMetadata ? [...this.offlineDownloadMetadata.values()] : []
    );
    // The header gaining or losing its line changes the header's own shape, so
    // that one goes back through a render rather than being patched in.
    if (Boolean(summary) !== Boolean(summaryText)) return false;
    if (summary && summary.textContent !== summaryText) summary.textContent = summaryText;
    return true;
  },

  collectOfflineDownloadStatuses() {
    const statuses = new Map();
    (Array.isArray(this.streams) ? this.streams : []).forEach((stream) => {
      const downloadId = this.getOfflineDownloadId(stream);
      if (!downloadId) return;
      statuses.set(
        downloadId,
        String(this.offlineDownloadMetadata?.get(downloadId)?.status || "idle")
      );
    });
    return statuses;
  },

  findStreamCardNode(streamId = "") {
    const id = String(streamId || "");
    if (!id || !this.container) return null;
    // Stream ids carry addon URLs, so they are not safe to drop into a selector.
    return (
      Array.from(this.container.querySelectorAll("[data-card-action='play'][data-stream-id]")).find(
        (node) => node.dataset.streamId === id
      ) || null
    );
  },
  renderOfflineDownloadActions(stream = {}) {
    if (!Environment.isBrowser() || !this.offlineDownloadsSupported) return "";
    const context = this.getOfflineDownloadContext(stream);
    const downloadId = createOfflineDownloadId(context);
    if (!downloadId) return "";
    const download = this.offlineDownloadMetadata?.get(downloadId) || null;
    const status = String(download?.status || "idle");
    const button = (action, icon, label, className = "") =>
      this.renderOfflineButton(action, icon, label, stream.id, className);
    const statusLine = (tone, icon, text) => this.renderOfflineDownloadStatus(tone, icon, text);
    const described = this.describeOfflineDownload(download, downloadId);
    const line = described.text ? statusLine(described.tone, described.icon, described.text) : "";
    if (status === "downloading") {
      // The ring carries the percentage so the line beside it can spend its
      // room on the figures a person actually checks: how much has landed.
      const ring =
        described.percent === null
          ? ""
          : `<span class="stream-route-offline-ring" style="--offline-progress:${described.percent}" role="img" aria-label="${described.percent}% downloaded" aria-live="polite">${described.percent}%</span>`;
      return `${line}<div class="stream-route-offline-actions">${ring}${button("pause", "Ⅱ", "Pause", "secondary")}${button("cancel", "×", "Cancel", "secondary")}</div>`;
    }
    if (status === "queued") {
      return `${line}<div class="stream-route-offline-actions">${button("cancel", "×", "Cancel", "secondary")}</div>`;
    }
    if (status === "completed") {
      return `${line}<div class="stream-route-offline-actions">${button("playOffline", "▶", "Play Offline")}${this.renderOfflineSubtitleButton(downloadId, stream.id)}${button("deleteOffline", "⌫", "Delete Offline", "secondary")}</div>`;
    }
    if (["paused", "interrupted", "failed"].includes(status)) {
      return `${line}<div class="stream-route-offline-actions">${button("resume", "▶", status === "failed" ? "Retry" : "Resume", "download")}${button("cancel", "×", "Delete", "secondary")}</div>`;
    }
    if (!canQueueBrowserOfflineDownload(context)) return "";
    return `<div class="stream-route-offline-actions">${button("download", status === "failed" ? "↻" : "↓", status === "failed" ? "Retry Download" : "Download", "download")}</div>`;
  },

  renderOfflineCopyRow(download = {}) {
    const isMatched = this.streams.some(
      (stream) => this.getOfflineDownloadId(stream) === String(download.downloadId || "")
    );
    if (isMatched) return "";
    const quality = String(download.quality || download.filename || "Offline media");
    const size = formatBytes(download.downloadedBytes || download.totalBytes) || "";
    return `<div class="stream-route-card-row stream-route-offline-copy"><article class="stream-route-card stream-route-offline-card"><div class="stream-route-card-copy"><div class="stream-route-card-heading">OFFLINE COPY</div><div class="stream-route-card-quality">${escapeHtml([quality, size].filter(Boolean).join(" • "))}</div><div class="stream-route-card-line secondary">${escapeHtml(download.sourceName || "Downloaded")}</div></div><div class="stream-route-offline-actions">${this.renderOfflineButton("playOfflineCopy", "▶", "Play Offline", download.downloadId)}${this.renderOfflineSubtitleButton(download.downloadId, download.downloadId)}${this.renderOfflineButton("deleteOfflineCopy", "⌫", "Delete Offline", download.downloadId, "secondary")}</div></article></div>`;
  },

  renderOfflineSubtitleButton(downloadId, streamId) {
    // The player fetches its own subtitles online, but a downloaded film is
    // watched offline -- where the only subtitle available is the one on disk.
    const subtitles = this.offlineSubtitleByDownload?.get(String(downloadId || "")) || [];
    if (!canOfferOfflineSubtitleHandoff(subtitles)) return "";
    return this.renderOfflineButton(
      "sendOfflineSubtitle",
      "CC",
      "Send Subtitle To Another App",
      streamId,
      "secondary"
    );
  },

  async sendOfflineSubtitleForDownload(downloadId) {
    const subtitles = this.offlineSubtitleByDownload?.get(String(downloadId || "")) || [];
    try {
      const download = await getOfflineDownload(downloadId).catch(() => null);
      await sendOfflineSubtitleFor(download, subtitles, {
        onError: (message) => this.showStreamToast(message)
      });
    } catch (error) {
      // The caller runs this as void, so anything thrown here used to vanish and
      // the button simply looked dead.
      this.showStreamToast(`Subtitle handoff failed: ${String(error?.message || error)}`);
    }
  },

  renderOfflineButton(action, icon, label, streamId = "", className = "") {
    return `<button type="button" class="stream-route-offline-action ${className}" data-offline-action="${action}" data-stream-id="${escapeHtml(streamId)}" aria-label="${escapeHtml(label)}" title="${escapeHtml(label)}">${escapeHtml(icon)}</button>`;
  },

  renderStreamCard(stream, index, streamBadgesEnabled = true, badgeSettings = null) {
    if (Platform.isBrowser()) {
      const sourceModel = normalizeSourceForDisplay(stream, {
        badgeSettings,
        streamBadgesEnabled,
        addonLogoLookup: this.addonLogoLookup
      });
      return `
        <div class="stream-route-card-row" data-stream-row="${index}">
          <article class="stream-route-card stream-route-card-action focusable${this.isCardActionFocused(index, "play") ? " focused" : ""}"
                   data-action="playStream"
                   data-card-action="play"
                   data-stream-id="${escapeHtml(stream.id)}"
                   data-stream-row="${index}">
            ${renderBrowserSourceCardContent(sourceModel)}
            ${this.renderOfflineDownloadActions(stream)}
          </article>
        </div>
      `;
    }
    const headline = getStreamHeadline(stream);
    const quality = getStreamQuality(stream);
    const badges = renderStreamBadges(stream, streamBadgesEnabled, badgeSettings);
    const showAddonLogo = badgeSettings?.showAddonLogo === true;
    const badgePlacement = resolveStreamBadgePlacement(badgeSettings);
    const topBadges = badgePlacement === "TOP" ? badges : "";
    const bottomBadges = badgePlacement === "BOTTOM" ? badges : "";
    const descriptionLines = getStreamDescriptionLines(stream);
    let addonIdentity = "";
    if (showAddonLogo) {
      const addonLogoUrl =
        normalizeAddonLogoUrl(stream.addonLogo) ||
        resolveAddonLogo(stream.addonName, this.addonLogoLookup);
      const cachedAddonLogoUrl = getCachedAddonLogoDisplayUrl(addonLogoUrl);
      let displayAddonLogoUrl = cachedAddonLogoUrl || "";
      if (addonLogoUrl && !displayAddonLogoUrl && !hasFailedAddonLogo(addonLogoUrl)) {
        requestAddonLogo(addonLogoUrl, () => this.requestRender({ delayMs: 160 }));
      }
      const addonBadgeLabel = escapeHtml(getAddonBadgeLabel(stream.addonName || ""));
      const addonLogoLoading = "lazy";
      const addonLogoDecoding = "async";
      const addonBadge = displayAddonLogoUrl
        ? `<img src="${escapeHtml(displayAddonLogoUrl)}" alt="${escapeHtml(stream.addonName || "Addon")}" data-addon-logo="${escapeHtml(addonLogoUrl)}" decoding="${addonLogoDecoding}" loading="${addonLogoLoading}" referrerpolicy="no-referrer" /><span hidden>${addonBadgeLabel}</span>`
        : `<span>${addonBadgeLabel}</span>`;
      addonIdentity = `
          <div class="stream-route-card-side">
            <div class="stream-route-addon-badge">${addonBadge}</div>
            <div class="stream-route-addon-name">${escapeHtml(stream.addonName || "Addon")}</div>
          </div>`;
    }

    return `
      <div class="stream-route-card-row" data-stream-row="${index}">
        <article class="stream-route-card stream-route-card-action focusable${this.isCardActionFocused(index, "play") ? " focused" : ""}"
                 data-action="playStream"
                 data-card-action="play"
                 data-stream-id="${escapeHtml(stream.id)}"
                 data-stream-row="${index}">
          <div class="stream-route-card-copy">
            <div class="stream-route-card-heading">${escapeHtml(headline)}</div>
            ${topBadges || ""}
            ${!badges ? `<div class="stream-route-card-quality">${escapeHtml(quality)}</div>` : ""}
            ${descriptionLines.map((line, lineIndex) => `<div class="stream-route-card-line${lineIndex > 0 ? " secondary" : ""}">${escapeHtml(line)}</div>`).join("")}
            ${bottomBadges || ""}
          </div>
          ${addonIdentity}
          ${this.renderOfflineDownloadActions(stream)}
        </article>
      </div>
    `;
  },

  renderLoadingCards(count = 3) {
    return `
      <div class="stream-route-card-row">
        <div class="stream-route-card skeleton">
          <div class="stream-route-card-copy">
            <div class="stream-route-skeleton-line"></div>
            <div class="stream-route-skeleton-line"></div>
            <div class="stream-route-skeleton-line"></div>
            <div class="stream-route-skeleton-line"></div>
          </div>
        </div>
      </div>
    `.repeat(count);
  },

  // A stream was chosen before this screen was ever entered, so the screen has
  // nothing to ask and nothing to show. Painting its header, filters and list
  // for the second or two the link takes to resolve would be showing the picker
  // the setting exists to skip -- so the route paints its backdrop and says
  // what it is doing, and nothing else.
  renderAutoResolvedHandoff(backdropUrl = null) {
    const backdrop = backdropUrl === null ? this.getBackdropUrl() : backdropUrl;
    const nextMarkup = renderRouteHandoffShell({
      backdrop,
      label: t("stream_opening_player", {}, "Opening player…")
    });
    if (this.renderedMarkup !== nextMarkup) {
      this.container.innerHTML = nextMarkup;
      this.renderedMarkup = nextMarkup;
      this.streamFocusDomCache = null;
      this.focusedElement = null;
    }
  },

  render() {
    this.cancelScheduledRender();
    if (this.autoResolvedPlaybackPending) {
      this.renderAutoResolvedHandoff();
      return;
    }
    // Rebuilt markup means the memoised filtered-stream list may be stale.
    this._filteredStreamsCache = null;
    const { isSeries, title, subtitle, episodeLabel, detailLine } = this.getHeaderMeta();
    const backdrop = this.getBackdropUrl();
    const logo = this.params?.logo || "";
    const shellStableClass = this.hasRenderedStreamRouteShell ? " stable" : "";
    const orderedFilters = this.getOrderedFilterNames();
    const chips = [
      this.renderChip("all", this.addonFilter === "all", "success"),
      ...orderedFilters.map((name) => {
        const chip = this.sourceChips.find((entry) => entry.name === name) || {
          name,
          status: "success"
        };
        return this.renderChip(name, this.addonFilter === name, chip.status);
      })
    ].join("");
    const filtered = this.getFilteredStreams();
    const hasPendingForFilter = this.hasPendingSourceLoads();
    const hasAnyStreams = this.streams.length > 0;
    const streamBadgesEnabled = DebridSettingsStore.get().streamBadgesEnabled !== false;
    const badgeSettings = StreamBadgeSettingsStore.snapshot();
    const showAddonLogo = badgeSettings.showAddonLogo === true;
    const addonLogosReady = !showAddonLogo || !filtered.length || this.areAddonLogosReady(filtered);

    let body = "";
    if (filtered.length && addonLogosReady) {
      body = filtered
        .map((stream, index) =>
          this.renderStreamCard(stream, index, streamBadgesEnabled, badgeSettings)
        )
        .join("");
      if (hasPendingForFilter) {
        body += this.renderLoadingCards(1);
      }
    } else if (filtered.length && showAddonLogo) {
      this.requestAddonLogoPrerender(filtered);
      body = this.renderLoadingCards(Math.min(3, filtered.length));
    } else if ((this.loading && !hasAnyStreams) || hasPendingForFilter) {
      body = this.renderLoadingCards();
    } else if (this.error) {
      body = `<div class="stream-route-empty">${escapeHtml(this.error)}</div>`;
    } else if (!filtered.length) {
      body = `<div class="stream-route-empty">No sources found for this filter.</div>`;
    }
    const offlineCopies = (this.offlineLocalCopies || [])
      .map((download) => this.renderOfflineCopyRow(download))
      .filter(Boolean)
      .join("");
    if (offlineCopies) {
      body = `${offlineCopies}${body}`;
    }

    const buildRouteContent = (listBody) =>
      this.autoResumeUiActive
        ? ""
        : `
        <div class="stream-route-content">
          <section class="stream-route-left">
            <div class="stream-route-left-inner">
              ${logo ? `<img src="${logo}" class="stream-route-logo" alt="${escapeHtml(title)}" />` : `<h1 class="stream-route-title">${escapeHtml(title)}</h1>`}
              ${episodeLabel ? `<div class="stream-route-episode-code">${escapeHtml(episodeLabel)}</div>` : ""}
              ${subtitle ? `<div class="stream-route-subtitle">${escapeHtml(subtitle)}</div>` : ""}
              ${detailLine ? `<div class="stream-route-detail-line">${escapeHtml(detailLine)}</div>` : !isSeries && subtitle ? `<div class="stream-route-detail-line">${escapeHtml(subtitle)}</div>` : ""}
            </div>
          </section>
          <section class="stream-route-right">
            ${
              Platform.isBrowser()
                ? `<div class="stream-route-panel-shell">
                     <header class="stream-route-panel-header">
                       <div class="stream-route-panel-heading">
                         <span class="stream-route-panel-title">${escapeHtml(t("stream_panel_title", {}, "Streams"))}</span>
                         ${this.renderStreamPanelSummary()}
                       </div>
                       <div class="stream-route-filter-row">
                         ${this.renderAddonFilterPicker()}
                         ${this.renderStreamRefreshAction()}
                       </div>
                     </header>
                     <div class="stream-route-panel">
                       <div class="stream-route-list">${listBody}</div>
                     </div>
                   </div>`
                : `<div class="stream-route-chip-wrap">
                     <div class="stream-route-chip-track">${chips}</div>
                   </div>
                   <div class="stream-route-panel-shell">
                     <div class="stream-route-panel">
                       <div class="stream-route-list">${listBody}</div>
                     </div>
                   </div>`
            }
          </section>
        </div>`;

    const buildShellMarkup = (content) => `
      <div class="stream-route-shell${shellStableClass}">
        <div class="stream-route-backdrop"${backdrop ? ` style="background-image:url('${String(backdrop).replace(/'/g, "%27")}')"` : ""}></div>
        <div class="stream-route-backdrop-dim"></div>
        <div class="stream-route-left-gradient"></div>
        <div class="stream-route-right-gradient"></div>
        ${this.renderDesktopBackButton()}
        ${content}
        ${this.renderOfflineDownloadNotice()}
        ${this.renderContinueWatchingResumeOverlay()}
        ${this.renderAutoPlayOverlay()}
      </div>
    `;
    const routeContent = buildRouteContent(body);
    const nextMarkup = buildShellMarkup(routeContent);
    // The same page with the sources taken out of it. When two renders agree on
    // this and differ only in the list, the list is all that has to be written.
    const nextShellMarkup = buildShellMarkup(buildRouteContent(STREAM_LIST_BODY_TOKEN));

    // Addon logos can schedule a render once they resolve, so a settled list is
    // rebuilt several times over. Measured on
    // a 407-source list: three consecutive renders produced byte-identical
    // markup at ~1s each, so two of them were pure parse/layout/paint cost.
    // Keep the exact generated markup. Fixed-width hashes are not sufficient
    // here because stream/addon text is part of the string and collisions could
    // otherwise cause a genuinely changed list to retain stale DOM.
    const shellMounted = Boolean(this.container.querySelector(".stream-route-shell"));
    const markupUnchanged = shellMounted && this.renderedMarkup === nextMarkup;
    const listNode = shellMounted ? this.container.querySelector(".stream-route-list") : null;
    const listOnlyChange =
      !markupUnchanged && Boolean(listNode) && this.renderedShellMarkup === nextShellMarkup;

    if (listOnlyChange) {
      // Sources arrive in batches and addon logos resolve one by one, so a list
      // settles over several renders. Writing the whole page for each of those
      // threw away the backdrop, the title and the list element itself and made
      // them again -- which is the flicker while the list fills, and why a
      // scroll in progress lost its place: the node under the finger was gone.
      // Only the sources changed, so only the sources are written. The list
      // element survives, and with it the scroll position and the backdrop
      // already painted above it.
      listNode.innerHTML = body;
      this.renderedMarkup = nextMarkup;
      this.streamFocusDomCache = null;
      this.focusedElement = null;
    } else if (!markupUnchanged) {
      this.container.innerHTML = nextMarkup;
      this.renderedMarkup = nextMarkup;
      this.renderedShellMarkup = nextShellMarkup;
      this.streamFocusDomCache = null;
      this.focusedElement = null;
    }

    this.restoreScrollPosition();
    this.bindAddonLogoFallbacks();
    ScreenUtils.indexFocusables(this.container);
    this.restoreScrollPosition();
    this.applyFocus();
    if (Platform.isBrowser()) {
      const backButton = this.container.querySelector("[data-stream-desktop-back]");
      if (backButton) {
        backButton.onclick = () => this.handleStreamBack();
      }
    }
    this.bindDesktopPointerActions();
    this.bindListScrollState();
    this.renderedDownloadStatuses = this.collectOfflineDownloadStatuses();
    this.renderedOfflineCopyCount = (this.offlineLocalCopies || []).length;
    this.hasRenderedStreamRouteShell = true;
  },

  bindDesktopPointerActions() {
    if (!Platform.isBrowser() || !this.container || this.boundDesktopPointerActionHandler) {
      return;
    }
    this.boundDesktopPointerActionHandler = (event) => {
      const target = event.target;
      if (!(target instanceof Element)) {
        return;
      }
      const clickAction = resolveBrowserStreamCardClickAction(
        target,
        (node) => node instanceof HTMLElement && this.container.contains(node)
      );
      if (clickAction?.kind === "offline") {
        event.preventDefault();
        event.stopPropagation();
        void this.handleOfflineDownloadAction(clickAction.action, clickAction.streamId);
        return;
      }
      // onKeyDown already activates the focused TV/D-pad target. Let its
      // keyboard-generated click pass through without activating it twice.
      if (event.defaultPrevented || Number(event.detail || 0) === 0) {
        return;
      }
      if (clickAction?.kind !== "source" || !(clickAction.element instanceof HTMLElement)) {
        return;
      }
      void this.onPointerActivate(clickAction.element);
    };
    this.container.addEventListener("click", this.boundDesktopPointerActionHandler);

    // The picker is the app's own menu, so opening, choosing and dismissing it
    // are this screen's to handle. Capture, so the card handler above never
    // sees these first.
    this.boundStreamFilterRowHandler = (event) => {
      const target = event.target instanceof Element ? event.target : null;
      if (!target || !this.container?.contains(target)) {
        return;
      }
      const refresh = target.closest("[data-action='refreshStreams']");
      if (refresh) {
        event.preventDefault();
        event.stopPropagation();
        this.addonPickerOpen = false;
        // Bumping the token abandons whatever is still in flight, which is the
        // point: a refresh that waited for the answers it is replacing would be
        // no refresh at all.
        this.loadToken = (this.loadToken || 0) + 1;
        void this.loadStreams();
        return;
      }
      const option = target.closest("[data-action='selectAddonOption']");
      if (option) {
        event.preventDefault();
        event.stopPropagation();
        const index = Number(option.dataset.optionIndex || 0);
        const chosen = this.getAddonFilterOptions()[index];
        this.addonPickerOpen = false;
        if (chosen) {
          this.setAddonFilter(chosen.value);
        } else {
          this.render();
        }
        return;
      }
      const anchor = target.closest("[data-action='toggleAddonPicker']");
      if (anchor) {
        event.preventDefault();
        event.stopPropagation();
        this.addonPickerOpen = !this.addonPickerOpen;
        this.render();
        return;
      }
      // Anywhere else closes it, the way every menu in the app behaves.
      if (this.addonPickerOpen) {
        this.addonPickerOpen = false;
        this.render();
      }
    };
    this.container.addEventListener("click", this.boundStreamFilterRowHandler, true);
  },

  renderOfflineDownloadNotice() {
    if (!Environment.isBrowser() || !this.hasActiveOfflineDownload) return "";
    return `<div class="stream-route-offline-global-notice" aria-live="polite">Keep Nuvio open for reliable downloading</div>`;
  },

  bindListScrollState() {
    const list = this.container?.querySelector(".stream-route-list");
    if (!list) {
      return;
    }
    // A full innerHTML write used to discard this node along with its listeners.
    // Now that an unchanged render keeps the node alive, re-binding would stack
    // a duplicate scroll handler on every render.
    if (this.boundStreamListNode === list) {
      return;
    }
    this.boundStreamListNode = list;
    list.addEventListener(
      "scroll",
      () => {
        this.listScrollTop = this.getListScrollTop(list);
      },
      { passive: true }
    );
  },

  bindAddonLogoFallbacks() {
    this.container
      ?.querySelectorAll(".stream-route-addon-badge img[data-addon-logo]")
      .forEach((node) => {
        if (!(node instanceof HTMLImageElement) || node.dataset.fallbackBound === "true") {
          return;
        }
        node.dataset.fallbackBound = "true";
        const fallback = node.nextElementSibling;
        const applyFallback = () => {
          rememberFailedAddonLogo(node.dataset.addonLogo || node.getAttribute("src") || "");
          node.hidden = true;
          if (fallback instanceof HTMLElement) {
            fallback.hidden = false;
          }
        };
        node.addEventListener("error", applyFallback, { once: true });
      });
  },

  async startOfflineDownload(streamId) {
    const stream = this.streams.find((entry) => entry.id === streamId);
    if (!stream) return;
    if (!Environment.isBrowser()) return;
    this.openOfflineDownloadOptions(stream);
  },

  closeOfflineDownloadOptions() {
    this.offlineDownloadOptionsDialog?.destroy?.();
    this.offlineDownloadOptionsDialog = null;
    this.offlineDownloadOptionsState = null;
  },

  async discoverOfflineDownloadSubtitles(context = {}) {
    const type = context.itemType === "tv" ? "series" : context.itemType;
    const id = context.imdbId || context.itemId || context.mediaId;
    if (!type || !id) return [];
    return subtitleRepository.getSubtitles(type, id, context.videoId || null, {
      season: context.season,
      episode: context.episode,
      title: context.title,
      year: context.year
    });
  },

  getPreferredOfflineDownloadSubtitle(subtitles = []) {
    const settings = PlayerSettingsStore.get();
    const preferred = String(
      settings.subtitleStyle?.preferredLanguage || settings.subtitleLanguage || "off"
    )
      .trim()
      .toLowerCase();
    if (!preferred || preferred === "off") return null;
    return (
      (subtitles || []).find((subtitle) => {
        const language = String(subtitle.lang || subtitle.language || "").toLowerCase();
        return language === preferred || language.startsWith(`${preferred}-`);
      }) || null
    );
  },

  createOfflineSubtitleDescriptor(subtitle = null) {
    if (!subtitle) return null;
    const identity = getOfflineSubtitleIdentityParts(subtitle);
    return {
      addonId: String(subtitle.addonId || ""),
      fingerprint: createOfflineSubtitleFingerprint(subtitle),
      providerSubtitleId: identity.providerSubtitleId,
      urlIdentity: identity.urlIdentity,
      lang: String(subtitle.lang || subtitle.language || ""),
      fileName: subtitleReleaseName(subtitle),
      forced: subtitle.forced === true,
      sdh: subtitle.sdh === true || subtitle.hearingImpaired === true
    };
  },

  createOfflineSubtitleSelection(mode = "none", subtitles = []) {
    const descriptors = getSafeOfflineSubtitleDescriptors(
      (Array.isArray(subtitles) ? subtitles : [subtitles]).map((subtitle) =>
        this.createOfflineSubtitleDescriptor(subtitle)
      )
    );
    return {
      offlineSubtitleMode: mode,
      offlineSubtitleDescriptors: mode === "none" ? [] : descriptors,
      offlineSubtitle: mode === "specific" ? descriptors[0] || null : null
    };
  },

  renderOfflineDownloadOptionsContent(state) {
    const content = document.createElement("div");
    content.className = "stream-download-options";
    const source = state.stream || {};
    const snapshot = state.subtitleSnapshot || [];
    const sourceDisplay = normalizeSourceForDisplay(source);
    const quality = sourceDisplay.quality;
    const size = formatBytes(
      source.behaviorHints?.videoSize || source.raw?.behaviorHints?.videoSize || source.videoSize
    );
    const header = document.createElement("div");
    header.className = "download-options-header";
    header.innerHTML = `<div class="stream-download-options-source">${escapeHtml([quality, size].filter(Boolean).join(" · ") || "Selected source")}<span>${escapeHtml(sourceDisplay.addonName || source.addonName || "")}</span></div><div class="stream-download-options-label">Subtitles</div>`;
    content.appendChild(header);
    const picker = createBrowserOfflineSubtitlePicker({
      snapshot,
      selection: state,
      preferredLabel: state.preferredLabel,
      loading: state.loading,
      onSelect: (next) => {
        Object.assign(state, next);
        this.showOfflineDownloadOptions(state);
      }
    });
    content.appendChild(picker);
    if (state.error) {
      const unavailable = document.createElement("div");
      unavailable.className = "stream-download-options-unavailable";
      unavailable.textContent = "Subtitles unavailable — video can still be downloaded.";
      content.appendChild(unavailable);
    }
    return content;
  },

  showOfflineDownloadOptions(state) {
    this.offlineDownloadOptionsDialog?.destroy?.();
    this.offlineDownloadOptionsDialog = new NuvioDialog({
      title: "Download Options",
      widthVw: 34,
      panelClassName: "stream-download-options-dialog",
      actionsClassName: "stream-download-options-actions",
      content: () => this.renderOfflineDownloadOptionsContent(state),
      buttons: [
        {
          label: "Cancel",
          className: "season-download-secondary-action",
          onAction: () => this.closeOfflineDownloadOptions()
        },
        {
          label: "Download",
          className: "stream-download-primary-action",
          onAction: () => void this.confirmOfflineDownloadOptions(state)
        }
      ],
      onDismiss: () => this.closeOfflineDownloadOptions()
    });
    this.offlineDownloadOptionsDialog.mount(document.body);
  },

  async openOfflineDownloadOptions(stream) {
    const state = {
      stream,
      context: this.getOfflineDownloadContext(stream),
      subtitles: [],
      subtitleSnapshot: [],
      selectedMode: "none",
      selectedIndex: null,
      preferredLabel: "",
      selectedLanguage: "",
      loading: true,
      error: false
    };
    this.offlineDownloadOptionsState = state;
    this.showOfflineDownloadOptions(state);
    try {
      state.subtitles = await this.discoverOfflineDownloadSubtitles(state.context);
      state.subtitleSnapshot = createBrowserOfflineSubtitleSnapshot(state.subtitles, (subtitle) =>
        this.createOfflineSubtitleDescriptor(subtitle)
      );
      const preferred = this.getPreferredOfflineDownloadSubtitle(
        state.subtitleSnapshot.map((entry) => entry.subtitle)
      );
      state.preferredLabel = preferred ? normalizeSubtitleForDisplay(preferred).language : "";
    } catch (_) {
      state.error = true;
    } finally {
      state.loading = false;
      if (this.offlineDownloadOptionsState === state) this.showOfflineDownloadOptions(state);
    }
  },

  async confirmOfflineDownloadOptions(state = this.offlineDownloadOptionsState) {
    if (!state?.context) return;
    const snapshot = state.subtitleSnapshot || [];
    const selectedSubtitle = Number.isInteger(state.selectedIndex)
      ? snapshot[state.selectedIndex]?.subtitle
      : null;
    const preferredSubtitle = this.getPreferredOfflineDownloadSubtitle(
      snapshot.map((entry) => entry.subtitle)
    );
    const languageSubtitles = snapshot
      .filter((entry) => entry.language === state.selectedLanguage)
      .map((entry) => entry.subtitle);
    const selection =
      state.selectedMode === "all"
        ? this.createOfflineSubtitleSelection(
            "all",
            snapshot.map((entry) => entry.subtitle)
          )
        : state.selectedMode === "language"
          ? {
              ...this.createOfflineSubtitleSelection("language", languageSubtitles),
              offlineSubtitleLanguage: state.selectedLanguage
            }
          : state.selectedMode === "preferred"
            ? this.createOfflineSubtitleSelection("preferred", preferredSubtitle)
            : state.selectedMode === "specific"
              ? this.createOfflineSubtitleSelection("specific", selectedSubtitle)
              : this.createOfflineSubtitleSelection("none");
    try {
      await enqueueBrowserOfflineDownload({
        ...state.context,
        ...selection
      });
      this.closeOfflineDownloadOptions();
    } catch (_) {
      this.showStreamToast("Could not download this source.");
    }
  },

  async playOfflineDownload(streamId) {
    const stream = this.streams.find((entry) => entry.id === streamId);
    if (!stream) return;
    return this.playOfflineDownloadById(this.getOfflineDownloadId(stream), stream);
  },

  async playOfflineDownloadById(downloadId, stream = null) {
    return startOfflinePlayback({
      downloadId,
      playInternally: () => this.playOfflineDownloadInternally(downloadId, stream)
    });
  },

  async playOfflineDownloadInternally(downloadId, stream = null) {
    const playback = await createBrowserOfflinePlayback(downloadId);
    if (!playback) {
      this.showStreamToast("Offline file is unavailable.");
      await this.refreshOfflineDownloadMetadata();
      return;
    }
    try {
      const source = stream || {
        id: `offline-${downloadId}`,
        addonName: playback.download.sourceName || "Offline"
      };
      await this.playStream(source.id, {
        offlineObjectUrl: playback.objectUrl,
        offlineDownload: playback.download,
        offlineStream: source
      });
    } catch (_) {
      releaseBrowserOfflinePlayback(playback);
      this.showStreamToast("Could not play the offline file.");
    }
  },

  async handleOfflineDownloadAction(action, streamId) {
    if (action === "sendOfflineSubtitle") {
      const stream = this.streams.find((entry) => entry.id === streamId);
      return this.sendOfflineSubtitleForDownload(
        stream ? this.getOfflineDownloadId(stream) : streamId
      );
    }
    if (action === "playOfflineCopy") return this.playOfflineDownloadById(streamId);
    if (action === "deleteOfflineCopy") return deleteBrowserOfflineDownload(streamId);
    const stream = this.streams.find((entry) => entry.id === streamId);
    if (!stream) return;
    const downloadId = this.getOfflineDownloadId(stream);
    if (action === "download") return this.startOfflineDownload(streamId);
    if (action === "resume")
      return resumeQueuedBrowserOfflineDownload(downloadId, this.getOfflineDownloadContext(stream));
    if (action === "pause") return pauseQueuedBrowserOfflineDownload(downloadId);
    if (action === "cancel") return cancelQueuedBrowserOfflineDownload(downloadId);
    if (action === "playOffline") return this.playOfflineDownload(streamId);
    if (action === "deleteOffline") return deleteBrowserOfflineDownload(downloadId);
  },

  async routeSelectedStream(selected, context = {}) {
    if (!Environment.isBrowser() || context.offlineObjectUrl) return false;
    const player = normalizeBrowserExternalPlayer(PlayerSettingsStore.get().browserExternalPlayer);
    // A player this platform cannot launch is not a reason to ask a debrid
    // provider for a link. Desktop offers no external player at all, and a
    // stored choice from a phone outlives the device it was made on.
    if (player === "disabled" || !getBrowserExternalPlayerOptions().includes(player)) return false;
    const mediaUrl = await resolveExternalHandoffMediaUrl(selected, {
      season: this.params?.season == null ? null : Number(this.params.season),
      episode: this.params?.episode == null ? null : Number(this.params.episode),
      onNetworkResolve: () => this.showStreamToast("Preparing stream...")
    });
    if (!mediaUrl) return false;
    const itemType = normalizeType(this.params?.itemType);
    const prepared = prepareBrowserExternalPlaybackLaunch({
      player,
      platform: getBrowserExternalPlayerPlatform(),
      mediaUrl,
      title: this.params?.episodeTitle || this.params?.itemTitle || this.params?.playerTitle || "",
      subtitleUrl: "",
      resumePositionSeconds: resolveExternalResumeSeconds({
        positionMs: context.resumePositionMs,
        progressPercent: context.resumeProgressPercent,
        durationMs: context.resumeDurationMs
      }),
      knownDurationMs:
        Number(context.resumeDurationMs || 0) ||
        Math.max(0, Number(this.params?.runtime || this.params?.runtimeMinutes || 0)) * 60_000,
      progressMode: PlayerSettingsStore.get().externalPlayerProgress,
      returnMethod: PlayerSettingsStore.get().externalReturnMethod,
      progressContext: {
        itemId: this.params?.itemId || null,
        itemType: itemType || "movie",
        videoId: itemType === "series" || itemType === "tv" ? this.params?.videoId || null : null,
        season: this.params?.season == null ? null : Number(this.params.season),
        episode: this.params?.episode == null ? null : Number(this.params.episode),
        title: this.params?.itemTitle || this.params?.playerTitle || null,
        poster: this.params?.poster || null,
        background: this.getBackdropUrl() || null,
        episodeTitle: this.params?.episodeTitle || null,
        streamIdentity: buildStreamResumeIdentity(selected) || null
      }
    });
    if (!prepared?.launch?.href) return false;
    // Optional return convenience only: never allow binding failure to alter
    // the already-verified external-player launch path.
    // An Automation already brings the person back, so asking the relay for a
    // notification too would arrive for an app they are already looking at.
    // The subscription itself is left alone: it carries every other
    // notification the app sends, so cancelling it here would cost more than
    // this one message is worth.
    if (PlayerSettingsStore.get().externalReturnMethod !== "automation") {
      await bindBrowserPushReturn({ token: prepared.handoff?.token });
    }
    launchBrowserExternalPlayer({ href: prepared.launch.href });
    return true;
  },

  async playStream(
    streamId,
    {
      offlineObjectUrl = "",
      offlineDownload = null,
      offlineStream = null,
      skipExternalRoute = false
    } = {}
  ) {
    this.cancelAutoPlayCountdown();
    this.cancelAutoPlaySelectionWait();
    const filtered = this.getFilteredStreams();
    const selected =
      offlineStream || filtered.find((stream) => stream.id === streamId) || filtered[0];
    if (!selected) {
      return;
    }
    // Browser Player → Sources owns its own provider filters. Preserve the
    // Stream Selection canonical list across navigation instead of passing
    // only the currently filtered display slice.
    const playerStreamCandidates = offlineObjectUrl
      ? [
          {
            ...selected,
            url: offlineObjectUrl,
            externalUrl: null,
            sourceType: offlineDownload?.mimeType || selected.sourceType,
            mimeType: offlineDownload?.mimeType || selected.mimeType
          }
        ]
      : Environment.isBrowser()
        ? this.streams
        : this.getFilteredStreams();
    const itemType = normalizeType(this.params?.itemType);
    const startFromBeginning = Boolean(this.params?.startFromBeginning);
    const routeResumeProgress = {
      positionMs: Number(this.params?.resumePositionMs || 0) || 0,
      progressPercent: this.params?.resumeProgressPercent,
      durationMs: Number(this.params?.resumeDurationMs || 0) || 0
    };
    const hasRouteResume = !startFromBeginning && isWatchProgressInProgress(routeResumeProgress);
    let resumePositionMs = hasRouteResume ? routeResumeProgress.positionMs : 0;
    let resumeProgressPercent = hasRouteResume ? routeResumeProgress.progressPercent : null;
    let resumeDurationMs = hasRouteResume ? routeResumeProgress.durationMs : 0;
    // The route's position is a hint captured when this screen was opened, and
    // it does not move when playback does. Closing the player comes back to
    // this same screen with those same parameters, so pressing play again
    // resumed from where the session started rather than where it ended. The
    // store is the record of what was actually watched, so it answers whenever
    // it has a row and the hint only covers the case where it has none.
    if (!startFromBeginning) {
      const resumeTarget =
        itemType === "series" || itemType === "tv"
          ? {
              videoId: this.params?.videoId || null,
              season: this.params?.season,
              episode: this.params?.episode
            }
          : {};
      const resumeProgress = await watchProgressRepository
        .getResumeByContentId(this.params?.itemId, resumeTarget)
        .catch((error) => {
          console.warn("Stream resume lookup failed", error);
          return null;
        });
      const storedPositionMs = Number(resumeProgress?.positionMs || 0) || 0;
      if (storedPositionMs > 0 || Number(resumeProgress?.progressPercent) > 0) {
        resumePositionMs = storedPositionMs;
        resumeProgressPercent = resumeProgress?.progressPercent ?? resumeProgressPercent;
        resumeDurationMs = Number(resumeProgress?.durationMs || 0) || resumeDurationMs;
      }
    }
    // Where Back belongs after this. Read before the launch, because the
    // external branch below never opens the player route and the handoff flag
    // is cleared once it has.
    const returnRoute = resolveHandoffReturnRoute({
      handedOff: Boolean(this.autoResolvedPlaybackPending),
      continueWatchingBackHome: Boolean(this.params?.continueWatchingBackHome)
    });

    if (
      !skipExternalRoute &&
      (await this.routeSelectedStream(selected, {
        offlineObjectUrl,
        offlineDownload,
        offlineStream,
        resumePositionMs,
        resumeProgressPercent,
        resumeDurationMs
      }))
    ) {
      if (returnRoute !== "stream") {
        this.leaveForOriginWhenHidden();
      }
      return;
    }

    return Router.navigate("player", {
      streamUrl: offlineObjectUrl || selected.url || selected.externalUrl || null,
      itemId: this.params?.itemId || null,
      itemType: itemType || "movie",
      imdbId: this.params?.imdbId || null,
      tmdbId: this.params?.tmdbId || this.params?.tmdb_id || null,
      traktId: this.params?.traktId || this.params?.trakt_id || null,
      contentLanguage:
        this.params?.contentLanguage ||
        this.params?.originalLanguage ||
        this.params?.original_language ||
        null,
      videoId: this.params?.videoId || null,
      resumePositionMs,
      resumeProgressPercent,
      resumeDurationMs,
      startFromBeginning,
      episodeLabel:
        this.params?.season && this.params?.episode
          ? `S${this.params.season}E${this.params.episode}`
          : null,
      playerTitle: this.params?.itemTitle || this.params?.playerTitle || "Untitled",
      playerSubtitle: this.params?.episodeTitle || this.params?.playerSubtitle || "",
      playerEpisodeTitle: this.params?.episodeTitle || "",
      playerReleaseYear: this.params?.year || "",
      playerBackdropUrl: this.getBackdropUrl() || null,
      playerLogoUrl: this.params?.logo || null,
      parentalWarnings: this.params?.parentalWarnings || null,
      parentalGuide: this.params?.parentalGuide || null,
      season: this.params?.season == null ? null : Number(this.params.season),
      episode: this.params?.episode == null ? null : Number(this.params.episode),
      episodes: Array.isArray(this.params?.episodes) ? this.params.episodes : [],
      streamCandidates: playerStreamCandidates,
      preferredStreamId: selected.id,
      playbackSourceContext: selected.streamOrigin || {
        addonId: selected.addonId || "",
        addonBaseUrl: selected.addonBaseUrl || "",
        addonName: selected.addonName || "",
        addonOrderIndex: Number.isFinite(Number(selected.addonOrderIndex))
          ? Number(selected.addonOrderIndex)
          : null,
        sourceProviderId: selected.sourceProviderId || "",
        sourceIds: Array.isArray(selected.sources) ? selected.sources : [],
        selectedStreamId: selected.id || ""
      },
      // Only when its list was actually shown. A doorway is not a place to
      // come back to, and landing there cost a second Back to get out of.
      returnToStreamOnBack: returnRoute === "stream",
      handoffReturnRoute: returnRoute,
      streamRouteParams: this.params ? { ...this.params } : null,
      fromDetailRoute: Boolean(this.params?.fromDetailRoute),
      nextEpisodeVideoId: this.params?.nextEpisodeVideoId || null,
      nextEpisodeLabel: this.params?.nextEpisodeLabel || null,
      nextEpisodeSeason: this.params?.nextEpisodeSeason ?? null,
      nextEpisodeEpisode: this.params?.nextEpisodeEpisode ?? null,
      nextEpisodeTitle: this.params?.nextEpisodeTitle || "",
      nextEpisodeReleased: this.params?.nextEpisodeReleased || "",
      offlineObjectUrl: offlineObjectUrl || null,
      offlineDownloadId: offlineDownload?.downloadId || null
    });
  },

  onPointerFocus(target) {
    if (!target || !this.container?.contains(target)) {
      return false;
    }
    const { chips } = this.getFocusLists();
    const chipTarget = target.closest?.(".stream-route-chip.focusable") || target;
    const chipIndex = chips.indexOf(chipTarget);
    if (chipIndex >= 0) {
      this.focusState = { zone: "filter", index: chipIndex };
      this.focusList(chips, chipIndex);
      return true;
    }
    const cardAction = target.closest?.("[data-stream-row][data-card-action]");
    if (cardAction) {
      this.focusState = {
        zone: "card",
        row: Math.max(0, Number(cardAction.dataset.streamRow || 0)),
        action: String(cardAction.dataset.cardAction || "play")
      };
      this.focusElement(cardAction);
      return true;
    }
    return false;
  },

  onPointerActivate(target) {
    if (!target || !this.container?.contains(target)) {
      return false;
    }
    const actionTarget = target.closest?.("[data-action]") || target;
    this.onPointerFocus(actionTarget);
    const action = String(actionTarget.dataset.action || "");
    if (action === "setFilter") {
      const addon = String(actionTarget.dataset.addon || "all");
      const { chips } = this.getFocusLists();
      this.setAddonFilter(addon, "filter", Math.max(0, chips.indexOf(actionTarget)));
      return true;
    }
    if (action === "playStream") {
      this.playStream(actionTarget.dataset.streamId);
      return true;
    }
    return false;
  },

  onKeyDown(event) {
    // Any key during the auto-play countdown hands control back to the user.
    // Back just cancels and stays on the picker; other keys cancel and then do
    // their normal thing (OK on the highlighted stream plays it right away).
    if (this.autoPlayCountdown) {
      this.cancelAutoPlayCountdown();
      if (isBackEvent(event)) {
        event?.preventDefault?.();
        return;
      }
    }

    if (isBackEvent(event)) {
      event?.preventDefault?.();
      Router.back();
      return;
    }

    const direction = getDpadDirection(event);
    if (direction) {
      const { chips, rows } = this.getFocusLists();
      const zone = this.focusState?.zone || (rows.length ? "card" : "filter");
      let index = Number(this.focusState?.index || 0);
      event?.preventDefault?.();

      if (zone === "filter") {
        if (direction === "left") {
          if (chips.length) {
            const ordered = ["all", ...this.getOrderedFilterNames()];
            const currentFilter = ordered[clamp(index, 0, ordered.length - 1)] || "all";
            const currentPosition = ordered.indexOf(currentFilter);
            const nextFilter = ordered[clamp(currentPosition - 1, 0, ordered.length - 1)];
            this.setAddonFilter(
              nextFilter,
              "filter",
              clamp(index - 1, 0, Math.max(0, chips.length - 1))
            );
          }
          return;
        }
        if (direction === "right") {
          if (chips.length) {
            const ordered = ["all", ...this.getOrderedFilterNames()];
            const currentFilter = ordered[clamp(index, 0, ordered.length - 1)] || "all";
            const currentPosition = ordered.indexOf(currentFilter);
            const nextFilter = ordered[clamp(currentPosition + 1, 0, ordered.length - 1)];
            this.setAddonFilter(
              nextFilter,
              "filter",
              clamp(index + 1, 0, Math.max(0, chips.length - 1))
            );
          }
          return;
        }
        if (direction === "down" && rows.length) {
          this.focusState = { zone: "card", row: 0, action: "play" };
          this.applyFocus();
        }
        return;
      }

      if (zone === "card") {
        const rowIndex = clamp(Number(this.focusState?.row || 0), 0, Math.max(0, rows.length - 1));
        const currentRow = rows[rowIndex] || null;
        const currentAction = String(this.focusState?.action || "play");
        if (direction === "up") {
          if (rowIndex > 0) {
            const previousRow = rows[rowIndex - 1] || null;
            const target = this.resolveCardActionForRow(previousRow, currentAction);
            this.focusState = {
              zone: "card",
              row: rowIndex - 1,
              action: String(target?.dataset?.cardAction || "play")
            };
            this.applyFocus();
            return;
          }
          this.focusState = {
            zone: "filter",
            index: clamp(
              ["all", ...this.getOrderedFilterNames()].indexOf(this.addonFilter),
              0,
              Math.max(0, chips.length - 1)
            )
          };
          this.applyFocus();
          return;
        }
        if (direction === "down") {
          const nextRowIndex = clamp(rowIndex + 1, 0, Math.max(0, rows.length - 1));
          const nextRow = rows[nextRowIndex] || null;
          const target = this.resolveCardActionForRow(nextRow, currentAction);
          this.focusState = {
            zone: "card",
            row: nextRowIndex,
            action: String(target?.dataset?.cardAction || "play")
          };
          this.applyFocus();
          return;
        }
        if (direction === "left") {
          if (currentAction === "native" && currentRow?.play) {
            this.focusState = { zone: "card", row: rowIndex, action: "play" };
            this.applyFocus();
            return;
          }
          const ordered = ["all", ...this.getOrderedFilterNames()];
          const currentIndex = Math.max(0, ordered.indexOf(this.addonFilter));
          const nextFilter = ordered[clamp(currentIndex - 1, 0, ordered.length - 1)] || "all";
          this.setAddonFilter(nextFilter, "card", rowIndex);
          return;
        }
        if (direction === "right") {
          if (currentAction === "play" && currentRow?.native) {
            this.focusState = { zone: "card", row: rowIndex, action: "native" };
            this.applyFocus();
            return;
          }
          const ordered = ["all", ...this.getOrderedFilterNames()];
          const currentIndex = Math.max(0, ordered.indexOf(this.addonFilter));
          const nextFilter = ordered[clamp(currentIndex + 1, 0, ordered.length - 1)] || "all";
          this.setAddonFilter(nextFilter, "card", rowIndex);
          return;
        }
      }
      return;
    }

    if (Number(event?.keyCode || 0) !== 13) {
      return;
    }

    const current = this.container.querySelector(".focusable.focused");
    if (!current) {
      return;
    }
    const action = String(current.dataset.action || "");
    if (action === "setFilter") {
      const addon = String(current.dataset.addon || "all");
      this.setAddonFilter(
        addon,
        "filter",
        Array.from(this.container.querySelectorAll(".stream-route-chip.focusable")).indexOf(current)
      );
      return;
    }
    if (action === "playStream") {
      this.playStream(current.dataset.streamId);
      return;
    }
  },

  cleanup() {
    this.clearExternalHandoffWatch();
    this.closeOfflineDownloadOptions?.();
    this.cancelAutoPlayCountdown();
    this.cancelAutoPlaySelectionWait();
    this.offlineDownloadsUnsubscribe?.();
    this.offlineDownloadsUnsubscribe = null;
    this.loadToken = (this.loadToken || 0) + 1;
    this.playResolveToken = Number(this.playResolveToken || 0) + 1;
    this.cancelScheduledRender();
    if (this.errorChipTimer) {
      clearTimeout(this.errorChipTimer);
      this.errorChipTimer = null;
    }
    if (this.streamToastTimer) {
      clearTimeout(this.streamToastTimer);
      this.streamToastTimer = null;
    }
    this.renderedMarkup = null;
    this.boundStreamListNode = null;
    if (this.boundStreamFilterRowHandler && this.container) {
      this.container.removeEventListener("click", this.boundStreamFilterRowHandler, true);
    }
    this.boundStreamFilterRowHandler = null;
    this.addonPickerOpen = false;
    if (this.boundDesktopPointerActionHandler && this.container) {
      this.container.removeEventListener("click", this.boundDesktopPointerActionHandler);
      this.boundDesktopPointerActionHandler = null;
    }
    this.streamFocusDomCache = null;
    this.focusedElement = null;
    ScreenUtils.hide(this.container);
  }
};
