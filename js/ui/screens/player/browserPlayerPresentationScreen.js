import { renderFilterPicker } from "../../components/filterPicker.js";
import {
  isBrowserOfflineDownloadSupported,
  canQueueBrowserOfflineDownload
} from "../../../core/offline/browserOfflineDownloads.js";
import { I18n } from "../../../i18n/index.js";
import { PlayerController } from "../../../core/player/playerController.js";
import {
  browserPlayerChrome,
  browserPlayerControls,
  browserPlayerLayout,
  playerDesignIcon,
  playerPanelHead,
  playerChoice,
  playerText
} from "./browserPlayerPresentation.js";

const t = (key, fallback) => I18n.t(key, {}, { fallback });
const seconds = (value) => Math.max(0, Math.floor(Number(value) || 0));
const time = (value) => {
  const n = seconds(value);
  return n >= 3600
    ? `${Math.floor(n / 3600)}:${String(Math.floor((n % 3600) / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`
    : `${Math.floor(n / 60)}:${String(n % 60).padStart(2, "0")}`;
};

export const BrowserPlayerPresentationScreen = {
  renderPanelDownloadButton(index, scope, stream) {
    const episode = scope === "episode" ? this.episodes?.[this.episodePanelIndex] : null;
    if (
      !isBrowserOfflineDownloadSupported() ||
      !canQueueBrowserOfflineDownload(this.getPanelDownloadContext(stream, episode))
    )
      return "";
    return `<div class="stream-route-offline-actions"><button type="button" class="stream-route-offline-action download" data-player-download-index="${index}" data-player-download-scope="${scope}" aria-label="${playerText(t("downloads_download", "Download"))}" title="${playerText(t("downloads_download", "Download"))}">↓</button></div>`;
  },
  getPanelDownloadContext(stream, episode = null) {
    const p = this.params || {};
    const series = p.itemType === "series" || p.itemType === "tv";
    return {
      contentType: series ? "episode" : "movie",
      itemType: series ? "series" : p.itemType || "movie",
      itemId: p.itemId,
      mediaId: p.itemId,
      tmdbId: p.tmdbId || p.tmdb_id,
      imdbId: p.imdbId,
      seriesId: series ? p.itemId : "",
      seriesTitle: series ? p.playerTitle : "",
      season: episode?.season ?? p.season,
      episode: episode?.episode ?? p.episode,
      videoId: episode?.videoId || episode?.id || p.videoId,
      title: episode?.title || (series ? p.episodeTitle || p.playerSubtitle : p.playerTitle),
      year: p.playerReleaseYear || p.year,
      poster: p.playerPosterUrl || p.poster,
      backdrop: p.playerBackdropUrl || p.backdrop,
      description: episode?.overview || p.overview,
      runtimeMinutes: p.runtimeMinutes,
      episodeOverview: episode?.overview || "",
      sourceName: stream.addonName || "",
      filename: stream.behaviorHints?.filename || stream.raw?.behaviorHints?.filename || "",
      mimeType: stream.mimeType || null,
      stream
    };
  },
  getProposalLayout() {
    return browserPlayerLayout({
      touch: Boolean(this.browserOrientation?.mobile),
      width: window.innerWidth,
      height: window.innerHeight,
      preference: this.browserOrientation?.preference || "landscape"
    });
  },
  renderBrowserPlayerChrome(header, clock) {
    const subtitle = String(header.subtitle || "")
      .replace(/^S(\d+)E(\d+)/, "S$1 E$2")
      .replaceAll(" • ", " · ");
    return browserPlayerChrome({ title: header.title, subtitle, clock });
  },
  configureProposalPresentation() {
    const root = this.uiRefs?.root;
    if (!root?.classList.contains("player-presentation")) return;
    const layout = this.getProposalLayout();
    root.classList.add("nv-player");
    root.classList.toggle("nv-desktop", layout.desktop && !layout.portrait);
    root.classList.toggle("nv-mobile", !layout.desktop);
    root.classList.toggle("nv-portrait", layout.portrait);
    root.dataset.transport = layout.desktop ? "bottom" : "center";
    root.dataset.proposalLayout = layout.desktop ? "desktop" : "mobile";
    const back = root.querySelector("[data-player-desktop-back]");
    const slot = root.querySelector(".nv-back-slot");
    if (back && slot && back.parentNode !== slot) {
      back.innerHTML = playerDesignIcon("chevron-left");
      back.classList.add("nv-icon");
      slot.append(back);
    }
    for (const node of [
      this.uiRefs.subtitleDialog,
      this.uiRefs.audioDialog,
      this.uiRefs.speedDialog,
      this.uiRefs.mobileMorePanel,
      this.uiRefs.sourcesPanel
    ])
      node?.classList.add("nv-panel");
    this.uiRefs?.startupErrorOverlay?.classList.add("nv-error");
  },
  renderProposalControls(controls) {
    this.configureProposalPresentation();
    this.detectDesktopSoftwareVolume();
    const state = this.getDesktopVolumeState();
    const layout = this.getProposalLayout();
    const markup = browserPlayerControls({
      controls,
      paused: this.paused,
      offline: Boolean(this.offlineDownloadId),
      ...state,
      volumeSupported: this.desktopVolumeReadOnly === false,
      fullscreen: layout.desktop && Boolean(this.getDesktopFullscreenCapability()),
      fullscreenActive: this.isDesktopPlayerFullscreen(),
      labels: {
        play: t("detail_btn_play", "Play"),
        pause: t("player_pause", "Pause"),
        back10: t("player_seek_back_10", "Back 10 seconds"),
        forward10: t("player_seek_forward_10", "Forward 10 seconds"),
        next: t("next_episode_label", "Next episode"),
        subtitle: t("player_caption_subtitle", "Subtitle"),
        audio: t("audio_dialog_title", "Audio"),
        episode: t("player_caption_episode", "Episode"),
        stream: t("player_caption_stream", "Stream"),
        file: t("player_local_file", "File"),
        more: t("player_more", "More"),
        mute: t("player_mute", "Mute"),
        unmute: t("player_unmute", "Unmute"),
        volume: t("player_volume", "Volume"),
        fullscreen: t("player_fullscreen", "Fullscreen")
      }
    });
    const root = this.uiRefs.root;
    this.uiRefs.controlButtons.innerHTML = markup.toolbar;
    root.querySelector(".nv-center").innerHTML = markup.center;
    root.querySelector(".nv-next-slot").innerHTML = layout.desktop ? "" : markup.next;
    this.renderedControlSignature = this.getControlRenderSignature(controls);
    this.renderCompactBrowserMorePanel();
    this.renderNextEpisodeCard();
    this.syncPlayerOverlayLayoutState();
  },
  syncProposalTime(current, duration) {
    const root = this.uiRefs?.root;
    if (!root?.classList.contains("nv-player")) return;
    const values = [
      ["[data-player-elapsed]", time(current)],
      ["[data-player-duration]", "/ " + time(duration)],
      ["[data-player-remaining]", "−" + time(Math.max(0, duration - current))]
    ];
    for (const [selector, value] of values) {
      const node = root.querySelector(selector);
      if (node && node.textContent !== value) node.textContent = value;
    }
    const shell = this.uiRefs.progressShell;
    shell?.setAttribute("aria-valuemin", "0");
    shell?.setAttribute("aria-valuemax", String(seconds(duration)));
    shell?.setAttribute("aria-valuenow", String(seconds(current)));
    shell?.setAttribute("aria-valuetext", `${time(current)} / ${time(duration)}`);
  },
  isPlayerAirPlaySupported() {
    const video = this.getDesktopPlaybackVideo();
    // Safari can use the original network source alongside local MSE output.
    // The receiver handles compatibility; local downloads still stay local.
    const source =
      video?.querySelector?.("source[data-nuvio-airplay-source]")?.src ||
      video?.currentSrc ||
      video?.src ||
      "";
    return Boolean(
      !this.offlineDownloadId &&
      typeof video?.webkitShowPlaybackTargetPicker === "function" &&
      /^https?:\/\//i.test(String(source))
    );
  },
  openPlayerAirPlayPicker() {
    if (!this.isPlayerAirPlaySupported()) return false;
    const video = this.getDesktopPlaybackVideo();
    try {
      // A previous client-remux source may have disabled remote playback on
      // this same element. Only opt back in for the current network source.
      video.disableRemotePlayback = false;
      video.setAttribute("x-webkit-airplay", "allow");
      // Keep this synchronous inside the click's user activation.
      video.webkitShowPlaybackTargetPicker();
      this.moreActionsVisible = false;
      this.renderCompactBrowserMorePanel();
      this.updateModalBackdrop();
      return true;
    } catch {
      this.showAspectToast(
        t("player_airplay_unavailable", "AirPlay is unavailable for this stream.")
      );
      return false;
    }
  },
  getProposalPlaybackInfoRows() {
    const video = this.getDesktopPlaybackVideo();
    const source = this.getCurrentStreamCandidate();
    const audio = this.getAudioEntries().find((entry) => entry.selected);
    const client = PlayerController.clientRemux?.snapshot();
    const attempt = this.params?.unverifiedPlayback;
    const server = attempt?.mediaUrl === this.activePlaybackUrl ? attempt?.output : null;
    const output = client || server;
    const processing = output?.processing;
    const videoEncoded = processing === "transcode";
    const audioEncoded = videoEncoded || processing === "audio-transcode";
    const container = {
      fmp4: t("player_fragmented_mp4", "Fragmented MP4 (fMP4)"),
      "hls-fmp4": "HLS · fMP4",
      mp4: "MP4"
    }[output?.outputContainer];
    const method = {
      remux: "Remux",
      "audio-transcode": t("settings_filter_audio_transcode", "Audio Transcode"),
      transcode: t("settings_filter_full_transcode", "Full Transcode")
    }[processing];
    const location = client
      ? t("player_processing_client", "Client")
      : t("player_processing_server", "Server");
    const probe = this.offlineDownloadId
      ? null
      : this.directTrackProbe ||
        this.relayTrackProbe ||
        (source && this.getPlayerStreamProbe(source));
    const knownText = (value) =>
      typeof value === "string" && value.toLowerCase() !== "unknown" ? value : "";
    const width = video?.videoWidth || (!videoEncoded && probe?.width);
    const height = video?.videoHeight || (!videoEncoded && probe?.height);
    const codec = knownText(output?.video || (!videoEncoded && probe?.videoCodec)).toUpperCase();
    const frameRate = Number(!videoEncoded && probe?.frameRate);
    const videoBitrate = Number(!videoEncoded && probe?.videoBitrate);
    const size = Number(client?.sourceSizeBytes);
    const fileSize =
      size > 0
        ? size >= 1073741824
          ? (size / 1073741824).toFixed(2) + " GiB"
          : (size / 1048576).toFixed(1) + " MiB"
        : "";
    const file = [knownText(client?.sourceContainer || probe?.container), fileSize]
      .filter(Boolean)
      .join(" · ");
    const selectedAudio = [audio?.label, audio?.secondary].filter(Boolean).join(" · ");
    const outputAudio = output?.audio
      ? [
          knownText(output.audio).toUpperCase(),
          output.channels > 0 ? output.channels + " ch" : "",
          output.sampleRate > 0 ? output.sampleRate / 1000 + " kHz" : ""
        ]
          .filter(Boolean)
          .join(" · ")
      : "";
    return [
      [
        t("sources_title", "Source"),
        this.offlineDownloadId ? t("player_local_file", "Local file") : source?.addonName
      ],
      ...(file ? [[t("player_source_file", "Source file"), file]] : []),
      ...(container ? [[t("player_playback_container", "Playback container"), container]] : []),
      [
        t("player_video", "Video"),
        [
          width && height ? width + " × " + height : "",
          codec,
          Number.isFinite(frameRate) && frameRate > 0 ? Number(frameRate.toFixed(2)) + " fps" : "",
          Number.isFinite(videoBitrate) && videoBitrate > 0
            ? (videoBitrate / 1000000).toFixed(2) + " Mbps"
            : ""
        ]
          .filter(Boolean)
          .join(" · ")
      ],
      [
        t("audio_dialog_title", "Audio"),
        audioEncoded
          ? outputAudio
          : output?.audio === null
            ? ""
            : selectedAudio ||
              outputAudio ||
              t("player_audio_direct_default", "Player default audio")
      ],
      [
        t("player_processing", "Playback"),
        this.offlineDownloadId
          ? t("player_local_file", "Local file")
          : method
            ? method + " · " + location
            : PlayerController.playbackEngine
      ]
    ];
  },

  renderProposalMore() {
    const panel = this.uiRefs?.mobileMorePanel;
    if (!panel) return;
    panel.classList.add("nv-panel");
    panel.classList.toggle("hidden", !this.moreActionsVisible);
    if (!this.moreActionsVisible) {
      panel.innerHTML = "";
      return;
    }
    const row = (action, label, value = "", icon = "") =>
      `<button type="button" class="nv-choice player-control-btn" data-action="${action}">${icon ? playerDesignIcon(icon) : ""}<span class="nv-copy">${playerText(label)}</span>${value ? `<span class="nv-value">${playerText(value)}</span>` : ""}</button>`;
    if (this.playbackInfoVisible) {
      const rows = this.getProposalPlaybackInfoRows();
      panel.innerHTML =
        playerPanelHead(t("player_playback_information", "Playback information"), "backFromMore") +
        `<div class="nv-panel-body">${rows.map(([label, value]) => `<div class="nv-mini-row"><span>${playerText(label)}</span><span class="nv-value">${playerText(value || "—")}</span></div>`).join("")}<button type="button" class="nv-choice nv-subtle-action player-control-btn" data-action="moreInfoBack">${playerDesignIcon("chevron-left")} ${playerText(t("common.back", "Back"))}</button></div>`;
      return;
    }
    const aspect =
      this.aspectModes?.[this.aspectModeIndex]?.label || t("player_auto_aspect", "Automatic");
    panel.innerHTML =
      playerPanelHead(t("player_more", "More"), "backFromMore") +
      `<div class="nv-panel-body">
      ${this.getProposalLayout().rotate ? row("rotate", t("player_rotate", "Rotate"), "", "rotate-cw") : ""}
      ${this.getPlaybackSpeedOptions().length > 1 ? row("speed", t("player_playback_speed", "Speed"), this.getPlaybackSpeed() + "×") : ""}
      ${row("aspect", t("player_more_aspect_ratio", "Aspect ratio"), aspect)}
      ${this.isDesktopPictureInPictureSupported() ? row("presentationPip", "Picture-in-Picture", "", "picture-in-picture-2") : ""}
      ${this.isPlayerAirPlaySupported?.() ? row("airplay", "AirPlay", this.getDesktopPlaybackVideo()?.webkitCurrentPlaybackTargetIsWireless ? t("player_airplay_connected", "Connected") : "", "airplay") : ""}
      <button type="button" class="nv-choice player-control-btn" data-action="playbackInfo"><span class="nv-copy">${playerText(t("player_playback_information", "Playback information"))}</span>${playerDesignIcon("chevron-right")}</button>
    </div>`;
  },
  renderProposalAudio() {
    const dialog = this.uiRefs?.audioDialog;
    if (!dialog) return true;
    dialog.classList.add("nv-panel");
    dialog.classList.toggle("hidden", !this.audioDialogVisible);
    if (!this.audioDialogVisible) {
      dialog.innerHTML = "";
      return true;
    }
    const entries = this.getAudioEntries();
    dialog.innerHTML =
      playerPanelHead(t("audio_dialog_title", "Audio"), "audioTrack") +
      `<div class="nv-panel-body player-audio-track-list">${entries.length ? entries.map((e, index) => playerChoice({ label: e.label, secondary: e.secondary, selected: Boolean(e.selected), disabled: e.supported === false, attributes: `data-audio-column="tracks" data-audio-index="${index}"`, classes: "player-dialog-item" })).join("") : `<div class="nv-group">${playerText(this.getUnavailableTrackMessage("audio"))}</div>`}<div class="nv-mini-row"><span>${playerText(t("player_audio_boost", "Audio boost"))}</span><span class="nv-value">${Math.round(Number(this.audioAmplificationDb || 0))} dB</span></div></div>`;
    return true;
  },
  renderProposalFile() {
    const panel = this.uiRefs?.sourcesPanel;
    if (!panel || !this.offlineDownloadId) return false;
    panel.classList.add("nv-panel");
    panel.dataset.rich = "false";
    panel.classList.toggle("hidden", !this.sourcesPanelVisible);
    if (!this.sourcesPanelVisible) {
      panel.innerHTML = "";
      return true;
    }
    const file = this.offlinePlayerDownloads?.find((d) => d.downloadId === this.offlineDownloadId),
      size = Number(file?.totalBytes || file?.downloadedBytes || 0);
    const bytes =
      size >= 1073741824
        ? (size / 1073741824).toFixed(2) + " GB"
        : size >= 1048576
          ? Math.round(size / 1048576) + " MB"
          : size
            ? size + " B"
            : "";
    const title =
      file?.filename || this.getCurrentStreamCandidate()?.title || this.params.playerTitle;
    panel.innerHTML =
      playerPanelHead(t("player_saved_file", "Saved file"), "source") +
      `<div class="nv-panel-body player-local-file"><div class="nv-group">${playerText(t("player_this_device", "This device"))}</div>${playerChoice({ label: title, secondary: [file?.mimeType, bytes].filter(Boolean).join(" · "), selected: true })}<div class="nv-mini-row"><span>${playerText(t("player_file_location", "Location"))}</span><span class="nv-value">${playerText(t("player_app_storage", "App storage"))}</span></div></div>`;
    return true;
  },
  renderProposalError() {
    const root = this.uiRefs?.root,
      overlay = this.uiRefs?.startupErrorOverlay;
    if (!root?.classList.contains("nv-player") || !overlay) return false;
    const visible = this.isStartupErrorVisible();
    root.dataset.error = String(visible);
    overlay.classList.add("nv-error");
    overlay.classList.toggle("hidden", !visible);
    overlay.setAttribute("aria-hidden", String(!visible));
    if (!visible) {
      overlay.innerHTML = "";
      return true;
    }
    this.dismissPauseOverlay?.();
    this.controlsVisible = true;
    root.classList.remove("pause-screen-visible");
    root.classList.add("controls-visible");
    this.syncPlayerOverlayLayoutState?.();
    this.uiRefs.controlsOverlay?.classList.remove("hidden");
    const offline = Boolean(this.offlineDownloadId),
      details = [this.startupErrorMessage, ...(this.startupErrorDetails || [])].filter(Boolean);
    overlay.innerHTML = `<div class="nv-error-copy">${playerDesignIcon("circle-alert")}<h3>${playerText(offline ? t("player_file_cannot_play", "File cannot be played yet") : t("player_video_cannot_play", "Video cannot be played yet"))}</h3><p>${playerText(offline ? t("player_file_error_help", "This downloaded file is unavailable or incomplete.") : t("player_stream_error_help", "The stream did not respond. Try again or choose another stream."))}</p><div class="nv-error-actions"><button type="button" class="nv-retry" data-player-error-action="retry-current">${playerText(t("action_retry", "Try again"))}</button><button type="button" data-player-error-action="choose-source">${playerText(offline ? t("player_saved_episodes", "Saved episodes") : t("player_choose_stream", "Choose stream"))}</button></div><details class="player-startup-error-diagnostics"><summary>${playerText(t("player_problem_details", "Problem details"))}</summary><div class="player-startup-error-details">${details.map((line) => `<div>${playerText(line)}</div>`).join("")}</div><button type="button" class="nv-icon" data-player-error-action="copy-details">${playerText(t("player_copy_log", "Copy log"))}</button></details></div>`;
    this.uiRefs.startupErrorButton = overlay.querySelector(
      '[data-player-error-action="retry-current"]'
    );
    return true;
  },
  renderProposalWarning() {
    const overlay = this.uiRefs?.parentalGuide;
    if (!this.uiRefs?.root?.classList.contains("nv-player") || !overlay) return false;
    overlay.classList.add("nv-warning");
    const visible =
      (this.parentalGuideVisible || this.parentalGuideExiting) && this.parentalWarnings?.length;
    overlay.classList.toggle("hidden", !visible);
    overlay.classList.toggle("is-exiting", Boolean(this.parentalGuideExiting));
    const signature = visible ? JSON.stringify(this.parentalWarnings) : "";
    // Control visibility changes must not restart the staggered entrance.
    if (overlay.nvWarningSignature !== signature) {
      overlay.nvWarningSignature = signature;
      overlay.innerHTML = visible
        ? `<div class="nv-warning-content" style="--nv-warning-count:${this.parentalWarnings.length}"><span class="nv-warning-line" aria-hidden="true"></span><strong>${playerText(t("player_content_guidance", "Content guidance"))}</strong><small>${this.parentalWarnings.map((w, index) => `<span class="nv-warning-item" style="--nv-warning-index:${index}">${playerText(w.label)}${w.severity ? `: <span class="nv-warning-severity">${playerText(w.severity)}</span>` : ""}</span>`).join("")}</small></div>`
        : "";
    }
    return true;
  },
  renderProposalSubtitle() {
    const dialog = this.uiRefs?.subtitleDialog;
    if (!dialog) return true;
    dialog.classList.add("nv-panel");
    dialog.classList.toggle("hidden", !this.subtitleDialogVisible);
    if (!this.subtitleDialogVisible) {
      dialog.innerHTML = "";
      return true;
    }
    const body = dialog.querySelector(".nv-panel-body"),
      scroll = Number(body?.scrollTop || 0);
    if (this.proposalSubtitleStyleVisible) {
      const controls = this.getSubtitleStyleControls();
      dialog.innerHTML =
        playerPanelHead(t("player_subtitle_style_title", "Subtitle appearance"), "subtitleDialog") +
        `<div class="nv-panel-body nv-subtitle-style">${controls
          .map((item, index) => {
            const attrs = `data-subtitle-rail="style" data-subtitle-index="${index}" data-style-id="${playerText(item.id)}"`;
            const reset = item.id === "reset" || item.id === "resetDelay";
            return `<div class="nv-style-item player-dialog-style-item"><span class="nv-style-copy"><span>${playerText(item.label)}</span><small class="player-dialog-item-sub">${playerText(item.value)}</small></span><div class="nv-style-actions">${reset ? `<button type="button" class="nv-icon" data-subtitle-style-action="reset" ${attrs} aria-label="${playerText(item.label)}" ${item.disabled ? "disabled" : ""}>${playerDesignIcon("rotate-ccw")}</button>` : ["decrease", "increase"].map((action, i) => `<button type="button" class="nv-icon" data-subtitle-style-action="${action}" ${attrs} aria-label="${playerText(item.label)} ${i ? "+" : "−"}" ${item.disabled ? "disabled" : ""}>${playerDesignIcon(i ? "plus" : "minus")}</button>`).join("")}</div></div>`;
          })
          .join(
            ""
          )}<button type="button" class="nv-choice nv-subtle-action player-control-btn" data-action="proposalSubtitleBack">${playerDesignIcon("chevron-left")} ${playerText(t("player_subtitle_back", "Back to subtitles"))}</button></div>`;
      return true;
    }
    const languages = this.getSubtitleLanguageRailItems();
    const filter = languages.some((l) => l.key === this.proposalSubtitleLanguageFilter)
      ? this.proposalSubtitleLanguageFilter
      : "all";
    const options = languages
      .filter((language) => filter === "all" || language.key === filter)
      .flatMap((language) =>
        this.getSubtitleOptionsForLanguage(language.key).map((option, index) => ({
          ...option,
          index,
          languageKey: language.key,
          languageLabel: language.label
        }))
      );
    const choice = (option) =>
      playerChoice({
        label: option.languageLabel || option.title,
        secondary: [
          option.title && option.title !== option.languageLabel ? option.title : "",
          option.meta || option.secondary
        ]
          .filter(Boolean)
          .join(" · "),
        selected: Boolean(option.selected),
        attributes: `data-proposal-subtitle-language="${playerText(option.languageKey)}" data-proposal-subtitle-index="${option.index}"`,
        classes: "player-dialog-item"
      });
    const internal = options.filter((o) => o.sourceType === "internal"),
      addons = options.filter((o) => o.sourceType === "addon");
    const group = (label, items) =>
      items.length
        ? `<div class="nv-group">${playerText(label)}</div>${items.map(choice).join("")}`
        : "";
    dialog.innerHTML =
      playerPanelHead(t("player_caption_subtitle", "Subtitle"), "subtitleDialog") +
      `<div class="nv-panel-body nv-subtitle-options"><div class="nv-language-filter"><span>${playerText(t("subtitle_tab_language", "Language"))}</span><button type="button" class="nv-choice player-control-btn nv-language-anchor" data-action="proposalSubtitleLanguageToggle" aria-expanded="${Boolean(this.proposalSubtitleLanguagePickerOpen)}"><span class="nv-copy">${playerText(filter === "all" ? t("player_all_languages", "All languages") : languages.find((l) => l.key === filter)?.label)}</span>${playerDesignIcon(this.proposalSubtitleLanguagePickerOpen ? "chevron-up" : "chevron-down")}</button>${this.proposalSubtitleLanguagePickerOpen ? `<div class="nv-language-options" role="group" aria-label="${playerText(t("subtitle_tab_language", "Language"))}">${[{ key: "all", label: t("player_all_languages", "All languages") }, ...languages.filter((l) => l.key !== "__off__")].map((l) => playerChoice({ label: l.label, selected: l.key === filter, attributes: `data-action="proposalSubtitleLanguageFilter" data-proposal-subtitle-filter="${playerText(l.key)}"`, classes: "player-control-btn" })).join("")}</div>` : ""}</div>${playerChoice({ label: t("subtitle_none", "Off"), selected: this.getSelectedSubtitleLanguageKey() === "__off__", attributes: 'data-action="proposalSubtitleOff"', classes: "player-control-btn" })}${group(t("player_subtitles_inside", "Built-in"), internal)}${group(this.offlineDownloadId ? t("player_subtitles_saved", "Saved on device") : t("player_subtitles_addon", "Add-ons"), addons)}${this.subtitleLoading || this.manifestLoading || this.trackDiscoveryInProgress ? `<div class="nv-group">${playerText(t("subtitle_loading_builtin", "Loading subtitle tracks…"))}</div>` : ""}<button type="button" class="nv-choice nv-subtle-action player-control-btn" data-action="proposalSubtitleStyle"><span class="nv-copy">${playerText(t("player_subtitle_appearance_sync", "Appearance & synchronization"))}</span>${playerDesignIcon("chevron-right")}</button></div>`;
    dialog.querySelector(".nv-panel-body").scrollTop = scroll;
    return true;
  },
  renderProposalDrawerHeader(panel, { sources = false, streams = false } = {}) {
    if (!this.uiRefs?.root?.classList.contains("nv-player")) return false;
    panel.classList.add("nv-panel");
    panel.dataset.rich = "true";
    panel.classList.remove("is-entering", "is-exiting");
    const list = panel.querySelector(
      sources
        ? ".player-sources-list"
        : streams
          ? ".player-episode-stream-list"
          : ".player-episode-list"
    );
    const nested = streams && !sources;
    const title = t(
      streams || sources ? "player_caption_stream" : "player_caption_episode",
      streams || sources ? "Stream" : "Episode"
    );
    const closeAttributes = sources
      ? 'data-top-action="close" data-sources-zone="top" data-sources-index="1"'
      : 'data-episode-action="close"';
    let heading = `<header class="nv-panel-head${sources || streams ? " nv-stream-head" : ""}">${sources || streams ? `<button type="button" class="nv-stream-title" ${nested ? 'data-episode-stream-action="back"' : closeAttributes}>${playerDesignIcon("chevron-left")}<strong>${playerText(title)}</strong></button>` : `<strong>${playerText(title)}</strong>`}${sources || streams ? '<div class="nv-stream-toolbar-slot"></div>' : ""}<button type="button" class="nv-icon" ${closeAttributes} aria-label="${playerText(t("sources_close", "Close"))}">${playerDesignIcon("x")}</button></header>`;
    let content = "";
    if (sources || streams) {
      const filters = sources ? this.getSourceFilters() : this.getEpisodePanelStreamFilters(),
        selected = sources ? this.sourceFilter : this.episodePanelStreamFilter;
      const toolbar = `<div class="nv-source-toolbar">${renderFilterPicker({
        picker: sources ? "player-source" : "player-episode-source",
        title: t("stream_filter_source", "Source"),
        value: selected === "all" ? t("subtitle_all", "All") : selected,
        options: filters.map((name) => ({
          value: name,
          label: name === "all" ? t("subtitle_all", "All") : name
        })),
        selectedIndex: Math.max(0, filters.indexOf(selected)),
        focusIndex: Math.max(0, filters.indexOf(selected)),
        open: this.panelAddonPickerOpen === (sources ? "player-source" : "player-episode-source"),
        classPrefix: "nv-addon-picker",
        widthClass: "nv-source-picker",
        anchorExtraClass: "player-control-btn",
        optionExtraClass: "player-control-btn",
        anchorAction: "togglePanelAddonPicker",
        optionAction: "selectPanelAddonOption"
      })}<button type="button" class="nv-icon" ${sources ? 'data-top-action="reload" data-sources-zone="top" data-sources-index="0"' : 'data-episode-stream-action="reload"'} aria-label="${playerText(t("stream_refresh_sources", "Refresh sources"))}">${playerDesignIcon("rotate-cw")}</button></div>`;
      heading = heading.replace('<div class="nv-stream-toolbar-slot"></div>', toolbar);
    } else {
      const seasons = this.getEpisodePanelSeasons();
      const selectedIndex = Math.max(0, seasons.indexOf(Number(this.episodePanelSeason)));
      content = `<div class="nv-season-picker">${renderFilterPicker({
        picker: "player-episode-season",
        title: t("player_season", "Season"),
        value: seasons.length ? this.getEpisodePanelSeasonLabel(seasons[selectedIndex]) : "",
        options: seasons.map((season) => ({ label: this.getEpisodePanelSeasonLabel(season) })),
        classPrefix: "nv-addon-picker",
        anchorExtraClass: "player-control-btn",
        optionExtraClass: "player-control-btn",
        selectedIndex,
        focusIndex: selectedIndex,
        open: Boolean(this.episodeSeasonPickerOpen),
        anchorAction: "toggleEpisodeSeasonPicker",
        optionAction: "selectEpisodeSeasonOption"
      })}</div>`;
    }
    panel.innerHTML = heading + `<div class="nv-panel-body">${content}</div>`;
    const body = panel.querySelector(".nv-panel-body");
    if (list) body.append(list);
    return true;
  },
  renderProposalEpisodeCard(episode, index, { thumbnail, date, current, duration }) {
    return `<button type="button" class="nv-episode-card player-episode-item${current ? " selected" : ""}" data-episode-index="${index}" aria-pressed="${current}" aria-current="${current ? "true" : "false"}"><span class="player-episode-thumb-wrap">${current ? `<span class="nv-episode-current">${playerDesignIcon("play")}</span>` : ""}${thumbnail ? `<img class="player-episode-thumb" src="${playerText(thumbnail)}" alt="" loading="lazy" decoding="async" />` : '<span class="player-episode-thumb-fallback"></span>'}</span><span class="nv-episode-copy">${current ? `<span class="nv-episode-current-label">${playerText(t("sources_playing", "Playing"))}</span>` : ""}<strong>${playerText([episode.episode, episode.title || t("episodes_episode", "Episode")].filter((v) => v !== null && v !== undefined && v !== "").join(". "))}</strong><small>${playerText([date, duration].filter(Boolean).join(" · "))}</small><p>${playerText(episode.overview || episode.description || "")}</p></span></button>`;
  },
  handleProposalAction(action) {
    if (!this.uiRefs?.root?.classList.contains("nv-player")) return false;
    if (action === "airplay") {
      this.openPlayerAirPlayPicker();
      return true;
    }
    if (action === "proposalSubtitleStyle" || action === "proposalSubtitleBack") {
      this.proposalSubtitleStyleVisible = action === "proposalSubtitleStyle";
      this.renderSubtitleDialog();
      return true;
    }
    if (action === "proposalSubtitleOff") {
      this.applySubtitleEntry(
        this.getSubtitleEntries("builtIn").find((e) => e.id === "subtitle-off") || {
          trackIndex: -1
        }
      );
      return true;
    }
    if (action === "proposalDelayMinus" || action === "proposalDelayPlus") {
      this.subtitleDelayMs = Math.max(
        -10000,
        Math.min(
          10000,
          Number(this.subtitleDelayMs || 0) + (action === "proposalDelayMinus" ? -500 : 500)
        )
      );
      this.schedulePersistPlayerPresentationSettings();
      this.applySubtitlePresentationSettings();
      this.renderSubtitleDialog();
      return true;
    }
    if (action === "speed") {
      const options = this.getPlaybackSpeedOptions().filter((v) => [1, 1.25, 1.5].includes(v));
      const next = options[(options.indexOf(this.getPlaybackSpeed()) + 1) % options.length] || 1;
      void this.applyPlaybackSpeed(next).then(() => this.renderCompactBrowserMorePanel());
      return true;
    }
    if (action === "aspect") {
      this.aspectModeIndex = (this.aspectModeIndex + 1) % this.aspectModes.length;
      this.applyAspectMode({ showToast: false });
      this.renderCompactBrowserMorePanel();
      return true;
    }
    return false;
  }
};
