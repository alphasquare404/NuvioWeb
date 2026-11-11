const phases = new Set([
  "runtime-import",
  "runtime-create",
  "release-playback",
  "cache-close",
  "storage-cleanup",
  "cache-open",
  "subtitle-worker",
  "renderer-open",
  "producer-start",
  "cache-run",
  "staging-lock",
  "media-worker"
]);
const names = new Map([
  ["UnknownError", "unknown-error"],
  ["QuotaExceededError", "quota-exceeded"],
  ["InvalidStateError", "invalid-state"],
  ["SecurityError", "security-error"],
  ["NotAllowedError", "not-allowed"],
  ["NotFoundError", "not-found"],
  ["AbortError", "aborted"],
  ["TypeError", "type-error"]
]);
// Browser exception messages may contain URLs or misleading example causes.
// Record only our fixed phase and exception class, before cleanup can obscure it.
export async function runStartupStep(
  phase,
  operation,
  report = (facts) => console.warn("[ClientRemux] startup-failure", facts)
) {
  if (!phases.has(phase)) throw Error("invalid-startup-phase");
  try {
    return await operation();
  } catch (error) {
    if (error?.remuxStartupPhase) throw error;
    const exception = names.get(error?.name) || "operation-failed";
    const reason = error?.message === "sourceopen-timeout" ? "sourceopen-timeout" : exception;
    const failure = new Error("client-startup-" + phase + "-" + reason);
    failure.remuxStartupPhase = phase;
    try {
      report({ phase, exception, reason });
    } catch {}
    throw failure;
  }
}

const playbackReasons = new Set([
  "AbortError",
  "DataError",
  "InvalidStateError",
  "NetworkError",
  "NotSupportedError",
  "OperationError",
  "QuotaExceededError",
  "SecurityError",
  "TypeError",
  "audio-probe-mismatch",
  "audio-track-limit",
  "audio-track-unavailable",
  "buffer-budget-cannot-progress",
  "cache-capacity-unavailable",
  "cache-file-invalid",
  "cache-file-missing",
  "cache-media-invalid",
  "client-media-error",
  "client-transcode-audio-decode-unsupported",
  "client-transcode-software-audio-decode-failed",
  "client-transcode-audio-output-unavailable",
  "client-transcode-video-decode-unsupported",
  "client-transcode-software-video-decode-failed",
  "client-transcode-software-video-decoder-unavailable",
  "client-transcode-aac-encode-unsupported",
  "client-transcode-video-copy-unsupported",
  "client-transcode-codec-unsupported",
  "client-transcode-output-unavailable",
  "transcode-init-too-large",
  "transcode-track-unavailable",
  "client-output-audio-codec-unsupported",
  "client-output-video-codec-unsupported",
  "decoder-not-ready-within-buffer-budget",
  "duration-unavailable",
  "fragment-packet-budget",
  "output-box-invalid",
  "output-codecs-unsupported",
  "output-timing-invalid",
  "output-write-exceeds-buffer-budget",
  "range-body-too-large",
  "range-body-truncated",
  "range-head-invalid",
  "range-read-limit",
  "range-response-invalid",
  "remux-version-mismatch",
  "seek-outside-duration",
  "short-opfs-write",
  "source-changed",
  "sourcebuffer-compressed-byte-budget",
  "sourcebuffer-error",
  "staging-write-failed",
  "startup-window-exceeds-buffer-budget",
  "video-keyframe-unavailable",
  "worker-error"
]);

const codecNames = new Set([
  "avc",
  "hevc",
  "vp8",
  "vp9",
  "av1",
  "aac",
  "mp3",
  "opus",
  "vorbis",
  "flac",
  "ac3",
  "eac3",
  "ac-3",
  "ec-3",
  "alac",
  "dts",
  "truehd",
  "pcm-u8",
  "pcm-s8",
  "pcm-s16",
  "pcm-s16be",
  "pcm-s24",
  "pcm-s24be",
  "pcm-s32",
  "pcm-s32be",
  "pcm-f32",
  "pcm-f32be",
  "pcm-f64",
  "pcm-f64be",
  "ulaw",
  "alaw"
]);

export function clientRemuxFailureFacts(phase, error, stats, video) {
  const reason = [error?.message, error?.name].find((value) => playbackReasons.has(value));
  const facts = {
    phase,
    reason: reason || "operation-failed",
    nativeMediaErrorCode: video.error?.code || 0,
    readyState: video.readyState,
    networkState: video.networkState
  };
  for (const [key, allowed] of Object.entries({
    pipelinePhase: [
      "worker-storage",
      "source-open",
      "track-discovery",
      "codec-check",
      "key-packets",
      "output-metadata",
      "mux-output",
      "transcode-track-discovery",
      "transcode-codec-check",
      "transcode-output"
    ],
    rangeStep: ["request", "headers", "head-fallback", "body", "complete"],
    video: codecNames,
    audio: codecNames,
    videoDecoder: ["native", "software"],
    softwareVideoStage: [
      "config-allocation",
      "open",
      "packet-allocation",
      "send",
      "timestamp",
      "receive",
      "decode-frame",
      "convert-pixels",
      "copy-pixels",
      "drain"
    ],
    sourceVideo: codecNames,
    sourceAudio: codecNames
  })) {
    const value = stats[key];
    if (allowed instanceof Set ? allowed.has(value) : allowed.includes(value)) facts[key] = value;
  }
  for (const key of [
    "sourceOpenMs",
    "rangeAttempts",
    "rangeNetworkRetries",
    "rangeHostHeadUsed",
    "rangeSuccesses",
    "lastRangeMs",
    "lastRangeStatus",
    "lastHeadStatus",
    "lastRangeBodyBytes",
    "bytes",
    "audioTrackCount",
    "audioIndex",
    "outputBytes",
    "hostResolveAttempted",
    "hostResolveSucceeded",
    "rangeRedirected",
    "rangeRedirectRetry",
    "rangeContentRangeVisible",
    "outputMimeSupported"
  ]) {
    const value = stats[key];
    if (Number.isFinite(value) || typeof value === "boolean") facts[key] = value;
  }
  if (facts.softwareVideoStage && Number.isSafeInteger(stats.softwareVideoCode))
    facts.softwareVideoCode = stats.softwareVideoCode;
  if (stats.lastRangeStatus && stats.lastRangeStatus !== 206) {
    if (/^(?:[a-z0-9-]+\.)+[a-z0-9-]+$/i.test(stats.invalidRangeHost || ""))
      facts.responseHost = stats.invalidRangeHost;
    const contentType = stats.invalidRangeContentType;
    if (
      [
        "text/html",
        "text/plain",
        "application/json",
        "application/octet-stream",
        "video/mp4",
        "video/x-matroska",
        "video/webm"
      ].includes(contentType)
    )
      facts.responseContentType = contentType;
    if (Number.isSafeInteger(stats.invalidRangeContentLength))
      facts.responseContentLength = stats.invalidRangeContentLength;
  }
  return facts;
}
