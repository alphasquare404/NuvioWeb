import { canUseDecodePlayback } from "./mediabunnySettings.js";

let preparedContext;
let expiry;

function createAudioContext() {
  const AudioContext = globalThis.AudioContext || globalThis.webkitAudioContext;
  return new AudioContext();
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
