import { subtitleRepository } from "../../data/repository/subtitleRepository.js";
import { PlayerSettingsStore } from "../../data/local/playerSettingsStore.js";
import { subtitleReleaseName } from "../../domain/model/subtitle.js";
import {
  createOfflineSubtitleFingerprint,
  getOfflineSubtitleIdentityParts,
  getSafeOfflineSubtitleDescriptors
} from "../../core/offline/browserOfflineDownloads.js";
import { enqueueBrowserOfflineDownload } from "../../core/offline/browserOfflineDownloadQueue.js";
import { NuvioDialog } from "./nuvioDialog.js";
import { normalizeSubtitleForDisplay } from "./browserSubtitleDisplay.js";
import {
  createBrowserOfflineSubtitlePicker,
  createBrowserOfflineSubtitleSnapshot
} from "./browserOfflineSubtitlePicker.js";
import { normalizeSourceForDisplay } from "./browserStreamSourceCard.js";
const escapeHtml = (value) =>
  String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
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

export const BrowserOfflineDownloadOptions = {
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

  async openOfflineDownloadOptions(stream, context = this.getOfflineDownloadContext(stream)) {
    const state = {
      stream,
      context,
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
      const queued = await enqueueBrowserOfflineDownload({
        ...state.context,
        ...selection
      });
      this.closeOfflineDownloadOptions();
      this.showAspectToast?.(
        queued.status === "existing" ? "Already in Downloads" : "Download queued"
      );
    } catch (_) {
      (this.showStreamToast || this.showAspectToast).call(this, "Could not download this source.");
    }
  }
};
