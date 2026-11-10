// How a stream will be played, decided before it is played.
//
// The ladder is a cost ladder, not a guess:
//   direct           — the container and the codecs are things <video> already plays
//   remux            — the container is the problem, the codecs are fine
//   audio-transcode  — the audio track is the problem, whatever the container is
//   transcode        — the picture itself has to be re-encoded, which is the
//                      expensive one and the one worth warning about
//
// Two sources feed it, deliberately. The addon's own text (resolution, codec tags,
// extension) is free and available for every row of a list; a server-side probe is
// exact but costs a request, so it is asked for once a row is actually in focus.
// The first gives a label, the second turns it into a decision.

export const PLAYBACK_METHODS = Object.freeze({
  UNKNOWN: "unknown",
  DIRECT: "direct",
  REMUX: "remux",
  AUDIO_TRANSCODE: "audio-transcode",
  TRANSCODE: "transcode"
});

// Direct is green, remux yellow, audio conversion orange, full conversion red.
export const PLAYBACK_METHOD_TONES = Object.freeze({
  [PLAYBACK_METHODS.UNKNOWN]: "neutral",
  [PLAYBACK_METHODS.DIRECT]: "green",
  [PLAYBACK_METHODS.REMUX]: "yellow",
  [PLAYBACK_METHODS.AUDIO_TRANSCODE]: "orange",
  [PLAYBACK_METHODS.TRANSCODE]: "red"
});

// A filename often sits inside an addon's description followed by a space or a
// bracket, so the boundary is "not a letter or digit" rather than end-of-string.
const BOUNDARY = "(?:$|[^a-z0-9])";
const HLS = new RegExp("\\.m3u8" + BOUNDARY, "i");
const DASH = new RegExp("\\.mpd" + BOUNDARY, "i");
const MKV = new RegExp("\\.mkv" + BOUNDARY, "i");
const AVI = new RegExp("\\.avi" + BOUNDARY, "i");
const M2TS = new RegExp("\\.m2ts" + BOUNDARY, "i");
// Addons often name the container without an extension ("MKV | 1080p").
const MKV_WORD = /\bmkv\b|matroska/i;
const MP4_WORD = /\bmp4\b/i;
const MP4 = new RegExp("\\.(?:mp4|m4v)" + BOUNDARY, "i");
const WEBM = new RegExp("\\.webm" + BOUNDARY, "i");
const TS = new RegExp("\\.ts" + BOUNDARY, "i");

const VIDEO_HINTS = [
  [/av1|\bav01\b/i, "av1"],
  [/hevc|h\.?265|x265|\bhvc1\b|\bhev1\b/i, "hevc"],
  // `8bit` used to be here and it was wrong: it describes the depth, not the codec, and
  // it turned an unrecognised picture into a confident "h264 -> Direct". A stream whose
  // probe reported MPEG-4 Part 2 was shown as Direct for exactly that reason.
  [/x264|h\.?264|\bavc1?\b|\bavc\b/i, "h264"],
  [/\bvvc\b|h\.?266/i, "unknown"]
];

const AUDIO_HINTS = [
  [/flac/i, "flac"],
  // "DDP5.1" glues the channel layout to the codec, so no trailing word boundary. This
  // sits before the Atmos rule because "DDP5.1 Atmos" is E-AC-3 with Atmos, not TrueHD.
  [/eac3|e-ac-3|\bddp|\bdd\+/i, "eac3"],
  [/truehd|atmos/i, "truehd"],
  [/\bdts\b/i, "dts"],
  [/\bac3\b|\bdd\b/i, "ac3"],
  [/\bopus\b/i, "opus"],
  [/aac/i, "aac"]
];

/**
 * How many channels the text claims.
 *
 * `AAC5.1` and `DDP5.1` glue the layout to the codec.
 * Numbers only; 0 means "not stated". Capability is assessed separately.
 */
