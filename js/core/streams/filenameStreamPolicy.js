import { classifyStreamFilename } from "./streamCompatibilityFilter.js";
import { getDeviceCapabilities } from "../player/deviceCapabilities.js";
import { TRANSCODE_MODE } from "../../config.js";

export const FILENAME_STREAM_MODES = ["ALL", "DIRECT", "DIRECT_REMUX"];
export const FILENAME_ESTIMATE_NOTICE =
  "Estimates only: filenames are compared with this device's playback capabilities. File contents have not been checked.";
export const FILENAME_FILTER_NOTICE =
  "Filename estimates only. Use this filter carefully: incomplete or incorrect names can hide playable streams, including Unknown results. Applies to stream lists, autoplay and next episodes even when labels are hidden. Actual playback may use a different route.";
export function filenameStreamDisplayMode(settings = {}) {
  // Deliberately do not revive retired probe/compatibility preferences.
  return FILENAME_STREAM_MODES.includes(settings.filenameStreamDisplayMode)
    ? settings.filenameStreamDisplayMode
    : "ALL";
}
export const FILENAME_STREAM_METHODS = [
  "direct",
  "remux",
  "audio-transcode",
  "video-transcode",
  "transcode"
];
export const DECODE_STREAM_METHODS = ["supported", "unsupported", "unknown"];

export function filenameStreamFilterKey(settings = {}) {
  return settings.mediabunnyEnabled !== false && settings.mediabunnyMode === "decode"
    ? "decodeStreamFilter"
    : "filenameStreamFilter";
}

export function normalizeFilenameStreamFilter(value, methods = FILENAME_STREAM_METHODS) {
  if (!Array.isArray(value)) return null;
  if (value.includes("all")) return ["all"];
  const selected = methods.filter((method) => value.includes(method));
  return selected.length ? selected : null;
}

export function filenameStreamFilter(settings = {}) {
  if (filenameStreamFilterKey(settings) === "decodeStreamFilter") {
    return (
      normalizeFilenameStreamFilter(settings.decodeStreamFilter, DECODE_STREAM_METHODS) || ["all"]
    );
  }
  const selection = normalizeFilenameStreamFilter(settings.filenameStreamFilter);
  if (selection) return selection;
  const mode = filenameStreamDisplayMode(settings);
  if (mode === "ALL") return ["all"];
  return [
    "direct",
    ...(mode === "DIRECT_REMUX" ? ["remux"] : []),
    ...(settings.filenameTranscodeFilter?.audio === true ? ["audio-transcode"] : []),
    ...(settings.filenameTranscodeFilter?.full === true ? ["transcode"] : [])
  ];
}

export function toggleFilenameStreamFilter(selected, method, settings = {}) {
  if (method === "all") return ["all"];
  const next = selected.includes(method)
    ? selected.filter((id) => id !== method)
    : [...selected.filter((id) => id !== "all"), method];
  const methods =
    filenameStreamFilterKey(settings) === "decodeStreamFilter"
      ? DECODE_STREAM_METHODS
      : FILENAME_STREAM_METHODS;
  return normalizeFilenameStreamFilter(next, methods) || ["all"];
}

const decodeVideoCodecs = ["h264", "hevc", "vp8", "vp9", "av1", "prores"];
const decodeAudioCodecs = ["aac", "opus", "mp3", "vorbis", "flac", "ac3", "eac3", "dts", "truehd"];

export function filenameStreamCategory(
  stream,
  settings = {},
  capabilities = getDeviceCapabilities()
) {
  const { method, container, videoCodec, audioCodec, audioChannels } = classifyStreamFilename(
    stream,
    capabilities
  );
  if (filenameStreamFilterKey(settings) === "decodeStreamFilter") {
    if (["hls", "dash", "unknown"].includes(container)) return "unknown";
    if (container === "avi" || videoCodec === "vvc") return "unsupported";
    if (videoCodec === "unknown" || audioCodec === "unknown") return "unknown";
    if (decodeVideoCodecs.includes(videoCodec) && decodeAudioCodecs.includes(audioCodec))
      return "supported";
    return "unknown";
  }
  if (
    method === "transcode" &&
    TRANSCODE_MODE === "client" &&
    settings.mediabunnyEnabled !== false &&
    capabilities[audioCodec] === true &&
    !(audioChannels > 2 && capabilities.requiresStereoAac)
  )
    return "video-transcode";
  return method;
}

export function filterFilenameStreams(streams = [], settings = {}, capabilities = null) {
  const selected = filenameStreamFilter(settings);
  if (selected.includes("all")) return streams;
  const device = capabilities || getDeviceCapabilities();
  return streams.filter((stream) =>
    selected.includes(filenameStreamCategory(stream, settings, device))
  );
}
