export const CLIENT_LABEL_LIMITS = [3, 5, 8, 10];
export function normalizePlaybackLabelSource(value) {
  return String(value || "")
    .trim()
    .toUpperCase() === "FILE_NAME"
    ? "FILE_NAME"
    : "FILE_METADATA";
}
export function usesMetadataLabels(labels = {}) {
  return normalizePlaybackLabelSource(labels.playbackLabelSource) === "FILE_METADATA";
}
export function isStreamCheckEnabled() {
  return false;
}
export function isStreamLabelingEnabled() {
  return false;
}
export function normalizeStreamDisplayMode(value) {
  return ["ALL", "DIRECT", "DIRECT_REMUX"].includes(value) ? value : "ALL";
}
export function streamDisplayMode(settings = {}) {
  if (settings.streamDisplayMode != null)
    return normalizeStreamDisplayMode(settings.streamDisplayMode);
  if (settings.showOnlyDirectStreams === true) return "DIRECT";
  return settings.streamCompatibilityFilter === "LIKELY_DIRECT_REMUX"
    ? "DIRECT_REMUX"
    : settings.streamCompatibilityFilter === "LIKELY_DIRECT"
      ? "DIRECT"
      : "ALL";
}
// Kept as the shared gate for startup selection and existing player integrations.
// A restrictive view may now include Remux as well as Direct.
export function isOnlyDirectEnabled(settings = {}, labels = {}) {
  return streamDisplayMode(settings) !== "ALL" && isStreamCheckEnabled(labels);
}
export function allowsPlaybackMethod(method, settings = {}) {
  return (
    method === "direct" || (streamDisplayMode(settings) === "DIRECT_REMUX" && method === "remux")
  );
}
export function normalizeClientLabelLimit(value) {
  const count = Number(value);
  return CLIENT_LABEL_LIMITS.includes(count) ? count : 5;
}
export function normalizeFilenameCheckLimit(value) {
  return Number(value) === 0 ? 0 : normalizeClientLabelLimit(value);
}
export function streamLabelProbeLimit(labels = {}, mode = "server", configured = 20) {
  if (!usesMetadataLabels(labels))
    return normalizeFilenameCheckLimit(labels.filenameCheckLimit ?? 0);
  const value = Number(configured);
  const hostLimit = Number.isFinite(value) && value >= 0 ? Math.trunc(value) : 20;
  if (mode !== "client") return hostLimit;
  const clientLimit = normalizeClientLabelLimit(labels.clientLabelLimit);
  return hostLimit > 0 ? Math.min(hostLimit, clientLimit) : clientLimit;
}
