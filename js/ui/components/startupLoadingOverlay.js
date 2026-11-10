import { Router } from "../navigation/router.js";
import { PlayerSettingsStore } from "../../data/local/playerSettingsStore.js";
import { I18n } from "../../i18n/index.js";
import { renderLoadingIndicator } from "./loadingIndicator.js";
import { createPlayerOrientation } from "../screens/player/browserPlayerOrientation.js";
import { resolveDetailPortraitBackdrop } from "../screens/detail/detailPortraitPlate.js";

const STAGES = {
  finding: ["startup_loading_finding", "Finding a stream…"],
  checking: ["startup_loading_preparing", "Preparing video…"],
  probing: ["startup_loading_checking", "Checking stream metadata…"],
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
let playbackAttempt = null;
let presentation = {};
let backHandler = null;
let probeActions = null;
let orientation = null;
let artworkResize = null;

export const StartupLoadingOverlay = {
  get orientation() {
    return orientation?.preference || "landscape";
  },
  get active() {
    return Boolean(host);
  },
  get probing() {
    return Boolean(probeActions);
  },
  setProbeActions(actions, meta) {
    if (meta?.itemKey && presentation.itemKey && meta.itemKey !== presentation.itemKey)
      this.finish("replaced");
    probeActions = actions;
    this.begin(meta, "probing");
    return () => {
      if (probeActions !== actions) return;
      probeActions = null;
      if (
        !usesUnifiedStartup(undefined, { internalPlayer: true }) ||
        PlayerSettingsStore.get().loadingOverlayEnabled === false
      ) {
        this.finish();
      } else {
        this.setStage("opening");
      }
    };
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
      !probeActions &&
      (!usesUnifiedStartup(settings, { internalPlayer: meta.internalPlayer === true }) ||
        settings.loadingOverlayEnabled === false)
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
          <div class="startup-probe-actions" hidden>
            <button type="button" class="focusable startup-probe-skip"></button>
            <button type="button" class="focusable startup-probe-choose"></button>
          </div>
        </div>`;
      const back = host.querySelector(".startup-loading-back");
      if (back) back.onclick = () => this.back();
      const skip = host.querySelector(".startup-probe-skip");
      if (skip) {
        skip.textContent = I18n.t("skip_generic", {}, { fallback: "Skip" });
        skip.onclick = () => probeActions?.onSkip();
      }
      const choose = host.querySelector(".startup-probe-choose");
      if (choose) {
        choose.textContent = I18n.t("player_choose_stream", {}, { fallback: "Choose Stream" });
        choose.onclick = () => probeActions?.onChooseStream();
      }
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
    if (probeActions) stage = "probing";
    else if (STAGES[nextStage]) stage = nextStage;
    const actions = host?.querySelector(".startup-probe-actions");
    if (actions) actions.hidden = !probeActions;
    if (stage === "frame" || stage === "restoring") relayText = "";
    const node = host?.querySelector(".player-loading-status");
    if (!node) return;
    const enabled = PlayerSettingsStore.get().showPlayerLoadingStatus !== false;
    const [key, fallback] = STAGES[stage];
    let status = I18n.t(key, {}, { fallback });
    const routes = {
      direct: ["startup_loading_direct", "Opening directly…"],
      remux: ["startup_loading_remux", "Preparing remux playback…"],
      "audio-transcode": ["startup_loading_audio_conversion", "Converting audio…"],
      "client-audio-transcode": [
        "startup_loading_client_audio_conversion",
        "Converting audio on this device…"
      ],
      "client-transcode": ["startup_loading_video_conversion", "Converting video on this device…"],
      "server-transcode": ["startup_loading_video_conversion_server", "Converting video on server…"]
    };
    if (playbackAttempt && !["finding", "probing", "frame", "restoring"].includes(stage)) {
      const route = routes[playbackAttempt.route];
      if (route) status = I18n.t(route[0], {}, { fallback: route[1] });
    }
    if (playbackAttempt?.sourceNumber)
      status =
        I18n.t("startup_loading_stream", [playbackAttempt.sourceNumber], {
          fallback: `Stream ${playbackAttempt.sourceNumber}`
        }) +
        " · " +
        status;
    node.textContent = enabled ? status : "";
    const detail = host.querySelector(".player-loading-detail");
    if (detail) {
      let failure = "";
      const failedRoute = playbackAttempt?.failedRoute;
      if (failedRoute === "probe" || routes[failedRoute]) {
        const labels = {
          probe: ["startup_loading_probe_timeout", "Probe timed out. Trying another method."],
          direct: [
            "startup_loading_direct_failed",
            "Direct playback did not start. Trying another method."
          ],
          remux: [
            "startup_loading_remux_failed",
            "Remux playback did not start. Trying another method."
          ],
          "client-audio-transcode": [
            "startup_loading_video_conversion_failed",
            "Device conversion failed"
          ],
          "client-transcode": [
            "startup_loading_video_conversion_failed",
            "Device conversion failed"
          ],
          "server-transcode": [
            "startup_loading_video_conversion_server_failed",
            "Server conversion failed"
          ],
          "audio-transcode": [
            "startup_loading_audio_failed",
            "Audio conversion did not start. Trying another method."
          ]
        };
        const label = labels[failedRoute];
        failure = I18n.t(label[0], {}, { fallback: label[1] });
      } else if (playbackAttempt?.failedSourceNumber) {
        const number = playbackAttempt.failedSourceNumber;
        failure = I18n.t("startup_loading_stream_failed", [number], {
          fallback: `Stream ${number} could not play. Trying the next stream.`
        });
      }
      const detailText = [failure, relayText].filter(Boolean).join(" ");
      detail.textContent = enabled ? detailText : "";
      detail.classList.toggle("hidden", !enabled || !detailText);
    }
    node.classList.toggle("hidden", !enabled);
  },
  setPlaybackAttempt({ sourceNumber, route, failedRoute } = {}) {
    if (
      !playbackAttempt ||
      (sourceNumber !== undefined && sourceNumber !== playbackAttempt.sourceNumber)
    ) {
      const number =
        Number.isSafeInteger(sourceNumber) && sourceNumber > 0 && sourceNumber < 10000
          ? sourceNumber
          : null;
      playbackAttempt = {
        sourceNumber: number,
        failedSourceNumber: number > 1 ? number - 1 : null
      };
    }
    if (route !== undefined)
      playbackAttempt.route = [
        "direct",
        "remux",
        "audio-transcode",
        "client-audio-transcode",
        "client-transcode",
        "server-transcode"
      ].includes(route)
        ? route
        : "";
    if (failedRoute !== undefined)
      playbackAttempt.failedRoute = [
        "probe",
        "direct",
        "remux",
        "audio-transcode",
        "client-audio-transcode",
        "client-transcode",
        "server-transcode"
      ].includes(failedRoute)
        ? failedRoute
        : "";
    this.setStage(stage);
  },
  setRelayText(text) {
    relayText = String(text || "");
    this.setStage(stage);
  },
  finish(_reason = "finished") {
    if (artworkResize) globalThis.removeEventListener?.("resize", artworkResize);
    artworkResize = null;
    orientation?.destroy();
    orientation = null;
    host?.remove();
    host = null;
    relayText = "";
    playbackAttempt = null;
    stage = "finding";
    presentation = {};
    backHandler = null;
    probeActions = null;
  }
};