export function detectAudioChannels(text = "") {
  const value = String(text || "");
  const glued = /(?:aac|ddp|eac3|ac3|dd)\s*([1-8])[.-]([01])/i.exec(value);
  const layout = glued || /\b([1-8])[.-]([01])\b/.exec(value);
  if (layout) {
    const channels = Number(layout[1]) + Number(layout[2]);
    return Number.isFinite(channels) && channels > 0 ? channels : 0;
  }
  const explicit = /\b([2-8])\s*(?:ch|channels)\b/i.exec(value);
  return explicit ? Number(explicit[1]) : 0;
}
export function detectContainer(url = "") {
  const value = String(url || "");
  if (HLS.test(value)) return "hls";
  if (DASH.test(value)) return "dash";
  if (MKV.test(value) || MKV_WORD.test(value)) return "mkv";
  if (AVI.test(value)) return "avi";
  if (M2TS.test(value)) return "ts";
  if (WEBM.test(value)) return "webm";
  if (MP4.test(value) || MP4_WORD.test(value)) return "mp4";
  if (TS.test(value)) return "ts";
  return "unknown";
}

/** Codec hints, from the URL's extension or from whatever the addon printed. */
export function detectVideoCodec(text = "") {
  const value = String(text || "");
  for (const [pattern, codec] of VIDEO_HINTS) {
    if (pattern.test(value)) return codec;
  }
  return "unknown";
}

export function detectAudioCodec(text = "") {
  const value = String(text || "");
  for (const [pattern, codec] of AUDIO_HINTS) {
    if (pattern.test(value)) return codec;
  }
  return "unknown";
}

function codecSupported(codec, capabilities = {}) {
  const value = capabilities[codec];
  return typeof value === "boolean" ? value : null;
}

/**
 * @param {object} input
 * @param {string} input.url            the stream source
 * @param {string} input.label          the addon's own text for the row
 * @param {object|null} input.probe     {container, videoCodec, audioCodec} from the server
 * @param {object} input.capabilities   what this device claims it can decode
 */
