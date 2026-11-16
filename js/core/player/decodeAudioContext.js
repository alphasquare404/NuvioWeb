import { canUseDecodePlayback } from "./mediabunnySettings.js";

let preparedContext;
let expiry;

function createAudioContext() {
  applyPlaybackAudioSession();
  const AudioContext = globalThis.AudioContext || globalThis.webkitAudioContext;
  return new AudioContext();
}

// Decoded audio goes straight to WebAudio, which iOS silences with the ring
// switch unless the page claims a playback session. The video path never needs
// this, so only the decode runtime calls it.
export function applyPlaybackAudioSession(scope = globalThis) {
  try {
    const session = scope.navigator?.audioSession;
    if (session && "type" in session) session.type = "playback";
  } catch (_) {
    // Unsupported browsers keep their default session.
  }
}

export function prepareDecodeAudioFromGesture(settings) {
  if (
    settings.mediabunnyEnabled === false ||
    settings.mediabunnyMode !== "decode" ||
    !canUseDecodePlayback() ||
    !globalThis.navigator?.userActivation?.isActive
  ) {
    return;
  }

  try {
    applyPlaybackAudioSession();
    preparedContext ||= createAudioContext();
    void preparedContext.resume().catch(() => {});
    clearTimeout(expiry);
    expiry = setTimeout(() => {
      const context = preparedContext;
      preparedContext = null;
      void context?.close().catch(() => {});
    }, 60000);
  } catch (_) {
    // Playback can still initialize its own audio context.
  }
}

export function takeDecodeAudioContext() {
  clearTimeout(expiry);
  const context = preparedContext;
  preparedContext = null;
  return context || createAudioContext();
}
