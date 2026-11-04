// A correlation tag, never a URL/token/filename. Only emitted with opt-in debug.
export function probeSourceId(value) {
  let hash = 2166136261;
  for (const char of String(value || "")) hash = Math.imul(hash ^ char.codePointAt(0), 16777619);
  return "s" + (hash >>> 0).toString(16).padStart(8, "0");
}
export function reportProbeCacheHit(url, tier) {
  if (
    globalThis.__NUVIO_CLIENT_PROBE_DEBUG__ !== true ||
    !["memory", "persistent", "byte-limit-failure"].includes(tier)
  )
    return;
  console.warn(
    "[ClientProbe] " + JSON.stringify({ event: "cache-hit", sourceId: probeSourceId(url), tier })
  );
}
const labels = new Map();
export function reportPlaybackLabel(url, probe, verdict) {
  if (globalThis.__NUVIO_CLIENT_PROBE_DEBUG__ !== true || !probe) return;
  const sourceId = probeSourceId(url),
    assessment = probe.playbackCapabilities;
  const facts = {
    sourceId,
    method: verdict.method,
    reason: /^[a-z0-9-]{1,80}$/i.test(verdict.reason || "") ? verdict.reason : "unavailable",
    engine: ["native", "movi"].includes(assessment?.engine) ? assessment.engine : "unknown",
    videoSupported: assessment?.video ?? null,
    containerSupported: assessment?.container ?? null,
    audioSupported: (assessment?.audio || []).map((track) => ({
      index: track.index,
      supported: track.supported ?? null
    })),
    width: Number(probe.width) || 0,
    height: Number(probe.height) || 0,
    audioChannels: Number(probe.audioChannels) || 0
  };
  const signature = JSON.stringify(facts);
  if (labels.get(sourceId) === signature) return;
  labels.set(sourceId, signature);
  while (labels.size > 200) labels.delete(labels.keys().next().value);
  console.warn("[PlaybackLabel] " + signature);
}

// Error pages are not media. Read at most 4 KiB to categorize a CDN refusal,
// cancel the rest, and retain only a fixed category -- never response text.
export async function inspectProbeHttpFailure(response) {
  const contentType = response.headers.get("Content-Type") || "";
  const errorType = /json/i.test(contentType)
    ? "json"
    : /html/i.test(contentType)
      ? "html"
      : /text|xml/i.test(contentType)
        ? "text"
        : "other";
  let errorCategory = "http-error",
    errorBytes = 0;
  const reader = errorType !== "other" ? response.body?.getReader?.() : null;
  if (!reader) {
    await response.body?.cancel().catch(() => {});
    return { errorType, errorCategory, errorBytes };
  }
  const bytes = new Uint8Array(4096);
  try {
    while (errorBytes < bytes.length) {
      const part = await reader.read();
      if (part.done) break;
      const take = Math.min(part.value.length, bytes.length - errorBytes);
      bytes.set(part.value.subarray(0, take), errorBytes);
      errorBytes += take;
    }
    const text = new TextDecoder().decode(bytes.subarray(0, errorBytes));
    errorCategory =
      /expired|invalid.{0,30}(?:signature|token)|signature.{0,30}(?:invalid|mismatch)/i.test(text)
        ? "signed-link-rejected"
        : /range.{0,40}(?:invalid|not satisfiable)|invalid.{0,20}range/i.test(text)
          ? "range-rejected"
          : /cloudflare|ray id/i.test(text)
            ? "edge-rejected"
            : /access denied|unauthorized|forbidden/i.test(text)
              ? "access-denied"
              : /bad request/i.test(text)
                ? "bad-request"
                : "http-error";
  } catch {
    /* Keep fixed facts even when a response stalls or is aborted. */
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock?.();
  }
  return { errorType, errorCategory, errorBytes };
}
