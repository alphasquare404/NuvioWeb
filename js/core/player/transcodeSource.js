// When the audio track alone is the reason a stream will not play.
//
// The same measurement that produced the remux relay applies one step further: an
// MKV that will not open is a container problem, but an MP4 with E-AC3, DTS or
// TrueHD audio is an audio problem, and copying the picture while re-encoding only
// the audio track is minutes cheaper than re-encoding the picture.
//
// Unlike remux, that costs the deployment real CPU, so there are two gates: the
// deployment has to offer the endpoint (TRANSCODE_ENDPOINT), and the profile has to
// be allowed to use it. The second is why this module also asks the bridge how it
// is configured rather than assuming a token is needed.

import { PLAYBACK_METHODS } from "./playbackMethod.js";

export const TRANSCODE_ACCESS_MODES = Object.freeze({
  OPEN: "open",
  TOKEN: "token",
  LAN: "lan"
});

/**
 * What the bridge will do with an unknown value.
 *
 * Same rule as the server: anything unrecognised falls back to the strictest
 * shape, so a typo in one call site cannot open the endpoint up.
 */
export function normalizeTranscodeAccessMode(value) {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (normalized === TRANSCODE_ACCESS_MODES.OPEN || normalized === TRANSCODE_ACCESS_MODES.LAN) {
    return normalized;
  }
  return TRANSCODE_ACCESS_MODES.TOKEN;
}

export function isTranscodeEndpointConfigured(endpoint) {
  return String(endpoint || "").trim().length > 0;
}

/** Only a source the bridge itself can fetch is worth wrapping. */
function isFetchableByServer(url) {
  return /^https?:\/\//i.test(String(url || "").trim());
}

/**
 * Should this source be handed to the audio transcode endpoint?
 *
 * Only when the ladder says the audio track is the problem. A stream that needs
 * the container fixed is the remux relay's job, and one already pointing at this
 * endpoint must not be wrapped a second time.
 */
export function shouldTranscodeSource({ url = "", verdict = null, endpoint = "" } = {}) {
  if (!isTranscodeEndpointConfigured(endpoint)) return false;
  if (verdict?.method !== PLAYBACK_METHODS.AUDIO_TRANSCODE) return false;
  const value = String(url || "").trim();
  if (!isFetchableByServer(value)) return false;
  return !value.startsWith(String(endpoint).trim());
}

/**
 * May this profile ask at all?
 *
 * `open` and `lan` need no secret -- the server decides by itself who is calling.
 * `token` needs one, and an unknown mode is read as `token` so a bridge that could
 * not be asked never gets called on the strength of a guess.
 */
export function isTranscodeAccessGranted({ mode = "", token = "" } = {}) {
  const normalized = normalizeTranscodeAccessMode(mode);
  if (normalized === TRANSCODE_ACCESS_MODES.OPEN) return true;
  if (normalized === TRANSCODE_ACCESS_MODES.LAN) return true;
  return String(token || "").trim().length > 0;
}

/**
 * What this device needs the deployment to produce.
 *
 * The bridge cannot know what a phone can decode -- the only party that can answer
 * is the device itself, through MediaSource.isTypeSupported -- so the plan is
 * computed here and sent as a small, closed set of values the server validates.
 * That is also what makes a second device work without any configuration: it
 * simply asks for its own plan.
 *
 * Today the only audio path is "keep the picture, re-encode the audio to AAC",
 * because AAC is the one target every browser that plays MP4 at all can decode.
 * Asking for a re-encode of the picture is a separate, expensive decision and is
 * deliberately not produced here.
 */
export const TRANSCODE_PLAN_DEFAULTS = Object.freeze({
  video: "copy",
  audio: "aac",
  height: 0,
  channels: 2
});

export function buildTranscodePlan({ capabilities = {}, verdict = null } = {}) {
  if (verdict?.method !== PLAYBACK_METHODS.AUDIO_TRANSCODE) {
    return { ok: false, reason: "not-audio-only" };
  }
  // A device that cannot decode AAC either has nothing left to gain from this
  // endpoint, and asking would only spend CPU to produce another unplayable file.
  if (capabilities.aac === false) {
    return { ok: false, reason: "no-common-audio" };
  }
  return { ok: true, plan: { ...TRANSCODE_PLAN_DEFAULTS } };
}

