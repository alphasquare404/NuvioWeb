import { classifyPlayback } from "../player/playbackMethod.js";
import { getDeviceCapabilities } from "../player/deviceCapabilities.js";

export function normalizeStreamCompatibilityFilter(value) {
  const mode = String(value || "OFF")
    .trim()
    .toUpperCase();
  return ["OFF", "LIKELY_DIRECT", "LIKELY_DIRECT_REMUX"].includes(mode) ? mode : "OFF";
}

// This is a local text estimate, never a verified playback label. Do not resolve
// URLs, fetch media, or spend a probe slot to decide which candidates to inspect.
export function filterStreamsByCompatibility(streams = [], settings = {}, capabilities = null) {
  if (settings.streamDisplayMode != null) return streams;
  const mode = normalizeStreamCompatibilityFilter(settings.streamCompatibilityFilter);
  if (mode === "OFF") return streams;
  const device = capabilities || getDeviceCapabilities();
  return streams.filter((stream) => {
    const method = classifyStreamFilename(stream, device).method;
    return method === "direct" || (mode === "LIKELY_DIRECT_REMUX" && method === "remux");
  });
}

export function classifyStreamFilename(stream = {}, capabilities = null) {
  let filename = "";
  try {
    filename = decodeURIComponent(new URL(stream.url || stream.externalUrl || "").pathname);
  } catch {
    /* Descriptors may already carry a filename without a playable URL. */
  }
  const label = [
    stream.name,
    stream.label,
    stream.raw?.filename,
    stream.raw?.name,
    stream.raw?.title,
    stream.title,
    stream.description,
    stream.filename,
    stream.behaviorHints?.filename,
    stream.raw?.behaviorHints?.filename,
    stream.clientResolve?.filename,
    stream.raw?.clientResolve?.filename
  ]
    .filter(Boolean)
    .join(" ");
  return classifyPlayback({
    url: filename,
    label,
    capabilities: capabilities || getDeviceCapabilities()
  });
}
