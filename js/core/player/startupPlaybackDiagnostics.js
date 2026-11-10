// Debug-only instrumentation: retain the original return values and playback behavior.
export function installStartupPlaybackDiagnostics({
  controller,
  screen,
  emit,
  maxEvents = 120,
  durationMs = 90000
}) {
  let stopped = false;
  let sequence = 0;
  const began = Date.now();
  const session = began.toString(36);
  const cleanups = [];
  const errorName = (error) =>
    ["NotAllowedError", "AbortError", "NotSupportedError", "InvalidStateError"].includes(
      error?.name
    )
      ? error.name
      : "OtherError";
  const visible = (element) => {
    if (!element?.getClientRects?.().length) return false;
    for (let node = element; node; node = node.parentElement) {
      const style = globalThis.getComputedStyle?.(node);
      if (style?.display === "none" || style?.visibility === "hidden" || style?.opacity === "0")
        return false;
    }
    return true;
  };
  const snapshot = () => {
    const video = controller.video;
    const root = screen.uiRefs?.root;
    const buttons = [...(root?.querySelectorAll?.('[data-action="playPause"]') || [])];
    const engine = controller.playbackEngine;
    return {
      engine: [
        "none",
        "native",
        "native-file",
        "native-hls",
        "hls.js",
        "dash.js",
        "client-remux"
      ].includes(engine)
        ? engine
        : "other",
      paused: Boolean(video?.paused),
      muted: Boolean(video?.muted),
      defaultMuted: Boolean(video?.defaultMuted),
      volume: Number(video?.volume || 0),
      time: Number(video?.currentTime || 0),
      ready: Number(video?.readyState || 0),
      network: Number(video?.networkState || 0),
      nativeControls: Boolean(video?.controls),
      inline: Boolean(video?.playsInline),
      controllerPlaying: Boolean(controller.isPlaying),
      screenPaused: Boolean(screen.paused),
      audioGate: Boolean(controller.startupAudioGateActive),
      gatePauses: Boolean(controller.startupAudioGatePausesPlayback),
      presentationMuted: Boolean(controller.startupPresentationAudioMuted),
      loading: Boolean(screen.loadingVisible),
      presented: Boolean(screen.hasPresentedPlaybackFrame),
      restoring: Boolean(screen.pendingPlaybackRestore),
      activation: Boolean(globalThis.navigator?.userActivation?.isActive),
      everActivated: Boolean(globalThis.navigator?.userActivation?.hasBeenActive),
      standalone: Boolean(
        globalThis.navigator?.standalone ||
        globalThis.matchMedia?.("(display-mode: standalone)").matches
      ),
      hidden: Boolean(globalThis.document?.hidden),
      playButtons: buttons.length,
      visiblePlayButtons: buttons.filter(visible).length,
      visibleCenterPlay: buttons.filter(
        (button) => button.closest?.(".nv-center") && visible(button)
      ).length,
      visibleToolbarPlay: buttons.filter(
        (button) => button.closest?.(".nv-primary-row") && visible(button)
      ).length
    };
  };
  const record = (event, extra = {}) => {
    if (stopped || sequence >= maxEvents) return;
    try {
      emit({
        session,
        sequence: ++sequence,
        ms: Date.now() - began,
        event,
        ...snapshot(),
        ...extra
      });
    } catch {
      /* Diagnostics must not affect playback. */
    }
  };
  const wrap = (owner, key, label, observePromise = false) => {
    const original = owner?.[key];
    if (typeof original !== "function") return;
    const own = Object.getOwnPropertyDescriptor(owner, key);
    const wrapped = function (...args) {
      record(label + ":call");
      try {
        const result = original.apply(this, args);
        record(label + ":returned");
        if (observePromise && result?.then) {
          result.then(
            () => record(label + ":resolved"),
            (error) => record(label + ":rejected", { error: errorName(error) })
          );
        }
        return result;
      } catch (error) {
        record(label + ":threw", { error: errorName(error) });
        throw error;
      }
    };
    try {
      owner[key] = wrapped;
      cleanups.push(() => {
        if (owner[key] !== wrapped) return;
        if (own) Object.defineProperty(owner, key, own);
        else delete owner[key];
      });
    } catch {
      /* Some browser objects do not allow instance overrides. */
    }
  };
  let attachedVideo;
  const attachVideo = () => {
    const video = controller.video;
    if (!video || video === attachedVideo) return;
    attachedVideo = video;
    record("video:attached");
    wrap(video, "play", "video.play", true);
    wrap(video, "pause", "video.pause");
    for (const event of [
      "play",
      "playing",
      "pause",
      "volumechange",
      "loadedmetadata",
      "canplay",
      "waiting",
      "stalled",
      "error",
      "ended"
    ]) {
      const listener = () => {
        if (controller.video === video) record("media:" + event);
      };
      video.addEventListener?.(event, listener);
      cleanups.push(() => video.removeEventListener?.(event, listener));
    }
  };
  for (const key of [
    "setStartupAudioGate",
    "setStartupPresentationAudioMuted",
    "resume",
    "resumePlaybackAfterStartupGate"
  ]) {
    wrap(controller, key, "controller." + key);
  }
  const gesture = (event) => {
    const button = event.target?.closest?.("[data-action], [data-player-desktop-action]");
    if (!screen.uiRefs?.root?.contains?.(button)) return;
    const action = button?.dataset?.action || button?.dataset?.playerDesktopAction;
    if (["playPause", "mute"].includes(action))
      record("gesture:" + action, { trusted: Boolean(event.isTrusted) });
  };
  globalThis.document?.addEventListener?.("click", gesture, true);
  cleanups.push(() => globalThis.document?.removeEventListener?.("click", gesture, true));
  attachVideo();
  const interval = setInterval(() => {
    attachVideo();
    record("sample");
  }, 2000);
  const cleanup = () => {
    if (stopped) return;
    record("diagnostics:stop");
    stopped = true;
    clearInterval(interval);
    clearTimeout(timeout);
    cleanups.reverse().forEach((clean) => clean());
  };
  const timeout = setTimeout(cleanup, durationMs);
  return cleanup;
}
