// What this device says it can decode.
//
// Asked once, answered by the platform. The point is not to trust it blindly — it
// only knows codecs, not the file — but to combine it with the probe: the file says
// what it contains, this says whether the picture can be handed to <video> as is.

const CODEC_PROBES = {
  h264: 'video/mp4; codecs="avc1.640028"',
  hevc: 'video/mp4; codecs="hvc1.1.6.L120.90"',
  av1: 'video/mp4; codecs="av01.0.08M.10"',
  aac: 'video/mp4; codecs="mp4a.40.2"',
  eac3: 'video/mp4; codecs="ec-3"',
  ac3: 'video/mp4; codecs="ac-3"',
  opus: 'video/mp4; codecs="opus"'
};

let cached = null;

export function detectDeviceCapabilities(
  source = globalThis.MediaSource || globalThis.ManagedMediaSource
) {
  const capabilities = {};
  for (const [codec, type] of Object.entries(CODEC_PROBES)) {
    try {
      capabilities[codec] = Boolean(source?.isTypeSupported?.(type));
    } catch {
      capabilities[codec] = false;
    }
  }
  // No platform exposes a DTS capability through isTypeSupported; the safe reading
  // is "assume not", which only ever downgrades to an audio transcode.
  capabilities.dts = false;
  return capabilities;
}

export function getDeviceCapabilities() {
  if (!cached) cached = detectDeviceCapabilities();
  return cached;
}

/** Tests inject their own platform; production calls this once per page. */
export function setDeviceCapabilitiesForTests(capabilities) {
  cached = capabilities;
}
