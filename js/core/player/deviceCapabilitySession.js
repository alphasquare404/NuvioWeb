import { getDeviceCapabilities, invalidateDeviceCapabilities } from "./deviceCapabilities.js";
import { getHdrPlaybackSupport, invalidateHdrPlaybackSupport } from "./hdrSupport.js";

let initialized = false;
let revision = 0;
let refreshPending = false;
function scheduleRefresh() {
  if (refreshPending) return;
  refreshPending = true;
  Promise.resolve().then(() => {
    refreshPending = false;
    refreshDeviceCapabilities();
  });
}

export function getCapabilityRevision() {
  return revision;
}

// Invalidate both the device snapshot and per-file predictions, never file facts.
export function refreshDeviceCapabilities() {
  invalidateDeviceCapabilities();
  invalidateHdrPlaybackSupport();
  revision++;
  return { codecs: getDeviceCapabilities(), hdr: getHdrPlaybackSupport() };
}

export function initializeDeviceCapabilitySession() {
  const snapshot = { codecs: getDeviceCapabilities(), hdr: getHdrPlaybackSupport() };
  if (initialized) return snapshot;
  initialized = true;
  // Listen without periodically polling or making a media/network request.
  const scope = globalThis;
  for (const query of [
    "(video-dynamic-range: high)",
    "(video-dynamic-range: standard)",
    "(dynamic-range: high)",
    "(dynamic-range: standard)"
  ]) {
    try {
      const media = scope.matchMedia?.(query);
      if (typeof media?.addEventListener === "function")
        media.addEventListener("change", scheduleRefresh);
      else if (typeof media?.addListener === "function") media.addListener(scheduleRefresh);
    } catch {
      /* Older browsers keep the startup snapshot until reload. */
    }
  }
  scope.addEventListener?.("pageshow", (event) => {
    if (event.persisted) scheduleRefresh();
  });
  return snapshot;
}
