import { ScreenUtils } from "../../../navigation/screen.js";
import { Router } from "../../../navigation/router.js";
import { Platform } from "../../../../platform/index.js";
import { preflightSource } from "../../../../core/player/movi/moviCapability.js";
import { loadMoviModule, mountMoviElement } from "../../../../core/player/movi/moviEngine.js";
import { createWakeLock } from "../../../../core/player/movi/wakeLock.js";
import { markPlaybackWatched } from "../../../../core/player/markPlaybackWatched.js";
import { watchProgressRepository } from "../../../../data/repository/watchProgressRepository.js";
import { subtitleRepository } from "../../../../data/repository/subtitleRepository.js";
import { PlayerSettingsStore } from "../../../../data/local/playerSettingsStore.js";
import { createMoviSubtitleOverlay } from "./moviSubtitleOverlay.js";
import { parseSubtitleText } from "./subtitleTextParser.js";
import { skipIntroRepository } from "../../../../data/repository/skipIntroRepository.js";
import {
  createSkipGuide,
  normalizeIntervals,
  resolveSkipIdentity,
  segmentLabel
} from "../../../../core/player/movi/skipSegments.js";
import { endsAtLabel, formatWallClock } from "../../../../core/player/movi/clockText.js";

const STAGE_ATTRIBUTE = "data-movi-stage";
const BACK_ATTRIBUTE = "data-movi-back";
const FULLSCREEN_ATTRIBUTE = "data-movi-fullscreen";
const SKIP_ATTRIBUTE = "data-movi-skip";
const CLOCK_ATTRIBUTE = "data-movi-clock";

// The built-in player writes on a similar cadence: often enough that closing the
// tab loses nothing worth keeping, rarely enough that it is not a write per
// frame. The element reports time ~4x/second, so this is every ~20th tick.
const PROGRESS_SAVE_INTERVAL_MS = 5000;

function routeSource(params = {}) {
  return String(params.streamUrl || params.src || "").trim();
}

