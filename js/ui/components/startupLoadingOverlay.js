import { Router } from "../navigation/router.js";
import { PlayerSettingsStore } from "../../data/local/playerSettingsStore.js";
import { I18n } from "../../i18n/index.js";
import { renderLoadingIndicator } from "./loadingIndicator.js";

const STAGES = {
  finding: ["startup_loading_finding", "Finding a stream…"],
  checking: ["startup_loading_checking", "Checking streams…"],
  opening: ["startup_loading_opening", "Opening player…"],
  loading: ["startup_loading_video", "Loading video…"],
  metadata: ["startup_loading_metadata", "Reading video information…"],
  frame: ["startup_loading_frame", "Waiting for the first frame…"],
  restoring: ["startup_loading_restoring", "Resuming playback…"]
};

export function usesUnifiedStartup(settings = PlayerSettingsStore.get()) {
  return (
    settings.browserExternalPlayer === "disabled" &&
    (!settings.playerEngine || settings.playerEngine === "native")
  );
}

// This node belongs to the playback attempt, rather than to any one route.
// Detail -> Stream -> Player only changes its caption; the image never remounts.
let host = null;
let stage = "finding";
let relayText = "";
let presentation = {};
let backHandler = null;

export const StartupLoadingOverlay = {
  get active() {
    return Boolean(host);
  },
  setBackHandler(handler) {
    backHandler = handler;
  },
  back() {
    const handler = backHandler;
    this.finish();
    if (handler) handler();
    else void Router.back();
  },
  begin(meta = {}, nextStage = "finding") {
    const settings = PlayerSettingsStore.get();
    if (!usesUnifiedStartup(settings) || settings.loadingOverlayEnabled === false) {
      this.finish();
      return false;
    }
    if (meta.itemKey && presentation.itemKey && meta.itemKey !== presentation.itemKey)
      this.finish();
    if (
      !host &&
      typeof document !== "undefined" &&
      document.body?.appendChild &&
      document.createElement
    ) {
      host = document.createElement("div");
      host.id = "startupLoadingOverlay";
      host.className = "player-loading-overlay unified-startup-overlay";
      host.innerHTML = `
        <button type="button" class="startup-loading-back focusable" aria-label="Back">‹ Back</button>
        <div class="player-loading-backdrop"></div>
        <div class="player-loading-gradient"></div>
        <div class="player-loading-center">
          <div class="player-loading-identity">
            <img class="player-loading-logo hidden" alt="" />
            <div class="player-loading-title"></div>
          </div>
          ${renderLoadingIndicator({ className: "unified-startup-spinner" })}
          <div class="player-loading-status" role="status" aria-live="polite"></div>
        </div>`;
      const back = host.querySelector(".startup-loading-back");
      if (back) back.onclick = () => this.back();
      document.body.appendChild(host);
    }
    this.updateMetadata(meta);
    this.setStage(nextStage);
    return Boolean(host);
  },
  updateMetadata(meta = {}) {
    if (!host || (meta.itemKey && presentation.itemKey && meta.itemKey !== presentation.itemKey))
      return;
    for (const key of ["itemKey", "title", "subtitle", "backdropUrl"]) {
      if (String(meta[key] || "").trim()) presentation[key] = String(meta[key]).trim();
    }
    const owner = host;
    const title = host.querySelector(".player-loading-title");
    const identity = host.querySelector(".player-loading-identity");
    const logo = host.querySelector(".player-loading-logo");
    title.textContent = presentation.title || "Nuvio";
    const backdrop = presentation.backdropUrl || "";
    if (backdrop)
      host.querySelector(".player-loading-backdrop").style.backgroundImage =
        `url("${backdrop.replace(/"/g, "%22").replace(/\\/g, "%5C")}")`;
    const logoUrl = String(meta.logoUrl || "").trim();
    if (logoUrl && logoUrl !== presentation.logoUrl) {
      presentation.logoUrl = logoUrl;
      identity.classList.toggle("has-logo", false);
      logo.classList.toggle("hidden", true);
      logo.alt = presentation.title || "";
      logo.onload = () => {
        if (host !== owner || presentation.logoUrl !== logoUrl || !logo.naturalWidth) return;
        identity.classList.toggle("has-logo", true);
        logo.classList.toggle("hidden", false);
      };
      logo.onerror = () => {
        if (host !== owner || presentation.logoUrl !== logoUrl) return;
        identity.classList.toggle("has-logo", false);
        logo.classList.toggle("hidden", true);
      };
      logo.src = logoUrl;
      if (logo.complete && logo.naturalWidth) logo.onload();
    }
  },
  setStage(nextStage) {
    if (STAGES[nextStage]) stage = nextStage;
    const node = host?.querySelector(".player-loading-status");
    if (!node) return;
    const enabled = PlayerSettingsStore.get().showPlayerLoadingStatus !== false;
    const [key, fallback] = STAGES[stage];
    node.textContent = enabled ? relayText || I18n.t(key, {}, { fallback }) : "";
    node.classList.toggle("hidden", !enabled);
  },
  setRelayText(text) {
    relayText = String(text || "");
    this.setStage(stage);
  },
  finish() {
    host?.remove();
    host = null;
    relayText = "";
    stage = "finding";
    presentation = {};
    backHandler = null;
  }
};
