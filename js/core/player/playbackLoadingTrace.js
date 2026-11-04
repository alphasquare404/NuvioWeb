// Local console only. Never accept URLs, filenames, tokens or free-form errors.
export function createPlaybackLoadingTrace({
  now = Date.now,
  write = (record) => console.warn("[PlaybackLoading] " + JSON.stringify(record)),
  schedule = setInterval,
  cancel = clearInterval
} = {}) {
  let active = false,
    attempt = 0,
    startedAt = 0,
    stageAt = 0,
    stage = "finding",
    timer = null,
    beats = 0,
    snapshot = {};
  const stages = new Set([
    "finding",
    "checking",
    "opening",
    "loading",
    "metadata",
    "frame",
    "restoring"
  ]);
  const emit = (event) =>
    write({
      attempt,
      event,
      stage,
      elapsedMs: now() - startedAt,
      stageMs: now() - stageAt,
      ...snapshot
    });
  return {
    get active() {
      return active;
    },
    begin(next = "finding") {
      if (active) return;
      active = true;
      attempt++;
      startedAt = stageAt = now();
      stage = stages.has(next) ? next : "finding";
      snapshot = {};
      beats = 0;
      emit("begin");
      timer = schedule(() => {
        if (active && beats++ < 60) emit("waiting");
      }, 5000);
      timer?.unref?.();
    },
    stage(next) {
      if (!active || !stages.has(next) || stage === next) return;
      stage = next;
      stageAt = now();
      emit("stage");
    },
    sample(value = {}) {
      if (!active) return;
      const safe = {};
      for (const key of [
        "paused",
        "muted",
        "audioGate",
        "presentationMuted",
        "restoring",
        "seeking",
        "firstFrame",
        "controls"
      ]) {
        if (typeof value[key] === "boolean") safe[key] = value[key];
      }
      for (const key of ["readyState", "networkState", "position", "target", "mediaErrorCode"]) {
        if (typeof value[key] === "number" && Number.isFinite(value[key]))
          safe[key] = Math.round(value[key] * 1000) / 1000;
      }
      if (
        [
          "native-file",
          "native-hls",
          "hls",
          "hlsjs",
          "hls.js",
          "dash",
          "client-remux",
          "server-remux"
        ].includes(value.engine)
      )
        safe.engine = value.engine;
      snapshot = { ...snapshot, ...safe };
    },
    finish(reason = "finished") {
      if (!active) return;
      emit(["finished", "back", "error", "replaced"].includes(reason) ? reason : "finished");
      active = false;
      cancel(timer);
      timer = null;
      snapshot = {};
    }
  };
}
export const PlaybackLoadingTrace = createPlaybackLoadingTrace();