/** The query pairs that carry a plan, in the order the bridge reads them. */
export function transcodePlanQuery(plan) {
  if (!plan) return [];
  const parts = [`v=${encodeURIComponent(plan.video)}`, `a=${encodeURIComponent(plan.audio)}`];
  const height = Number(plan.height || 0);
  if (Number.isInteger(height) && height > 0) parts.push(`h=${height}`);
  const channels = Number(plan.channels || 0);
  if (Number.isInteger(channels) && channels > 0) parts.push(`ac=${channels}`);
  // Which audio track to take: a copy of the second track is not the same file as a
  // copy of the first, so it belongs in the request and in the cache key.
  const audioIndex = Number(plan.audioIndex || 0);
  if (Number.isInteger(audioIndex) && audioIndex > 0) parts.push(`ai=${audioIndex}`);
  if (Array.isArray(plan.audioIndices) && plan.audioIndices.length > 1)
    parts.push("audios=" + encodeURIComponent(plan.audioIndices.join(",")));
  return parts;
}

/**
 * The URL of the playlist, when the bridge offers HLS.
 *
 * A `<video>` element asked for a playlist of short fragments is the shape iOS
 * accepts for something that is still being produced. It is preferred over the
 * single file whenever the bridge says it can do it, because the file has to be
 * finished first and a film is minutes, not seconds.
 */
export function buildTranscodePlaylistUrl(url, { endpoint = "", token = "", plan = null } = {}) {
  const base = String(endpoint || "").trim();
  // An endpoint that already carries a query cannot have a path appended without
  // guessing where it belongs; that deployment keeps the file delivery.
  if (!base || base.includes("?")) return "";
  const parts = [`u=${encodeURIComponent(String(url || ""))}`];
  const secret = String(token || "").trim();
  if (secret) parts.push(`token=${encodeURIComponent(secret)}`);
  parts.push(...transcodePlanQuery(plan));
  return `${base.replace(/\/+$/, "")}/hls/index.m3u8?${parts.join("&")}`;
}

/**
 * The URL of the single-file delivery.
 *
 * The token travels in the query string because a <video> element cannot send an
 * Authorization header. It is this deployment's own origin, and the bridge accepts
 * either form, so a future caller with a fetch can use the header instead.
 *
 * `stream` asks for the answer while the job is still running, in fragments. That
 * is measured as refused by iOS -- `mediaErrorCode 4`, NotSupportedError 9 -- so
 * the app does not ask for it; `buildTranscodePlaylistUrl` is the delivery that
 * works.
 */
export function buildTranscodeUrl(
  url,
  { endpoint = "", token = "", stream = false, plan = null } = {}
) {
  const base = String(endpoint || "").trim();
  if (!base) return "";
  const separator = base.includes("?") ? "&" : "?";
  const parts = [`u=${encodeURIComponent(String(url || ""))}`];
  const secret = String(token || "").trim();
  if (secret) parts.push(`token=${encodeURIComponent(secret)}`);
  parts.push(...transcodePlanQuery(plan));
  if (stream) parts.push("stream=1");
  return `${base}${separator}${parts.join("&")}`;
}

/**
 * Ask the bridge how it is configured, once per session.
 *
 * The mode is the deployment's answer, not the profile's, and the app cannot know
 * it: a `lan` deployment is usable without a token and an `open` one never wants
 * one. Never throws -- a bridge that cannot be reached is read as `token`, which is
 * the same fail-closed default the server applies.
 *
 * It also carries `hls`: whether this bridge can deliver a stream while it is still
 * being produced. A deployment without it keeps the whole-file answer, which works
 * and is only slower to start.
 */
export function createTranscodeAccess({
  endpoint = "",
  fetchImpl = globalThis.fetch,
  timeoutMs = 4000
} = {}) {
  const base = String(endpoint || "").trim();
  let pending = null;
  let mode = "";
  let hls = false;

  async function request() {
    // An endpoint that already carries a query cannot have "/health" appended
    // without guessing where it belongs, so it is left unasked and treated as a
    // token deployment.
    if (!base || base.includes("?")) {
      mode = normalizeTranscodeAccessMode("");
      return { mode, reachable: false, hls: false };
    }
    const target = `${base.replace(/\/+$/, "")}/health`;
    const controller = typeof AbortController === "function" ? new AbortController() : null;
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
    try {
      const response = await fetchImpl(target, { signal: controller?.signal });
      if (!response?.ok) throw new Error(`transcode health ${response?.status || 0}`);
      const data = await response.json();
      mode = normalizeTranscodeAccessMode(data?.access);
      hls = data?.hls === true;
      return {
        mode,
        reachable: true,
        hls,
        ...(data?.fullVideo === true ? { fullVideo: true } : {}),
        ...(data?.alternateAudio === true ? { alternateAudio: true } : {})
      };
    } catch {
      mode = normalizeTranscodeAccessMode("");
      hls = false;
      return { mode, reachable: false, hls: false };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  return {
    get enabled() {
      return base.length > 0;
    },

    /** Cached: concurrent callers share one request, and it is asked once a session. */
    async resolve() {
      if (!pending) pending = request();
      return pending;
    },

    /** The mode already known, without waiting. */
    get mode() {
      return mode;
    }
  };
}
