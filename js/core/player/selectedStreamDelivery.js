import { prepareUnverifiedRemux } from "./unverifiedPlayback.js";
import { chooseHlsAudioIndices, canSwitchHlsAudioCodecs } from "./relayTracks.js";
import { tracePlayback, traceUrlKind, traceHost } from "../util/playbackTrace.js";
import { getDeviceCapabilities } from "./deviceCapabilities.js";
import {
  buildTranscodePlan,
  buildTranscodePlaylistUrl,
  buildTranscodeUrl,
  createTranscodeAccess,
  isTranscodeAccessGranted,
  shouldTranscodeSource
} from "./transcodeSource.js";
import { TRANSCODE_MODE, REMUX_ENDPOINT, REMUX_POLICY, TRANSCODE_ENDPOINT } from "../../config.js";
import { assertConfiguredRemuxRoute, isConfiguredCopyRelayUrl } from "./remuxPolicy.js";
import { clientRemuxAvailable, clientRemuxPlan } from "./remuxClient.js";
import { buildRemuxUrl } from "./remuxSource.js";
import { classifyPlayback, PLAYBACK_METHODS } from "./playbackMethod.js";
import { TranscodeSettingsStore } from "../../data/local/transcodeSettingsStore.js";
function unavailable(message) {
  const error = new Error(message);
  error.code = "PROCESSING_UNAVAILABLE";
  return error;
}
const transcodeAccess = createTranscodeAccess({ endpoint: TRANSCODE_ENDPOINT });
export function isTranscodeEnabled() {
  return (
    TRANSCODE_MODE === "client" || (TRANSCODE_MODE === "server" && Boolean(TRANSCODE_ENDPOINT))
  );
}

// Audio and full video conversion follow the same deployment mode.
export async function prepareMeasuredTranscode({
  sourceUrl,
  probe,
  capabilities = getDeviceCapabilities(),
  mode = TRANSCODE_MODE,
  scope = globalThis,
  afterPlaybackFailure = false,
  endpoint = TRANSCODE_ENDPOINT,
  access = transcodeAccess,
  token
} = {}) {
  if (
    mode === "none" ||
    !probe?.videoCodec ||
    probe.videoCodec === "unknown" ||
    !/^https?:\/\//i.test(sourceUrl || "")
  )
    return null;
  const verdict = classifyPlayback({ url: sourceUrl, probe, capabilities });
  // Some measured audio codecs (for example PCM in MKV) have no useful native
  // capability query. After the normal paths refuse playback, let the worker
  // test the real track and output. The label alone cannot authorize encoding.
  const tryMeasuredAudio =
    afterPlaybackFailure &&
    verdict.reason === "audio-capability-unknown" &&
    verdict.audioCodec !== "unknown" &&
    probe.playbackCapabilities?.relayVideo !== false;
  const method = tryMeasuredAudio ? PLAYBACK_METHODS.AUDIO_TRANSCODE : verdict.method;
  const audioOnly = method === PLAYBACK_METHODS.AUDIO_TRANSCODE;
  if (!audioOnly && method !== PLAYBACK_METHODS.TRANSCODE) return null;
  const index = Number(verdict.audioIndex) || 0;
  if (mode === "client") {
    const needed = audioOnly ? [] : ["VideoEncoder"];
    if (
      !clientRemuxAvailable(scope) ||
      !needed.every((name) => typeof scope[name] === "function")
    ) {
      throw unavailable(
        "This browser does not provide the WebCodecs APIs required for client conversion."
      );
    }
    return {
      url: sourceUrl,
      plan: { sourceUrl, route: "client", method, delivery: "mse", audioIndex: index },
      route: audioOnly ? "client-audio-transcode" : "client-transcode"
    };
  }
  if (mode !== "server" || !endpoint) return null;
  if ((!audioOnly && capabilities.h264 === false) || capabilities.aac === false) return null;
  const service = await access.resolve();
  if (!service?.reachable || (!audioOnly && (!service.hls || !service.fullVideo))) return null;
  const serverToken = token ?? TranscodeSettingsStore.get().token;
  if (!isTranscodeAccessGranted({ mode: service.mode, token: serverToken })) {
    throw unavailable(
      "Enter the Transcode token in Settings → Playback → Audio & Video to use server conversion."
    );
  }
  const options = {
    endpoint,
    token: serverToken,
    plan: {
      video: audioOnly ? "copy" : "h264",
      audio: "aac",
      height: audioOnly ? 0 : 1080,
      channels: 2,
      audioIndex: index
    }
  };
  const url = service.hls
    ? buildTranscodePlaylistUrl(sourceUrl, options)
    : buildTranscodeUrl(sourceUrl, options);
  return url
    ? {
        url,
        plan: null,
        waitForPlaylist: service.hls,
        output: {
          processing: method,
          outputContainer: service.hls ? "hls-fmp4" : "mp4",
          video: audioOnly ? verdict.videoCodec : options.plan.video,
          audio: probe.hasAudio === false ? null : options.plan.audio,
          channels: probe.hasAudio === false ? 0 : options.plan.channels
        },
        route: audioOnly ? "audio-transcode" : "server-transcode"
      }
    : null;
}

