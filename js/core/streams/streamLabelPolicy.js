export const CLIENT_LABEL_LIMITS = [3, 5, 8, 10];
export function normalizePlaybackLabelSource(value) {
  return String(value || "")
    .trim()
    .toUpperCase() === "FILE_NAME"
    ? "FILE_NAME"
    : "FILE_METADATA";
}
export function isStreamLabelingEnabled(labels = {}) {
  return (
    labels.showPlaybackLabels !== false &&
    Array.isArray(labels.labelAddons) &&
    labels.labelAddons.length > 0
  );
}
export function usesMetadataLabels(labels = {}) {
  return normalizePlaybackLabelSource(labels.playbackLabelSource) === "FILE_METADATA";
}
export function isOnlyDirectEnabled(settings = {}, labels = {}) {
  return settings.showOnlyDirectStreams === true && isStreamLabelingEnabled(labels);
}
export function normalizeClientLabelLimit(value) {
  const count = Number(value);
  return CLIENT_LABEL_LIMITS.includes(count) ? count : 5;
}

export function streamLabelProbeLimit(labels = {}, mode = "server", configured = 20) {
  const value = Number(configured);
  const hostLimit = Number.isFinite(value) && value >= 0 ? Math.trunc(value) : 20;
  if (mode !== "client") return hostLimit;
  const clientLimit = normalizeClientLabelLimit(labels.clientLabelLimit);
  return hostLimit > 0 ? Math.min(hostLimit, clientLimit) : clientLimit;
}
