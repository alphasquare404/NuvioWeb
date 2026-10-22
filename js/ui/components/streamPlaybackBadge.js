import {
  classifyPlayback,
  detectContainer,
  playbackMethodTone
} from "../../core/player/playbackMethod.js";

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

/**
 * What a card says when the deployment cannot do what the label would promise.
 *
 * A badge is a claim about the stream, but playability is a claim about the
 * deployment too: a server with no transcode endpoint cannot turn a DTS track into
 * AAC, and one with no remux cannot put an MKV into an MP4. Naming an unavailable
 * relay would then be a promise nobody keeps, so the card says so in the neutral
 * tone -- the same rule the endpoint contract already follows.
 */
export const TRANSCODE_UNAVAILABLE_LABEL = "Transcode (unavailable)";
export const REMUX_UNAVAILABLE_LABEL = "Remux (unavailable)";
/** The text cannot decide; only a probe can. Said plainly instead of guessing. */
export const UNPROBED_LABEL = "Unknown";
/** The probe is running right now: still a label, and the card never looks finished. */
export const PROBING_LABEL = "Checking…";
/** A container nothing can open, on a deployment with no relay to fix it. */
export const UNSUPPORTED_LABEL = "Unsupported";

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
 *
 * `transcodeAvailable` says whether this deployment offers the audio transcode relay
 * at all. When it does not, a row that needs one is described as unavailable rather
 * than promised: the label is the app's word that something can be played.
 */
export function renderStreamPlaybackBadge({
  url = "",
  label = "",
  probe = null,
  capabilities = {},
  transcodeAvailable = true,
  remuxAvailable = true,
  probing = false
} = {}) {
  // The addon text is a description, and this session proved it wrong twice: `8bit` was
  // read as h264, `AAC5.1` was really E-AC-3. So the text may only *exclude* a row that
  // nothing can open; every other label waits for the probe.
  if (!probe) {
    if (probing) {
      const palette = COLORS.neutral;
      return `<span class="stream-playback-badge" title="asking the server what this file really is" style="position:absolute;top:12px;right:12px;padding:4px 10px;border-radius:8px;font-size:11px;font-weight:700;letter-spacing:.02em;line-height:1.2;background:${palette.background};color:${palette.color};">${escapeHtml(PROBING_LABEL)}</span>`;
    }
    const container = detectContainer(`${url} ${label}`);
    const relayed = Boolean(remuxAvailable || transcodeAvailable);
    const impossible =
      (container === "mkv" || container === "ts" || container === "avi") && !relayed;
    if (impossible) {
      const palette = COLORS.neutral;
      return `<span class="stream-playback-badge" title="this container needs a relay, and this deployment runs none" style="position:absolute;top:12px;right:12px;padding:4px 10px;border-radius:8px;font-size:11px;font-weight:700;letter-spacing:.02em;line-height:1.2;background:${palette.background};color:${palette.color};">${escapeHtml(UNSUPPORTED_LABEL)}</span>`;
    }
    const palette = COLORS.neutral;
    return `<span class="stream-playback-badge" title="waiting for the probe: the text cannot be trusted with codecs" style="position:absolute;top:12px;right:12px;padding:4px 10px;border-radius:8px;font-size:11px;font-weight:700;letter-spacing:.02em;line-height:1.2;background:${palette.background};color:${palette.color};">${escapeHtml(UNPROBED_LABEL)}</span>`;
  }
  const result = describePlaybackMethod({ url, label, probe, capabilities });
  const unavailable =
    (!transcodeAvailable && result.method === "audio-transcode") ||
    (!remuxAvailable && result.method === "remux");
  const tone = unavailable ? "neutral" : playbackMethodTone(result.method);
  const palette = COLORS[tone] || COLORS.neutral;
  // Say what is being changed, not just that something is. "Transcode" alone leaves the
  // question the label exists to answer open: can this play, and what will happen to it?
  const audioCodec = String(result.audioCodec || "").toLowerCase();
  const audioConversion =
    audioCodec === "aac" ? "5.1→2.0" : `${audioCodec ? audioCodec.toUpperCase() : "audio"}→AAC`;
  const text = unavailable
    ? result.method === "remux"
      ? REMUX_UNAVAILABLE_LABEL
      : TRANSCODE_UNAVAILABLE_LABEL
    : result.method === "audio-transcode"
      ? `${LABELS[result.method]} ${audioConversion}`
      : LABELS[result.method] || "Direct";
  const detail = unavailable
    ? result.method === "remux"
      ? "this deployment does not run a remux endpoint"
      : "this deployment does not run a transcode endpoint"
    : result.confidence === "exact"
      ? result.reason
      : `${result.reason} (perkiraan)`;
  return `<span class="stream-playback-badge" title="${escapeHtml(detail)}" style="position:absolute;top:12px;right:12px;padding:4px 10px;border-radius:8px;font-size:11px;font-weight:700;letter-spacing:.02em;line-height:1.2;background:${palette.background};color:${palette.color};">${escapeHtml(text)}</span>`;
}
