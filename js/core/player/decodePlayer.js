import { createWakeLock } from "./movi/wakeLock.js";
import { resolveMediaHead } from "./mediaHeadResolver.js";
import { clientRemuxAssets } from "./remuxClient.js";
import { createEmbeddedSubtitles } from "./clientRemux/embeddedSubtitles.mjs";
import { clientMediaUrlResolver } from "../streams/clientMediaUrlResolver.js";
import { normalizeTrackLanguageCode } from "./trackLanguage.js";

export function createDecodePlayer({ video, requestHeaders, languages, emit, onError, onCues }) {
  const abort = new AbortController();
  const { signal } = abort;
  const { assetBase, version } = clientRemuxAssets();
  const canvas = video.ownerDocument.createElement("canvas");
  canvas.className = "player-decode-picture";
  canvas.setAttribute("aria-hidden", "true");
  video.after(canvas);
  const originals = new Map();
  const expose = (name, descriptor) => {
    originals.set(name, Object.getOwnPropertyDescriptor(video, name));
    Object.defineProperty(video, name, { configurable: true, ...descriptor });
  };

  const wakeLock = createWakeLock();
  let input;
  let playback;
  let subtitles;
  let ready = 0;
  let previous = null;
  let seekPending = false;
  let autoplayBlocked = false;
  let failed = false;
  let pendingPlay = false;
  let playingRequest = null;
  const state = () => playback?.snapshot();
  const paused = () => !state()?.playing;
  const time = () => state()?.time ?? 0;
  const duration = () => state()?.duration ?? NaN;
  expose("paused", { get: paused });
  expose("currentTime", {
    get: time,
    set: (value) => {
      void seek(value);
    }
  });
  expose("duration", { get: duration });
  expose("readyState", { get: () => ready });
  expose("ended", { get: () => Boolean(state()?.ended) });
  expose("seeking", { get: () => seekPending });
  expose("videoWidth", { get: () => (ready >= 2 ? canvas.width : 0) });
  expose("videoHeight", { get: () => (ready >= 2 ? canvas.height : 0) });
  expose("play", { value: resume });
  expose("pause", {
    value: () => {
      pendingPlay = false;
      playback?.pause();
    }
  });

  function setVolume() {
    playback?.setVolume(video.muted ? 0 : video.volume);
  }
  video.addEventListener("volumechange", setVolume);

  function reportState(next) {
    if (signal.aborted) return;
    const last = previous;
    previous = next;
    if (next.playing && !next.buffering && !wakeLock.isWanted()) void wakeLock.start();
    else if (!next.playing && wakeLock.isWanted()) void wakeLock.stop();
    if (next.buffering && !last?.buffering) emit("waiting");
    if (next.playing && !next.buffering && (!last?.playing || last?.buffering)) emit("playing");
    if (next.ended && !last?.ended) emit("ended");
    else if (!next.playing && last?.playing) emit("pause");
    emit("timeupdate");
    emit("remuxstatus");
  }

  function reportFrame() {
    if (signal.aborted) return;
    if (ready < 3) {
      ready = 3;
      video.classList.add("player-decode-source");
      emit("loadeddata");
      emit("canplay");
    }
    if (seekPending) {
      seekPending = false;
      subtitles?.seek(time() + playback.sourceStart);
      emit("seeked");
    }
  }

  function chooseAudio(tracks) {
    for (const language of languages) {
      const code = normalizeTrackLanguageCode(language);
      if (!code) continue;
      const exact = tracks.find((track) => normalizeTrackLanguageCode(track.language) === code);
      const base = code.split("-")[0];
      const match =
        exact ||
        tracks.find((track) => normalizeTrackLanguageCode(track.language).split("-")[0] === base);
      if (match) return match.index;
    }
    return tracks.find((track) => track.default)?.index ?? tracks[0]?.index ?? -1;
  }

  async function seek(value) {
    if (!playback || !Number.isFinite(value)) return;
    seekPending = value < duration();
    if (seekPending) emit("seeking");
    playback.seek(value);
    if (!seekPending) emit("seeked");
  }

  async function resume() {
    pendingPlay = true;
    if (!playback || ready < 2) return;
    if (paused()) {
      autoplayBlocked = false;
      try {
        playingRequest ||= playback.play().finally(() => {
          playingRequest = null;
        });
        await playingRequest;
        if (!pendingPlay) playback.pause();
      } catch (error) {
        if (!signal.aborted && error.name === "NotAllowedError") {
          autoplayBlocked = true;
          emit("remuxstatus");
          return;
        }
        throw error;
      }
    }
  }

  return {
    canvas,
    async start({ url, start = 0, autoplay, playbackRate }) {
      pendingPlay = autoplay;
      emit("loadstart");
      const module = await import(new URL("decode-runtime.js", assetBase).href);
      signal.throwIfAborted();
      let headers = requestHeaders;
      try {
        input = await module.openDecodeSource({ url, headers, signal });
      } catch (error) {
        if (!clientMediaUrlResolver.canUseHost(url) || signal.aborted) throw error;
        const resolved = await clientMediaUrlResolver.resolve(url, { signal, skipDirect: true });
        if (!resolved?.ok || resolved.url === url) throw error;
        if (new URL(resolved.url).origin !== new URL(url).origin) headers = null;
        url = resolved.url;
        input = await module.openDecodeSource({ url, headers, signal });
      }
      try {
        signal.throwIfAborted();
        playback = await module.createDecodePlayback({
          input,
          canvas,
          chooseAudio,
          onState: reportState,
          onFrame: reportFrame,
          onError: () => {
            if (signal.aborted) return;
            failed = true;
            onError();
          }
        });
      } catch (error) {
        if (signal.aborted) input.dispose();
        throw error;
      }
      if (signal.aborted) {
        playback.destroy();
        signal.throwIfAborted();
      }
      playback.setRate(playbackRate);
      setVolume();
      if (/matroska|webm/i.test(playback.format)) {
        subtitles = createEmbeddedSubtitles({
          video,
          assetBase,
          version,
          requestHeaders: headers,
          getTime: () => time() + playback.sourceStart,
          onTracks: () => emit("audiotrackschanged"),
          onCues: () => {},
          onDecodedCues: (cues) =>
            onCues(
              cues.map((cue) => ({
                ...cue,
                start: cue.start - playback.sourceStart,
                end: cue.end - playback.sourceStart
              }))
            ),
          resolveHead: (target, signal) =>
            resolveMediaHead(
              target,
              new URL(target).origin === new URL(url).origin ? headers : {},
              signal
            ),
          resolveSource: async (target, signal) => {
            if (!clientMediaUrlResolver.canUseHost(target)) return null;
            const result = await clientMediaUrlResolver.resolve(target, {
              signal,
              skipDirect: true
            });
            return result.ok ? result.url : null;
          },
          onStatus: () => emit("remuxstatus")
        });
        subtitles.setSource(url);
      }
      ready = 1;
      emit("audiotrackschanged");
      // Metadata handlers may synchronously restore a percentage-based resume.
      playback.seek(start < duration() ? start : 0);
      emit("loadedmetadata");
      if (pendingPlay) {
        const onReady = () => {
          if (pendingPlay) void resume().catch(() => onError());
        };
        if (ready >= 2) onReady();
        else video.addEventListener("canplay", onReady, { once: true, signal });
      }
    },
    snapshot() {
      const current = state();
      return {
        state: failed ? "error" : ready >= 2 ? "ready" : "opening",
        position: time(),
        duration: duration(),
        restoring: seekPending,
        autoplayBlocked,
        audioTracks: (playback?.audioTracks || []).map((track) => ({
          ...track,
          id: String(track.index),
          label: track.name || track.language || "Audio " + (track.index + 1),
          supported: true
        })),
        audioIndex: current?.audioIndex ?? -1,
        subtitle: subtitles?.snapshot() || { state: "off" }
      };
    },
    resume,
    pause: () => video.pause(),
    seek,
    async selectAudio(index) {
      playback?.selectAudio(index);
      emit("audiotrackschanged");
    },
    setRate: (rate) => playback?.setRate(rate),
    setGain: (gain) => playback?.setGain(gain),
    getSubtitleTracks: () => subtitles?.tracks() || [],
    selectSubtitle: (id) => subtitles?.select(id) ?? false,
    setSubtitleDelay: (delay) => subtitles?.setDelay(delay),
    dispose() {
      if (signal.aborted) return;
      abort.abort();
      void wakeLock.stop();
      video.removeEventListener("volumechange", setVolume);
      subtitles?.destroy();
      if (playback) playback.destroy();
      else input?.dispose();
      for (const [name, descriptor] of originals) {
        if (descriptor) Object.defineProperty(video, name, descriptor);
        else delete video[name];
      }
      video.classList.remove("player-decode-source");
      canvas.remove();
    }
  };
}
