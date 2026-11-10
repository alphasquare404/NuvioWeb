import { classifyStreamFilename } from "./streamCompatibilityFilter.js";
import { getDeviceCapabilities } from "../player/deviceCapabilities.js";

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
export const FILENAME_STREAM_METHODS = ["direct", "remux", "audio-transcode", "transcode"];

export function normalizeFilenameStreamFilter(value) {
  if (!Array.isArray(value)) return null;
  if (value.includes("all")) return ["all"];
  const methods = FILENAME_STREAM_METHODS.filter((method) => value.includes(method));
  return methods.length ? methods : null;
}

export function filenameStreamFilter(settings = {}) {
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

export function toggleFilenameStreamFilter(selected, method) {
  if (method === "all") return ["all"];
  const next = selected.includes(method)
    ? selected.filter((id) => id !== method)
    : [...selected.filter((id) => id !== "all"), method];
  return normalizeFilenameStreamFilter(next) || ["all"];
}

export function filterFilenameStreams(streams = [], settings = {}, capabilities = null) {
  const selected = filenameStreamFilter(settings);
  if (selected.includes("all")) return streams;
  const device = capabilities || getDeviceCapabilities();
  return streams.filter((stream) =>
    selected.includes(classifyStreamFilename(stream, device).method)
  );
}
