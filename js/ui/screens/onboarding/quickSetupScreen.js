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
    this.initialPlayer = this.player;
    this.initialProgressMode = this.progressMode;
    this.initialOfflineSync = this.offlineSync;

    // Asking about a notification the browser cannot deliver is a step that
    // wastes the one thing this flow is spending: attention.
    this.pushState = await getBrowserPushReturnState().catch(() => ({ state: "unavailable" }));
    this.stepIndex = 0;

    ScreenUtils.show(this.container);
    this.onClickBound = this.onClick.bind(this);
    this.container.addEventListener("click", this.onClickBound);
    this.render();
  },

  // Which steps this profile actually gets. The progress question only makes
  // sense once a player that can report progress has been chosen, and the
  // notification question only where notifications are possible at all.
  steps() {
    const steps = ["player"];
    if (getBrowserExternalPlayerCapabilities(this.player).automaticProgress) {
      steps.push("progress");
    }
    if (["not-enabled", "enabled", "blocked"].includes(this.pushState?.state)) {
      steps.push("notifications");
    }
    steps.push("offlineSync");
    return steps;
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
        <p class="quick-setup-footnote">${escapeHtml(
          t(
            "quick_setup_change_later",
            {},
            "Nothing here is final — all of these are in Settings, under Playback or Downloads."
          )
        )}</p>
        <footer class="quick-setup-actions">
          <button class="quick-setup-skip focusable" type="button" data-action="skip">${escapeHtml(
            t("quick_setup_skip", {}, "Skip setup")
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
              isLast ? t("quick_setup_finish", {}, "Done") : t("quick_setup_next", {}, "Next")
            )}</button>
          </div>
        </footer>
      </main>`;

    ScreenUtils.indexFocusables(this.container);
    ScreenUtils.setInitialFocus(this.container);
  },

  renderStep(step) {
    if (step === "offlineSync") return this.renderOfflineSyncStep();
    if (step === "progress") return this.renderProgressStep();
    if (step === "notifications") return this.renderNotificationsStep();
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
      <div class="quick-setup-options">${cards}</div>`;
  },

  renderProgressStep() {
    const modes = [
      {
        id: "automatic",
        label: t("quick_setup_progress_automatic", {}, "Automatic"),
        body: t(
          "quick_setup_progress_automatic_body",
          {},
          "The player reports where you stopped, and Nuvio picks it up when you come back."
        ),
        recommended: true
      },
      {
        id: "manual",
        label: t("quick_setup_progress_manual", {}, "Manual"),
        body: t(
          "quick_setup_progress_manual_body",
          {},
          "Nuvio asks you where you stopped each time."
        ),
        recommended: false
      }
    ];

    const cards = modes
      .map(
        (mode) => `
        <div class="quick-setup-option${mode.id === this.progressMode ? " is-selected" : ""}">
          <button class="quick-setup-option-choose focusable" type="button"
                  data-action="chooseProgress" data-mode="${escapeHtml(mode.id)}"
                  aria-pressed="${mode.id === this.progressMode ? "true" : "false"}">
            <span class="quick-setup-option-label">${escapeHtml(mode.label)}</span>
            ${
              mode.recommended
                ? `<span class="quick-setup-badge">${escapeHtml(t("quick_setup_player_recommended", {}, "Recommended"))}</span>`
                : ""
            }
            <span class="quick-setup-option-body">${escapeHtml(mode.body)}</span>
          </button>
        </div>`
      )
      .join("");

    return `
      <h1>${escapeHtml(t("quick_setup_progress_title", {}, "Bringing progress back"))}</h1>
      <p>${escapeHtml(
        t(
          "quick_setup_progress_body",
          {},
          "Automatic only works if you leave the player by its own Close button."
        )
      )}</p>
      <figure class="quick-setup-figure">
        <img src="assets/images/quick-setup-external-player-close.jpg"
             alt="${escapeHtml(
               t(
                 "quick_setup_progress_image_alt",
                 {},
                 "The Close button in the external player's control bar"
               )
             )}" />
        <figcaption>${escapeHtml(
          t(
            "quick_setup_progress_close_warning",
            {},
            "Close the player with this button when you finish watching. Swiping it away from the app switcher sends nothing back, and you will have to enter your progress by hand."
          )
        )}</figcaption>
      </figure>
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

  renderNotificationsStep() {
    const state = this.pushState?.state;
    let action = "";
    if (state === "enabled") {
      action = `<p class="quick-setup-status is-done">${escapeHtml(
        t("quick_setup_notifications_enabled", {}, "Notifications are on.")
      )}</p>`;
    } else if (state === "blocked") {
      // Asking again does nothing: the browser only offers once per origin, and
      // a refusal stands until the person changes it in site settings.
      action = `<p class="quick-setup-status">${escapeHtml(
        t(
          "quick_setup_notifications_blocked",
          {},
          "Notifications are blocked for Nuvio. You can turn them back on in your browser's site settings."
        )
      )}</p>`;
    } else {
      action = `<button class="quick-setup-enable focusable" type="button" data-action="enableNotifications">${escapeHtml(
        t("quick_setup_notifications_enable", {}, "Enable notifications")
      )}</button>`;
    }

    return `
      <h1>${escapeHtml(t("quick_setup_notifications_title", {}, "One tap back"))}</h1>
      <p>${escapeHtml(
        t(
          "quick_setup_notifications_body",
          {},
          "When you finish in the external player, Nuvio sends one notification. Tapping it brings you straight back, instead of hunting for the app yourself."
        )
      )}</p>
      ${action}`;
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
      this.render();
      return;
    }
    if (action === "chooseOfflineSync") {
      this.offlineSync = node.dataset.mode === "on";
      this.render();
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
    ScreenUtils.hide(this.container);
  }
};
