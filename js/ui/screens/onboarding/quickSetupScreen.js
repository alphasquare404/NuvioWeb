// One-time Quick Setup, shown once per profile after the profile is chosen.
//
// It asks only about things the app cannot work out for itself and that cost
// something to get wrong: which external player to hand playback to, whether
// progress should come back on its own, and whether the person wants the
// notification that brings them back in one tap. Add-ons and debrid are
// deliberately absent -- they need credentials and a long list, which turns a
// setup into work, and work is what makes people press Skip.
//
// Every answer starts on what the profile already has. The flow reads before it
// writes, and writes only what the person actually chose, so an existing
// profile passing through it keeps everything it had.

import { ExperienceModeStore } from "../../../data/local/experienceModeStore.js";
import { PlayerSettingsStore } from "../../../data/local/playerSettingsStore.js";
import { StreamBadgeSettingsStore } from "../../../data/local/streamBadgeSettingsStore.js";
import { REMUX_MODE, REMUX_ENDPOINT, TRANSCODE_ENDPOINT } from "../../../config.js";
import { filenameStreamDisplayMode } from "../../../core/streams/filenameStreamPolicy.js";
import { settingsStreamPreviewSources } from "../settings/playbackSettingsPresentation.js";
import {
  normalizeSourceForDisplay,
  renderBrowserSourceCardContent
} from "../../components/browserStreamSourceCard.js";
import { renderFilenamePlaybackMethodBadge } from "../../components/filenamePlaybackBadge.js";
import { quickSetupReleaseFeatures } from "./quickSetupRelease.js";
import { ProfileManager } from "../../../core/profile/profileManager.js";
import { I18n } from "../../../i18n/index.js";
import { Router } from "../../navigation/router.js";
import { ScreenUtils } from "../../navigation/screen.js";
import {
  getBrowserExternalPlayerCapabilities,
  getBrowserExternalPlayerOptions,
  getBrowserExternalPlayerPlatform,
  getBrowserExternalPlayerStoreUrl,
  normalizeBrowserExternalPlayer
} from "../../components/browserExternalPlayer.js";
import {
  enableBrowserPushReturn,
  getBrowserPushReturnState
} from "../../components/browserPushReturn.js";
import {
  copyAutomationShortcutTarget,
  getAutomationReturnAvailability,
  openAutomationShortcut,
  openAutomationTutorial,
  renderAutomationReturnGuide
} from "../../components/browserAutomationReturn.js";
import { selectQuickSetupSteps, selectReturnMethodsOffered } from "./quickSetupSteps.js";

function t(key, params = {}, fallback = key) {
  return I18n.t(key, params, { fallback });
}

