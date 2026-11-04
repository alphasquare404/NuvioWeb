// Output capability only; each source still needs its own codec/container checks.
// Unsupported media queries must remain unknown, not be mistaken for SDR.
export function detectHdrPlaybackSupport(scope = globalThis) {
  if (typeof scope.matchMedia !== "function") return null;
  try {
    if (scope.matchMedia("(video-dynamic-range: high)").matches) return true;
    if (scope.matchMedia("(video-dynamic-range: standard)").matches) return false;
    // An SDR display cannot present HDR. A CSS HDR display alone does not prove
    // the browser's separate video output path supports it.
    if (
      !scope.matchMedia("(dynamic-range: high)").matches &&
      scope.matchMedia("(dynamic-range: standard)").matches
    )
      return false;
  } catch {
    /* Capability unavailable. */
  }
  return null;
}

let cachedSupport;
export function getHdrPlaybackSupport() {
  if (cachedSupport === undefined) cachedSupport = detectHdrPlaybackSupport();
  return cachedSupport;
}

export function invalidateHdrPlaybackSupport() {
  cachedSupport = undefined;
}
