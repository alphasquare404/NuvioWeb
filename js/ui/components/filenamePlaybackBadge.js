import {
  filenameStreamCategory,
  FILENAME_ESTIMATE_NOTICE
} from "../../core/streams/filenameStreamPolicy.js";
import { isTranscodeEnabled } from "../../core/player/selectedStreamDelivery.js";
import { getDeviceCapabilities } from "../../core/player/deviceCapabilities.js";
import { PlayerSettingsStore } from "../../data/local/playerSettingsStore.js";
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
  "video-transcode": ["Transcode", "purple", "video-transcode"],
  transcode: ["Unsupported", "red"],
  supported: ["Supported", "green", "supported"],
  unsupported: ["Unsupported", "red", "unsupported"],
  unknown: ["Unknown", "neutral", "unknown"]
};
const TRANSCODE_DESCRIPTIONS = {
  "audio-transcode": ["settings_filter_audio_transcode", "Audio Transcode"],
  "video-transcode": ["player_video_transcode", "Video Transcode"],
  transcode: ["settings_filter_full_transcode", "Full Transcode"]
};
export function renderFilenamePlaybackBadge(stream, settings = {}, capabilities = null) {
  if (settings?.showPlaybackLabels === false) return "";
  const device = capabilities || getDeviceCapabilities();
  const method = filenameStreamCategory(stream, PlayerSettingsStore.get(), device);
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
  const transcodeDescription =
    method === "transcode" && !fullTranscode ? null : TRANSCODE_DESCRIPTIONS[method];
  const descriptionLabel = transcodeDescription
    ? I18n.t(transcodeDescription[0], {}, { fallback: transcodeDescription[1] })
    : label;
  const description = descriptionLabel + ". " + FILENAME_ESTIMATE_NOTICE;
  const content = artwork
    ? `<img src="assets/icons/playback-badge-compact-${artwork}.svg" alt="${escape(label)}">`
    : escape(label);
  return `<span class="filename-playback-badge tone-${tone} ${artwork ? "has-artwork" : "stream-route-stream-badge"}" role="img" title="${escape(description)}" aria-label="${escape(description)}">${content}</span>`;
}