function routeHeaders(params = {}) {
  const headers = params.requestHeaders || params.headers || null;
  if (!headers || typeof headers !== "object") return null;
  const entries = Object.entries(headers).filter(([, value]) => value != null && value !== "");
  return entries.length ? Object.fromEntries(entries) : null;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * The movi engine's screen.
 *
 * Deliberately a sibling of the player route rather than a fourth engine inside
 * it: the spike established that `<movi-player>` cannot stand in for
 * `<video id="videoPlayer">` (no `textTracks`, no `instanceof HTMLMediaElement`,
 * no `createMediaElementSource`). This route owns its own surface, and the
 * router never suspends it — the decoder and its cache have to go when the
 * screen does, exactly like the built-in player.
 */
export const MoviPlayerScreen = {
  async mount(params = {}) {
    this.container = document.getElementById("moviPlayer");
    if (!this.container) return;
    this.disposed = false;
    this.handle = null;
    this.params = params;
    this.positionMs = 0;
    this.durationMs = 0;
    this.lastSaveAt = 0;

    ScreenUtils.show(this.container);
    this.container.innerHTML = `
      <div style="position:absolute;inset:0;background:#000;">
        <div ${STAGE_ATTRIBUTE} style="position:absolute;inset:0;"></div>
        <button type="button" ${BACK_ATTRIBUTE} style="position:absolute;top:12px;left:12px;z-index:3;padding:10px 14px;border:0;border-radius:8px;background:rgba(0,0,0,.6);color:#fff;font:inherit;">Back</button>
        <button type="button" ${FULLSCREEN_ATTRIBUTE} style="position:absolute;top:12px;right:12px;z-index:3;padding:10px 14px;border:0;border-radius:8px;background:rgba(0,0,0,.6);color:#fff;font:inherit;">Fullscreen</button>
        <button type="button" ${SKIP_ATTRIBUTE} hidden style="position:absolute;left:12px;bottom:104px;z-index:3;padding:11px 18px;border:0;border-radius:999px;background:rgba(15,15,15,.82);color:#fff;font:600 14px/1.2 system-ui,sans-serif;">Skip intro</button>
        <div ${CLOCK_ATTRIBUTE} hidden style="position:absolute;right:12px;bottom:104px;z-index:3;text-align:right;color:#fff;font:13px/1.35 system-ui,sans-serif;text-shadow:0 1px 3px rgba(0,0,0,.9);">
          <div data-movi-clock-time>--:--</div>
          <div data-movi-clock-end></div>
        </div>
      </div>
    `;

    this.container.querySelector(`[${BACK_ATTRIBUTE}]`)?.addEventListener("click", () => {
      void Router.back();
    });
    this.container.querySelector(`[${FULLSCREEN_ATTRIBUTE}]`)?.addEventListener("click", () => {
      void this.toggleFullscreen();
    });

    const src = routeSource(params);
    if (!src) {
      this.showMessage("No source was handed to the movi engine.");
      return;
    }

    // One byte, before the element is built: a source the browser may not read
    // must fail as a sentence here, not as a black screen inside the player.
    // A downloaded file is already here: no host to ask, no CORS to satisfy, and a
    // Range probe against a blob URL would say nothing.
    const offline = /^(blob|data):/i.test(src);
    const preflight = offline ? { ok: true } : await preflightSource(src);
    if (this.disposed) return;
    if (!preflight.ok) {
      this.showMessage(
        preflight.reason === "http"
          ? `The source answered ${preflight.status}. Try another stream.`
          : "This stream cannot be read by the browser (CORS). Use a proxy, or open it in an external player."
      );
      return;
    }

    try {
      await loadMoviModule();
    } catch (error) {
      if (!this.disposed) this.showMessage(String(error?.message || error));
      return;
    }
    if (this.disposed) return;

    const stage = this.container.querySelector(`[${STAGE_ATTRIBUTE}]`);
    if (!stage) return;

    this.handle = mountMoviElement({
      container: stage,
      src,
      headers: routeHeaders(params),
      startAt: params.resumePositionMs
        ? Number(params.resumePositionMs) / 1000
        : params.startPositionSeconds || 0,
      title: params.playerTitle || "",
      // The route owns fullscreen; see toggleFullscreen below for why.
      controlsList: "nofullscreen"
    });
    this.handle.element.style.width = "100%";
    this.handle.element.style.height = "100%";
    this.wireProgress(this.handle.element);
    this.wireViewport();
    this.updateFullscreenButton();
    // A canvas is not "media playback" to iOS, so without this the screen dims
    // and locks on the auto-lock timer — in the middle of the film.
    this.wakeLock = createWakeLock();
    void this.wakeLock.start();
    this.wireSkipButton();
    void this.loadSkipSegments();
    this.startClock();
    void this.loadSubtitle(stage);
  },

  /**
   * Keep the subtitle layer on the picture when the picture moves.
   *
   * A fullscreen change does not fire a layout event the layer can hear, and movi
   * does not tell us it resized, so the geometry is re-read on every viewport
   * change and on every playhead tick (~4x/second) — one getBoundingClientRect is
   * cheaper than an observer that fires at unknown times.
   */
  wireViewport() {
    this.onViewportChange = () => {
      this.syncOverlayGeometry();
      this.updateFullscreenButton();
    };
    globalThis.addEventListener?.("resize", this.onViewportChange);
    globalThis.addEventListener?.("orientationchange", this.onViewportChange);
    globalThis.document?.addEventListener?.("fullscreenchange", this.onViewportChange);
  },

  syncOverlayGeometry() {
    const element = this.handle?.element;
    if (!element || !this.overlay) return;
    const rect = element.getBoundingClientRect?.();
    if (!rect) return;
    this.overlay.anchorTo({
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height
    });
  },

  /**
   * Fullscreen of the STAGE, not of the picture element.
   *
   * movi renders to a canvas, so it cannot enter native fullscreen the way a
   * <video> can: its own button fills the viewport with the picture alone and
   * leaves the subtitle layer behind. Asking for fullscreen on the stage keeps
   * picture, controls and subtitles in one box.
   *
   * Offered only where the platform grants it. iOS Safari refuses element
   * fullscreen for anything but a video, and there the app already fills the
   * screen — so the button is hidden rather than shown doing nothing (see
   * updateFullscreenButton).
   */
  async toggleFullscreen() {
    const stage = this.container?.querySelector?.(`[${STAGE_ATTRIBUTE}]`);
    const doc = globalThis.document;
    if (!stage || !doc) return;
    try {
      if (doc.fullscreenElement) {
        await doc.exitFullscreen?.();
      } else {
        await stage.requestFullscreen?.();
      }
    } catch (error) {
      console.warn("movi: fullscreen was refused", error);
    } finally {
      this.updateFullscreenButton();
    }
  },

  updateFullscreenButton() {
    const button = this.container?.querySelector?.(`[${FULLSCREEN_ATTRIBUTE}]`);
    if (!button) return;
    const stage = this.container?.querySelector?.(`[${STAGE_ATTRIBUTE}]`);
    const doc = globalThis.document;
    const supported = Boolean(
      stage && typeof stage.requestFullscreen === "function" && doc?.fullscreenEnabled
    );
    // Hidden rather than disabled: on a platform that cannot do it, there is
    // nothing to press the button for. The picture is already as big as it gets.
    button.hidden = !supported;
    button.textContent = doc?.fullscreenElement ? "Exit fullscreen" : "Fullscreen";
  },

  /**
   * IntroDB intervals for this item, through the same repository the built-in
   * player asks. Only while the profile keeps skip prompts on; the intervals are
   * harmless to hold and expensive to fetch, so they are fetched once per mount.
   */
  async loadSkipSegments() {
    const settings = PlayerSettingsStore.get();
    if (settings.skipIntroEnabled === false) return;

    // Identity is resolved the way the built-in player resolves it: the id may sit
    // on videoId or itemId, and there is no skip data for a film — IntroDB is
    // asked per episode, so season and episode have to be there.
    const identity = resolveSkipIdentity(this.params || {});
    if (identity.reason) {
      // Visible in Settings → About → Console debug, so "no button appeared" can
      // be told apart from "this title simply has no data".
      console.warn(
        `movi: skip intro unavailable (${identity.reason}) — it needs an IMDb id plus season and episode, so series only`
      );
      return;
    }

    let intervals = [];
    try {
      intervals = normalizeIntervals(
        await skipIntroRepository.getSkipIntervals(
          identity.imdbId,
          identity.season,
          identity.episode
        )
      );
    } catch (error) {
      console.warn("movi: skip segments could not be loaded", error);
      return;
    }
    if (this.disposed) return;
    if (!intervals.length) {
      console.warn(
        `movi: no skip segments for ${identity.imdbId} S${identity.season}E${identity.episode} — either IntroDB has no data for this episode or the request was refused`
      );
      return;
    }

    this.skipGuide = createSkipGuide({
      intervals,
      autoSkipTypes: Array.isArray(settings.autoSkipSegmentTypes)
        ? settings.autoSkipSegmentTypes
        : []
    });
    this.updateSkipPrompt(Number(this.handle?.element?.currentTime) || 0);
  },

  wireSkipButton() {
    this.onSkipClick = () => {
      const segment = this.promptSegment;
      if (!segment) return;
      this.skipGuide?.markHandled(segment);
      this.hideSkipPrompt();
      try {
        this.handle.element.currentTime = segment.endTime;
      } catch (error) {
        console.warn("movi: skip seek was refused", error);
      }
    };
    this.container
      ?.querySelector?.(`[${SKIP_ATTRIBUTE}]`)
      ?.addEventListener("click", this.onSkipClick);
  },

  updateSkipPrompt(seconds) {
    const button = this.container?.querySelector?.(`[${SKIP_ATTRIBUTE}]`);
    if (!button || !this.skipGuide) return;
    const verdict = this.skipGuide.evaluate(seconds);

    if (verdict.action === "auto") {
      this.hideSkipPrompt();
      try {
        this.handle.element.currentTime = verdict.segment.endTime;
      } catch (error) {
        console.warn("movi: auto-skip seek was refused", error);
      }
      return;
    }

    if (verdict.action !== "prompt") {
      this.hideSkipPrompt();
      return;
    }

    this.promptSegment = verdict.segment;
    button.textContent = segmentLabel(verdict.segment.type);
    button.hidden = false;
  },

  hideSkipPrompt() {
    this.promptSegment = null;
    const button = this.container?.querySelector?.(`[${SKIP_ATTRIBUTE}]`);
    if (button) button.hidden = true;
  },

  /**
   * The wall clock and the end time, as the built-in player shows them.
   *
   * The clock is on a timer because it changes without playback; the end time
   * follows the playhead, so it is written on the time tick instead.
   */
  startClock() {
    if (PlayerSettingsStore.get().osdClockEnabled === false) return;
    const block = this.container?.querySelector?.(`[${CLOCK_ATTRIBUTE}]`);
    const timeNode = this.container?.querySelector?.("[data-movi-clock-time]");
    if (!block || !timeNode) return;
    block.hidden = false;
    timeNode.textContent = formatWallClock();
    this.clockTimer = globalThis.setInterval?.(() => {
      timeNode.textContent = formatWallClock();
      this.updateClockEnd(Number(this.handle?.element?.currentTime) || 0);
    }, 15000);
  },

  updateClockEnd(seconds) {
    const node = this.container?.querySelector?.("[data-movi-clock-end]");
    if (!node) return;
    const duration = Number(this.handle?.element?.duration);
    node.textContent = endsAtLabel(seconds, duration);
  },

  /**
   * The three signals, read off the element's own events.
   *
   * `timeupdate` carries seconds in `detail`; the duration is read from the
   * element because that is where it lands. Saves are throttled here rather than
   * in the repository, so a paused player writes nothing.
   */
  wireProgress(element) {
    this.onTimeUpdate = (event) => {
      const seconds = Number(event?.detail);
      if (!Number.isFinite(seconds)) return;
      this.positionMs = Math.max(0, Math.trunc(seconds * 1000));
      this.overlay?.setTime(seconds);
      this.syncOverlayGeometry();
      this.updateSkipPrompt(seconds);
      this.updateClockEnd(seconds);
      const duration = Number(element.duration);
      if (Number.isFinite(duration) && duration > 0) this.durationMs = Math.trunc(duration * 1000);
      const now = Date.now();
      if (now - this.lastSaveAt < PROGRESS_SAVE_INTERVAL_MS) return;
      this.lastSaveAt = now;
      void this.saveProgress();
    };
    this.onEnded = () => {
      void this.completePlayback();
    };
    element.addEventListener("timeupdate", this.onTimeUpdate);
    element.addEventListener("ended", this.onEnded);
  },

  progressContext() {
    const params = this.params || {};
    const itemId = String(params.itemId || "").trim();
    if (!itemId) return null;
    return {
      itemId,
      itemType: String(params.itemType || "movie"),
      videoId: params.videoId == null ? null : String(params.videoId),
      season: params.season ?? null,
      episode: params.episode ?? null,
      title: params.playerTitle || null,
      episodeTitle: params.playerEpisodeTitle || null
    };
  },

  /**
   * The same rule the built-in player applies to a downloaded file.
   *
   * With "Sync offline progress" off, a download records nothing at all — not a
   * position, not a completion. Without this gate a profile that deliberately
   * switched that off would find downloaded files in Continue Watching, recorded by
   * one engine and not the other.
   */
  offlineProgressSuppressed() {
    const offline = /^blob:/i.test(String(this.params?.streamUrl || ""));
    if (!offline) return false;
    return PlayerSettingsStore.get().syncOfflineProgress !== true;
  },

  async saveProgress() {
    if (this.offlineProgressSuppressed()) return;
    const context = this.progressContext();
    if (!context || this.positionMs <= 0) return;
    try {
      await watchProgressRepository.saveProgress({
        contentId: context.itemId,
        contentType: context.itemType,
        videoId: context.videoId,
        season: context.season,
        episode: context.episode,
        title: context.title,
        background: this.params?.playerBackdropUrl || null,
        logo: this.params?.playerLogoUrl || null,
        episodeTitle: context.episodeTitle,
        positionMs: this.positionMs,
        durationMs: this.durationMs
      });
    } catch (error) {
      console.warn("movi playback progress was not saved", error);
    }
  },

  /**
   * Watched state, not a 100% resume row: the helper removes the progress entry
   * and reconciles the series, which is the completion boundary the rest of the
   * app already reads.
   */
  async completePlayback() {
    if (this.offlineProgressSuppressed()) return;
    const context = this.progressContext();
    if (!context) return;
    try {
      const duration = Number(this.handle?.element?.duration);
      this.positionMs =
        Number.isFinite(duration) && duration > 0 ? Math.trunc(duration * 1000) : this.positionMs;
      await markPlaybackWatched(context);
    } catch (error) {
      console.warn("movi playback completion was not recorded", error);
    }
  },

  /**
   * An addon subtitle, fetched and drawn by us.
   *
   * The file comes from the same repository the built-in player asks, and the
   * language comes from the profile's own preference, so a viewer who set
   * Indonesian gets Indonesian without meeting a second picker. A failure here is
   * silent on purpose: a missing subtitle must never stop the picture.
   */
  async loadSubtitle(stage) {
    const settings = PlayerSettingsStore.get();
    if (settings.subtitlesEnabled === false) return;

    const target = await this.resolveSubtitleTarget(settings);
    if (!target || this.disposed) return;

    let text = "";
    try {
      const response = await fetch(target.url, { mode: "cors" });
      if (!response.ok) return;
      text = await response.text();
    } catch (error) {
      console.warn("movi: subtitle file could not be read", error);
      return;
    }
    if (this.disposed) return;

    const cues = parseSubtitleText(text);
    if (!cues.length) return;

    this.overlay = createMoviSubtitleOverlay({ host: stage });
    this.overlay.mount();
    this.overlay.setCues(cues);
    this.syncOverlayGeometry();
    const start = Number(this.handle?.element?.currentTime);
    if (Number.isFinite(start)) this.overlay.setTime(start);
  },

  async resolveSubtitleTarget(settings) {
    const params = this.params || {};
    const explicitUrl = String(params.subtitleUrl || params.subtitleFileUrl || "").trim();
    if (explicitUrl) return { url: explicitUrl };

    const itemId = String(params.itemId || "").trim();
    if (!itemId) return null;

    try {
      const list = await subtitleRepository.getSubtitles(
        params.itemType,
        itemId,
        params.videoId || null
      );
      if (!Array.isArray(list) || !list.length) return null;

      const preferred = String(settings.subtitleLanguage || "")
        .trim()
        .toLowerCase();
      // "off" is a real choice in this app: it means no subtitle, not "any".
      if (preferred === "off") return null;
      const wanted = preferred.slice(0, 2);
      const match = wanted
        ? list.find((entry) =>
            String(entry?.lang || "")
              .toLowerCase()
              .startsWith(wanted)
          )
        : null;
      const chosen = match || list[0];
      return chosen?.url ? { url: chosen.url, lang: chosen.lang || "" } : null;
    } catch (error) {
      console.warn("movi: subtitle lookup failed", error);
      return null;
    }
  },

  showMessage(text) {
    const stage = this.container?.querySelector?.(`[${STAGE_ATTRIBUTE}]`);
    if (!stage) return;
    stage.innerHTML = `<p style="margin:0;padding:24px;color:#e6ebf2;font:14px/1.5 system-ui,sans-serif;">${escapeHtml(
      text
    )}</p>`;
  },

  async onKeyDown(event) {
    if (Platform.isBackEvent(event)) {
      event?.preventDefault?.();
      await Router.back();
    }
  },

  consumeBackRequest() {
    return false;
  },

  cleanup() {
    this.disposed = true;
    globalThis.removeEventListener?.("resize", this.onViewportChange);
    globalThis.removeEventListener?.("orientationchange", this.onViewportChange);
    globalThis.document?.removeEventListener?.("fullscreenchange", this.onViewportChange);
    if (this.clockTimer) globalThis.clearInterval?.(this.clockTimer);
    this.clockTimer = null;
    this.container
      ?.querySelector?.(`[${SKIP_ATTRIBUTE}]`)
      ?.removeEventListener("click", this.onSkipClick);
    void this.wakeLock?.stop?.();
    this.wakeLock = null;
    if (globalThis.document?.fullscreenElement) void globalThis.document.exitFullscreen?.();
    const element = this.handle?.element;
    if (element) {
      element.removeEventListener("timeupdate", this.onTimeUpdate);
      element.removeEventListener("ended", this.onEnded);
    }
    this.overlay?.destroy?.();
    this.overlay = null;
    // Best effort: the screen is going away, so the write is fired and not
    // awaited — the element teardown must not wait on storage.
    void this.saveProgress();
    this.handle?.destroy?.();
    this.handle = null;
    ScreenUtils.hide(this.container);
  }
};
