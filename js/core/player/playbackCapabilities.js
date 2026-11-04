import { getCapabilityRevision } from "./deviceCapabilitySession.js";
import { CONTAINER_MIME_TYPES } from "./deviceCapabilities.js";

// Local predictions about the selected engine. Never persist these on the server.
const AUDIO = {
  aac: "mp4a.40.2",
  ac3: "ac-3",
  eac3: "ec-3",
  opus: "opus",
  flac: "flac",
  vorbis: "vorbis",
  truehd: "mlpa",
  mp3: "mp4a.6B"
};
const H264_PROFILES = {
  baseline: 66,
  "constrained baseline": 66,
  main: 77,
  extended: 88,
  high: 100,
  "high 10": 110,
  "high 4:2:2": 122,
  "high 4:4:4 predictive": 244
};

export function videoCodecString(probe) {
  if (
    typeof probe.codecString === "string" &&
    /^(avc1|hvc1|hev1|av01|vp09)\.[a-zA-Z0-9.]+$/.test(probe.codecString)
  )
    return probe.codecString;
  const codec = String(probe.videoCodec || "").toLowerCase();
  const profile = String(probe.videoProfile || "").toLowerCase();
  const level = Number(probe.videoLevel);
  const depth = Number(probe.bitDepth) || 8;
  if (codec === "h264" && H264_PROFILES[profile] && level > 0 && level < 256) {
    return `avc1.${H264_PROFILES[profile].toString(16).padStart(2, "0")}00${level.toString(16).padStart(2, "0")}`;
  }
  // These are capability queries, not bitstream decoder descriptions.
  // Unknown profiles remain unknown rather than substituting Main/8-bit.
  if (codec === "vp8") return "vp8";
  if (codec === "vp9" && /^profile [0-3]$/.test(profile) && level > 0) {
    return `vp09.0${profile.slice(-1)}.${String(level).padStart(2, "0")}.${String(depth).padStart(2, "0")}`;
  }
  return "";
}

function canPlay(element, type) {
  try {
    return typeof element?.canPlayType === "function" ? Boolean(element.canPlayType(type)) : null;
  } catch {
    return null;
  }
}