function escapeHtml(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const PLAYER_LABELS = {
  lenna: "Lenna",
  outplayer: "Outplayer",
  infuse: "Infuse",
  vlc: "VLC"
};

function playerLabel(id) {
  return PLAYER_LABELS[id] || t("quick_setup_player_builtin", {}, "Nuvio's own player");
}

// The button says where it goes before it is pressed. The Apple mark on iOS,
// where the link is the App Store; everywhere else the store is a different
// place and would be a different mark, so the plain download arrow stands in
// rather than the button going out bare.
function storeMark(platform) {
  const path =
    platform === "ios"
      ? "M16.37 1.43c.02 1.2-.44 2.29-1.2 3.09-.82.87-2.18 1.55-3.3 1.46-.14-1.15.43-2.35 1.17-3.1.83-.85 2.27-1.48 3.33-1.45zM20.9 17.2c-.57 1.3-.85 1.88-1.58 3.03-1.02 1.6-2.46 3.59-4.25 3.6-1.59.02-2-1.03-4.15-1.02-2.15.01-2.6 1.04-4.19 1.03-1.79-.02-3.15-1.81-4.17-3.41-2.85-4.5-3.15-9.77-1.39-12.57 1.25-1.99 3.22-3.16 5.07-3.16 1.89 0 3.08 1.04 4.64 1.04 1.52 0 2.44-1.04 4.62-1.04 1.65 0 3.4.9 4.65 2.45-4.09 2.24-3.43 8.08.75 10.05z"
      : "M12 3a1 1 0 0 1 1 1v9.59l3.3-3.3a1 1 0 0 1 1.4 1.42l-5 5a1 1 0 0 1-1.4 0l-5-5a1 1 0 1 1 1.4-1.42l3.3 3.3V4a1 1 0 0 1 1-1zM4 19a1 1 0 0 1 1-1h14a1 1 0 0 1 0 2H5a1 1 0 0 1-1-1z";
  return `
    <svg class="quick-setup-store-mark" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path fill="currentColor" d="${path}" />
    </svg>`;
}

export const QuickSetupScreen = {
  async mount() {
    this.container = document.getElementById("quickSetup");
    if (!this.container) return;

    const settings = PlayerSettingsStore.get();
    this.platform = getBrowserExternalPlayerPlatform();
    const offered = getBrowserExternalPlayerOptions();
    const stored = normalizeBrowserExternalPlayer(settings.browserExternalPlayer);
    // The stored player may be one this platform cannot offer -- the default is
    // Lenna, which exists on iOS and nowhere else -- and a choice nobody can see
    // would leave the step looking like nothing is chosen.
    this.player = offered.includes(stored) ? stored : offered[0] || "disabled";
    this.progressMode = settings.externalPlayerProgress === "manual" ? "manual" : "automatic";
    this.offlineSync = settings.syncOfflineProgress === true;
    this.returnMethod = settings.externalReturnMethod;
    this.initialPlayer = stored;
    this.initialProgressMode = this.progressMode;
    this.initialOfflineSync = this.offlineSync;
    this.initialReturnMethod = this.returnMethod;
    this.automationAvailability = getAutomationReturnAvailability();
    this.includeReleaseIntro = ExperienceModeStore.get().quickSetupVersion > 0;
    this.labels = StreamBadgeSettingsStore.get().showPlaybackLabels !== false;
    this.filenameRouting = settings.filenamePlaybackRoutingEnabled !== false;
    this.streamFilter = filenameStreamDisplayMode(settings);
    this.initialLabels = this.labels;
    this.initialFilenameRouting = this.filenameRouting;
    this.initialStreamFilter = this.streamFilter;
    this.releaseFeatures = quickSetupReleaseFeatures({
      mode: REMUX_MODE,
      remuxEndpoint: REMUX_ENDPOINT,
      transcodeEndpoint: TRANSCODE_ENDPOINT
    });

    // Asking about a notification the browser cannot deliver is a step that
    // wastes the one thing this flow is spending: attention.
    this.pushState = await getBrowserPushReturnState().catch(() => ({ state: "unavailable" }));
    this.stepIndex = 0;

    ScreenUtils.show(this.container);
    this.onClickBound = this.onClick.bind(this);
    this.container.addEventListener("click", this.onClickBound);
    this.onChangeBound = this.onChange.bind(this);
    this.container.addEventListener("change", this.onChangeBound);
    this.render();
  },

  // Which steps this profile actually gets. The progress question only makes
  // sense once a player that can report progress has been chosen, and the
  // notification question only where notifications are possible at all.
  steps() {
    const capabilities = getBrowserExternalPlayerCapabilities(this.player);
    return selectQuickSetupSteps({
      callbackMode: capabilities.callbackMode,
      automaticProgress: capabilities.automaticProgress,
      pushState: this.pushState?.state,
      automationAvailability: this.automationAvailability,
      progressMode: this.progressMode,
      internalProcessing: true,
      includeReleaseIntro: this.includeReleaseIntro
    });
  },

  returnMethodsOffered() {
    return selectReturnMethodsOffered({
      pushState: this.pushState?.state,
      automationAvailability: this.automationAvailability,
      progressMode: this.progressMode
    });
  },

  currentStep() {
    const steps = this.steps();
    return steps[Math.min(this.stepIndex, steps.length - 1)] || "player";
  },

  render() {
    const steps = this.steps();
    const step = this.currentStep();
    const position = Math.min(this.stepIndex, steps.length - 1);
    const isLast = position >= steps.length - 1;
    const isRelease = step === "release";

    this.container.innerHTML = `
      <main class="quick-setup-screen">
        <header class="quick-setup-header">
          <img class="quick-setup-logo" src="assets/brand/app_logo_wordmark.png" alt="Nuvio" />
          <p class="quick-setup-progress-label">${escapeHtml(
            t(
              "quick_setup_step_of",
              { current: position + 1, total: steps.length },
              "Step {{current}} of {{total}}"
            )
          )}</p>
        </header>
        <section class="quick-setup-body">${this.renderStep(step)}</section>
        ${
          isRelease
            ? ""
            : `<p class="quick-setup-footnote">${escapeHtml(
                t(
                  "quick_setup_change_later",
                  {},
                  "Nothing here is final — all of these are in Settings, under Playback or Downloads."
                )
              )}</p>`
        }
        <footer class="quick-setup-actions${isRelease ? " quick-setup-release-actions" : ""}">
          <button class="quick-setup-skip focusable" type="button" data-action="skip">${escapeHtml(
            isRelease
              ? t("quick_setup_keep_settings", {}, "Keep my settings")
              : t("quick_setup_skip", {}, "Skip setup")
          )}</button>
          <div class="quick-setup-actions-end">
            ${
              position > 0
                ? `<button class="quick-setup-back focusable" type="button" data-action="back">${escapeHtml(
                    t("quick_setup_back", {}, "Back")
                  )}</button>`
                : ""
            }
            <button class="quick-setup-next focusable" type="button" data-action="${isLast ? "finish" : "next"}">${escapeHtml(
              isRelease
                ? t("quick_setup_review_settings", {}, "Review my settings")
                : isLast
                  ? t("quick_setup_finish", {}, "Done")
                  : t("quick_setup_next", {}, "Next")
            )}</button>
          </div>
        </footer>
      </main>`;

    ScreenUtils.indexFocusables(this.container);
    ScreenUtils.setInitialFocus(this.container);
  },

  renderStep(step) {
    if (step === "release") return this.renderReleaseStep();
    if (step === "processing") return this.renderProcessingStep();
    if (step === "offlineSync") return this.renderOfflineSyncStep();
    if (step === "progress") return this.renderProgressStep();
    if (step === "return") return this.renderReturnStep();
    return this.renderPlayerStep();
  },

  renderPlayerStep() {
    const options = getBrowserExternalPlayerOptions();
    const note =
      this.platform === "ios"
        ? `<p class="quick-setup-note">${escapeHtml(
            t(
              "quick_setup_player_ios_note",
              {},
              "On iPhone and iPad an external player is recommended: it plays what the browser cannot. Lenna is the pick because it has a built-in subtitle search."
            )
          )}</p>`
        : "";

    const cards = options
      .map((id) => {
        const selected = id === this.player;
        const store =
          id === "disabled"
            ? ""
            : getBrowserExternalPlayerStoreUrl({ player: id, platform: this.platform });
        return `
          <div class="quick-setup-option${selected ? " is-selected" : ""}">
            <button class="quick-setup-option-choose focusable" type="button"
                    data-action="choosePlayer" data-player="${escapeHtml(id)}"
                    aria-pressed="${selected ? "true" : "false"}">
              <span class="quick-setup-option-label">${escapeHtml(playerLabel(id))}</span>
              ${
                id === "lenna"
                  ? `<span class="quick-setup-badge">${escapeHtml(t("quick_setup_player_recommended", {}, "Recommended"))}</span>`
                  : ""
              }
            </button>
            ${
              store
                ? `<button class="quick-setup-option-get focusable" type="button"
                           data-action="getPlayer" data-player="${escapeHtml(id)}">${storeMark(
                             this.platform
                           )}<span>${escapeHtml(t("quick_setup_player_get", {}, "Get"))}</span></button>`
                : ""
            }
          </div>`;
      })
      .join("");

    return `
      <h1>${escapeHtml(t("quick_setup_player_title", {}, "Choose a player"))}</h1>
      <p>${escapeHtml(
        t(
          "quick_setup_player_body",
          {},
          "Nuvio can play here, or hand the stream to another app on your device."
        )
      )}</p>
      ${note}
      <div class="quick-setup-options">${cards}</div>
      ${this.player === "disabled" ? this.renderReleaseCapabilities() : ""}`;
  },

  renderReleaseCapabilities() {
    const features = this.releaseFeatures;
    const remux = features.remuxProvider
      ? `<section class="quick-setup-feature"><h2>Remux</h2><p>${escapeHtml(
          t(
            features.client ? "quick_setup_client_remux" : "quick_setup_server_remux",
            {},
            features.client
              ? "Powered by Mediabunny, compatible streams are repackaged on your device without changing the video quality."
              : "Powered by Jellyfin FFmpeg, compatible streams are repackaged on the server without changing the video quality."
          )
        )}</p></section>`
      : "";
    const audio = features.audioTranscoding
      ? `<section class="quick-setup-feature"><h2>${escapeHtml(t("quick_setup_audio_transcoding_title", {}, "Audio transcoding"))}</h2><p>${escapeHtml(t("quick_setup_audio_transcoding", {}, "Unsupported audio can be converted automatically while preserving the original video quality."))}</p></section>`
      : "";
    const warning = features.client
      ? t(
          "quick_setup_client_limitations",
          {},
          "Transcoding is not supported in client mode. Your device must support the original video and audio codecs."
        )
      : features.audioTranscoding
        ? t(
            "quick_setup_server_limitations",
            {},
            "Full video transcoding is not supported. Audio conversion cannot make an unsupported video codec playable."
          )
        : features.remuxProvider
          ? t(
              "quick_setup_no_audio_transcoding",
              {},
              "Audio transcoding is disabled on this host. Full video transcoding is not supported."
            )
          : t(
              "quick_setup_no_processing",
              {},
              "Remux and transcoding are not available on this host. Streams must use formats supported by your device."
            );
    return `<div class="quick-setup-features">${remux}${audio}<p class="quick-setup-note"><strong>${escapeHtml(t("quick_setup_limitations", {}, "Current limitations"))}</strong><br>${escapeHtml(warning)}</p></div>`;
  },

  renderReleaseStep() {
    return `<h1>${escapeHtml(t("quick_setup_release_title", {}, "New in v0.2.1"))}</h1>
      <h2 class="quick-setup-release-heading">${escapeHtml(t("quick_setup_release_heading", {}, "More ways to watch, right here."))}</h2>
      <p>${escapeHtml(
        this.releaseFeatures.remuxProvider || this.releaseFeatures.audioTranscoding
          ? t(
              "quick_setup_release_body",
              {},
              "The internal player now supports more stream formats, so you can watch more without switching apps."
            )
          : t(
              "quick_setup_release_body_unassisted",
              {},
              "Review how streams are labelled, played, and filtered without changing your existing preferences."
            )
      )}</p>
      ${this.renderReleaseCapabilities()}
      ${this.renderWhatsNew()}
      <p class="quick-setup-existing-settings">${escapeHtml(t("quick_setup_existing_settings", {}, "Your existing settings are preserved. You can keep them or review your playback preferences."))}</p>`;
  },

  renderWhatsNew() {
    const features = this.releaseFeatures;
    const groups = [
      [
        t("quick_setup_changes_new", {}, "New"),
        [
          features.remuxProvider
            ? t(
                "quick_setup_changes_remux",
                {},
                "Internal player remux — Play more compatible formats without re-encoding the video."
              )
            : null,
          features.audioTranscoding
            ? t(
                "quick_setup_changes_audio",
                {},
                "Audio transcoding — Convert unsupported audio while preserving the original video."
              )
            : null,
          t(
            "quick_setup_changes_airplay",
            {},
            "AirPlay — Send the original stream to a compatible AirPlay device on supported devices."
          ),
          t(
            "quick_setup_changes_processing",
            {},
            "Stream processing controls — Choose playback labels, filename-based processing, and stream filters."
          ),
          t(
            "quick_setup_changes_colors",
            {},
            "Custom accent colors — Pick your own color in Appearance."
          ),
          t(
            "quick_setup_changes_mdblist",
            {},
            "MDBList integration — Connect your account and sync your library."
          )
        ]
      ],
      [
        t("quick_setup_changes_fix", {}, "Fix"),
        [
          t(
            "quick_setup_changes_autoplay",
            {},
            "Autoplay waits for eligible sources and reuses the last successfully played link."
          ),
          t(
            "quick_setup_changes_cw",
            {},
            "Continue Watching updates sooner, including completed episodes and Next Up."
          ),
          t(
            "quick_setup_changes_tracks",
            {},
            "Improved audio-track selection and built-in subtitle handling."
          ),
          t("quick_setup_changes_collections", {}, "Fixed Collection pages failing to open."),
          t(
            "quick_setup_changes_touch",
            {},
            "Fixed stream context menus and unwanted text selection when holding media cards."
          ),
          t(
            "quick_setup_changes_panels",
            {},
            "Fixed player controls, dropdown orientation, and overlapping panels on smaller screens."
          )
        ]
      ],
      [
        t("quick_setup_changes_change", {}, "Change"),
        [
          t(
            "quick_setup_changes_player",
            {},
            "Redesigned player controls, episode lists, and stream panels."
          ),
          t("quick_setup_changes_screens", {}, "Updated loading and pause screens."),
          t(
            "quick_setup_changes_settings",
            {},
            "Settings use connected panels on larger screens and separate navigation on smaller screens."
          ),
          features.remuxProvider
            ? t("quick_setup_changes_buffer", {}, "Increased remux buffering limits.")
            : null,
          t(
            "quick_setup_changes_downloads",
            {},
            "Downloads save richer metadata and artwork without requiring a visit to Details first."
          ),
          t(
            "quick_setup_changes_onboarding",
            {},
            "Updated onboarding preserves existing player and offline-sync preferences."
          )
        ]
      ]
    ];
    return `<details class="quick-setup-whats-new"><summary class="focusable">${escapeHtml(t("quick_setup_whats_new", {}, "What's new"))}</summary><div class="quick-setup-changes">${groups
      .map(
        ([title, entries]) =>
          `<section><h3>${escapeHtml(title)}</h3><ul>${entries
            .filter(Boolean)
            .map((entry) => `<li>${escapeHtml(entry)}</li>`)
            .join("")}</ul></section>`
      )
      .join("")}</div></details>`;
  },

  renderProcessingStep() {
    const field = (id, title, body, checked) =>
      `<label class="quick-setup-processing-field"><span><strong>${escapeHtml(title)}</strong><small>${escapeHtml(body)}</small></span><input type="checkbox" class="focusable" data-processing-field="${id}" ${checked ? "checked" : ""} /></label>`;
    return `<h1>${escapeHtml(t("quick_setup_processing_title", {}, "Stream processing"))}</h1>
      <p>${escapeHtml(t("quick_setup_processing_body", {}, "Choose how streams are labelled, opened, and filtered."))}</p>
      <div class="quick-setup-processing-fields">
        ${field("labels", t("quick_setup_labels", {}, "Labels"), t("quick_setup_labels_body", {}, "Show Direct, Remux, Transcoding, or Unknown estimates on stream cards."), this.labels)}
        ${field("filenameRouting", t("settings_filename_route_title", {}, "Determine stream processing based on filename"), t("settings_filename_route_short", {}, "Estimate how to play the stream from its filename. If playback fails, another supported method is tried automatically."), this.filenameRouting)}
        <label class="quick-setup-processing-field"><span><strong>${escapeHtml(t("quick_setup_filter", {}, "Stream filter"))}</strong><small>${escapeHtml(t("settings_filename_filter_short", {}, "Filename estimates. Also applies to autoplay and next episodes."))}</small></span><select class="focusable" data-processing-field="streamFilter">${[
          ["ALL", "All streams"],
          ["DIRECT", "Direct"],
          ["DIRECT_REMUX", "Direct + Remux"]
        ]
          .map(
            ([value, label]) =>
              `<option value="${value}" ${this.streamFilter === value ? "selected" : ""}>${escapeHtml(label)}</option>`
          )
          .join("")}</select></label>
      </div>
      ${this.renderStreamPreview()}
      <p class="quick-setup-preview-note">${escapeHtml(t("quick_setup_filter_warning", {}, "Filename estimates are not compatibility checks. Incorrect filenames can hide playable streams, including Unknown results."))}</p>`;
  },

  renderStreamPreview() {
    const badgeSettings = {
      ...StreamBadgeSettingsStore.snapshot(),
      showPlaybackLabels: this.labels
    };
    const cards = settingsStreamPreviewSources(this.streamFilter)
      .map((source) => {
        const display = normalizeSourceForDisplay(source, {
          badgeSettings: { ...badgeSettings, showPlaybackLabels: false }
        });
        const label = renderFilenamePlaybackMethodBadge(source.previewMethod, badgeSettings);
        if (label)
          display.badges = display.badges
            ? display.badges.replace(">", `>${label}`)
            : `<div class="stream-route-card-badges">${label}</div>`;
        const top = badgeSettings.badgePlacement === "TOP";
        display.topBadges = top ? display.badges : "";
        display.bottomBadges = top ? "" : display.badges;
        return `<div class="stream-route-card-row"><article class="stream-route-card stream-route-card-action" data-preview-source="${source.id}">${renderBrowserSourceCardContent(display)}<div class="stream-route-offline-actions"><span class="stream-route-offline-action download" aria-hidden="true">↓</span></div></article></div>`;
      })
      .join("");
    return `<section class="quick-setup-stream-preview" aria-label="${escapeHtml(t("settings_preview_streams", {}, "Stream card preview"))}"><h2>${escapeHtml(t("settings_preview_streams", {}, "Stream card preview"))}</h2><p class="quick-setup-preview-note">${escapeHtml(t("quick_setup_preview_note", {}, "Example filenames only. No stream is fetched or checked."))}</p>${cards}</section>`;
  },

  onChange(event) {
    const field = event.target.dataset.processingField;
    if (!["labels", "filenameRouting", "streamFilter"].includes(field)) return;
    if (field === "streamFilter") {
      if (!["ALL", "DIRECT", "DIRECT_REMUX"].includes(event.target.value)) return;
      this.streamFilter = event.target.value;
    } else this[field] = event.target.checked;
    this.render();
    this.container.querySelector(`[data-processing-field="${field}"]`)?.focus();
  },

  // A figure belongs to the answer it illustrates, so each one lives inside its
  // own card rather than above both, where it looked like it described the
  // question.
  renderFigure({ src, alt, caption = "" }) {
    return `
      <figure class="quick-setup-figure">
        <img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}" />
        ${caption ? `<figcaption>${escapeHtml(caption)}</figcaption>` : ""}
      </figure>`;
  },

  renderProgressStep() {
    const modes = [
      {
        id: "automatic",
        label: t("quick_setup_progress_automatic", {}, "Automatic"),
        body: t(
          "quick_setup_progress_automatic_body",
          {},
          "The external player reports where you stopped, and Nuvio picks it up when you come back."
        ),
        recommended: true,
        detail: this.renderFigure({
          src: "assets/images/quick-setup-external-player-close.jpg",
          alt: t(
            "quick_setup_progress_image_alt",
            {},
            "The Close button in the external player's control bar"
          ),
          caption: t(
            "quick_setup_progress_close_warning",
            {},
            "Close the external player with this button when you finish watching. Swiping it away from the app switcher sends nothing back, and you will have to enter your progress by hand."
          )
        })
      },
      {
        id: "manual",
        label: t("quick_setup_progress_manual", {}, "Manual"),
        body: t(
          "quick_setup_progress_manual_body",
          {},
          "Nuvio asks you where you stopped each time."
        ),
        recommended: false,
        detail: `
          <p class="quick-setup-option-caption">${escapeHtml(
            t(
              "quick_setup_progress_manual_caption",
              {},
              "Coming back from the external player, Nuvio asks how it went. Setting a position opens a second prompt where you type it in."
            )
          )}</p>
          ${this.renderFigure({
            src: "assets/images/quick-setup-manual-outcome.jpg",
            alt: t(
              "quick_setup_progress_manual_outcome_alt",
              {},
              "The prompt asking how your playback went, with Keep current progress, Set playback position and Mark as finished"
            )
          })}
          ${this.renderFigure({
            src: "assets/images/quick-setup-manual-position.jpg",
            alt: t(
              "quick_setup_progress_manual_position_alt",
              {},
              "The prompt for typing a playback position in hours, minutes and seconds"
            )
          })}`
      }
    ];

    const cards = modes
      .map((mode) => {
        const selected = mode.id === this.progressMode;
        return `
        <div class="quick-setup-option${selected ? " is-selected has-detail" : ""}">
          <button class="quick-setup-option-choose focusable" type="button"
                  data-action="chooseProgress" data-mode="${escapeHtml(mode.id)}"
                  aria-pressed="${selected ? "true" : "false"}">
            <span class="quick-setup-option-label">${escapeHtml(mode.label)}</span>
            ${
              mode.recommended
                ? `<span class="quick-setup-badge">${escapeHtml(t("quick_setup_player_recommended", {}, "Recommended"))}</span>`
                : ""
            }
            <span class="quick-setup-option-body">${escapeHtml(mode.body)}</span>
          </button>
          ${selected ? this.renderOptionDetail(mode) : ""}
        </div>`;
      })
      .join("");

    return `
      <h1>${escapeHtml(t("quick_setup_progress_title", {}, "Bringing progress back"))}</h1>
      <p>${escapeHtml(
        t(
          "quick_setup_progress_body",
          {},
          "Automatic only works if you leave the external player by its own Close button."
        )
      )}</p>
      <div class="quick-setup-options">${cards}</div>`;
  },

  renderOfflineSyncStep() {
    const modes = [
      {
        id: "off",
        label: t("quick_setup_offline_sync_off", {}, "Watch and forget"),
        body: t(
          "quick_setup_offline_sync_off_body",
          {},
          "Nothing is recorded while you watch a download: not your position, not that you finished it, and nothing reaches your account or tracking service."
        ),
        badge: t("quick_setup_offline_sync_default", {}, "Default")
      },
      {
        id: "on",
        label: t("quick_setup_offline_sync_on", {}, "Keep track of it"),
        body: t(
          "quick_setup_offline_sync_on_body",
          {},
          "A download is treated like any other playback. Your position is saved and carried up to your account and tracking service."
        ),
        badge: t("quick_setup_offline_sync_experimental", {}, "Experimental"),
        caution: t(
          "quick_setup_offline_sync_caution",
          {},
          "Experimental. It still has plenty of bugs: positions can disagree between devices, and viewing can go missing. A tracking service is told the position but not when you watched it, so an offline session reaches Trakt or Simkl stamped with the time it arrived."
        )
      }
    ];

    const selected = this.offlineSync ? "on" : "off";
    const cards = modes
      .map(
        (mode) => `
        <div class="quick-setup-option${mode.id === selected ? " is-selected" : ""}${
          mode.caution ? " is-caution" : ""
        }">
          <button class="quick-setup-option-choose focusable" type="button"
                  data-action="chooseOfflineSync" data-mode="${escapeHtml(mode.id)}"
                  aria-pressed="${mode.id === selected ? "true" : "false"}">
            <span class="quick-setup-option-label">${escapeHtml(mode.label)}</span>
            ${
              mode.badge
                ? `<span class="quick-setup-badge ${
                    mode.caution ? "is-caution" : "is-neutral"
                  }">${escapeHtml(mode.badge)}</span>`
                : ""
            }
            <span class="quick-setup-option-body">${escapeHtml(mode.body)}</span>
            ${
              mode.caution
                ? `<span class="quick-setup-option-caution">${escapeHtml(mode.caution)}</span>`
                : ""
            }
          </button>
        </div>`
      )
      .join("");

    return `
      <h1>${escapeHtml(t("quick_setup_offline_sync_title", {}, "Downloads and progress"))}</h1>
      <p>${escapeHtml(
        t(
          "quick_setup_offline_sync_body",
          {},
          "A download plays with no network. Nuvio can either keep track of where you are in it, or leave it alone completely."
        )
      )}</p>
      <p class="quick-setup-note">${escapeHtml(
        t(
          "quick_setup_offline_sync_warning",
          {},
          "Keeping track is experimental and still has plenty of bugs. When another device watched the same title while this one was offline, the two can disagree about which position is newer, and the wrong one can win. That is why it starts off."
        )
      )}</p>
      <div class="quick-setup-options">${cards}</div>`;
  },

  // The notification body, kept exactly as it was: the browser offers its
  // permission once per origin, and a refusal stands until the person undoes it
  // in site settings, so asking again would be a button that does nothing.
  renderNotificationBody() {
    const state = this.pushState?.state;
    if (state === "enabled") {
      return `<p class="quick-setup-status is-done">${escapeHtml(
        t("quick_setup_notifications_enabled", {}, "Notifications are on.")
      )}</p>`;
    }
    if (state === "blocked") {
      return `<p class="quick-setup-status">${escapeHtml(
        t(
          "quick_setup_notifications_blocked",
          {},
          "Notifications are blocked for Nuvio. You can turn them back on in your browser's site settings."
        )
      )}</p>`;
    }
    return `<button class="quick-setup-enable focusable" type="button" data-action="enableNotifications">${escapeHtml(
      t("quick_setup_notifications_enable", {}, "Enable notifications")
    )}</button>`;
  },

  // A chosen card shows what it is. A card whose detail is a tutorial -- a
  // page of numbered steps with pictures -- shows a button instead, and the
  // tutorial only when it is asked for, so choosing the option does not bury
  // the button that continues past it.
  renderOptionDetail(mode) {
    if (!mode?.detailCollapsed) {
      return `<div class="quick-setup-option-detail">${mode?.detail || ""}</div>`;
    }
    return `<div class="quick-setup-option-detail">
      <details class="quick-setup-steps">
        <summary class="quick-setup-steps-toggle focusable">${escapeHtml(
          t("quick_setup_show_steps", {}, "Show the steps")
        )}</summary>
        <div class="quick-setup-steps-body">${mode.detail}</div>
      </details>
    </div>`;
  },

  renderReturnStep() {
    const offered = this.returnMethodsOffered();
    const modes = [];
    // The Automation goes first where it exists: it is the recommendation, and
    // on iOS it is also the one that works without a relay or a permission.
    if (offered.includes("automation")) {
      const needsInstall = this.automationAvailability === "needs-install";
      modes.push({
        id: "automation",
        label: t("quick_setup_return_automation", {}, "A Shortcut automation"),
        body: t(
          "quick_setup_return_automation_body",
          {},
          "Closing the external player is the only tap. iOS opens Nuvio from there by itself, with no notification to find."
        ),
        badge: needsInstall
          ? t("quick_setup_return_needs_install_badge", {}, "Needs installing")
          : t("quick_setup_return_recommended", {}, "Recommended on iPhone"),
        // A recommendation wears the accent the person chose in Appearance, the
        // way the player step's does. Only the unmet precondition stays grey.
        badgeNeutral: needsInstall,
        // The guide is a page of steps with pictures. Choosing this option
        // should say what it is, not bury the next button under a tutorial
        // nobody has asked for yet.
        detailCollapsed: true,
        detail: renderAutomationReturnGuide({ availability: this.automationAvailability })
      });
    }
    if (offered.includes("notification")) {
      modes.push({
        id: "notification",
        label: t("quick_setup_return_notification", {}, "A notification"),
        body: t(
          "quick_setup_return_notification_body",
          {},
          "Nuvio sends one notification when the player reports back. Tapping it brings you straight here."
        ),
        detail: `${this.renderFigure({
          src: "assets/images/quick-setup-return-notification.jpg",
          alt: t(
            "quick_setup_return_notification_image_alt",
            {},
            "A NuvioWeb notification saying playback was updated, with a prompt to tap it to return"
          )
        })}${this.renderNotificationBody()}`
      });
    }

    const cards = modes
      .map((mode) => {
        const selected = mode.id === this.returnMethod;
        return `
        <div class="quick-setup-option${selected ? " is-selected has-detail" : ""}">
          <button class="quick-setup-option-choose focusable" type="button"
                  data-action="chooseReturnMethod" data-mode="${escapeHtml(mode.id)}"
                  aria-pressed="${selected ? "true" : "false"}">
            <span class="quick-setup-option-label">${escapeHtml(mode.label)}</span>
            ${
              mode.badge
                ? `<span class="quick-setup-badge${mode.badgeNeutral ? " is-neutral" : ""}">${escapeHtml(mode.badge)}</span>`
                : ""
            }
            <span class="quick-setup-option-body">${escapeHtml(mode.body)}</span>
          </button>
          ${selected ? this.renderOptionDetail(mode) : ""}
        </div>`;
      })
      .join("");

    const body =
      modes.length > 1
        ? t(
            "quick_setup_return_body",
            {},
            "An external player leaves you in the player. Nuvio can bring you back one of two ways — pick the one you will actually set up."
          )
        : t(
            "quick_setup_return_body_single",
            {},
            "An external player leaves you in the player. This is the way back this device can offer."
          );

    return `
      <h1>${escapeHtml(t("quick_setup_return_title", {}, "Getting back here"))}</h1>
      <p>${escapeHtml(body)}</p>
      <p class="quick-setup-note">${escapeHtml(
        t(
          "quick_setup_return_callback_note",
          {},
          "Either way, closing the player opens a page in your default browser confirming your progress arrived. It closes itself a moment later and needs nothing from you. It only stays open if something went wrong, and then it says what."
        )
      )}</p>
      <div class="quick-setup-options">${cards}</div>`;
  },

  async onClick(event) {
    const node = event.target.closest?.("[data-action]");
    if (!node || !this.container.contains(node)) return;
    event.preventDefault();
    const action = node.dataset.action;

    if (action === "choosePlayer") {
      this.player = normalizeBrowserExternalPlayer(node.dataset.player);
      this.render();
      return;
    }
    if (action === "getPlayer") {
      const url = getBrowserExternalPlayerStoreUrl({
        player: normalizeBrowserExternalPlayer(node.dataset.player),
        platform: this.platform
      });
      if (url) globalThis.open?.(url, "_blank", "noopener");
      return;
    }
    if (action === "chooseProgress") {
      this.progressMode = node.dataset.mode === "manual" ? "manual" : "automatic";
      if (this.progressMode === "manual" && this.returnMethod === "notification") {
        this.returnMethod = "";
      }
      this.render();
      return;
    }
    if (action === "chooseOfflineSync") {
      this.offlineSync = node.dataset.mode === "on";
      this.render();
      return;
    }
    if (action === "chooseReturnMethod") {
      this.returnMethod = node.dataset.mode === "automation" ? "automation" : "notification";
      this.render();
      return;
    }
    if (action === "addReturnShortcut") {
      openAutomationShortcut();
      return;
    }
    if (action === "copyReturnShortcutTarget") {
      // The address stays on screen, so a clipboard the browser will not give
      // us costs a tap rather than the step.
      const copied = await copyAutomationShortcutTarget();
      node.textContent = copied
        ? t("automation_return_copied", {}, "Copied")
        : t("automation_return_copy_address", {}, "Copy");
      return;
    }
    if (action === "openReturnTutorial") {
      openAutomationTutorial();
      return;
    }
    if (action === "enableNotifications") {
      node.disabled = true;
      this.pushState = await enableBrowserPushReturn().catch(() => this.pushState);
      this.render();
      return;
    }
    if (action === "back") {
      this.stepIndex = Math.max(0, this.stepIndex - 1);
      this.render();
      return;
    }
    if (action === "next") {
      this.commitStep(this.currentStep());
      this.stepIndex = Math.min(this.steps().length - 1, this.stepIndex + 1);
      this.render();
      return;
    }
    if (action === "finish") {
      this.commitStep(this.currentStep());
      await this.finish();
      return;
    }
    if (action === "skip") {
      await this.finish();
    }
  },

  // Only a value the person actually changed is written. Passing through the
  // flow without touching anything leaves the profile exactly as it was, which
  // is what makes it safe to show to someone who is already set up.
  commitStep(step) {
    if (step === "processing") {
      if (this.labels !== this.initialLabels) {
        StreamBadgeSettingsStore.set({ showPlaybackLabels: this.labels });
        this.initialLabels = this.labels;
      }
      const changes = {};
      if (this.filenameRouting !== this.initialFilenameRouting)
        changes.filenamePlaybackRoutingEnabled = this.filenameRouting;
      if (this.streamFilter !== this.initialStreamFilter)
        changes.filenameStreamDisplayMode = this.streamFilter;
      if (Object.keys(changes).length) PlayerSettingsStore.set(changes);
      this.initialFilenameRouting = this.filenameRouting;
      this.initialStreamFilter = this.streamFilter;
    }
    if (step === "player" && this.player !== this.initialPlayer) {
      PlayerSettingsStore.set({ browserExternalPlayer: this.player });
      this.initialPlayer = this.player;
    }
    if (step === "progress" && this.progressMode !== this.initialProgressMode) {
      PlayerSettingsStore.set({ externalPlayerProgress: this.progressMode });
      this.initialProgressMode = this.progressMode;
    }
    if (step === "offlineSync" && this.offlineSync !== this.initialOfflineSync) {
      PlayerSettingsStore.set({ syncOfflineProgress: this.offlineSync });
      this.initialOfflineSync = this.offlineSync;
    }
    if (step === "return" && this.returnMethod !== this.initialReturnMethod) {
      PlayerSettingsStore.set({ externalReturnMethod: this.returnMethod });
      this.initialReturnMethod = this.returnMethod;
    }
  },

  async finish() {
    ExperienceModeStore.markQuickSetupSeen(ProfileManager.getActiveProfileId());
    await Router.navigate("home", {}, { replaceHistory: true, skipStackPush: true });
  },

  consumeBackRequest() {
    if (this.stepIndex > 0) {
      this.stepIndex -= 1;
      this.render();
      return true;
    }
    return false;
  },

  cleanup() {
    this.container?.removeEventListener("click", this.onClickBound);
    this.container?.removeEventListener("change", this.onChangeBound);
    ScreenUtils.hide(this.container);
  }
};
