import { getHdrPlaybackSupport } from "../player/hdrSupport.js";

export function normalizeHdrPreference(value) {
  const preference = String(value || "AUTO")
    .trim()
    .toUpperCase();
  return ["AUTO", "PREFER", "AVOID", "ANY"].includes(preference) ? preference : "AUTO";
}

export function resolveHdrPreference(settings = {}, support = getHdrPlaybackSupport()) {
  if (String(settings.streamAutoPlayMode || "").toUpperCase() !== "FIRST_STREAM") return "ANY";
  const preference = normalizeHdrPreference(settings.streamAutoPlayHdrPreference);
  return preference === "AUTO"
    ? support === true
      ? "PREFER"
      : support === false
        ? "AVOID"
        : "ANY"
    : preference;
}

export function hdrFromProbe(probe) {
  const transfer = String(probe?.colorTransfer || "")
    .trim()
    .toLowerCase();
  if (["smpte2084", "arib-std-b67"].includes(transfer)) return true;
  if (
    [
      "bt709",
      "bt470m",
      "bt470bg",
      "smpte170m",
      "smpte240m",
      "gamma22",
      "gamma28",
      "iec61966-2-1",
      "bt2020-10",
      "bt2020-12"
    ].includes(transfer)
  )
    return false;
  return null;
}

export function hdrFromText(stream = {}) {
  const text = [
    stream.name,
    stream.title,
    stream.description,
    stream.filename,
    stream.behaviorHints?.filename,
    stream.raw?.behaviorHints?.filename
  ]
    .filter(Boolean)
    .join(" ");
  // Do not confuse HDRip, HEVC, 10-bit, 4K, or a URL token with HDR.
  if (/\b(?:HDR10\+?|HDR|HLG|DoVi|DV)\b|Dolby[ ._-]*Vision/i.test(text)) return true;
  if (/\bSDR\b/i.test(text)) return false;
  return null;
}

export function streamHdrStatus(stream, { probeForStream, probeOnly = false } = {}) {
  const probed = hdrFromProbe(probeForStream?.(stream));
  return probed == null && !probeOnly ? hdrFromText(stream) : probed;
}

export function applyHdrPreference(streams, { hdrPreference = "ANY", ...evidence } = {}) {
  if (hdrPreference === "AVOID")
    return streams.filter((stream) => streamHdrStatus(stream, evidence) !== true);
  if (hdrPreference !== "PREFER") return streams;
  return [
    ...streams.filter((stream) => streamHdrStatus(stream, evidence) === true),
    ...streams.filter((stream) => streamHdrStatus(stream, evidence) !== true)
  ];
}
