import { chooseHlsAudioIndices } from "./relayTracks.js";
import { classifyStreamFilename } from "../streams/streamCompatibilityFilter.js";
import { classifyPlayback } from "./playbackMethod.js";

import { REMUX_POLICY, REMUX_ENDPOINT, TRANSCODE_ENDPOINT, TRANSCODE_MODE } from "../../config.js";
import { clientRemuxPlan } from "./remuxClient.js";
import { buildRemuxUrl } from "./remuxSource.js";
import {
  createTranscodeAccess,
  buildTranscodePlaylistUrl,
  buildTranscodeUrl,
  buildTranscodePlan,
  isTranscodeAccessGranted
} from "./transcodeSource.js";
import { TranscodeSettingsStore } from "../../data/local/transcodeSettingsStore.js";
const copyAccess = createTranscodeAccess({ endpoint: TRANSCODE_ENDPOINT });

// Unknown file facts start Direct. Only a playback refusal or bounded startup
// stall can trigger the configured copy route; filenames never authorize encoding.
export function selectUnverifiedPlayback({ stream, probe, capabilities = {} } = {}) {
  const sourceUrl = String(stream?.url || stream?.externalUrl || "").trim();
  const verdict = probe ? classifyPlayback({ url: sourceUrl, probe, capabilities }) : null;
  if (!sourceUrl || (verdict && verdict.method !== "unknown")) return null;
  const route = "direct";
  return {
    sourceUrl,
    route,
    mediaUrl: sourceUrl,
    remuxTried: route === "remux",
    rawTried: route === "direct",
    audioTranscodeTried: false,
    busy: false,
    probeReason: verdict?.reason || ""
  };
}

// The user may opt into a filename-based first attempt. Encoding remains audio-only.
export function selectFilenamePlaybackAttempt({
  stream,
  probe = null,
  capabilities = {},
  enabled = true,
  policy = REMUX_POLICY,
  audioEndpoint = TRANSCODE_MODE === "server" ? TRANSCODE_ENDPOINT : ""
} = {}) {
  const attempt = selectUnverifiedPlayback({ stream, capabilities });
  if (!attempt) return null;
  const estimate = enabled
    ? probe
      ? classifyPlayback({ url: attempt.sourceUrl, probe, capabilities })
      : classifyStreamFilename(stream, capabilities)
    : null;
  const route =
    estimate?.method === "remux" && policy.mode !== "off"
      ? "remux"
      : estimate?.method === "audio-transcode" && audioEndpoint && capabilities.aac === true
        ? "audio-transcode"
        : "direct";
  return {
    ...attempt,
    route,
    rawTried: route === "direct",
    remuxTried: route === "remux",
    audioTranscodeTried: route === "audio-transcode",
    routeFallbackEnabled: true,
    filenameRouting: enabled,
    filenameVerdict: probe ? null : estimate
  };
}

export function nextPlaybackFallbackRoute(
  attempt,
  failure = {},
  {
    remuxAvailable = REMUX_POLICY.mode !== "off",
    audioAvailable = TRANSCODE_MODE === "server" && Boolean(TRANSCODE_ENDPOINT)
  } = {}
) {
  if (!attempt || attempt.busy) return null;
  const preparationTimeout = /Stream preparation timed out|server-hls-startup-timeout/i.test(
    failure.detail || ""
  );
  const eligible = canTryUnverifiedRemux(
    { ...attempt, route: "direct", remuxTried: false },
    {
      ...failure,
      mediaErrorCode:
        failure.preparationFailed || (!failure.startupStall && failure.detail)
          ? 4
          : failure.mediaErrorCode,
      detail: preparationTimeout ? "" : failure.detail,
      startupStall: failure.startupStall || preparationTimeout
    }
  );
  if (!eligible) return null;
  if (!attempt.rawTried) return "direct";
  if (!attempt.remuxTried && remuxAvailable) return "remux";
  if (!attempt.audioTranscodeTried && audioAvailable) return "audio-transcode";
  return null;
}

