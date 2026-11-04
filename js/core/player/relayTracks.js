// Track discovery for this host's existing HLS relay, never for arbitrary manifests.
export function relayTrackContext(
  source,
  endpoint,
  base = globalThis.location?.href || "http://localhost/"
) {
  if (!endpoint) return null;
  try {
    const url = new URL(source, base),
      relay = new URL(endpoint, base);
    if (
      url.origin !== relay.origin ||
      url.pathname !== relay.pathname.replace(/\/+$/, "") + "/hls/index.m3u8"
    )
      return null;
    const original = url.searchParams.get("u");
    if (!original || !/^https?:$/.test(new URL(original).protocol)) return null;
    const raw = url.searchParams.get("ai") ?? "0";
    if (!/^\d+$/.test(raw) || Number(raw) > 7) return null;
    const textUrl = new URL(url);
    textUrl.pathname = relay.pathname.replace(/\/+$/, "");
    const list = url.searchParams.get("audios");
    const audioIndices =
      list && /^[0-7](?:,[0-7]){1,7}$/.test(list)
        ? list
            .split(",")
            .map(Number)
            .sort((a, b) => a - b)
        : null;
    return { url, source: original, audioIndex: Number(raw), audioIndices, textUrl };
  } catch {
    return null;
  }
}

export function relayAudioUrl(context, index) {
  if (!Number.isInteger(index) || index < 0 || index > 7) return null;
  const url = new URL(context.url);
  url.searchParams.set("ai", String(index));
  return url.href;
}

// Same renderer as client MKV subtitles; only transport differs. All MKV reads
// happen on the existing relay, so server mode does not require browser source CORS.
export function createRelaySubtitleTransport(context, { fetchImpl = globalThis.fetch } = {}) {
  let controller = null,
    closed = false,
    latest = 0,
    sourceId;
  const port = {
    onmessage: null,
    onerror: null,
    postMessage(message) {
      controller?.abort();
      const serial = ++latest;
      if (message.type === "cancel" || closed) return;
      if (message.type === "open") sourceId = message.sourceId;
      const url = new URL(context.textUrl);
      url.searchParams.set("text", message.type === "open" ? "tracks" : "cues");
      if (message.type === "window") {
        url.searchParams.set("track", String(message.trackId));
        url.searchParams.set("time", String(message.time));
      }
      controller = new AbortController();
      const current = controller;
      const timer = setTimeout(() => current.abort(), 20000);
      void (async () => {
        try {
          let response, data;
          // Controller.play can return before the HLS request registers its job.
          // Wait for that existing request; subtitle discovery never creates video work.
          for (let attempt = 0; attempt < 40; attempt++) {
            response = await fetchImpl(url.href, { signal: current.signal, cache: "no-store" });
            data = await response.json();
            const pendingJob = response.status === 409 && data.error === "subtitle-hls-not-ready";
            if (
              (!pendingJob && response.status !== 429 && response.status !== 503) ||
              attempt === 39
            )
              break;
            await new Promise((resolve) => setTimeout(resolve, 400));
            current.signal.throwIfAborted();
          }
          if (!response.ok || !data.ok) throw Error(data.error || "subtitle-read-failed");
          if (closed || serial !== latest) return;
          port.onmessage?.({
            data: {
              type: message.type === "open" ? "tracks" : "window",
              sourceId,
              ...(message.type === "open"
                ? { tracks: data.tracks }
                : { requestId: message.requestId, result: data.result })
            }
          });
        } catch (error) {
          if (!closed && serial === latest)
            port.onmessage?.({
              data: {
                type: "error",
                sourceId,
                ...(message.requestId === undefined ? {} : { requestId: message.requestId }),
                reason: /^[a-z0-9-]+$/.test(error.message) ? error.message : "subtitle-read-failed"
              }
            });
        } finally {
          clearTimeout(timer);
        }
      })();
    },
    terminate() {
      closed = true;
      latest++;
      controller?.abort();
    }
  };
  return port;
}

export function canSwitchHlsAudioCodecs(scope = globalThis) {
  if (
    typeof scope.SourceBuffer?.prototype?.changeType === "function" ||
    typeof scope.ManagedSourceBuffer?.prototype?.changeType === "function"
  )
    return true;
  // Native-only HLS owns its codec transitions. An MSE engine without changeType
  // keeps the existing single-audio delivery rather than risking a broken buffer.
  if (!scope.MediaSource && !scope.ManagedMediaSource) {
    const video = scope.document?.createElement?.("video");
    return Boolean(video?.audioTracks && video?.canPlayType?.("application/vnd.apple.mpegurl"));
  }
  return false;
}

// Device facts govern eligibility; mixed codecs additionally require an engine
// that can change the audio buffer type without reattaching the video.
export function chooseHlsAudioIndices(
  probe,
  initial,
  { canChangeCodec = canSwitchHlsAudioCodecs() } = {}
) {
  const tracks = probe?.audioStreams || [];
  if (tracks.length < 2) return null;
  const eligible = tracks.filter(
    (track) =>
      Number.isInteger(track.index) &&
      track.index >= 0 &&
      track.index <= 7 &&
      probe.playbackCapabilities?.audio?.find((item) => item.index === track.index)?.supported !==
        false
  );
  // A change in profile can change the decoder configuration even within one family.
  const formats = new Set(
    eligible.map((track) => `${track.codec}:${track.codec === "aac" ? track.profile || "" : ""}`)
  );
  if (formats.size > 1 && !canChangeCodec) return null;
  const indices = eligible.map((track) => track.index).sort((a, b) => a - b);
  return indices.length > 1 && indices.includes(initial) ? indices : null;
}

export function mergeRelayRenditionTracks(context, metadata, actual) {
  if (!context?.audioIndices) return metadata;
  return actual.map((track, index) => {
    // Native engines can reorder options; FFmpeg's rendition name is stable.
    const rendition = /^audio_(\d+)$/.exec(track.label || track.name || "");
    const ordinal = rendition ? Number(rendition[1]) - 1 : index;
    const facts = metadata.find((item) => item.index === context.audioIndices[ordinal]);
    return {
      ...facts,
      ...track,
      label: facts?.language || track.label,
      language: facts?.language || track.language
    };
  });
}
