export function canReleasePlayingStartupAudioGate({
  allowPlayback = false,
  hasPresentedPlaybackFrame = false,
  pendingAudioSelection = false,
  readyState = 0
} = {}) {
  return Boolean(
    allowPlayback &&
    hasPresentedPlaybackFrame &&
    !pendingAudioSelection &&
    Number.isFinite(Number(readyState)) &&
    Number(readyState) >= 3
  );
}

export function shouldAllowPlaybackDuringStartupAudioGate({
  isHlsPlayback = false,
  isClientRemuxPlayback = false
} = {}) {
  // Streaming pipelines must advance while the presentation gate keeps audio muted.
  return Boolean(isHlsPlayback || isClientRemuxPlayback);
}

export function selectStartupAudioFallbackOption(options = []) {
  const supportedOptions = (Array.isArray(options) ? options : []).filter(
    (entry) => entry?.supported !== false
  );
  return supportedOptions.find((entry) => entry?.selected) || supportedOptions[0] || null;
}
