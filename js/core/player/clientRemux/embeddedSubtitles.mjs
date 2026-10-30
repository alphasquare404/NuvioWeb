import { cueText } from "./mkvTextSubtitles.mjs";
export function clearSubtitleCues(track) {
  if (!track) return;
  track.mode = "hidden";
  for (const cue of Array.from(track.cues || [])) track.removeCue(cue);
  track.mode = "disabled";
}
// One selected language, one removable native track. PlayerScreen owns styling.
export function createEmbeddedSubtitles({
  video,
  assetBase,
  version,
  requestHeaders = {},
  getTime,
  onTracks,
  onCues,
  onStatus,
  makeTransport = null
}) {
  let worker = null,
    sourceId = null,
    request = 0,
    list = [],
    selected = null,
    node = null,
    pending = false,
    window = null,
    state = "off",
    reason = null,
    delay = 0,
    stats = {},
    revision = 0;
  const track = () => node?.track;
  function notify() {
    onStatus({ subtitle: snapshot() });
  }
  function snapshot() {
    return { state, reason, selectedTrack: selected, coverage: window, ...stats };
  }
  function clear() {
    revision++;
    clearSubtitleCues(track());
  }
  function dispose() {
    worker?.terminate();
    worker = null;
    sourceId = null;
    request++;
    clear();
    node?.remove();
    node = null;
    list = [];
    selected = null;
    pending = false;
    window = null;
    state = "off";
    reason = null;
    stats = {};
  }
  function load(time, force = false) {
    if (!worker || selected === null) return;
    const target = Math.max(0, time - delay);
    if (!force && (pending || (window && target >= window.from && target < window.to - 8))) return;
    pending = true;
    state = "loading";
    reason = null;
    request++;
    notify();
    worker.postMessage({
      type: "window",
      sourceId,
      requestId: request,
      trackId: selected,
      time: target
    });
  }
  function select(id) {
    const candidate = list.find((t) => String(t.id) === String(id));
    if (id !== null && id !== -1 && id !== "off" && !candidate?.supported) return false;
    request++;
    worker?.postMessage({ type: "cancel", sourceId, requestId: request });
    pending = false;
    clear();
    window = null;
    selected = candidate?.id ?? null;
    if (selected === null) {
      state = "off";
      notify();
      return true;
    }
    if (typeof VTTCue !== "function") {
      state = "error";
      reason = "texttrack-api-unavailable";
      notify();
      return false;
    }
    if (!node) {
      node = document.createElement("track");
      node.kind = "subtitles";
      node.label = "Embedded text";
      video.appendChild(node);
    }
    track().mode = "showing";
    load(getTime(), true);
    return true;
  }
  function setSource(url) {
    dispose();
    sourceId = crypto.randomUUID();
    state = "opening";
    worker = makeTransport ? makeTransport() : new Worker(new URL("subtitle-worker.js", assetBase));
    worker.onmessage = ({ data }) => {
      if (data.sourceId !== sourceId) return;
      if (data.type === "tracks") {
        list = data.tracks;
        state = "ready";
        onTracks();
        notify();
        return;
      }
      if (data.requestId !== undefined && data.requestId !== request) return;
      if (data.type === "window") {
        pending = false;
        window = { from: data.result.from, to: data.result.to };
        stats = data.result.stats;
        state = "showing";
        reason = null;
        const layer = track();
        if (!layer || selected === null) return;
        const mode = layer.mode,
          rev = ++revision;
        layer.mode = "hidden";
        for (const cue of Array.from(layer.cues || [])) layer.removeCue(cue);
        for (const c of data.result.cues) {
          const cue = new VTTCue(c.start, c.end, cueText(c.text));
          cue.id = c.id;
          layer.addCue(cue);
        }
        layer.mode = mode === "disabled" ? "showing" : mode;
        onCues();
        requestAnimationFrame(() => {
          if (rev === revision && selected !== null && layer.mode === "disabled")
            layer.mode = mode === "disabled" ? "hidden" : mode;
        });
        notify();
      } else if (data.type === "error") {
        pending = false;
        state = "error";
        reason = data.reason;
        stats = data.stats || stats;
        notify();
      }
    };
    worker.onerror = () => {
      pending = false;
      state = "error";
      reason = "subtitle-worker-error";
      notify();
    };
    worker.postMessage({ type: "open", version, requestHeaders, sourceId, url });
    notify();
  }
  const timer = setInterval(() => {
    if (selected !== null && !video.paused && state !== "error") load(getTime());
  }, 500);
  return {
    setSource,
    dispose,
    seek(time) {
      load(time, true);
    },
    select,
    tracks: () => list.map((t) => ({ ...t, selected: t.id === selected })),
    setDelay(value) {
      if (delay !== value) {
        delay = Number(value) || 0;
        load(getTime(), true);
      }
    },
    snapshot,
    destroy() {
      clearInterval(timer);
      dispose();
    }
  };
}