async function boundedQuery(callback) {
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(callback),
      new Promise((resolve) => {
        timer = setTimeout(() => resolve(null), 750);
      })
    ]);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function assessUncachedPlaybackCapabilities(
  probe,
  { engine = "native", scope = globalThis, mediaElement } = {}
) {
  // Resolve the media element in the body so legacy compilation preserves this.
  if (mediaElement === undefined) {
    const documentRef = scope.document;
    mediaElement =
      typeof documentRef?.createElement === "function" ? documentRef.createElement("video") : null;
  }
  const container = probe.container;
  // One probed variant is not a complete adaptive manifest.
  if (container === "hls" || container === "dash")
    return { engine, video: null, audio: [], container: null };
  const codec = videoCodecString(probe);
  const sourceTypes = CONTAINER_MIME_TYPES[container];
  let video = null;
  let smooth = null;
  let powerEfficient = null;
  let needsRetag = false;
  let relayVideo = null;
  let containerSupport = null;
  let videoType = "";
  if (codec && engine === "movi") {
    const decoder = scope.VideoDecoder;
    if (typeof decoder?.isConfigSupported === "function") {
      const answer = await boundedQuery(() =>
        decoder.isConfigSupported({
          codec,
          codedWidth: probe.width || undefined,
          codedHeight: probe.height || undefined
        })
      );
      video = typeof answer?.supported === "boolean" ? answer.supported : null;
    }
    // WebCodecs video support does not prove this engine's demux/audio fallback.
  } else if (codec) {
    const sourceCodec =
      probe.videoTag === "hev1" && container === "mp4" ? codec.replace(/^hvc1\./, "hev1.") : codec;
    const targetType = `video/mp4; codecs="${codec}"`;
    relayVideo = canPlay(mediaElement, targetType);
    if (sourceTypes) {
      videoType = `${sourceTypes.video}; codecs="${sourceCodec}"`;
      video = canPlay(mediaElement, videoType);
      containerSupport = canPlay(mediaElement, sourceTypes.video);
      if (video === true) containerSupport = true;
      if (video === false && relayVideo === true) {
        video = true;
        videoType = targetType;
        if (sourceCodec !== codec && container === "mp4") needsRetag = true;
        else containerSupport = false;
      }
    } else {
      // The output codec can be assessed independently of an unknown source format.
      video = relayVideo;
      videoType = targetType;
    }
    const api = scope.navigator?.mediaCapabilities;
    if (
      typeof api?.decodingInfo === "function" &&
      probe.width > 0 &&
      probe.height > 0 &&
      probe.frameRate > 0 &&
      probe.videoBitrate > 0
    ) {
      const answer = await boundedQuery(() =>
        api.decodingInfo({
          type: "file",
          video: {
            contentType: videoType,
            width: probe.width,
            height: probe.height,
            bitrate: probe.videoBitrate,
            framerate: probe.frameRate
          }
        })
      );
      if (typeof answer?.supported === "boolean") {
        video = answer.supported;
        smooth = typeof answer.smooth === "boolean" ? answer.smooth : null;
        powerEfficient = typeof answer.powerEfficient === "boolean" ? answer.powerEfficient : null;
      }
    }
  }
  const tracks = probe.audioStreams?.length
    ? probe.audioStreams
    : [{ index: 0, codec: probe.audioCodec, channels: probe.audioChannels }];
  // HDR describes source presentation. It is not a codec/container refusal.
  const hdr = ["smpte2084", "arib-std-b67"].includes(probe.colorTransfer);
  const audio = await Promise.all(
    tracks.map(async (track) => {
      let id = AUDIO[track.codec];
      if (track.codec === "aac") {
        id = {
          LC: "mp4a.40.2",
          Main: "mp4a.40.1",
          "HE-AAC": "mp4a.40.5",
          "HE-AACv2": "mp4a.40.29",
          LD: "mp4a.40.23",
          ELD: "mp4a.40.39"
        }[track.profile];
      }
      if (track.codec === "dts")
        id = { DTS: "dtsc", "DTS-HD MA": "dtsl", "DTS-HD HRA": "dtsh", "DTS Express": "dtse" }[
          track.profile
        ];
      let supported = null;
      let needsRemux = false;
      if (id && engine === "native") {
        const sourceAudioType =
          containerSupport === false || needsRetag ? "audio/mp4" : sourceTypes?.audio;
        let contentType = sourceAudioType ? `${sourceAudioType}; codecs="${id}"` : "";
        supported = contentType ? canPlay(mediaElement, contentType) : null;
        if (supported === false && sourceAudioType !== "audio/mp4") {
          const mp4Type = `audio/mp4; codecs="${id}"`;
          if (canPlay(mediaElement, mp4Type) === true) {
            supported = true;
            needsRemux = true;
            contentType = mp4Type;
          }
        }
        const api = scope.navigator?.mediaCapabilities;
        if (typeof api?.decodingInfo === "function" && track.channels > 0 && track.sampleRate > 0) {
          const answer = await boundedQuery(() =>
            api.decodingInfo({
              type: "file",
              audio: { contentType, channels: String(track.channels), samplerate: track.sampleRate }
            })
          );
          if (typeof answer?.supported === "boolean") supported = answer.supported;
        }
      }
      return { index: track.index, supported, needsRemux };
    })
  );
  return {
    engine,
    video,
    audio,
    container: containerSupport,
    smooth,
    powerEfficient,
    needsRetag,
    relayVideo,
    videoType,
    hdr,
    containerReason:
      containerSupport === false
        ? `container-${container}-unsupported-by-browser`
        : containerSupport === true
          ? "browser-container-supported"
          : "container-capability-unknown"
  };
}

// The same decoding configuration can be reused across links/files. Keep these
// predictions local and separate from the server's immutable file facts.
const assessmentCaches = new WeakMap();
function assessmentKey(probe, engine) {
  return JSON.stringify([
    engine,
    ...[
      "container",
      "videoCodec",
      "codecString",
      "videoProfile",
      "videoLevel",
      "bitDepth",
      "videoTag",
      "width",
      "height",
      "frameRate",
      "videoBitrate",
      "audioCodec",
      "audioChannels",
      "colorTransfer",
      "hasAudio"
    ].map((key) => probe[key] ?? null),
    probe.audioStreams?.map((track) => [
      track.index,
      track.codec,
      track.profile,
      track.channels,
      track.sampleRate
    ])
  ]);
}

export async function assessPlaybackCapabilities(probe, options = {}) {
  const { engine = "native", scope = globalThis, mediaElement } = options;
  let contexts = assessmentCaches.get(scope);
  if (!contexts) assessmentCaches.set(scope, (contexts = new Map()));
  let context = contexts.get(mediaElement);
  const revision = getCapabilityRevision();
  if (!context || context.revision !== revision) {
    context = { revision, results: new Map() };
    contexts.set(mediaElement, context);
  }
  const key = assessmentKey(probe, engine);
  if (context.results.has(key)) return context.results.get(key);
  const pending = assessUncachedPlaybackCapabilities(probe, options);
  // Also share concurrent requests for an identical configuration.
  context.results.set(key, pending);
  if (context.results.size > 512) context.results.delete(context.results.keys().next().value);
  try {
    const result = await pending;
    if (getCapabilityRevision() !== revision) return assessPlaybackCapabilities(probe, options);
    // An API timeout/error is not a capability verdict; allow a later retry.
    if (
      result.video == null ||
      result.container == null ||
      (probe.hasAudio !== false && result.audio.some((track) => track.supported == null))
    )
      context.results.delete(key);
    return result;
  } catch (error) {
    context.results.delete(key);
    throw error;
  }
}