export function classifyPlayback({ url = "", label = "", probe = null, capabilities = {} } = {}) {
  const exact = Boolean(probe);
  const text = `${url} ${label}`;
  const container = String(probe?.container || detectContainer(text) || "unknown").toLowerCase();
  const videoCodec = String(probe?.videoCodec || detectVideoCodec(text) || "unknown").toLowerCase();
  const audioCodec = String(probe?.audioCodec || detectAudioCodec(text) || "unknown").toLowerCase();
  // The probe knows the channel count exactly; the label is a fallback for rows that have
  // not been probed. canPlayType is still what answers "is this codec playable at all".
  const probedChannels = Number(probe?.audioChannels) || 0;
  const audioChannels = probedChannels > 0 ? probedChannels : detectAudioChannels(text);
  const audioStreams = Array.isArray(probe?.audioStreams) ? probe.audioStreams : [];
  const confidence = exact ? "predicted" : "estimate";
  const assessment = probe?.playbackCapabilities;
  const outcome = (method, reason, extra = {}) => ({
    method,
    reason,
    confidence,
    container,
    videoCodec,
    audioCodec,
    audioChannels,
    ...extra
  });
  // A probe may describe one variant, not all variants the manifest can select.
  if (container === "hls" || container === "dash") {
    return outcome(PLAYBACK_METHODS.UNKNOWN, "adaptive-variants-unverified");
  }

  // Nothing to go on: no extension, no filename, no codec tags, no probe. Saying
  // "Direct" here would be a guess dressed as a decision.
  if (container === "unknown" && videoCodec === "unknown") {
    return {
      method: PLAYBACK_METHODS.UNKNOWN,
      reason: "not-enough-information",
      confidence,
      container,
      videoCodec,
      audioCodec,
      audioChannels
    };
  }

  const videoOk = assessment ? assessment.video : codecSupported(videoCodec, capabilities);
  const trackSupport = (track) =>
    assessment
      ? (assessment.audio?.find((item) => item.index === track.index)?.supported ?? null)
      : codecSupported(track.codec, capabilities);
  const audioOk = probe?.hasAudio === false ? true : trackSupport({ index: 0, codec: audioCodec });

  // A video codec the text did not name decides remux versus a full re-encode -- a large
  // difference, and one only ffprobe can settle. It is asked before the container, because
  // "unsupported container" only says the relay will be used, not which relay does what.
  if (videoCodec === "unknown") {
    return {
      method: PLAYBACK_METHODS.UNKNOWN,
      reason: "video-unknown",
      confidence,
      container,
      videoCodec,
      audioCodec,
      audioChannels
    };
  }
  if (videoOk == null) return outcome(PLAYBACK_METHODS.UNKNOWN, "video-capability-unknown");
  if (videoOk === false) {
    return {
      method: PLAYBACK_METHODS.TRANSCODE,
      reason: `video-${videoCodec}-unsupported`,
      confidence,
      container,
      videoCodec,
      audioCodec,
      audioChannels
    };
  }

  // An unrecognised container may be an MKV; only a named, playable one is Direct.
  if (container === "unknown") {
    return {
      method: PLAYBACK_METHODS.UNKNOWN,
      reason: "container-unknown",
      confidence,
      container,
      videoCodec,
      audioCodec,
      audioChannels
    };
  }

  const containerOk = assessment
    ? assessment.container === true &&
      !assessment.audio?.find((track) => track.index === 0)?.needsRemux
    : capabilities.containers?.[container] === true;
  if (assessment?.engine === "movi" && assessment.container == null) {
    return outcome(PLAYBACK_METHODS.UNKNOWN, "engine-path-unverified");
  }
  const containerSupported = assessment
    ? assessment.container
    : capabilities.containers?.[container];
  if (containerSupported == null)
    return outcome(PLAYBACK_METHODS.UNKNOWN, "container-capability-unknown");
  // Keep the first playable track. Only change tracks to solve an actual refusal.
  const playableTrack =
    audioOk === false ? audioStreams.find((track) => trackSupport(track) === true) : null;
  const selectedAudioIndex = playableTrack ? Number(playableTrack.index) || 0 : 0;
  const audioTrackSelected = selectedAudioIndex > 0;
  if (audioOk == null) return outcome(PLAYBACK_METHODS.UNKNOWN, "audio-capability-unknown");
  // Audio before container, because the audio transcode relay also rewrites the
  // container: it copies the picture into an MP4 and only re-encodes the audio.
  // Reading them the other way round labelled every MKV with a DTS or E-AC3 track
  // "Remux", sent it to the remux relay, and produced an MP4 whose audio the device
  // still cannot decode -- a relabelled failure, not a fix. Yellow now means
  // exactly what it says: the audio is fine and only the box is wrong.
  // An unsupported first track is only a reason to convert when there is no playable
  // track to switch to. Selecting an existing AAC track beats encoding a new one.
  if (audioOk === false && !audioTrackSelected) {
    // The configured audio relay copies video into MP4. Check that output too.
    if (assessment?.relayVideo === false)
      return outcome(PLAYBACK_METHODS.TRANSCODE, "relay-output-video-unsupported");
    return {
      method: PLAYBACK_METHODS.AUDIO_TRANSCODE,
      reason: `audio-${audioCodec}-unsupported`,
      confidence,
      container,
      videoCodec,
      audioCodec,
      audioChannels
    };
  }

  // A playable track that is not the first one still needs the relay: the player takes
  // track 0 and nothing can change that from the list.
  if (!containerOk || audioTrackSelected) {
    if (assessment?.relayVideo === false)
      return outcome(PLAYBACK_METHODS.TRANSCODE, "relay-output-video-unsupported");
    return {
      method: PLAYBACK_METHODS.REMUX,
      audioIndex: selectedAudioIndex,
      reason: audioTrackSelected
        ? "audio-track-selected"
        : assessment?.containerReason || `container-${container}`,
      confidence,
      container,
      videoCodec,
      audioCodec,
      audioChannels
    };
  }

  // Retag only when querying the actual tag failed but the repaired tag succeeded.
  if (assessment?.needsRetag === true) {
    return {
      method: PLAYBACK_METHODS.REMUX,
      audioIndex: selectedAudioIndex,
      reason: "hevc-tag-hev1",
      confidence,
      container,
      videoCodec,
      audioCodec,
      audioChannels
    };
  }

  return {
    method: PLAYBACK_METHODS.DIRECT,
    reason: "supported",
    confidence,
    container,
    videoCodec,
    audioCodec
  };
}

export function playbackMethodTone(method) {
  return PLAYBACK_METHOD_TONES[method] || "neutral";
}
