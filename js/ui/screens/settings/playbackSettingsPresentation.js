import { filenameStreamFilter } from "../../../core/streams/filenameStreamPolicy.js";

export const PLAYBACK_SETTINGS_GROUPS = [
  "general",
  "autoplay",
  "audio",
  "subtitles",
  "skipping",
  "external",
  "p2p"
];

export function activePlaybackSettingsGroup(expanded = {}, wide = false) {
  return PLAYBACK_SETTINGS_GROUPS.find((id) => expanded[id]) || (wide ? "general" : null);
}

export function togglePlaybackSettingsGroup(expanded, id, wide = false) {
  if (!PLAYBACK_SETTINGS_GROUPS.includes(id)) return { ...expanded };
  const active = activePlaybackSettingsGroup(expanded, wide);
  return {
    ...expanded,
    ...Object.fromEntries(
      PLAYBACK_SETTINGS_GROUPS.map((key) => [key, key === id && (wide || active !== id)])
    )
  };
}

export function subtitleSettingsPreviewStyle(style = {}) {
  const number = (value, fallback, min, max) => {
    const parsed = Number(value);
    return Math.min(max, Math.max(min, Number.isFinite(parsed) ? parsed : fallback));
  };
  const color = (value, fallback) =>
    /^#[0-9a-f]{6}(?:[0-9a-f]{2})?$/i.test(String(value || "")) ? value : fallback;
  return {
    size: (20 * number(style.fontSize, 120, 50, 200)) / 100,
    bottom: number(style.verticalOffset, 5, -20, 50) + 25,
    weight: style.bold ? 700 : 400,
    color: color(style.textColor, "#FFFFFF"),
    background: color(style.backgroundColor, "#00000000"),
    outline: style.outlineEnabled ? color(style.outlineColor, "#000000") : "transparent"
  };
}

// Display-only examples: no media URL, reader, player or probe is created.
export const SETTINGS_STREAM_PREVIEW_SOURCES = [
  {
    id: "example-direct",
    previewMethod: "direct",
    name: "Sample.1080p.H264.AAC.mp4",
    description: "H.264 · AAC 2.0 · MP4",
    addonName: "Preview",
    behaviorHints: { filename: "Sample.1080p.H264.AAC.mp4", videoSize: 1800000000 }
  },
  {
    id: "example-remux",
    previewMethod: "remux",
    name: "Sample.1080p.H264.AAC.mkv",
    description: "H.264 · AAC 2.0 · MKV",
    addonName: "Preview",
    behaviorHints: { filename: "Sample.1080p.H264.AAC.mkv", videoSize: 2100000000 }
  },
  {
    id: "example-audio",
    previewMethod: "audio-transcode",
    name: "Sample.1080p.H264.DTS.mkv",
    description: "H.264 · DTS · MKV",
    addonName: "Preview",
    behaviorHints: { filename: "Sample.1080p.H264.DTS.mkv", videoSize: 3400000000 }
  },
  {
    id: "example-video",
    previewMethod: "transcode",
    name: "Sample.2160p.HEVC.AAC.mkv",
    description: "HEVC · AAC · MKV",
    addonName: "Preview",
    behaviorHints: { filename: "Sample.2160p.HEVC.AAC.mkv", videoSize: 7000000000 }
  },
  {
    id: "example-unknown",
    previewMethod: "unknown",
    name: "Sample.media",
    description: "No format information in the filename",
    addonName: "Preview",
    behaviorHints: { filename: "Sample.media" }
  }
];

export function filenameStreamFilterOptions(t) {
  return [
    { id: "all", label: t("settings_filter_all", {}, "All Streams") },
    { id: "direct", label: t("settings_filter_direct", {}, "Direct") },
    { id: "remux", label: t("settings_filter_remux", {}, "Remux") },
    { id: "audio-transcode", label: t("settings_filter_audio_transcode", {}, "Audio Transcode") },
    { id: "transcode", label: t("settings_filter_full_transcode", {}, "Full Transcode") }
  ];
}

export function filenameStreamFilterSummary(settings, t) {
  const selection = filenameStreamFilter(settings);
  return filenameStreamFilterOptions(t)
    .filter(({ id }) => selection.includes(id))
    .map(({ label }) => label)
    .join(" + ");
}

// These are illustrative label categories, not compatibility claims about a file.
export function settingsStreamPreviewSources(settings = {}) {
  const selected = filenameStreamFilter(settings);
  if (selected.includes("all")) return SETTINGS_STREAM_PREVIEW_SOURCES;
  return SETTINGS_STREAM_PREVIEW_SOURCES.filter((source) =>
    selected.includes(source.previewMethod)
  );
}
