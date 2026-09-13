import { watchProgressRepository } from "../../data/repository/watchProgressRepository.js";
import { markPlaybackWatched } from "./markPlaybackWatched.js";
import { WatchProgressSyncService } from "../profile/watchProgressSyncService.js";
import { nativeVideoEngine } from "./engines/nativeVideoEngine.js";
import { hlsJsEngine } from "./engines/hlsJsEngine.js";
import { dashJsEngine } from "./engines/dashJsEngine.js";
import { isTerminalHlsHttpStatus } from "./hlsNetworkErrorPolicy.js";
import { loadStreamingLibs } from "../../runtime/loadStreamingLibs.js";

const MIN_PROGRESS_SYNC_DURATION_MS = 1000;
const HLS_TRANSIENT_LEVEL_404_RETRY_LIMIT = 2;
const HLS_TRANSIENT_LEVEL_404_RETRY_BASE_DELAY_MS = 1500;

export const PlayerController = {
  video: null,
  isPlaying: false,
  currentItemId: null,
  currentItemType: null,
  currentVideoId: null,
  currentSeason: null,
  currentEpisode: null,
  progressSaveTimer: null,
  lastProgressPushAt: 0,
  lifecycleBound: false,
  lifecycleFlushHandler: null,
  visibilityFlushHandler: null,
  hlsInstance: null,
  dashInstance: null,
  playbackEngine: "none",
  lastPlaybackErrorCode: 0,
  lastHlsErrorDiagnostic: null,
  currentPlaybackUrl: "",
  currentPlaybackHeaders: {},
  currentPlaybackMediaSourceType: null,
  lastProgressSnapshot: null,
  lastKnownDurationSeconds: 0,
  playbackEngineAttempts: new Map(),
  playRequestToken: 0,
  playbackSessionActive: false,
  startupAudioGateActive: false,
  startupAudioGatePausesPlayback: true,
  startupPresentationAudioMuted: false,
  desiredPlaybackRate: 1,
  videoElementListeners: [],
  markPlaybackWatched,
  externalProgressHandoff: null,

  isExpectedPlayInterruption(error) {
    const message = String(error?.message || "").toLowerCase();
    const name = String(error?.name || "").toLowerCase();
    if (name === "aborterror") {
      return true;
    }
    return (
      message.includes("interrupted by a new load request") ||
      message.includes("the play() request was interrupted")
    );
  },

  isPlaybackRequestActive(playToken = null, url = null) {
    if (playToken !== null && Number(playToken) !== Number(this.playRequestToken || 0)) {
      return false;
    }
    if (url !== null && String(this.currentPlaybackUrl || "") !== String(url || "").trim()) {
      return false;
    }
    return Boolean(this.video);
  },

  emitVideoEvent(eventName, detail = null) {
    if (!this.video || !eventName) {
      return;
    }
    try {
      const event =
        typeof CustomEvent === "function"
          ? new CustomEvent(eventName, { detail: detail || null })
          : (() => {
              const legacyEvent = document.createEvent("CustomEvent");
              legacyEvent.initCustomEvent(eventName, false, false, detail || null);
              return legacyEvent;
            })();
      this.video.dispatchEvent?.(event);
    } catch (_) {
      // Ignore synthetic browser media-event failures.
    }
  },

  normalizeMimeType(mimeType) {
    return String(mimeType || "")
      .toLowerCase()
      .split(";")[0]
      .trim();
  },

  normalizePlaybackSourceType(sourceType) {
    const raw = String(sourceType || "").trim();
    if (!raw) {
      return null;
    }
    if (raw.includes("/")) {
      return raw;
    }

    const normalized = raw.toLowerCase();
    const aliases = {
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
    return aliases[normalized] || null;
  },

  resolveRuntimeSourceType(sourceType) {
    const normalized = this.normalizePlaybackSourceType(sourceType);
    if (!normalized) {
      return null;
    }
    if (
      this.isLikelyHlsMimeType(normalized) ||
      this.isLikelyDashMimeType(normalized) ||
      this.isLikelySmoothStreamingMimeType(normalized)
    ) {
      return normalized;
    }
    return this.canPlayNatively(normalized) ? normalized : null;
  },

  guessMediaMimeType(url) {
    const raw = String(url || "").trim();
    if (!raw) {
      return null;
    }

    const inferByPath = (pathname = "", search = null) => {
      const path = String(pathname || "").toLowerCase();
      const formatHint = String(
        search?.get?.("format") ||
          search?.get?.("type") ||
          search?.get?.("mime") ||
          search?.get?.("output") ||
          ""
      ).toLowerCase();
      if (path.endsWith(".m3u8")) {
        return "application/vnd.apple.mpegurl";
      }
      if (path.endsWith(".mpd")) {
        return "application/dash+xml";
      }
      if (path.includes(".ism/manifest") || path.includes(".isml/manifest")) {
        return "application/vnd.ms-sstr+xml";
      }
      if (formatHint === "m3u8" || formatHint === "hls") {
        return "application/vnd.apple.mpegurl";
      }
      if (formatHint === "mpd" || formatHint === "dash") {
        return "application/dash+xml";
      }
      if (path.includes("/playlist")) {
        return "application/vnd.apple.mpegurl";
      }
      const extensionMatch = path.match(
        /\.(mp4|m4v|mov|webm|mkv|avi|wmv|ts|m2ts|mpg|mpeg|3gp|mp3|aac|flac)(?=($|[/?#&]))/i
      );
      if (extensionMatch) {
        const extension = String(extensionMatch[1] || "").toLowerCase();
        const directMimeMap = {
          "3gp": "video/3gpp",
          aac: "audio/aac",
          avi: "video/x-msvideo",
          flac: "audio/flac",
          m2ts: "video/mp2t",
          m4v: "video/mp4",
          mkv: "video/x-matroska",
          mov: "video/quicktime",
          mp3: "audio/mpeg",
          mp4: "video/mp4",
          mpeg: "video/mpeg",
          mpg: "video/mpeg",
          ts: "video/mp2t",
          webm: "video/webm",
          wmv: "video/x-ms-wmv"
        };
        return directMimeMap[extension] || null;
      }
      return null;
    };

    try {
      const parsed = new URL(raw);
      return inferByPath(parsed.pathname, parsed.searchParams);
    } catch (_) {
      return inferByPath(raw, null);
    }
  },

  isLikelyHlsMimeType(mimeType) {
    const normalized = this.normalizeMimeType(mimeType);
    return (
      normalized === "application/vnd.apple.mpegurl" ||
      normalized === "application/x-mpegurl" ||
      normalized === "audio/mpegurl" ||
      normalized === "audio/x-mpegurl"
    );
  },

  isLikelyDashMimeType(mimeType) {
    return this.normalizeMimeType(mimeType) === "application/dash+xml";
  },

  isLikelySmoothStreamingMimeType(mimeType) {
    return this.normalizeMimeType(mimeType) === "application/vnd.ms-sstr+xml";
  },

  canUseHlsJs() {
    return hlsJsEngine.isSupported();
  },

  canUseDashJs() {
    return dashJsEngine.isSupported();
  },

  canPlayNatively(mimeType) {
    return nativeVideoEngine.canPlay(this.video, mimeType);
  },

  isUnsupportedSourceError(error) {
    const message = String(error?.message || "").toLowerCase();
    return (
      message.includes("no supported source") ||
      message.includes("no supported sources") ||
      message.includes("not supported")
    );
  },

  nativeAudioTrackListToArray() {
    const audioTrackList =
      this.video?.audioTracks ||
      this.video?.webkitAudioTracks ||
      this.video?.mozAudioTracks ||
      null;
    if (!audioTrackList) {
      return [];
    }
    try {
      return Array.from(audioTrackList).filter(Boolean);
    } catch (_) {
      const tracks = [];
      const trackCount = Number(audioTrackList.length || 0);
      for (let trackIndex = 0; trackIndex < trackCount; trackIndex += 1) {
        const track = audioTrackList[trackIndex] || audioTrackList.item?.(trackIndex) || null;
        if (track) {
          tracks.push(track);
        }
      }
      return tracks;
    }
  },

  getNativeAudioTracks() {
    return this.nativeAudioTrackListToArray().map((track, index) => ({
      id: String(track?.id ?? `native-audio-${index}`),
      index,
      label: String(track?.label || track?.name || track?.language || `Audio ${index + 1}`),
      language: String(track?.language || track?.lang || ""),
      selected: Boolean(track?.enabled || track?.selected),
      engine: "native",
      raw: track
    }));
  },

  getBrowserAudioTracks() {
    if (this.playbackEngine === "hls.js") {
      const selectedIndex = this.getSelectedHlsAudioTrackIndex();
      return this.getHlsAudioTracks().map((track, index) => ({
        id: String(track?.id ?? track?.name ?? `hls-audio-${index}`),
        index,
        label: String(track?.name || track?.label || track?.lang || `Audio ${index + 1}`),
        language: String(track?.lang || track?.language || ""),
        selected: index === selectedIndex,
        engine: "hls.js",
        raw: track
      }));
    }
    if (this.playbackEngine === "dash.js") {
      const selectedIndex = this.getSelectedDashAudioTrackIndex();
      return this.getDashAudioTracks().map((track, index) => ({
        ...track,
        index,
        selected: index === selectedIndex,
        engine: "dash.js"
      }));
    }
    return this.getNativeAudioTracks();
  },

  getSelectedBrowserAudioTrackIndex() {
    return this.getBrowserAudioTracks().findIndex((track) => track.selected);
  },

  setBrowserAudioTrack(index) {
    const targetIndex = Number(index);
    const tracks = this.getBrowserAudioTracks();
    if (!Number.isFinite(targetIndex) || targetIndex < 0 || targetIndex >= tracks.length) {
      return false;
    }
    const engine = tracks[targetIndex]?.engine;
    if (engine === "hls.js") {
      return this.setHlsAudioTrack(targetIndex);
    }
    if (engine === "dash.js") {
      return this.setDashAudioTrack(targetIndex);
    }
    const applied = this.setNativeAudioTrack(targetIndex);
    if (applied) {
      this.emitVideoEvent("audiotrackschanged", { playbackEngine: "native-file" });
    }
    return applied;
  },

  applyStartupAudioGateToVideo() {
    if (!this.video) {
      return;
    }
    try {
      const gated = Boolean(this.startupAudioGateActive || this.startupPresentationAudioMuted);
      this.video.muted = gated;
      this.video.defaultMuted = gated;
      if (
        !gated &&
        (!Number.isFinite(Number(this.video.volume)) || Number(this.video.volume) <= 0)
      ) {
        this.video.volume = 1;
      }
    } catch (_) {
      // Ignore unsupported volume/mute operations.
    }
  },

  setStartupPresentationAudioMuted(muted) {
    this.startupPresentationAudioMuted = Boolean(muted);
    this.applyStartupAudioGateToVideo();
  },

  pausePlaybackForStartupGate() {
    if (!this.video || !this.startupAudioGateActive) {
      return;
    }
    try {
      this.video.pause();
      this.isPlaying = false;
    } catch (_) {
      // Ignore pause failures while the media element is still loading.
    }
  },

  resumePlaybackAfterStartupGate() {
    if (!this.video) {
      return;
    }
    try {
      const playPromise = this.video.play();
      if (playPromise && typeof playPromise.catch === "function") {
        playPromise.catch((error) => {
          if (this.isExpectedPlayInterruption(error)) {
            return;
          }
          console.warn("Playback start after startup gate rejected", error);
        });
      }
      this.isPlaying = true;
    } catch (error) {
      if (!this.isExpectedPlayInterruption(error)) {
        console.warn("Playback start after startup gate rejected", error);
      }
    }
  },

  handlePlaybackStartedUnderStartupGate(playPromise = null) {
    if (
      !this.startupAudioGateActive ||
      !this.startupAudioGatePausesPlayback
    ) {
      return playPromise;
    }
    if (playPromise && typeof playPromise.then === "function") {
      playPromise
        .then(() => {
          this.pausePlaybackForStartupGate();
        })
        .catch(() => {
          // The normal playback-start rejection handler reports real failures.
        });
      return playPromise;
    }
    this.pausePlaybackForStartupGate();
    return playPromise;
  },

  attemptBrowserVideoPlay({
    warningLabel = "Playback start rejected",
    onRejected = null,
    playToken = null
  } = {}) {
    if (!this.video || (playToken !== null && playToken !== this.playRequestToken)) {
      return Promise.resolve(false);
    }

    const handleRejectedPlay = async (error) => {
      if (this.isExpectedPlayInterruption(error)) {
        return false;
      }
      if (typeof onRejected === "function") {
        try {
          if (await onRejected(error)) {
            return true;
          }
        } catch (_) {
          // Continue to the normal browser playback failure path.
        }
      }
      this.isPlaying = false;
      console.warn(warningLabel, error);
      return false;
    };

    try {
      this.applyStartupAudioGateToVideo();
      const playPromise = this.handlePlaybackStartedUnderStartupGate(this.video.play());
      if (!playPromise || typeof playPromise.then !== "function") {
        return Promise.resolve(true);
      }
      return Promise.resolve(playPromise).then(
        () => true,
        (error) => handleRejectedPlay(error)
      );
    } catch (error) {
      return handleRejectedPlay(error);
    }
  },

  setStartupAudioGate(active, { resume = true, pausePlayback = true } = {}) {
    const shouldGate = Boolean(active);
    const wasGated = Boolean(this.startupAudioGateActive);
    const playbackWasPausedForGate = Boolean(this.startupAudioGatePausesPlayback);
    this.startupAudioGateActive = shouldGate;
    this.startupAudioGatePausesPlayback = shouldGate ? Boolean(pausePlayback) : true;
    this.applyStartupAudioGateToVideo();

    if (shouldGate) {
      return;
    }

    if (!resume || !wasGated) {
      return;
    }
    if (playbackWasPausedForGate || this.video?.paused) {
      this.resumePlaybackAfterStartupGate();
    }
  },

  getCurrentTimeSeconds() {
    return Math.max(0, Number(this.video?.currentTime || 0));
  },

  getDurationSeconds() {
    const durationSeconds = Number(this.video?.duration || 0);
    if (
      Number.isFinite(durationSeconds) &&
      durationSeconds > Number(this.lastKnownDurationSeconds || 0)
    ) {
      this.lastKnownDurationSeconds = durationSeconds;
    }
    return Math.max(0, Number(this.lastKnownDurationSeconds || 0));
  },

  getBufferedTimeSeconds() {
    try {
      const video = this.video;
      const durationSeconds = Number(video?.duration || 0);
      const currentSeconds = Number(video?.currentTime || 0);
      const ranges = video?.buffered;
      if (
        !ranges ||
        !Number.isFinite(durationSeconds) ||
        durationSeconds <= 0 ||
        !Number.isFinite(currentSeconds) ||
        currentSeconds < 0
      ) {
        return null;
      }

      const rangeCount = Number(ranges.length || 0);
      if (!Number.isFinite(rangeCount) || rangeCount <= 0) {
        return null;
      }
      for (let index = 0; index < rangeCount; index += 1) {
        const startSeconds = Number(ranges.start(index));
        const endSeconds = Number(ranges.end(index));
        if (
          Number.isFinite(startSeconds) &&
          Number.isFinite(endSeconds) &&
          startSeconds >= 0 &&
          endSeconds >= startSeconds &&
          startSeconds <= currentSeconds &&
          endSeconds >= currentSeconds
        ) {
          return Math.max(0, Math.min(endSeconds, durationSeconds));
        }
      }
    } catch (_) {
      // TimeRanges can change while it is being read.
    }

    return null;
  },

  seekToSeconds(targetSeconds) {
    const seconds = Number(targetSeconds || 0);
    if (!Number.isFinite(seconds) || seconds < 0) {
      return false;
    }

    if (!this.video) {
      return false;
    }
    try {
      this.video.currentTime = seconds;
      return true;
    } catch (_) {
      return false;
    }
  },

  isPlaybackEnded() {
    return Boolean(this.video?.ended);
  },

  getPlaybackReadyState() {
    return Number(this.video?.readyState || 0);
  },

  getLastPlaybackErrorCode() {
    return Number(this.lastPlaybackErrorCode || 0);
  },

  sanitizePlaybackDiagnosticText(value, maxLength = 240) {
    const text = String(value ?? "")
      .replace(/https?:\/\/[^\s"'<>]+/gi, "[redacted-url]")
      .replace(
        /((?:clear_?key|clearkey|api_password|authorization|cookie|token)=)[^&\s]+/gi,
        "$1[redacted]"
      )
      .replace(
        /((?:clear_?key|clearkey|api_password|authorization|cookie|token)\s*:\s*)(?:"[^"]*"|'[^']*'|[^,;\s}]+)/gi,
        "$1[redacted]"
      )
      .trim();
    if (!text) {
      return "";
    }
    return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
  },

  captureHlsErrorDiagnostic(data = {}) {
    const video = this.video || null;
    const buffered = [];
    try {
      for (let index = 0; index < Number(video?.buffered?.length || 0); index += 1) {
        buffered.push(
          `${Number(video.buffered.start(index)).toFixed(3)}-${Number(
            video.buffered.end(index)
          ).toFixed(3)}`
        );
      }
    } catch (_) {
      // Buffered ranges are best-effort diagnostics only.
    }

    const fragment = data?.frag || null;
    const responseCode = Number(data?.response?.code || data?.networkDetails?.status || 0);
    const mediaErrorCode = Number(video?.error?.code || 0);
    const diagnostic = {
      fatal: Boolean(data?.fatal),
      type: this.sanitizePlaybackDiagnosticText(data?.type),
      details: this.sanitizePlaybackDiagnosticText(data?.details),
      reason: this.sanitizePlaybackDiagnosticText(data?.reason),
      error: this.sanitizePlaybackDiagnosticText(data?.error?.message || data?.error?.name),
      sourceBuffer: this.sanitizePlaybackDiagnosticText(
        data?.sourceBufferName || data?.parent || fragment?.type
      ),
      responseCode: responseCode || null,
      level: Number.isFinite(Number(data?.level ?? fragment?.level))
        ? Number(data?.level ?? fragment?.level)
        : null,
      fragmentSn:
        fragment?.sn == null ? null : this.sanitizePlaybackDiagnosticText(fragment.sn, 80),
      fragmentCc: Number.isFinite(Number(fragment?.cc)) ? Number(fragment.cc) : null,
      readyState: Number(video?.readyState || 0),
      networkState: Number(video?.networkState || 0),
      currentTime: Number.isFinite(Number(video?.currentTime))
        ? Number(Number(video.currentTime).toFixed(3))
        : null,
      buffered: buffered.join(", ") || "none",
      mediaErrorCode: mediaErrorCode || null,
      mediaError: this.sanitizePlaybackDiagnosticText(video?.error?.message)
    };
    this.lastHlsErrorDiagnostic = diagnostic;
    console.warn("[Nuvio playback] hls.js error", diagnostic);
    return diagnostic;
  },

  getLastHlsErrorDetail() {
    const diagnostic = this.lastHlsErrorDiagnostic;
    if (!diagnostic) {
      return "";
    }
    const fields = [
      diagnostic.type,
      diagnostic.details,
      diagnostic.reason,
      diagnostic.error,
      diagnostic.sourceBuffer ? `buffer=${diagnostic.sourceBuffer}` : "",
      diagnostic.responseCode ? `HTTP ${diagnostic.responseCode}` : "",
      diagnostic.level == null ? "" : `level=${diagnostic.level}`,
      diagnostic.fragmentSn == null ? "" : `sn=${diagnostic.fragmentSn}`,
      diagnostic.fragmentCc == null ? "" : `cc=${diagnostic.fragmentCc}`,
      `fatal=${diagnostic.fatal}`,
      `readyState=${diagnostic.readyState}`,
      `networkState=${diagnostic.networkState}`,
      diagnostic.currentTime == null ? "" : `time=${diagnostic.currentTime}`,
      `buffered=${diagnostic.buffered}`,
      diagnostic.mediaErrorCode ? `mediaCode=${diagnostic.mediaErrorCode}` : "",
      diagnostic.mediaError
    ].filter(Boolean);
    return fields.join("; ");
  },

  getAttemptedPlaybackEngines(url = this.currentPlaybackUrl) {
    const normalizedUrl = String(url || "").trim();
    if (!normalizedUrl) {
      return new Set();
    }
    return new Set(this.playbackEngineAttempts.get(normalizedUrl) || []);
  },

  rememberPlaybackEngineAttempt(url, engineName, { reset = false } = {}) {
    const normalizedUrl = String(url || "").trim();
    const normalizedEngine = String(engineName || "").trim();
    if (!normalizedUrl || !normalizedEngine) {
      return;
    }
    const nextSet = reset
      ? new Set()
      : new Set(this.playbackEngineAttempts.get(normalizedUrl) || []);
    nextSet.add(normalizedEngine);
    this.playbackEngineAttempts.set(normalizedUrl, nextSet);
  },

  clearPlaybackEngineAttempts(url = null) {
    const normalizedUrl = String(url || "").trim();
    if (!normalizedUrl) {
      this.playbackEngineAttempts.clear();
      return;
    }
    this.playbackEngineAttempts.delete(normalizedUrl);
  },

  isLivePlaybackItemType(itemType = this.currentItemType) {
    const normalized = String(itemType || "")
      .trim()
      .toLowerCase();
    return (
      normalized === "channel" ||
      normalized === "live" ||
      normalized === "tvchannel" ||
      normalized === "stream"
    );
  },

  getPlaybackEngineCandidates(url, sourceType = null) {
    const normalizedSourceType = String(sourceType || this.guessMediaMimeType(url) || "").trim();
    const canUseDashJs = this.canUseDashJs();
    const canPlayNativeHls = this.canPlayNatively("application/vnd.apple.mpegurl");
    const canPlayNativeDash = this.canPlayNatively("application/dash+xml");
    const canPlayNativeSmooth = this.canPlayNatively("application/vnd.ms-sstr+xml");
    const pushCandidate = (target, candidate) => {
      const normalized = String(candidate || "").trim();
      if (!normalized || target.includes(normalized)) {
        return;
      }
      target.push(normalized);
    };

    if (this.isLikelyHlsMimeType(normalizedSourceType)) {
      const candidates = [];
      // Preserve the browser order: hls.js first, then the native WebKit
      // fallback when the media element supports HLS.
      pushCandidate(candidates, "hls.js");
      if (canPlayNativeHls) {
        pushCandidate(candidates, "native-hls");
      }
      return candidates;
    }

    if (this.isLikelyDashMimeType(normalizedSourceType)) {
      const candidates = [];
      if (canPlayNativeDash) {
        pushCandidate(candidates, "native-dash");
      }
      if (canUseDashJs) {
        pushCandidate(candidates, "dash.js");
      }
      return candidates;
    }

    if (this.isLikelySmoothStreamingMimeType(normalizedSourceType)) {
      const candidates = [];
      if (canPlayNativeSmooth) {
        pushCandidate(candidates, "native-file");
      }
      return candidates;
    }

    return ["native-file"];
  },

  getAlternativePlaybackEngine(
    url = this.currentPlaybackUrl,
    sourceType = this.currentPlaybackMediaSourceType,
    itemType = this.currentItemType
  ) {
    const normalizedUrl = String(url || "").trim();
    if (!normalizedUrl) {
      return null;
    }
    const attemptedEngines = this.getAttemptedPlaybackEngines(normalizedUrl);
    const currentEngine = String(this.playbackEngine || "").trim();
    const candidates = this.getPlaybackEngineCandidates(normalizedUrl, sourceType, itemType);
    return (
      candidates.find(
        (candidate) => candidate !== currentEngine && !attemptedEngines.has(candidate)
      ) || null
    );
  },

  getPlaybackCapabilities() {
    const supports = (mimeType) => this.canPlayNatively(mimeType);
    const capabilities = {
      hls: supports("application/vnd.apple.mpegurl"),
      dash: supports("application/dash+xml"),
      smoothStreaming: supports("application/vnd.ms-sstr+xml"),
      mp4: supports("video/mp4"),
      mp4H264: supports('video/mp4; codecs="avc1.4d401f,mp4a.40.2"'),
      mp4Hevc:
        supports('video/mp4; codecs="hvc1.1.6.L93.B0,mp4a.40.2"') ||
        supports('video/mp4; codecs="hev1.1.6.L93.B0,mp4a.40.2"'),
      mp4HevcMain10:
        supports('video/mp4; codecs="hvc1.2.4.L153.B0,mp4a.40.2"') ||
        supports('video/mp4; codecs="hev1.2.4.L153.B0,mp4a.40.2"'),
      mp4Av1: supports('video/mp4; codecs="av01.0.08M.08,mp4a.40.2"'),
      webmVp9: supports('video/webm; codecs="vp9,opus"'),
      webm: supports("video/webm"),
      mkvH264:
        supports('video/x-matroska; codecs="avc1.4d401f,mp4a.40.2"') ||
        supports("video/x-matroska"),
      quicktime: supports("video/quicktime"),
      mpegTs: supports("video/mp2t"),
      audioAac: supports('audio/mp4; codecs="mp4a.40.2"'),
      audioMp3: supports("audio/mpeg"),
      audioFlac: supports("audio/flac"),
      audioAc3: supports('audio/mp4; codecs="ac-3"') || supports('audio/mp4; codecs="dac3"'),
      audioEac3: supports('audio/mp4; codecs="ec-3"') || supports('audio/mp4; codecs="dec3"'),
      dolbyVision:
        supports('video/mp4; codecs="dvh1.05.06,ec-3"') ||
        supports('video/mp4; codecs="dvhe.05.06,ec-3"')
    };
    capabilities.hdrLikely = capabilities.mp4HevcMain10 || capabilities.mp4Av1;
    capabilities.atmosLikely = capabilities.audioEac3;
    return capabilities;
  },

  teardownHlsInstance() {
    if (!this.hlsInstance) {
      return;
    }
    try {
      this.hlsInstance.destroy();
    } catch (_) {
      // Ignore HLS cleanup failures.
    }
    this.hlsInstance = null;
  },

  teardownDashInstance() {
    if (!this.dashInstance) {
      return;
    }
    try {
      this.dashInstance.reset?.();
    } catch (_) {
      // Ignore DASH cleanup failures.
    }
    this.dashInstance = null;
  },

  teardownAdaptiveInstances() {
    this.teardownHlsInstance();
    this.teardownDashInstance();
    this.playbackEngine = "none";
  },

  applyNativeSource(url, mimeType = null, engineName = "native-file") {
    if (!nativeVideoEngine.load(this.video, url, mimeType)) {
      return false;
    }
    this.playbackEngine = String(engineName || "native-file");
    return true;
  },

  shouldForwardHeaderToHls(name) {
    const lower = String(name || "")
      .trim()
      .toLowerCase();
    if (!lower) {
      return false;
    }
    if (lower === "range") {
      return false;
    }
    if (lower.startsWith("sec-")) {
      return false;
    }
    const forbidden = new Set([
      "host",
      "origin",
      "referer",
      "referrer",
      "user-agent",
      "content-length",
      "accept-encoding",
      "connection",
      "cookie"
    ]);
    return !forbidden.has(lower);
  },

  normalizePlaybackHeaders(headers) {
    if (!headers || typeof headers !== "object") {
      return {};
    }
    const entries = Object.entries(headers)
      .map(([key, value]) => [String(key || "").trim(), String(value ?? "").trim()])
      .filter(([key, value]) => key && value)
      .filter(([key]) => this.shouldForwardHeaderToHls(key));
    return Object.fromEntries(entries);
  },

  buildHlsConfig(requestHeaders = {}) {
    const forwardedHeaders = this.normalizePlaybackHeaders(requestHeaders);
    return {
      autoStartLoad: false,
      enableWorker: true,
      lowLatencyMode: false,
      backBufferLength: 90,
      maxBufferLength: 30,
      maxMaxBufferLength: 60,
      maxBufferHole: 0.5,
      startFragPrefetch: false,
      fragLoadingTimeOut: 20000,
      manifestLoadingTimeOut: 20000,
      xhrSetup: (xhr) => {
        Object.entries(forwardedHeaders).forEach(([headerName, headerValue]) => {
          try {
            xhr.setRequestHeader(headerName, headerValue);
          } catch (_) {
            // Ignore forbidden/unsupported browser headers.
          }
        });
      },
      fetchSetup: (context, initParams = {}) => {
        const headers = new Headers(initParams.headers || {});
        Object.entries(forwardedHeaders).forEach(([headerName, headerValue]) => {
          try {
            headers.set(headerName, headerValue);
          } catch (_) {
            // Ignore forbidden/unsupported browser headers.
          }
        });
        return new Request(context.url, {
          ...initParams,
          headers
        });
      }
    };
  },

  pickInitialHlsLevel(levels = []) {
    const candidates = Array.isArray(levels) ? levels : [];
    let selectedIndex = -1;
    let selectedScore = -1;
    candidates.forEach((level, index) => {
      const height = Number(level?.height || 0);
      const bitrate = Number(level?.bitrate || level?.attrs?.BANDWIDTH || 0);
      const score = height * 1000000000 + bitrate;
      if (score > selectedScore) {
        selectedScore = score;
        selectedIndex = index;
      }
    });
    return selectedIndex;
  },

  primeHlsInitialLevel(hls) {
    const initialLevel = this.pickInitialHlsLevel(hls?.levels);
    if (!Number.isFinite(initialLevel) || initialLevel < 0) {
      return -1;
    }
    try {
      hls.startLevel = initialLevel;
    } catch (_) {
      // Ignore unsupported hls.js builds.
    }
    try {
      hls.nextAutoLevel = initialLevel;
    } catch (_) {
      // Keep ABR enabled even if the hint is unsupported.
    }
    return initialLevel;
  },

  playWithHlsJs(url, requestHeaders = {}, playToken = null) {
    if (!this.video || !this.canUseHlsJs()) {
      return false;
    }
    if (!this.isPlaybackRequestActive(playToken, url)) {
      return false;
    }

    const Hls = hlsJsEngine.getConstructor();
    if (!Hls) {
      return false;
    }
    this.teardownHlsInstance();
    this.teardownDashInstance();
    const hls = hlsJsEngine.create(this.buildHlsConfig(requestHeaders));
    if (!hls) {
      return false;
    }
    this.hlsInstance = hls;
    this.playbackEngine = "hls.js";
    let networkRecoveryAttempts = 0;
    let mediaRecoveryAttempts = 0;
    let transientLevelNotFoundRetries = 0;
    let transientLevelNotFoundRetryTimer = null;

    const clearTransientLevelNotFoundRetry = () => {
      if (transientLevelNotFoundRetryTimer) {
        clearTimeout(transientLevelNotFoundRetryTimer);
        transientLevelNotFoundRetryTimer = null;
      }
    };

    const emitFatalHlsNetworkError = (data = {}, responseCode = 0) => {
      clearTransientLevelNotFoundRetry();
      this.lastPlaybackErrorCode = 2;
      this.teardownHlsInstance();
      this.emitVideoEvent("error", {
        playbackEngine: "hls.js",
        mediaErrorCode: 2,
        hlsErrorType: String(data.type || ""),
        hlsErrorDetails: String(data.details || ""),
        hlsResponseCode: Number(responseCode) || null
      });
    };

    const scheduleTransientLevelNotFoundRetry = () => {
      transientLevelNotFoundRetries += 1;
      const retryAttempt = transientLevelNotFoundRetries;
      const retryDelayMs = HLS_TRANSIENT_LEVEL_404_RETRY_BASE_DELAY_MS * retryAttempt;
      clearTransientLevelNotFoundRetry();
      console.warn("[Nuvio playback] retrying transient HLS level 404", {
        attempt: retryAttempt,
        limit: HLS_TRANSIENT_LEVEL_404_RETRY_LIMIT,
        delayMs: retryDelayMs
      });
      transientLevelNotFoundRetryTimer = setTimeout(() => {
        transientLevelNotFoundRetryTimer = null;
        if (!this.isPlaybackRequestActive(playToken, url) || this.hlsInstance !== hls) {
          return;
        }
        try {
          // Reload the master manifest as bridge-generated level URLs can be
          // temporarily unavailable or stale while a live window advances.
          hls.loadSource(url);
        } catch (error) {
          console.warn("HLS level 404 retry failed", error);
          this.lastPlaybackErrorCode = 2;
          this.teardownHlsInstance();
          this.emitVideoEvent("error", {
            playbackEngine: "hls.js",
            mediaErrorCode: 2,
            hlsErrorType: "networkError",
            hlsErrorDetails: "levelLoadError"
          });
        }
      }, retryDelayMs);
    };

    hls.on(Hls.Events.ERROR, (_, data = {}) => {
      if (!this.isPlaybackRequestActive(playToken, url)) {
        return;
      }
      this.captureHlsErrorDiagnostic(data);
      if (!data?.fatal) {
        return;
      }
      if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
        const responseCode = Number(data?.response?.code || data?.networkDetails?.status || 0);
        if (
          String(data?.details || "") === "levelLoadError" &&
          responseCode === 404 &&
          transientLevelNotFoundRetries < HLS_TRANSIENT_LEVEL_404_RETRY_LIMIT
        ) {
          scheduleTransientLevelNotFoundRetry();
          return;
        }
        if (isTerminalHlsHttpStatus(responseCode)) {
          emitFatalHlsNetworkError(data, responseCode);
          return;
        }
        if (networkRecoveryAttempts >= 1) {
          emitFatalHlsNetworkError(data, responseCode);
          return;
        }
        try {
          networkRecoveryAttempts += 1;
          hls.startLoad();
          return;
        } catch (_) {
          // Fall through and destroy on unrecoverable load errors.
        }
      }
      if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
        if (mediaRecoveryAttempts >= 1) {
          this.lastPlaybackErrorCode = 3;
          this.teardownHlsInstance();
          this.emitVideoEvent("error", {
            playbackEngine: "hls.js",
            mediaErrorCode: 3,
            hlsErrorType: String(data.type || ""),
            hlsErrorDetails: String(data.details || "")
          });
          return;
        }
        try {
          mediaRecoveryAttempts += 1;
          hls.recoverMediaError();
          return;
        } catch (_) {
          // Fall through and destroy on unrecoverable media errors.
        }
      }
      this.lastPlaybackErrorCode = 4;
      this.teardownHlsInstance();
      this.emitVideoEvent("error", {
        playbackEngine: "hls.js",
        mediaErrorCode: 4,
        hlsErrorType: String(data.type || ""),
        hlsErrorDetails: String(data.details || "")
      });
    });

    hls.on(Hls.Events.LEVEL_LOADED, () => {
      clearTransientLevelNotFoundRetry();
      transientLevelNotFoundRetries = 0;
    });

    hls.on(Hls.Events.MEDIA_ATTACHED, () => {
      if (!this.isPlaybackRequestActive(playToken, url)) {
        return;
      }
      try {
        hls.loadSource(url);
      } catch (error) {
        console.warn("HLS source attach failed", error);
        this.lastPlaybackErrorCode = 4;
        this.emitVideoEvent("error", {
          playbackEngine: "hls.js",
          mediaErrorCode: 4,
          hlsErrorType: "attach",
          hlsErrorDetails: String(error?.message || error || "")
        });
      }
    });

    hls.on(Hls.Events.MANIFEST_PARSED, () => {
      if (!this.isPlaybackRequestActive(playToken, url)) {
        return;
      }
      this.primeHlsInitialLevel(hls);
      try {
        hls.startLoad();
      } catch (_) {
        // hls.js may already be loading on older builds.
      }
      this.applyStartupAudioGateToVideo();
      const playPromise = this.video.play();
      this.handlePlaybackStartedUnderStartupGate(playPromise);
      if (playPromise && typeof playPromise.catch === "function") {
        playPromise.catch((error) => {
          if (this.isExpectedPlayInterruption(error)) {
            return;
          }
          console.warn("HLS playback start rejected", error);
        });
      }
    });

    [
      Hls.Events.AUDIO_TRACKS_UPDATED,
      Hls.Events.AUDIO_TRACK_SWITCHED,
      Hls.Events.AUDIO_TRACK_LOADED,
      Hls.Events.SUBTITLE_TRACKS_UPDATED,
      Hls.Events.SUBTITLE_TRACK_SWITCH,
      Hls.Events.SUBTITLE_TRACK_LOADED
    ]
      .filter(Boolean)
      .forEach((eventName) => {
        hls.on(eventName, () => {
          if (!this.isPlaybackRequestActive(playToken, url)) {
            return;
          }
          this.emitVideoEvent("hlstrackschanged", { playbackEngine: "hls.js" });
        });
      });

    this.video.removeAttribute("src");
    hls.attachMedia(this.video);
    return true;
  },

  playWithDashJs(url, playToken = null) {
    if (!this.video || !this.canUseDashJs()) {
      return false;
    }
    if (!this.isPlaybackRequestActive(playToken, url)) {
      return false;
    }

    this.teardownDashInstance();
    this.teardownHlsInstance();

    let player = null;
    try {
      player = dashJsEngine.createPlayer();
      if (!player) {
        return false;
      }
      player.updateSettings?.({
        streaming: {
          fastSwitchEnabled: true,
          lowLatencyEnabled: false,
          scheduleWhilePaused: false,
          bufferToKeep: 20,
          bufferPruningInterval: 20,
          stableBufferTime: 12
        }
      });
      player.initialize(this.video, url, true);
      const dashEvents = dashJsEngine.getEvents();
      const emitTracksChanged = () => {
        if (!this.isPlaybackRequestActive(playToken, url)) {
          return;
        }
        this.emitVideoEvent("dashtrackschanged", { playbackEngine: "dash.js" });
      };
      const emitDashError = (event = {}) => {
        if (!this.isPlaybackRequestActive(playToken, url)) {
          return;
        }
        const errorText = String(
          event?.error?.message || event?.event?.message || event?.message || ""
        ).toLowerCase();
        let mediaErrorCode = 4;
        if (
          errorText.includes("network") ||
          errorText.includes("download") ||
          errorText.includes("manifest")
        ) {
          mediaErrorCode = 2;
        } else if (
          errorText.includes("decode") ||
          errorText.includes("mediasource") ||
          errorText.includes("append")
        ) {
          mediaErrorCode = 3;
        }
        this.lastPlaybackErrorCode = mediaErrorCode;
        this.emitVideoEvent("error", {
          playbackEngine: "dash.js",
          mediaErrorCode,
          dashError: String(event?.error?.message || event?.message || "")
        });
      };
      try {
        [
          dashEvents.STREAM_INITIALIZED,
          dashEvents.TRACK_CHANGE_RENDERED,
          dashEvents.CURRENT_TRACK_CHANGED,
          dashEvents.TEXT_TRACKS_ADDED,
          dashEvents.PLAYBACK_METADATA_LOADED,
          dashEvents.PERIOD_SWITCH_COMPLETED
        ]
          .filter(Boolean)
          .forEach((eventName) => player.on?.(eventName, emitTracksChanged));
        if (dashEvents.ERROR) {
          player.on?.(dashEvents.ERROR, emitDashError);
        }
        if (dashEvents.PLAYBACK_ERROR) {
          player.on?.(dashEvents.PLAYBACK_ERROR, emitDashError);
        }
      } catch (_) {
        // Ignore dash event binding issues.
      }
      this.dashInstance = player;
      this.playbackEngine = "dash.js";
      return true;
    } catch (error) {
      console.warn("DASH source attach failed", error);
      try {
        player?.reset?.();
      } catch (_) {
        // Ignore reset failures on partial init.
      }
      this.dashInstance = null;
      this.lastPlaybackErrorCode = 4;
      this.emitVideoEvent("error", {
        playbackEngine: "dash.js",
        mediaErrorCode: 4,
        dashError: String(error?.message || error || "")
      });
      return false;
    }
  },

  getDashAudioTracks() {
    const tracks = this.dashInstance?.getTracksFor?.("audio");
    if (!Array.isArray(tracks)) {
      return [];
    }
    return tracks.filter(Boolean).map((track, index) => ({
      id: String(track?.id ?? `dash-audio-${index}`),
      index,
      label: String(track?.labels?.[0]?.text || track?.lang || `Track ${index + 1}`),
      language: String(track?.lang || ""),
      raw: track
    }));
  },

  getSelectedDashAudioTrackIndex() {
    const current = this.dashInstance?.getCurrentTrackFor?.("audio");
    const tracks = this.getDashAudioTracks();
    if (!current || !tracks.length) {
      return -1;
    }
    const exactMatch = tracks.findIndex((track) => track.raw === current);
    if (exactMatch >= 0) {
      return exactMatch;
    }
    const currentId = String(current?.id ?? "");
    const currentLang = String(current?.lang ?? "");
    return tracks.findIndex(
      (track) =>
        String(track?.id ?? "") === currentId && String(track?.language ?? "") === currentLang
    );
  },

  setDashAudioTrack(index) {
    const targetIndex = Number(index);
    const tracks = this.getDashAudioTracks();
    if (!Number.isFinite(targetIndex) || targetIndex < 0 || targetIndex >= tracks.length) {
      return false;
    }
    const target = tracks[targetIndex]?.raw || null;
    if (!target || typeof this.dashInstance?.setCurrentTrack !== "function") {
      return false;
    }
    try {
      this.dashInstance.setCurrentTrack(target);
      const currentTime = Number(this.video?.currentTime || 0);
      if (Number.isFinite(currentTime) && currentTime > 0) {
        this.video.currentTime = Math.max(0, currentTime - 0.001);
      }
      this.emitVideoEvent("dashtrackschanged", { playbackEngine: "dash.js" });
      return true;
    } catch (_) {
      return false;
    }
  },

  getDashTextTracks() {
    const tracks = this.dashInstance?.getTracksFor?.("text");
    if (!Array.isArray(tracks)) {
      return [];
    }
    return tracks.filter(Boolean).map((track, index) => ({
      id: String(track?.id ?? `dash-text-${index}`),
      index,
      textTrackIndex: Number(track?.index),
      label: String(track?.labels?.[0]?.text || track?.lang || `Subtitle ${index + 1}`),
      language: String(track?.lang || ""),
      raw: track
    }));
  },

  getSelectedDashTextTrackIndex() {
    const current = this.dashInstance?.getCurrentTrackFor?.("text");
    const tracks = this.getDashTextTracks();
    if (!current || !tracks.length) {
      return -1;
    }
    const exactMatch = tracks.findIndex((track) => track.raw === current);
    if (exactMatch >= 0) {
      return exactMatch;
    }
    const currentId = String(current?.id ?? "");
    const currentLang = String(current?.lang ?? "");
    return tracks.findIndex(
      (track) =>
        String(track?.id ?? "") === currentId && String(track?.language ?? "") === currentLang
    );
  },

  setDashTextTrack(index) {
    const targetIndex = Number(index);
    const player = this.dashInstance;
    if (!player) {
      return false;
    }

    if (!Number.isFinite(targetIndex) || targetIndex < 0) {
      try {
        player.setTextTrack?.(-1);
      } catch (_) {
        // Ignore disable-text failures.
      }
      try {
        player.enableText?.(false);
      } catch (_) {
        // Ignore text disable fallback failures.
      }
      this.emitVideoEvent("dashtrackschanged", { playbackEngine: "dash.js" });
      return true;
    }

    const tracks = this.getDashTextTracks();
    if (targetIndex >= tracks.length) {
      return false;
    }

    const target = tracks[targetIndex] || null;
    try {
      player.enableText?.(true);
    } catch (_) {
      // Ignore text enable failures.
    }
    try {
      if (Number.isFinite(target?.textTrackIndex) && typeof player.setTextTrack === "function") {
        player.setTextTrack(target.textTrackIndex);
      } else if (target?.raw && typeof player.setCurrentTrack === "function") {
        player.setCurrentTrack(target.raw);
      } else {
        return false;
      }
      this.emitVideoEvent("dashtrackschanged", { playbackEngine: "dash.js" });
      return true;
    } catch (_) {
      return false;
    }
  },

  getHlsAudioTracks() {
    return hlsJsEngine.getAudioTracks(this.hlsInstance);
  },

  getSelectedHlsAudioTrackIndex() {
    return hlsJsEngine.getSelectedAudioTrackIndex(this.hlsInstance);
  },

  setHlsAudioTrack(index) {
    const applied = hlsJsEngine.setAudioTrack(this.hlsInstance, index);
    if (applied) {
      this.emitVideoEvent("hlstrackschanged", { playbackEngine: "hls.js" });
    }
    return applied;
  },

  getHlsSubtitleTracks() {
    return hlsJsEngine.getSubtitleTracks(this.hlsInstance);
  },

  getSelectedHlsSubtitleTrackIndex() {
    return hlsJsEngine.getSelectedSubtitleTrackIndex(this.hlsInstance);
  },

  setHlsSubtitleTrack(index) {
    const applied = hlsJsEngine.setSubtitleTrack(this.hlsInstance, index);
    if (applied) {
      this.emitVideoEvent("hlstrackschanged", { playbackEngine: "hls.js" });
    }
    return applied;
  },

  normalizePlaybackRate(speed = 1) {
    const targetSpeed = Number(speed || 1);
    if (!Number.isFinite(targetSpeed) || targetSpeed <= 0) {
      return NaN;
    }
    return targetSpeed;
  },

  getSupportedPlaybackRates() {
    return [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
  },

  getPlaybackRate() {
    const targetSpeed = this.normalizePlaybackRate(this.desiredPlaybackRate);
    if (Number.isFinite(targetSpeed)) {
      return targetSpeed;
    }
    return Number(this.video?.playbackRate || 1);
  },

  async setPlaybackRate(speed = 1) {
    if (!this.video) {
      return false;
    }
    const targetSpeed = this.normalizePlaybackRate(speed);
    if (!Number.isFinite(targetSpeed)) {
      return false;
    }

    try {
      this.video.playbackRate = targetSpeed;
    } catch (_) {
      return false;
    }
    this.desiredPlaybackRate = targetSpeed;

    return true;
  },

  setNativeAudioTrack(index) {
    if (!this.video) {
      return false;
    }
    const targetIndex = Number(index);
    const tracks = this.nativeAudioTrackListToArray();
    if (!Number.isFinite(targetIndex) || targetIndex < 0 || targetIndex >= tracks.length) {
      return false;
    }

    const applySelection = () => {
      tracks.forEach((track, trackIndex) => {
        const selected = trackIndex === targetIndex;
        try {
          if ("enabled" in track) {
            track.enabled = selected;
          }
        } catch (_) {
          // Best effort.
        }
        try {
          if ("selected" in track) {
            track.selected = selected;
          }
        } catch (_) {
          // Best effort.
        }
      });
    };

    applySelection();
    return true;
  },

  setNativeTextTrack(index) {
    if (!this.video) {
      return false;
    }
    const targetIndex = Number(index);
    const textTrackList =
      this.video.textTracks || this.video.webkitTextTracks || this.video.mozTextTracks || null;
    let tracks = [];
    if (textTrackList) {
      try {
        tracks = Array.from(textTrackList).filter(Boolean);
      } catch (_) {
        const trackCount = Number(textTrackList.length || 0);
        for (let trackIndex = 0; trackIndex < trackCount; trackIndex += 1) {
          const track = textTrackList[trackIndex] || textTrackList.item?.(trackIndex) || null;
          if (track) {
            tracks.push(track);
          }
        }
      }
    }
    if (!Number.isFinite(targetIndex) || targetIndex < -1 || targetIndex >= tracks.length) {
      return false;
    }

    tracks.forEach((track, trackIndex) => {
      try {
        track.mode = targetIndex >= 0 && trackIndex === targetIndex ? "showing" : "disabled";
      } catch (_) {
        // Best effort.
      }
    });

    return true;
  },

  choosePlaybackEngine(url, sourceType, itemType = this.currentItemType) {
    const candidates = this.getPlaybackEngineCandidates(url, sourceType, itemType);
    if (candidates.length) {
      return candidates[0];
    }
    return "native-file";
  },

  async ensureAdaptiveLibrariesForSource(sourceType, playbackEngine = null) {
    const normalizedEngine = String(playbackEngine || "").trim();
    const normalizedSourceType = String(sourceType || "").trim();
    if (!normalizedSourceType) {
      return;
    }
    if (
      this.isLikelyHlsMimeType(normalizedSourceType) ||
      this.isLikelyDashMimeType(normalizedSourceType)
    ) {
      await loadStreamingLibs({
        hls: this.isLikelyHlsMimeType(normalizedSourceType),
        dash: this.isLikelyDashMimeType(normalizedSourceType)
      });
    }
  },

  unbindVideoElementListeners() {
    this.videoElementListeners.forEach(({ target, eventName, handler }) => {
      target?.removeEventListener?.(eventName, handler);
    });
    this.videoElementListeners = [];
  },

  bindVideoElement(video) {
    if (!video) {
      return false;
    }
    this.unbindVideoElementListeners();
    this.video = video;
    const listen = (eventName, handler) => {
      video.addEventListener(eventName, handler);
      this.videoElementListeners.push({ target: video, eventName, handler });
    };

    listen("ended", () => {
      this.isPlaying = false;
      const context = this.createProgressContext();
      const durationMs = Math.floor(this.getDurationSeconds() * 1000);
      const completedMs =
        durationMs > 0 ? durationMs : Math.floor(this.getCurrentTimeSeconds() * 1000);
      this.flushProgress(completedMs, durationMs > 0 ? durationMs : completedMs, false, context);
    });

    listen("error", (e) => {
      this.isPlaying = false;
      const customErrorCode = Number(e?.detail?.mediaErrorCode || 0);
      const nativeErrorCode = Number(this.video?.error?.code || 0);
      const mediaErrorCode = customErrorCode || nativeErrorCode || this.getLastPlaybackErrorCode();
      const diagnostic = {
        event: e?.type || "error",
        mediaErrorCode,
        playbackEngine: this.playbackEngine
      };
      console.error("Video error:", diagnostic);
    });

    return true;
  },

  replaceBrowserVideoElement() {
    if (!this.video?.parentNode) {
      return null;
    }
    const oldVideo = this.video;
    const preservedState = {
      autoplay: Boolean(oldVideo.autoplay),
      defaultMuted: Boolean(oldVideo.defaultMuted),
      muted: Boolean(oldVideo.muted),
      playbackRate: Number(oldVideo.playbackRate || 1),
      preload: String(oldVideo.preload || "auto"),
      volume: Number.isFinite(Number(oldVideo.volume)) ? Number(oldVideo.volume) : 1
    };

    this.playRequestToken = Number(this.playRequestToken || 0) + 1;
    this.unbindVideoElementListeners();
    this.teardownAdaptiveInstances();
    try {
      oldVideo.pause();
      Array.from(oldVideo.querySelectorAll("source, track")).forEach((node) => node.remove());
      oldVideo.removeAttribute("src");
      oldVideo.load();
    } catch (_) {
      // A detached browser video can reject cleanup while its request is aborted.
    }
    const freshVideo = document.createElement("video");
    Array.from(oldVideo.attributes).forEach((attribute) => {
      freshVideo.setAttribute(attribute.name, attribute.value);
    });
    freshVideo.autoplay = preservedState.autoplay;
    freshVideo.defaultMuted = preservedState.defaultMuted;
    freshVideo.muted = preservedState.muted;
    freshVideo.preload = preservedState.preload;
    freshVideo.volume = preservedState.volume;
    freshVideo.playbackRate = preservedState.playbackRate;
    oldVideo.replaceWith(freshVideo);

    this.playbackSessionActive = false;
    this.playbackEngine = "none";
    this.bindVideoElement(freshVideo);
    return freshVideo;
  },

  init() {
    const initialVideo = document.getElementById("videoPlayer");
    this.bindVideoElement(initialVideo);
    this.video.muted = false;
    this.video.defaultMuted = false;
    this.video.volume = 1;

    if (!this.lifecycleBound) {
      this.lifecycleBound = true;
      this.lifecycleFlushHandler = () => {
        this.flushCurrentProgress({ forceCloudSync: true });
      };
      this.visibilityFlushHandler = () => {
        if (document.visibilityState === "hidden") {
          this.lifecycleFlushHandler?.();
        }
      };
      window.addEventListener("pagehide", this.lifecycleFlushHandler);
      window.addEventListener("beforeunload", this.lifecycleFlushHandler);
      document.addEventListener("visibilitychange", this.visibilityFlushHandler);
    }
  },

  async play(
    url,
    {
      itemId = null,
      itemType = "movie",
      videoId = null,
      season = null,
      episode = null,
      title = null,
      poster = null,
      background = null,
      episodeTitle = null,
      requestHeaders = {},
      mediaSourceType = null,
      forceEngine = null,
      streamIdentity = null
    } = {}
  ) {
    if (!this.video) return;

    const requestedUrl = String(url || "").trim();
    const playToken = Number(this.playRequestToken || 0) + 1;
    this.playRequestToken = playToken;

    await this.flushCurrentProgress({ allowCloudSync: false });
    if (!this.isPlaybackRequestActive(playToken)) {
      return;
    }

    // Starting a new built-in playback session is an intentional local-player
    // action. Any stale protection left by an earlier external handoff must
    // not permanently suppress this session's normal progress writes.
    this.externalProgressHandoff = null;

    // Keep the maximum duration for this playback while adaptive engines
    // transition through their initial metadata events.
    this.lastKnownDurationSeconds = 0;
    this.lastProgressSnapshot = null;
    this.playbackSessionActive = true;
    this.applyStartupAudioGateToVideo();

    this.currentItemId = itemId;
    this.currentItemType = itemType;
    this.currentVideoId = videoId;
    this.currentSeason = season == null ? null : Number(season);
    this.currentEpisode = episode == null ? null : Number(episode);
    this.currentItemTitle = title || null;
    this.currentItemPoster = poster || null;
    this.currentItemBackground = background || null;
    this.currentEpisodeTitle = episodeTitle || null;
    this.currentStreamIdentity = streamIdentity || null;
    this.currentPlaybackUrl = requestedUrl;
    this.currentPlaybackHeaders = { ...(requestHeaders || {}) };
    this.currentPlaybackMediaSourceType = this.resolveRuntimeSourceType(mediaSourceType);
    this.lastPlaybackErrorCode = 0;
    this.lastHlsErrorDiagnostic = null;

    const sourceType =
      this.currentPlaybackMediaSourceType ||
      this.resolveRuntimeSourceType(this.guessMediaMimeType(url)) ||
      null;
    const preferredEngine = forceEngine || this.choosePlaybackEngine(url, sourceType, itemType);
    await this.ensureAdaptiveLibrariesForSource(sourceType, preferredEngine);
    if (!this.isPlaybackRequestActive(playToken, requestedUrl)) {
      return;
    }
    this.rememberPlaybackEngineAttempt(this.currentPlaybackUrl, preferredEngine, {
      reset: !forceEngine
    });

    this.teardownAdaptiveInstances();
    Array.from(this.video.querySelectorAll("source")).forEach((node) => node.remove());
    this.video.pause();
    this.video.removeAttribute("src");
    this.video.load();
    if (preferredEngine === "hls.js") {
      const hlsStarted = this.playWithHlsJs(url, requestHeaders, playToken);
      if (!hlsStarted) {
        this.applyNativeSource(url, sourceType || "application/vnd.apple.mpegurl", "native-hls");
        this.attemptBrowserVideoPlay({
          warningLabel: "Playback start rejected",
          playToken
        });
      }
    } else if (preferredEngine === "dash.js") {
      const dashStarted = this.playWithDashJs(url, playToken);
      if (!dashStarted) {
        this.applyNativeSource(url, sourceType || "application/dash+xml", "native-dash");
      }
      this.attemptBrowserVideoPlay({
        warningLabel: "DASH playback start rejected",
        playToken
      });
    } else if (preferredEngine === "native-hls") {
      this.applyNativeSource(url, sourceType || "application/vnd.apple.mpegurl", "native-hls");
      this.attemptBrowserVideoPlay({
        warningLabel: "Native HLS playback start rejected",
        playToken,
        onRejected: (error) => {
          if (!this.isUnsupportedSourceError(error)) {
            return false;
          }
          const fallbackStarted = this.playWithHlsJs(url, requestHeaders, playToken);
          if (fallbackStarted) {
            this.isPlaying = true;
          }
          return fallbackStarted;
        }
      });
    } else if (preferredEngine === "native-dash") {
      this.applyNativeSource(url, sourceType || "application/dash+xml", "native-dash");
      this.attemptBrowserVideoPlay({
        warningLabel: "Native DASH playback start rejected",
        playToken,
        onRejected: (error) => {
          if (!this.isUnsupportedSourceError(error) || !this.canUseDashJs()) {
            return false;
          }
          const fallbackStarted = this.playWithDashJs(url, playToken);
          if (fallbackStarted) {
            this.isPlaying = true;
          }
          return fallbackStarted;
        }
      });
    } else {
      this.applyNativeSource(url, sourceType || null, "native-file");
      this.attemptBrowserVideoPlay({
        warningLabel: "Playback start rejected",
        playToken
      });
    }

    this.isPlaying = true;

    if (this.progressSaveTimer) {
      clearInterval(this.progressSaveTimer);
    }

    this.progressSaveTimer = setInterval(() => {
      const context = this.createProgressContext();
      this.flushProgress(
        Math.floor(this.getCurrentTimeSeconds() * 1000),
        Math.floor(this.getDurationSeconds() * 1000),
        false,
        context
      );
    }, 5000);
  },

  pause() {
    if (!this.video) return;

    this.flushCurrentProgress({ forceCloudSync: true });

    this.video.pause();
    this.isPlaying = false;
  },

  resume() {
    if (!this.video) return;

    // A user explicitly resumed the built-in player after an external return.
    // Its subsequent progress is authoritative again.
    this.releaseExternalPlaybackOwnership();
    this.flushCurrentProgress({ forceCloudSync: false });
    if (this.startupAudioGateActive) {
      this.applyStartupAudioGateToVideo();
      return;
    }

    const playPromise = this.video.play();
    if (playPromise && typeof playPromise.catch === "function") {
      playPromise.catch((error) => {
        if (this.isExpectedPlayInterruption(error)) {
          return;
        }
        console.warn("Playback resume rejected", error);
      });
    }
    this.isPlaying = true;
  },

  stop({ forceCloudSync = true, allowCloudSync = true, flushProgress = true } = {}) {
    if (!this.video) return;

    this.playRequestToken = Number(this.playRequestToken || 0) + 1;
    this.setStartupPresentationAudioMuted(false);
    const flushPromise = flushProgress
      ? this.flushCurrentProgress({ forceCloudSync, allowCloudSync })
      : Promise.resolve(false);
    if (!this.playbackSessionActive) {
      if (this.progressSaveTimer) {
        clearInterval(this.progressSaveTimer);
        this.progressSaveTimer = null;
      }
      return flushPromise;
    }
    this.playbackSessionActive = false;
    this.setStartupAudioGate(false, { resume: false });

    try {
      this.video.pause();
    } catch (_) {
      // Ignore media-element cleanup failures during route transitions.
    }
    this.teardownAdaptiveInstances();
    try {
      this.video.removeAttribute("src");
    } catch (_) {
      // Ignore source reset failures during route transitions.
    }
    try {
      Array.from(this.video.querySelectorAll("source")).forEach((node) => node.remove());
    } catch (_) {
      // Ignore source node cleanup failures.
    }
    try {
      this.video.load();
    } catch (_) {
      // Ignore source-reset failures during route transitions.
    }

    this.isPlaying = false;
    this.currentItemId = null;
    this.currentItemType = null;
    this.currentVideoId = null;
    this.currentSeason = null;
    this.currentEpisode = null;
    this.currentItemTitle = null;
    this.currentItemPoster = null;
    this.currentItemBackground = null;
    this.currentEpisodeTitle = null;
    this.currentStreamIdentity = null;
    this.currentPlaybackUrl = "";
    this.currentPlaybackHeaders = {};
    this.currentPlaybackMediaSourceType = null;
    this.lastKnownDurationSeconds = 0;
    this.playbackEngine = "none";
    this.lastPlaybackErrorCode = 0;
    this.clearPlaybackEngineAttempts();

    if (this.progressSaveTimer) {
      clearInterval(this.progressSaveTimer);
      this.progressSaveTimer = null;
    }

    return flushPromise;
  },

  createProgressContext() {
    const itemType = this.currentItemType || "movie";
    const normalizedItemType = String(itemType).trim().toLowerCase();
    const isSeries = normalizedItemType === "series" || normalizedItemType === "tv";
    return {
      itemId: this.currentItemId,
      itemType,
      // Android stores movie progress at content level and episode progress at
      // the exact season/episode identity. A movie's discovery video ID can
      // vary between addons and must not split resume state by source.
      videoId: isSeries ? this.currentVideoId || null : null,
      season: Number.isFinite(this.currentSeason) ? this.currentSeason : null,
      episode: Number.isFinite(this.currentEpisode) ? this.currentEpisode : null,
      title: this.currentItemTitle || null,
      poster: this.currentItemPoster || null,
      background: this.currentItemBackground || null,
      episodeTitle: this.currentEpisodeTitle || null,
      streamIdentity: this.currentStreamIdentity || null
    };
  },

  buildProgressSnapshotKey(context = this.createProgressContext()) {
    if (!context?.itemId) {
      return "";
    }
    return [
      String(context.itemId || "").trim(),
      String(context.itemType || "movie").trim(),
      String(context.videoId || "").trim(),
      Number.isFinite(context.season) ? Number(context.season) : "",
      Number.isFinite(context.episode) ? Number(context.episode) : ""
    ].join("|");
  },

  recordProgressSnapshot(positionMs, durationMs, context = null) {
    const active = context || this.createProgressContext();
    const safePosition = Number(positionMs || 0);
    const safeDuration = Number(durationMs || 0);
    if (!active?.itemId || !Number.isFinite(safePosition) || safePosition <= 0) {
      return;
    }
    this.lastProgressSnapshot = {
      key: this.buildProgressSnapshotKey(active),
      positionMs: Math.max(0, Math.trunc(safePosition)),
      durationMs:
        Number.isFinite(safeDuration) && safeDuration > 0
          ? Math.max(0, Math.trunc(safeDuration))
          : 0,
      updatedAt: Date.now()
    };
  },

  getRecordedProgressSnapshot(context = null) {
    const active = context || this.createProgressContext();
    const snapshot = this.lastProgressSnapshot;
    if (!snapshot || !active?.itemId) {
      return null;
    }
    if (snapshot.key !== this.buildProgressSnapshotKey(active)) {
      return null;
    }
    return snapshot;
  },

  async flushCurrentProgress({ forceCloudSync = false, allowCloudSync = true } = {}) {
    const context = this.createProgressContext();
    if (!context.itemId) {
      return false;
    }

    const snapshot = this.getRecordedProgressSnapshot(context);
    const currentPositionMs = Math.floor(this.getCurrentTimeSeconds() * 1000);
    const currentDurationMs = Math.floor(this.getDurationSeconds() * 1000);
    const positionMs =
      Number.isFinite(currentPositionMs) && currentPositionMs > 0
        ? currentPositionMs
        : Number(snapshot?.positionMs || 0);
    const durationMs =
      Number.isFinite(currentDurationMs) && currentDurationMs > 0
        ? currentDurationMs
        : Number(snapshot?.durationMs || 0);

    await this.flushProgress(positionMs, durationMs, false, context, {
      allowCloudSync: allowCloudSync && !forceCloudSync
    });
    if (forceCloudSync) {
      await this.pushProgressIfDue(true);
    }
    return true;
  },

  beginExternalPlaybackHandoff(handoff) {
    const context = handoff?.progressContext;
    if (!context?.itemId || this.buildProgressSnapshotKey(context) !== this.buildProgressSnapshotKey()) return false;
    this.externalProgressHandoff = {
      key: this.buildProgressSnapshotKey(context),
      token: String(handoff.token || ""),
      authoritativePositionMs: null,
      completed: false
    };
    // Start one final best-effort save without delaying the user-gesture
    // custom-scheme launch (iOS can reject a launch after an await).
    void this.flushCurrentProgress({ forceCloudSync: true });
    try { this.video?.pause?.(); } catch (_) { /* Best effort before app handoff. */ }
    this.isPlaying = false;
    return true;
  },

  releaseExternalPlaybackOwnership() {
    this.externalProgressHandoff = null;
  },

  shouldSuppressStaleInternalProgress(context, positionMs) {
    const handoff = this.externalProgressHandoff;
    if (!handoff || handoff.key !== this.buildProgressSnapshotKey(context) || handoff.authoritativePositionMs == null) return false;
    if (handoff.completed) return true;
    return Number(positionMs || 0) <= Number(handoff.authoritativePositionMs) + 1000;
  },

  acceptExternalPlaybackProgress(context, positionMs, durationMs) {
    const handoff = this.externalProgressHandoff;
    if (!handoff || handoff.key !== this.buildProgressSnapshotKey(context)) return;
    handoff.authoritativePositionMs = Math.max(0, Number(positionMs) || 0);
    handoff.completed = Number(durationMs) > 0 && handoff.authoritativePositionMs / Number(durationMs) >= 0.9;
    if (this.video) {
      try { this.video.currentTime = handoff.authoritativePositionMs / 1000; } catch (_) { /* Media may be detached. */ }
      try { this.video.pause(); } catch (_) { /* Keep the built-in player paused. */ }
    }
    this.isPlaying = false;
  },

  acceptExternalPlaybackCompletion(context) {
    const handoff = this.externalProgressHandoff;
    if (!handoff || handoff.key !== this.buildProgressSnapshotKey(context)) return;
    handoff.completed = true;
    if (this.video) {
      try { this.video.pause(); } catch (_) { /* Keep the built-in player paused. */ }
    }
    this.isPlaying = false;
  },

  async completePlayback(context = null, { allowCloudSync = true, externalAuthoritative = false } = {}) {
    const active = context || this.createProgressContext();
    if (!active?.itemId) return false;
    if (!externalAuthoritative && this.shouldSuppressStaleInternalProgress(active, 0)) return true;
    await this.markPlaybackWatched(active);
    if (externalAuthoritative) this.acceptExternalPlaybackCompletion(active);
    if (allowCloudSync) await this.pushProgressIfDue(true);
    return true;
  },

  async applyExternalPlaybackReport({ handoff, outcome, positionSeconds = null, durationSeconds = null } = {}) {
    const context = handoff?.progressContext;
    if (!context?.itemId || !["finished", "stopped"].includes(outcome)) {
      return false;
    }
    const toMilliseconds = (value) => {
      const seconds = Number(value);
      return Number.isFinite(seconds) && seconds >= 0 ? Math.round(seconds * 1000) : 0;
    };
    const reportedPositionMs = toMilliseconds(positionSeconds);
    const reportedDurationMs = toMilliseconds(durationSeconds);
    const knownDurationMs = Math.max(0, Number(handoff?.knownDurationMs || 0));
    const durationMs = reportedDurationMs || knownDurationMs;
    if ((positionSeconds != null && !reportedPositionMs) || (durationSeconds != null && !reportedDurationMs)) {
      return false;
    }
    if (durationMs > 0 && reportedPositionMs > durationMs * 1.1 + 60000) {
      return false;
    }
    if (outcome === "finished") {
      return PlayerController.completePlayback.call(this, context, { externalAuthoritative: true });
    }
    if (reportedPositionMs <= 0) return false;
    const applied = await this.flushProgress(reportedPositionMs, durationMs, false, context, { externalAuthoritative: true });
    if (applied) this.acceptExternalPlaybackProgress?.(context, reportedPositionMs, durationMs);
    return applied;
  },

  async flushProgress(
    positionMs,
    durationMs,
    clear = false,
    context = null,
    { allowCloudSync = true, externalAuthoritative = false } = {}
  ) {
    const active = context || this.createProgressContext();
    if (!active?.itemId) {
      return;
    }

    const safePosition = Number(positionMs || 0);
    const safeDuration = Number(durationMs || 0);
    if (!externalAuthoritative && this.shouldSuppressStaleInternalProgress(active, safePosition)) return true;
    const hasFiniteDuration = Number.isFinite(safeDuration) && safeDuration > 0;
    const hasReachedMinimumSyncPosition =
      Number.isFinite(safePosition) && safePosition >= MIN_PROGRESS_SYNC_DURATION_MS;
    const isCompleted = hasFiniteDuration && safePosition / safeDuration >= 0.9;
    if (safePosition > 0) {
      this.recordProgressSnapshot(safePosition, safeDuration, active);
    }
    if (!clear && !isCompleted) {
      if (hasFiniteDuration && safeDuration < MIN_PROGRESS_SYNC_DURATION_MS) {
        return false;
      }
      if (!hasFiniteDuration && !hasReachedMinimumSyncPosition) {
        return false;
      }
    }

    if (clear || isCompleted) {
      if (isCompleted) {
        return this.completePlayback(active, { allowCloudSync, externalAuthoritative });
      } else {
        await watchProgressRepository.removeProgress(active.itemId, active.videoId || null);
      }
      if (!allowCloudSync) {
        return true;
      }
      // Local watched/progress state (and series reconciliation above) is the
      // canonical completion boundary. A delayed/offline cloud push must not
      // make an already-applied completion look like a failed playback report.
      await this.pushProgressIfDue(true);
      return true;
    }

    if (!Number.isFinite(safePosition) || safePosition <= 0) {
      return false;
    }

    await watchProgressRepository.saveProgress({
      contentId: active.itemId,
      contentType: active.itemType || "movie",
      videoId: active.videoId || null,
      season: active.season,
      episode: active.episode,
      title: active.title || null,
      poster: active.poster || null,
      background: active.background || null,
      logo: active.logo || null,
      episodeTitle: active.episodeTitle || null,
      // Persist the stream identity so Continue Watching can resume the same
      // source instead of reopening the stream picker.
      streamIdentity: active.streamIdentity || null,
      positionMs: Math.max(0, Math.trunc(safePosition)),
      durationMs: hasFiniteDuration ? Math.max(0, Math.trunc(safeDuration)) : 0
    });
    if (!allowCloudSync) {
      return true;
    }
    // Saving progress locally succeeded. Cloud sync is best effort and has
    // its own retry path, so callers must not show a manual fallback merely
    // because this particular push was deferred or offline.
    await this.pushProgressIfDue(false);
    return true;
  },

  pushProgressIfDue(force = false) {
    const now = Date.now();
    if (!force && now - Number(this.lastProgressPushAt || 0) < 30000) {
      return Promise.resolve(false);
    }
    this.lastProgressPushAt = now;
    return WatchProgressSyncService.push().catch((error) => {
      console.warn("Watch progress auto push failed", error);
      return false;
    });
  }
};
