import { classifyStreamFilename } from "../../core/streams/streamCompatibilityFilter.js";
import { FILENAME_ESTIMATE_NOTICE } from "../../core/streams/filenameStreamPolicy.js";
import { isTranscodeEnabled } from "../../core/player/selectedStreamDelivery.js";
import { I18n } from "../../i18n/index.js";
function escape(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
const LABELS = {
  direct: ["Direct", "green", "direct"],
  remux: ["Repackage", "blue", "repackage"],
  "audio-transcode": ["Transcode", "orange", "audio-transcode"],
  transcode: ["Unsupported", "red"],
  unknown: ["Unknown", "neutral", "unknown"]
};
export function renderFilenamePlaybackBadge(stream, settings = {}, capabilities = null) {
  const { method } = classifyStreamFilename(stream, capabilities);
  return renderFilenamePlaybackMethodBadge(method, settings);
}

// Also used by Settings to illustrate each label without claiming a real file
// needs that method on the current device.
export function renderFilenamePlaybackMethodBadge(method, settings = {}) {
  if (settings?.showPlaybackLabels === false) return "";
  const fullTranscode = method === "transcode" && isTranscodeEnabled();
  const [label, tone, artwork] = fullTranscode
    ? ["Transcode", "red", "full-transcode"]
    : LABELS[method] || LABELS.unknown;
  const descriptionLabel = fullTranscode
    ? I18n.t("settings_filter_full_transcode", {}, { fallback: "Full Transcode" })
    : method === "audio-transcode"
      ? I18n.t("settings_filter_audio_transcode", {}, { fallback: "Audio Transcode" })
      : label;
  const description = descriptionLabel + ". " + FILENAME_ESTIMATE_NOTICE;
  const content = artwork
    ? `<img src="assets/icons/playback-badge-compact-${artwork}.svg" alt="${escape(label)}">`
    : escape(label);
  return `<span class="filename-playback-badge tone-${tone} ${artwork ? "has-artwork" : "stream-route-stream-badge"}" role="img" title="${escape(description)}" aria-label="${escape(description)}">${content}</span>`;
}
