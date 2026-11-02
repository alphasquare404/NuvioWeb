import { classifyStreamFilename } from "../../core/streams/streamCompatibilityFilter.js";
import { FILENAME_ESTIMATE_NOTICE } from "../../core/streams/filenameStreamPolicy.js";
function escape(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
const LABELS = {
  direct: ["Direct", "green"],
  remux: ["Remux", "yellow"],
  "audio-transcode": ["Transcoding", "orange"],
  transcode: ["Unsupported", "red"],
  unknown: ["Unknown", "neutral"]
};
export function renderFilenamePlaybackBadge(stream, settings = {}, capabilities = null) {
  const { method } = classifyStreamFilename(stream, capabilities);
  return renderFilenamePlaybackMethodBadge(method, settings);
}

// Also used by Settings to illustrate each label without claiming a real file
// needs that method on the current device.
export function renderFilenamePlaybackMethodBadge(method, settings = {}) {
  if (settings?.showPlaybackLabels === false) return "";
  const [label, tone] = LABELS[method] || LABELS.unknown;
  const description = label + ". " + FILENAME_ESTIMATE_NOTICE;
  return `<span class="stream-route-stream-badge filename-playback-badge tone-${tone}" title="${escape(description)}" aria-label="${escape(description)}">${label} <span class="filename-playback-estimate">≈</span></span>`;
}
