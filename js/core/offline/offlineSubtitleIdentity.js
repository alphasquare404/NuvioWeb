import { createOfflineMediaId } from "./offlineDownloadIdentity.js";

function text(value) {
  return String(value || "").trim();
}

function safeIdentityPart(value) {
  return text(value).replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
}

function stableHash(value) {
  let hash = 2166136261;
  for (const character of String(value || "")) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function safeUrlIdentity(value) {
  try {
    const url = new URL(text(value));
    return `${url.protocol}//${url.host}${url.pathname}`;
  } catch (_) {
    return "";
  }
}

function subtitleExtension(track = {}) {
  const candidate = `${track?.fileName || ""} ${safeUrlIdentity(track?.url || "")}`.toLowerCase();
  const match = candidate.match(/\.(vtt|srt|ass|ssa)(?:$|\s)/i);
  return match?.[1]?.toLowerCase() || "";
}

export function isOfflineSubtitleFormatSupported(track = {}) {
  return /^(vtt|srt|ass|ssa)$/.test(subtitleExtension(track));
}

export function offlineSubtitleExtension(track = {}) {
  return subtitleExtension(track);
}

// Native browser text tracks require WebVTT. The Player converts SubRip to
// VTT, but ASS/SSA need a full dialogue-to-VTT conversion that it does not
// currently provide. Keep this check shared by download persistence and local
// playback so an unreadable response can never be recorded as completed.
export function detectOfflineSubtitleFormat(content = "") {
  const value = String(content || "").replace(/^\uFEFF/, "").trim();
  if (/^WEBVTT(?:\s|$)/i.test(value)) return "vtt";
  if (/\b\d{1,2}:\d{2}:\d{2}[,.]\d{3}\s*-->/m.test(value)) return "srt";
  if (/^\s*\[Script Info\]/mi.test(value) && /^\s*Dialogue\s*:/mi.test(value)) {
    return "ass";
  }
  return "";
}

export function decodeOfflineSubtitleBytes(bytes) {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  const hasUtf16LeBom = view[0] === 0xff && view[1] === 0xfe;
  const hasUtf16BeBom = view[0] === 0xfe && view[1] === 0xff;
  const encoding = hasUtf16LeBom ? "utf-16le" : hasUtf16BeBom ? "utf-16be" : "utf-8";
  try {
    return {
      encoding,
      text: new TextDecoder(encoding).decode(view)
    };
  } catch (_) {
    return { encoding: "utf-8", text: new TextDecoder().decode(view) };
  }
}

export function isOfflineSubtitleTextLoadable(content = "") {
  return /^(vtt|srt)$/.test(detectOfflineSubtitleFormat(content));
}

export function createOfflineSubtitleFingerprint(track = {}) {
  return [
    text(track.id),
    safeUrlIdentity(track.url),
    text(track.lang || track.language).toLowerCase(),
    text(track.addonName || track.provider),
    text(track.fileName || track.filename),
    track.forced ? "forced" : "",
    track.sdh || track.hearingImpaired ? "sdh" : ""
  ].join("|");
}

export function createOfflineSubtitleId(input = {}) {
  const mediaIdentity = text(input.mediaIdentity || createOfflineMediaId(input));
  const fingerprint = text(input.fingerprint || createOfflineSubtitleFingerprint(input.track || input));
  return mediaIdentity && fingerprint
    ? `subtitle-${safeIdentityPart(mediaIdentity)}-${stableHash(fingerprint)}`
    : "";
}
