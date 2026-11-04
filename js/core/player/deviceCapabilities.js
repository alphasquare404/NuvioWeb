// What this device says it can decode.
//
// Asked once, answered by the platform. The point is not to trust it blindly — it
// only knows codecs, not the file — but to combine it with the probe: the file says
// what it contains, this says whether the picture can be handed to <video> as is.

// MIME names identify formats; support is always asked of the current browser.
export const CONTAINER_MIME_TYPES = Object.freeze({
  mp4: { video: "video/mp4", audio: "audio/mp4" },
  webm: { video: "video/webm", audio: "audio/webm" },
  mkv: { video: "video/x-matroska", audio: "audio/x-matroska" },
  ts: { video: "video/mp2t", audio: "audio/mp2t" },
  mpegts: { video: "video/mp2t", audio: "audio/mp2t" },
  avi: { video: "video/x-msvideo", audio: "audio/x-msvideo" }
});

const CODEC_PROBES = {
  h264: 'video/mp4; codecs="avc1.640028"',
  hevc: 'video/mp4; codecs="hvc1.1.6.L120.90"',
  av1: 'video/mp4; codecs="av01.0.08M.10"',
  aac: 'audio/mp4; codecs="mp4a.40.2"',
  eac3: 'audio/mp4; codecs="ec-3"',
  ac3: 'audio/mp4; codecs="ac-3"',
  opus: 'audio/mp4; codecs="opus"',
  flac: 'audio/mp4; codecs="flac"',
  vp8: 'video/webm; codecs="vp8"',
  vp9: 'video/webm; codecs="vp09.00.10.08"',
  vorbis: 'audio/webm; codecs="vorbis"',
  truehd: 'audio/mp4; codecs="mlpa"',
  vc1: 'video/mp4; codecs="vc-1"',
  dts: 'audio/mp4; codecs="dtsc"',
  mpeg4: 'video/mp4; codecs="mp4v.20.9"',
  mp4v: 'video/mp4; codecs="mp4v.20.9"'
};

let cached = null;

/** Historical probe-priority hint, never a playback support verdict. */
export function requiresHvc1HevcTag(userAgent = "", maxTouchPoints = 0) {
  const agent = String(userAgent || "");
  if (/iP(hone|ad|od)/i.test(agent)) return true;
  return /Macintosh/.test(agent) && Number(maxTouchPoints) > 1;
}

export function detectDeviceCapabilities(
  source = globalThis.MediaSource || globalThis.ManagedMediaSource,
  {
    userAgent = globalThis.navigator?.userAgent || "",
    maxTouchPoints = globalThis.navigator?.maxTouchPoints || 0,
    mediaElement
  } = {}
) {
  // Keep DOM calls out of default parameters: the legacy build transform can
  // otherwise lose the receiver while lowering optional method calls.
  if (mediaElement === undefined) {
    const documentRef = globalThis.document;
    mediaElement =
      typeof documentRef?.createElement === "function" ? documentRef.createElement("video") : null;
  }
  const capabilities = {};
  for (const [codec, type] of Object.entries(CODEC_PROBES)) {
    try {
      // Native file playback does not require MSE. Missing APIs are unknown.
      capabilities[codec] =
        typeof mediaElement?.canPlayType === "function"
          ? Boolean(mediaElement.canPlayType(type))
          : typeof source?.isTypeSupported === "function"
            ? Boolean(source.isTypeSupported(type))
            : null;
    } catch {
      capabilities[codec] = null;
    }
  }
  capabilities.containers = Object.fromEntries(
    Object.entries(CONTAINER_MIME_TYPES).map(([name, types]) => {
      let supported = null;
      try {
        if (typeof mediaElement?.canPlayType === "function")
          supported = Boolean(mediaElement.canPlayType(types.video));
      } catch {
        /* An unavailable query is unknown. */
      }
      return [name, supported];
    })
  );
  // A legacy hint used only to prioritise probes. It must never override file queries.
  capabilities.hevcHvc1Required = requiresHvc1HevcTag(userAgent, maxTouchPoints);
  // Channel support is assessed from the actual track, not inferred from iOS.
  capabilities.requiresStereoAac = false;
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

export function invalidateDeviceCapabilities() {
  cached = null;
}
