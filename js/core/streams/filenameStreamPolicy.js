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
export function filterFilenameStreams(streams = [], settings = {}, capabilities = null) {
  const mode = filenameStreamDisplayMode(settings);
  if (mode === "ALL") return streams;
  const device = capabilities || getDeviceCapabilities();
  return streams.filter((stream) => {
    const method = classifyStreamFilename(stream, device).method;
    return method === "direct" || (mode === "DIRECT_REMUX" && method === "remux");
  });
}
