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

/**
 * Does this platform refuse HEVC that is tagged the other way?
 *
 * Apple's media stack opens HEVC only when the track says `hvc1`; a file tagged
 * `hev1` — which is how essentially every x265 webrip in an MP4 arrives — is
 * refused with no diagnosis at all (`networkState: 3`, "not supported"). There is
 * no API that answers this, so it is read from the platform: iPhone/iPad, and the
 * iPadOS build that reports itself as a Mac with a touch screen.
 */
export function requiresHvc1HevcTag(userAgent = "", maxTouchPoints = 0) {
  const agent = String(userAgent || "");
  if (/iP(hone|ad|od)/i.test(agent)) return true;
  return /Macintosh/.test(agent) && Number(maxTouchPoints) > 1;
}

export function detectDeviceCapabilities(
  source = globalThis.MediaSource || globalThis.ManagedMediaSource,
  {
    userAgent = globalThis.navigator?.userAgent || "",
    maxTouchPoints = globalThis.navigator?.maxTouchPoints || 0
  } = {}
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
  // A platform that only accepts hvc1 turns an `hev1` file into a relay job, not a
  // direct play -- the label would otherwise promise something it cannot deliver.
  capabilities.hevcHvc1Required = requiresHvc1HevcTag(userAgent, maxTouchPoints);
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
