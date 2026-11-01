import { classifyPlayback } from "./playbackMethod.js";
import { classifyStreamFilename } from "../streams/streamCompatibilityFilter.js";
import { normalizePlaybackLabelSource } from "../streams/streamLabelPolicy.js";
import { REMUX_POLICY, REMUX_ENDPOINT, TRANSCODE_ENDPOINT } from "../../config.js";
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

// A filename estimate chooses only an initial copy/direct attempt. It cannot
// authorize an encoder or turn unverified codec support into a file fact.
export function selectUnverifiedPlayback({
  stream,
  probe,
  labels = {},
  capabilities = {},
  policy = REMUX_POLICY
} = {}) {
  const sourceUrl = String(stream?.url || stream?.externalUrl || "").trim();
  const verdict = probe ? classifyPlayback({ url: sourceUrl, probe, capabilities }) : null;
  if (!sourceUrl || (verdict && verdict.method !== "unknown")) return null;
  const filename =
    normalizePlaybackLabelSource(labels.playbackLabelSource) === "FILE_NAME" ||
    labels.metadataFilenameFallback === true;
  const estimated = filename ? classifyStreamFilename(stream, capabilities).method : "unknown";
  const route = estimated === "remux" && policy.mode !== "off" ? "remux" : "direct";
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
    audioIndex = 0
  } = {}
) {
  if (policy.mode === "client") {
    const plan = clientRemuxPlan({ url: sourceUrl }, null, { policy, attemptCopy: true });
    if (plan) return { url: plan.sourceUrl, plan };
  }
  if (policy.mode === "server" && remuxEndpoint) {
    const service = transcodeEndpoint ? await access.resolve() : null;
    if (service?.hls) {
      const url = buildTranscodePlaylistUrl(sourceUrl, {
        endpoint: transcodeEndpoint,
        token,
        plan: { video: "copy", audio: "copy", height: 0, channels: 2, audioIndex }
      });
      if (url) return { url, plan: null };
    }
    return { url: buildRemuxUrl(sourceUrl, remuxEndpoint, { audioIndex }), plan: null };
  }
  const error = new Error("Remux is unavailable in this host configuration.");
  error.code = "REMUX_ROUTE_UNAVAILABLE";
  throw error;
}

export function canTryUnverifiedAudioTranscode(attempt, failure, endpoint = TRANSCODE_ENDPOINT) {
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

// Only actual file facts plus device assessment may authorize audio encoding.
// An unsuccessful probe, a playable alternative track or unsupported video stops here.
export async function prepareUnverifiedAudioTranscode(
  sourceUrl,
  {
    probe = null,
    readProbe,
    capabilities = {},
    transcodeEndpoint = TRANSCODE_ENDPOINT,
    access = copyAccess,
    token = TranscodeSettingsStore.get().token || ""
  } = {}
) {
  if (!transcodeEndpoint) return null;
  const facts = probe || (await readProbe?.());
  if (!facts) return null;
  const verdict = classifyPlayback({ url: sourceUrl, probe: facts, capabilities });
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
