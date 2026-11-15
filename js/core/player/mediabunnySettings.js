export function normalizeMediabunnyMode(value, legacyEngine) {
  if (value === "decode" || value === "process") return value;
  return legacyEngine === "movi" ? "decode" : "process";
}

export function canUseDecodePlayback(scope = globalThis) {
  return Boolean(scope.isSecureContext && (scope.AudioContext || scope.webkitAudioContext));
}

export function shouldRouteToDecodePlayback(params, settings, scope = globalThis) {
  const source = String(params?.streamUrl || "");
  return Boolean(
    settings?.mediabunnyEnabled !== false &&
    settings?.mediabunnyMode === "decode" &&
    !params?.skipMediabunnyDecode &&
    !params?.externalFrameUrl &&
    /^(https?:|blob:)/i.test(source) &&
    !/\.(?:m3u8|mpd)(?:[?#]|$)|\/api\/(?:remux|transcode)(?:[/?#]|$)/i.test(source) &&
    canUseDecodePlayback(scope)
  );
}
