import { classifyPlayback, playbackMethodTone } from "../../core/player/playbackMethod.js";

// The label that answers "how will this stream be played?" before anyone presses
// play. Three costs, three colours: green for a container swap, yellow for audio
// only, red for a re-encode.

const LABELS = {
  unknown: "Unknown",
  direct: "Direct",
  remux: "Remux",
  "audio-transcode": "Transcode",
  transcode: "Transcode"
};

const COLORS = {
  neutral: { background: "rgba(120,120,120,0.85)", color: "#f0f0f0" },
  green: { background: "rgba(31,122,77,0.92)", color: "#eafff2" },
  yellow: { background: "rgba(168,138,26,0.95)", color: "#1b1600" },
  orange: { background: "rgba(190,94,20,0.95)", color: "#1b1000" },
  red: { background: "rgba(163,42,42,0.95)", color: "#fff2f2" }
};

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function describePlaybackMethod({
  url = "",
  label = "",
  probe = null,
  capabilities = {}
} = {}) {
  return classifyPlayback({ url, label, probe, capabilities });
}

/**
 * A badge for one stream row.
 *
 * `probe` is optional: without it the badge is an estimate from the addon's text,
 * which is all that exists before a row is focused.
 */
export function renderStreamPlaybackBadge({
  url = "",
  label = "",
  probe = null,
  capabilities = {}
} = {}) {
  const result = describePlaybackMethod({ url, label, probe, capabilities });
  const tone = playbackMethodTone(result.method);
  const palette = COLORS[tone] || COLORS.neutral;
  const text = LABELS[result.method] || "Direct";
  const detail = result.confidence === "exact" ? result.reason : `${result.reason} (perkiraan)`;
  return `<span class="stream-playback-badge" title="${escapeHtml(detail)}" style="position:absolute;top:12px;right:12px;padding:4px 10px;border-radius:8px;font-size:11px;font-weight:700;letter-spacing:.02em;line-height:1.2;background:${palette.background};color:${palette.color};">${escapeHtml(text)}</span>`;
}
