import { PlaybackLoadingTrace } from "../../core/player/playbackLoadingTrace.js";
import { Router } from "../navigation/router.js";
import { PlayerSettingsStore } from "../../data/local/playerSettingsStore.js";
import { I18n } from "../../i18n/index.js";
import { renderLoadingIndicator } from "./loadingIndicator.js";
import { createPlayerOrientation } from "../screens/player/browserPlayerOrientation.js";
import { resolveDetailPortraitBackdrop } from "../screens/detail/detailPortraitPlate.js";

const STAGES = {
  finding: ["startup_loading_finding", "Finding a stream…"],
  checking: ["startup_loading_preparing", "Preparing video…"],
  opening: ["startup_loading_preparing", "Preparing video…"],
  loading: ["startup_loading_preparing", "Preparing video…"],
  metadata: ["startup_loading_preparing", "Preparing video…"],
  frame: ["startup_loading_starting", "Starting playback…"],
  restoring: ["startup_loading_restoring", "Resuming playback…"]
};

export function usesUnifiedStartup(
  settings = PlayerSettingsStore.get(),
  { internalPlayer = false } = {}
) {
  return (
    (internalPlayer || settings.browserExternalPlayer === "disabled") &&
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
let orientation = null;
let artworkResize = null;

export const StartupLoadingOverlay = {
  get orientation() {
    return orientation?.preference || "landscape";
  },
  get active() {
    return Boolean(host);
  },
  setBackHandler(handler) {
    backHandler = handler;
  },
  back() {
    const handler = backHandler;
    this.finish("back");
    if (handler) handler();
    else void Router.back();
  },
  begin(meta = {}, nextStage = "finding") {
    const settings = PlayerSettingsStore.get();
    if (
      !usesUnifiedStartup(settings, { internalPlayer: meta.internalPlayer === true }) ||
      settings.loadingOverlayEnabled === false
    ) {
      this.finish();
      return false;
    }
    if (meta.itemKey && presentation.itemKey && meta.itemKey !== presentation.itemKey)
      this.finish("replaced");
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
        <button type="button" class="startup-loading-back focusable" aria-label="Back"><img class="player-desktop-back-icon" src="assets/icons/ic_player_back.svg" alt="" aria-hidden="true" /></button>
        <div class="player-loading-backdrop"></div>
        <div class="player-loading-gradient"></div>
        <div class="player-loading-center">
          <div class="player-loading-identity">
            <img class="player-loading-logo hidden" alt="" />
            <div class="player-loading-title"></div>
          </div>
          ${renderLoadingIndicator({ className: "unified-startup-spinner" })}
          <div class="player-loading-status" role="status" aria-live="polite"></div>
          <div class="player-loading-detail hidden"></div>
        </div>`;
      const back = host.querySelector(".startup-loading-back");
      if (back) back.onclick = () => this.back();
      document.body.appendChild(host);
      orientation = createPlayerOrientation(host, {
        preference: meta.orientation || "landscape",
        manageBody: false,
        onChange: () => this.refreshArtwork()
      });
    }
    if (!orientation?.mobile && !artworkResize) {
      artworkResize = () => this.refreshArtwork();
      globalThis.addEventListener?.("resize", artworkResize);
    }
    orientation?.setPreference(meta.orientation);
    PlaybackLoadingTrace.begin(nextStage);
    this.updateMetadata(meta);
    this.setStage(nextStage);
    return Boolean(host);
  },
  updateMetadata(meta = {}) {
    if (!host || (meta.itemKey && presentation.itemKey && meta.itemKey !== presentation.itemKey))
      return;
    for (const key of [
      "itemKey",
      "itemType",
      "title",
      "subtitle",
      "backdropUrl",
      "posterUrl",
      "textlessPoster"
    ]) {
      if (String(meta[key] || "").trim()) presentation[key] = String(meta[key]).trim();
    }
    const owner = host;
    const title = host.querySelector(".player-loading-title");
    const identity = host.querySelector(".player-loading-identity");
    const logo = host.querySelector(".player-loading-logo");
    title.textContent = presentation.title || "Nuvio";
    this.refreshArtwork();
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
  refreshArtwork() {
    if (!host) return;
    const portrait = orientation?.mobile
      ? orientation.preference === "portrait"
      : globalThis.innerHeight > globalThis.innerWidth;
    const textless = resolveDetailPortraitBackdrop({
      id: presentation.itemKey,
      type: presentation.itemType,
      textlessPoster: presentation.textlessPoster
    });
    const poster = textless || presentation.posterUrl || presentation.backdropUrl || "";
    const backdrop = portrait ? poster : presentation.backdropUrl || poster;
    const node = host.querySelector(".player-loading-backdrop");
    if (node)
      node.style.backgroundImage = backdrop
        ? `url("${backdrop.replace(/"/g, "%22").replace(/\\/g, "%5C")}")`
        : "";
  },
  setStage(nextStage) {
    if (STAGES[nextStage]) stage = nextStage;
    PlaybackLoadingTrace.stage(stage);
    if (stage === "frame" || stage === "restoring") relayText = "";
    const node = host?.querySelector(".player-loading-status");
    if (!node) return;
    const enabled = PlayerSettingsStore.get().showPlayerLoadingStatus !== false;
    const [key, fallback] = STAGES[stage];
    node.textContent = enabled ? I18n.t(key, {}, { fallback }) : "";
    const detail = host.querySelector(".player-loading-detail");
    if (detail) {
      detail.textContent = enabled ? relayText : "";
      detail.classList.toggle("hidden", !enabled || !relayText);
    }
    node.classList.toggle("hidden", !enabled);
  },
  setRelayText(text) {
    relayText = String(text || "");
    this.setStage(stage);
  },
  finish(reason = "finished") {
    if (reason !== "presenting") PlaybackLoadingTrace.finish(reason);
    if (artworkResize) globalThis.removeEventListener?.("resize", artworkResize);
    artworkResize = null;
    orientation?.destroy();
    orientation = null;
    host?.remove();
    host = null;
    relayText = "";
    stage = "finding";
    presentation = {};
    backHandler = null;
  }
};