export function canTryUnverifiedRemux(
  attempt,
  { mediaErrorCode = 0, detail = "", httpStatus = 0, startupStall = false } = {}
) {
  if (!attempt || attempt.route !== "direct" || attempt.remuxTried || attempt.busy) return false;
  if ([1, 2].includes(Number(mediaErrorCode))) return false;
  // Even a format-shaped media error can carry an explicit access/network failure.
  if (
    Number(httpStatus) >= 400 ||
    /(?:HTTP|status|response(?:Code)?)\s*[=:]?\s*[45]\d\d|networkError|network (?:request|connection)|fetch failed|failed to fetch|load failed|CORS|timeout|timed out|abort|NotAllowedError|SecurityError|expired|unauthori[sz]ed|forbidden/i.test(
      detail
    )
  )
    return false;
  return (
    (startupStall && Number(mediaErrorCode) === 0) ||
    [3, 4].includes(Number(mediaErrorCode)) ||
    /NotSupportedError|codec.*unsupported|unsupported.*(?:codec|format)|format.*not supported/i.test(
      detail
    )
  );
}

export async function prepareUnverifiedRemux(
  sourceUrl,
  {
    policy = REMUX_POLICY,
    remuxEndpoint = REMUX_ENDPOINT,
    transcodeEndpoint = TRANSCODE_ENDPOINT,
    access = copyAccess,
    token = TranscodeSettingsStore.get().token || "",
    audioIndex = 0,
    probe = null
  } = {}
) {
  if (policy.mode === "client") {
    const plan = clientRemuxPlan({ url: sourceUrl }, probe, { policy, attemptCopy: true });
    if (plan && probe) plan.audioIndex = audioIndex;
    if (plan) return { url: plan.sourceUrl, plan };
  }
  if (policy.mode === "server" && remuxEndpoint) {
    const service = transcodeEndpoint ? await access.resolve() : null;
    if (service?.hls) {
      const url = buildTranscodePlaylistUrl(sourceUrl, {
        endpoint: transcodeEndpoint,
        token,
        plan: {
          video: "copy",
          audio: "copy",
          height: 0,
          channels: 2,
          audioIndex,
          audioIndices:
            service.alternateAudio && probe ? chooseHlsAudioIndices(probe, audioIndex) : null
        }
      });
      if (url) return { url, plan: null };
    }
    return { url: buildRemuxUrl(sourceUrl, remuxEndpoint, { audioIndex }), plan: null };
  }
  const error = new Error("Remux is unavailable in this host configuration.");
  error.code = "REMUX_ROUTE_UNAVAILABLE";
  throw error;
}

export function canTryUnverifiedAudioTranscode(
  attempt,
  failure,
  endpoint = TRANSCODE_MODE === "server" ? TRANSCODE_ENDPOINT : ""
) {
  if (
    !endpoint ||
    !attempt ||
    attempt.route !== "remux" ||
    attempt.audioTranscodeTried ||
    attempt.busy
  )
    return false;
  return canTryUnverifiedRemux({ ...attempt, route: "direct", remuxTried: false }, failure);
}

// Actual file facts are preferred. The explicit filename-routing preference may
// authorize an estimated audio-only plan; the video always remains copy.
export async function prepareUnverifiedAudioTranscode(
  sourceUrl,
  {
    probe = null,
    readProbe,
    filenameVerdict = null,
    allowFilenameEstimate = false,
    capabilities = {},
    transcodeEndpoint = TRANSCODE_MODE === "server" ? TRANSCODE_ENDPOINT : "",
    access = copyAccess,
    token = TranscodeSettingsStore.get().token || ""
  } = {}
) {
  if (!transcodeEndpoint) return null;
  let facts = probe;
  let verdict = facts ? classifyPlayback({ url: sourceUrl, probe: facts, capabilities }) : null;
  if (
    !verdict &&
    allowFilenameEstimate &&
    filenameVerdict?.method === "audio-transcode" &&
    capabilities.aac === true
  )
    verdict = filenameVerdict;
  if (!verdict) {
    facts = await readProbe?.();
    if (!facts) return null;
    verdict = classifyPlayback({ url: sourceUrl, probe: facts, capabilities });
  }
  const requested = buildTranscodePlan({ capabilities, verdict });
  if (!requested.ok) return null;
  const service = await access.resolve();
  if (!service?.reachable || !isTranscodeAccessGranted({ mode: service.mode, token })) return null;
  const plan = { ...requested.plan, audioIndex: Number(verdict.audioIndex) || 0 };
  const url =
    service.hls &&
    buildTranscodePlaylistUrl(sourceUrl, { endpoint: transcodeEndpoint, token, plan });
  return {
    url: url || buildTranscodeUrl(sourceUrl, { endpoint: transcodeEndpoint, token, plan }),
    plan: null
  };
}
