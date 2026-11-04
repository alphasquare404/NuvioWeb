// Local console diagnostics only. Never serialize caller objects or error messages.
export function createPlaybackPauseTrace({
  now = Date.now,
  write = (record) => console.warn("[PlaybackPause] " + JSON.stringify(record)),
  schedule = setTimeout,
  cancel = clearTimeout,
  visibilityTarget = globalThis.document
} = {}) {
  let video = null,
    context = () => ({}),
    listeners = [],
    timers = [];
  let sequence = 0,
    active = false,
    pausedAt = null,
    resumedAt = null,
    records = 0;
  const engines = new Set([
    "native",
    "native-file",
    "native-hls",
    "hls",
    "hlsjs",
    "hls.js",
    "dash",
    "dashjs",
    "client-remux",
    "server-remux"
  ]);
  const states = new Set([
    "playing",
    "backpressure",
    "restoring",
    "seeking",
    "remux-complete",
    "error",
    "loading",
    "opening",
    "idle"
  ]);
  const number = (value) =>
    typeof value === "number" && Number.isFinite(value)
      ? Math.round(value * 1000) / 1000
      : undefined;
  function readContext() {
    try {
      return context() || {};
    } catch {
      return {};
    }
  }
  function ranges(value) {
    const result = [];
    try {
      for (let i = 0; i < value.length && result.length < 3; i++) {
        if (value.end(i) < Number(video.currentTime || 0) - 1) continue;
        result.push([number(value.start(i)), number(value.end(i))]);
      }
    } catch {
      /* A source may detach during an error. */
    }
    return result;
  }
  function sample() {
    const ctx = readContext(),
      remux = ctx.remux || {},
      safe = {};
    for (const key of ["paused", "muted", "seeking", "ended"]) safe[key] = Boolean(video?.[key]);
    for (const key of ["readyState", "networkState", "currentTime", "duration", "playbackRate"]) {
      const n = number(video?.[key]);
      if (n !== undefined) safe[key] = n;
    }
    safe.mediaErrorCode = number(video?.error?.code || ctx.mediaErrorCode || 0);
    safe.buffered = ranges(video?.buffered);
    safe.seekable = ranges(video?.seekable);
    if (engines.has(ctx.engine)) safe.engine = ctx.engine;
    if (["direct", "remux", "audio-transcode"].includes(ctx.route)) safe.route = ctx.route;
    if (["off", "client", "server"].includes(ctx.remuxMode)) safe.remuxMode = ctx.remuxMode;
    safe.offline = ctx.offline === true;
    safe.background = visibilityTarget?.hidden === true;
    safe.remuxAvailable = Boolean(ctx.remux);
    if (typeof remux.cacheEnabled === "boolean") safe.cacheEnabled = remux.cacheEnabled;
    if (typeof remux.restoring === "boolean") safe.restoring = remux.restoring;
    if (states.has(remux.state)) safe.remuxState = remux.state;
    if (["bytes", "time", "managed", "native-seek"].includes(remux.backpressureReason))
      safe.backpressureReason = remux.backpressureReason;
    for (const key of [
      "cacheBytes",
      "cacheLimitBytes",
      "cacheUnits",
      "cacheEvictions",
      "cacheHits",
      "cachePinnedBytes",
      "retainedCompressedBytes",
      "bufferedAheadSeconds",
      "targetSourceBytes"
    ]) {
      const n = number(remux[key]);
      if (n !== undefined) safe[key] = n;
    }
    if (Number.isInteger(ctx.httpStatus) && ctx.httpStatus >= 100 && ctx.httpStatus <= 599)
      safe.httpStatus = ctx.httpStatus;
    try {
      const frames = number(
        video.getVideoPlaybackQuality?.()?.totalVideoFrames ?? video.webkitDecodedFrameCount
      );
      if (frames !== undefined) safe.decodedFrames = frames;
    } catch {
      /* Unsupported video quality API. */
    }
    return safe;
  }
  function emit(event, extra = {}, important = false) {
    if (!active || !video || records >= 44 || (!important && records >= 40)) return;
    records++;
    const time = now();
    const record = {
      sequence,
      event,
      ...(pausedAt != null ? { sincePauseMs: time - pausedAt } : {}),
      ...(resumedAt != null
        ? { sinceResumeMs: time - resumedAt, pauseDurationMs: resumedAt - pausedAt }
        : {}),
      ...sample(),
      ...extra
    };
    try {
      write(record);
    } catch {
      /* Diagnostics must never interrupt playback. */
    }
  }
  function clearTimers() {
    timers.forEach(cancel);
    timers = [];
  }
  function beginPause(event) {
    if (!video || (!active && !readContext().presented)) return;
    if (!active || resumedAt != null) {
      clearTimers();
      sequence++;
      active = true;
      records = 0;
      pausedAt = now();
      resumedAt = null;
    }
    emit(event);
  }
  function beginResume(event) {
    if (!active || !video) return;
    if (resumedAt == null) {
      resumedAt = now();
      const cycle = sequence,
        sourceVideo = video;
      for (const delay of [1000, 5000, 15000, 30000, 60000]) {
        const timer = schedule(() => {
          if (cycle === sequence && video === sourceVideo) emit("resume-check");
        }, delay);
        timer?.unref?.();
        timers.push(timer);
      }
    }
    emit(event);
  }
  function visibilityChanged() {
    emit("visibility");
  }
  const api = {
    attach(nextVideo, getContext) {
      api.detach();
      video = nextVideo;
      context = getContext;
      const events = {
        pause: () => beginPause("paused"),
        play: () => beginResume("play"),
        playing: () => emit("playing"),
        waiting: () => emit("waiting"),
        stalled: () => emit("stalled"),
        emptied: () => emit("emptied"),
        abort: () => emit("aborted"),
        seeking: () => emit("seeking"),
        seeked: () => emit("seeked"),
        error: () => {
          emit("error", {}, true);
          clearTimers();
        },
        ended: () => {
          emit("ended");
          clearTimers();
          active = false;
        }
      };
      visibilityTarget?.addEventListener?.("visibilitychange", visibilityChanged);
      for (const [event, handler] of Object.entries(events)) {
        video.addEventListener(event, handler);
        listeners.push([event, handler]);
      }
    },
    pauseRequest() {
      beginPause("pause-request");
    },
    resumeRequest() {
      beginResume("resume-request");
    },
    failure(kind) {
      if (["stall-timeout", "player-error"].includes(kind)) emit(kind, {}, true);
    },
    playRejected(error) {
      const name = [
        "AbortError",
        "NotAllowedError",
        "NotSupportedError",
        "InvalidStateError",
        "UnknownError",
        "QuotaExceededError"
      ].includes(error?.name)
        ? error.name
        : "OtherError";
      emit("play-rejected", { exception: name }, true);
    },
    detach() {
      emit("closed");
      clearTimers();
      visibilityTarget?.removeEventListener?.("visibilitychange", visibilityChanged);
      for (const [event, handler] of listeners) video?.removeEventListener(event, handler);
      listeners = [];
      video = null;
      context = () => ({});
      active = false;
      pausedAt = resumedAt = null;
    }
  };
  return api;
}
export const PlaybackPauseTrace = createPlaybackPauseTrace();
