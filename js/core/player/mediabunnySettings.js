export function normalizeMediabunnyMode(value, legacyEngine) {
  if (value === "decode" || value === "process") return value;
  return legacyEngine === "movi" ? "decode" : "process";
}

export function canUseDecodePlayback(scope = globalThis) {
  return Boolean(scope.isSecureContext && (scope.AudioContext || scope.webkitAudioContext));
}

// A decode failure says this device could not play that stream. Retrying the
// same engine a few times is worth it (a range hiccup is not a broken codec),
// but once playback has had to fall back to Remux it stays there for the rest
// of the session: bouncing back to Decode Only repeats the failure.
let decodeBlocked = false;

export function blockDecodePlayback(reason = "decode-failed") {
  if (!decodeBlocked) {
    console.warn("[Decode] switching to Remux for the rest of this session", { reason });
  }
  decodeBlocked = true;
}

export function resetDecodeBlock() {
  decodeBlocked = false;
}

export function isDecodeBlocked() {
  return decodeBlocked;
}

export function shouldRouteToDecodePlayback(params, settings, scope = globalThis) {
  const source = String(params?.streamUrl || "");
  return Boolean(
    settings?.mediabunnyEnabled !== false &&
    settings?.mediabunnyMode === "decode" &&
    !isDecodeBlocked() &&
    !params?.skipMediabunnyDecode &&
    !params?.externalFrameUrl &&
    /^(https?:|blob:)/i.test(source) &&
    !/\.(?:m3u8|mpd)(?:[?#]|$)|\/api\/(?:remux|transcode)(?:[/?#]|$)/i.test(source) &&
    canUseDecodePlayback(scope)
  );
}