// Shared selected-file delivery. Keep the established HLS producer and alternate audio renditions.
export const SelectedStreamDelivery = {
  async remuxPlaylistUrl(
    url,
    { audioIndex = 0, audioStreams = null, playbackCapabilities = null } = {}
  ) {
    const why = (reason) => {
      console.warn(`[Playback] hls skipped: ${reason}`);
      return "";
    };
    try {
      assertConfiguredRemuxRoute(REMUX_POLICY, audioIndex, {
        serverAvailable: Boolean(REMUX_ENDPOINT)
      });
    } catch (error) {
      return why(error.reason);
    }
    if (!TRANSCODE_ENDPOINT) return why("no-endpoint");
    const access = await transcodeAccess.resolve();
    if (!access?.hls) return why(`no-hls(mode=${access?.mode || "?"})`);
    const token = String(TranscodeSettingsStore.get().token || "").trim();
    if (!isTranscodeAccessGranted({ mode: access?.mode, token })) return why("token-not-granted");
    const audioIndices = access.alternateAudio
      ? chooseHlsAudioIndices({ audioStreams, playbackCapabilities }, audioIndex)
      : null;
    const playlistUrl = buildTranscodePlaylistUrl(url, {
      endpoint: TRANSCODE_ENDPOINT,
      token,
      plan: {
        video: "copy",
        audio: "copy",
        height: 0,
        channels: 2,
        audioIndex,
        audioIndices
      }
    });
    if (playlistUrl && Array.isArray(audioStreams) && audioStreams.length > 1)
      tracePlayback("audio-renditions", {
        tracks: audioIndices?.length || 0,
        sourceTracks: audioStreams.length,
        codecs: [...new Set(audioStreams.map((track) => track.codec))].join(","),
        codecSwitch: canSwitchHlsAudioCodecs(),
        kind: traceUrlKind(playlistUrl),
        host: traceHost(playlistUrl)
      });
    if (!playlistUrl) why("built-nothing");
    return playlistUrl;
  },

  async isPlayableHlsPlaylist(playlistUrl, depth = 0) {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      if (this.signal?.aborted) throw new DOMException("Playback cancelled", "AbortError");
      let response;
      try {
        response = await fetch(playlistUrl, { cache: "no-store", signal: this.signal });
      } catch (error) {
        console.warn(`[Playback] hls playlist fetch failed: ${error?.message || error}`);
        return false;
      }
      if (response.status === 429 || response.status === 503) {
        const retryAfter = Number(response.headers.get("retry-after"));
        const waitMs = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 2000;
        console.warn(`[Playback] hls playlist busy (${response.status}), retry in ${waitMs}ms`);
        await new Promise((resolve) => setTimeout(resolve, Math.min(waitMs, 5000)));
        continue;
      }
      if (!response.ok) {
        console.warn(`[Playback] hls playlist ${response.status}`);
        return false;
      }
      let text = "";
      try {
        text = await response.text();
      } catch (error) {
        console.warn(`[Playback] hls playlist unreadable: ${error?.message || error}`);
        return false;
      }
      if (depth === 0 && text.includes("#EXT-X-STREAM-INF")) {
        const child = text
          .split(/\r?\n/)
          .map((line) => line.trim())
          .find((line) => line && !line.startsWith("#"));
        if (!child) return false;
        const base = typeof location !== "undefined" ? location.href : "http://localhost/";
        return this.isPlayableHlsPlaylist(new URL(child, new URL(playlistUrl, base)).href, 1);
      }
      if (!text.includes("#EXTINF")) {
        console.warn(`[Playback] hls playlist without segments (${text.length} bytes)`);
        return false;
      }
      const pageBase =
        typeof location !== "undefined" && location.href ? location.href : "http://localhost/";
      const segment = text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find((line) => line && !line.startsWith("#"));
      if (!segment) {
        console.warn("[Playback] hls playlist has no segment uri");
        return false;
      }
      // Fire and forget, in its own guard: nothing below may change the answer.
      void (async () => {
        try {
          const segmentUrl = new URL(segment, new URL(playlistUrl, pageBase).href).href;
          const head = await fetch(segmentUrl, {
            method: "HEAD",
            cache: "no-store",
            signal: this.signal
          });
          console.warn(`[Playback] hls segment HEAD ${head.status}`);
        } catch (error) {
          console.warn(`[Playback] hls segment probe failed: ${error?.message || error}`);
        }
      })();
      return true;
    }
    console.warn("[Playback] hls playlist still busy after retries");
    return false;
  },

  async resolvePlayerSource(stream, { attemptCopy = false } = {}) {
    const url = String(stream?.url || stream?.externalUrl || "").trim();
    // The remux decision does not depend on the transcode endpoint: a deployment can
    // run the container copy and not the audio one, and returning early here skipped
    // the remux path entirely for exactly that configuration.
    if (!url) return url;
    if (attemptCopy) return (await prepareUnverifiedRemux(url)).url;
    const clientPlan = clientRemuxPlan(stream, this.getStreamProbe(stream));
    if (clientPlan) return clientPlan.sourceUrl;
    if (
      isConfiguredCopyRelayUrl(url, {
        endpoint: TRANSCODE_ENDPOINT,
        baseUrl: globalThis.location?.href || "http://localhost/"
      })
    )
      assertConfiguredRemuxRoute(REMUX_POLICY, 0, { serverAvailable: Boolean(REMUX_ENDPOINT) });
    // Older history entries can already contain an explicit file-relay URL.
    // Preserve that choice while preferring progressive delivery when available.
    if (url.includes("/api/remux?")) {
      assertConfiguredRemuxRoute(REMUX_POLICY, 0, { serverAvailable: Boolean(REMUX_ENDPOINT) });
      let inner = "";
      try {
        inner = new URL(url, location.href).searchParams.get("u") || "";
      } catch {
        inner = "";
      }
      if (inner) {
        const playlistUrl = await this.remuxPlaylistUrl(inner);
        const playable = playlistUrl ? await this.isPlayableHlsPlaylist(playlistUrl) : false;
        // Cannot be skipped if this branch runs: says whether a playlist was offered at all.
        console.warn(
          `[Playback] remux branch playlist=${playlistUrl ? "offered" : "none"} playable=${playable}`
        );
        if (playable) return playlistUrl;
      }
      return url;
    }
    // Unknown on the card must not silently become a conversion request based
    // on addon text. Preserve native playback until file facts are available.
    const probe = this.getStreamProbe(stream);
    if (!probe) return url;
    const capabilities = getDeviceCapabilities();
    const verdict = classifyPlayback({
      url,
      label: [stream.name, stream.title, stream.description].filter(Boolean).join(" "),
      probe,
      capabilities
    });
    if (verdict.method === PLAYBACK_METHODS.REMUX)
      assertConfiguredRemuxRoute(REMUX_POLICY, Number(verdict.audioIndex) || 0, {
        serverAvailable: Boolean(REMUX_ENDPOINT)
      });
    if (verdict.method === PLAYBACK_METHODS.AUDIO_TRANSCODE && !TRANSCODE_ENDPOINT)
      throw new Error("This audio needs server conversion, which is unavailable on this host.");
    if (
      TRANSCODE_MODE !== "server" ||
      !shouldTranscodeSource({ url, verdict, endpoint: TRANSCODE_ENDPOINT })
    ) {
      // Only the playback verdict can request a container/tag or audio-track copy.
      // A filename extension alone must not send a supported source to the relay.
      if (verdict.method === PLAYBACK_METHODS.REMUX && REMUX_ENDPOINT) {
        // The player is told how to wait for this source instead of being asked to sit
        // through the copy: a remux needs minutes before its first byte, and the
        // player's own patience is eighteen seconds.
        // Two deliveries of the same copy. HLS starts in seconds, the file has to be
        // finished first -- but only a playlist that already holds a segment may be
        // handed over, or the player sees a zero-length video and calls it finished.
        const playlistUrl = await this.remuxPlaylistUrl(url, {
          audioIndex: Number(verdict.audioIndex) || 0,
          audioStreams: probe.audioStreams,
          playbackCapabilities: probe.playbackCapabilities
        });
        const playable = playlistUrl ? await this.isPlayableHlsPlaylist(playlistUrl) : false;
        // Cannot be skipped if this branch runs: says whether a playlist was offered at all.
        console.warn(
          `[Playback] remux branch playlist=${playlistUrl ? "offered" : "none"} playable=${playable}`
        );
        if (playable) return playlistUrl;
        return buildRemuxUrl(url, REMUX_ENDPOINT, { audioIndex: Number(verdict.audioIndex) || 0 });
      }
      return url;
    }
    // What this device needs produced, not what the server assumes: a device that
    // cannot decode AAC has nothing to gain here and must not spend the CPU.
    const requested = buildTranscodePlan({ capabilities, verdict });
    if (!requested.ok || !TRANSCODE_ENDPOINT)
      throw new Error("Audio conversion is unavailable on this host. Choose another stream.");
    const access = await transcodeAccess.resolve();
    const token = String(TranscodeSettingsStore.get().token || "").trim();
    if (!access?.reachable || !isTranscodeAccessGranted({ mode: access?.mode, token }))
      throw unavailable(
        "Audio conversion is unavailable. Check server access or choose another stream."
      );
    // A playlist is the one delivery iOS accepts for something still being made;
    // the single file has to be finished first, and a film is minutes. A deployment
    // that does not advertise HLS keeps the file, which plays -- only later.
    if (access?.hls) {
      const playlist = buildTranscodePlaylistUrl(url, {
        endpoint: TRANSCODE_ENDPOINT,
        token,
        plan: requested.plan
      });
      if (playlist) return playlist;
    }
    return buildTranscodeUrl(url, {
      endpoint: TRANSCODE_ENDPOINT,
      token,
      plan: requested.plan
    });
  }
};
