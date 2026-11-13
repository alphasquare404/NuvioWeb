import { StreamPreferencesStore } from "../../data/local/streamPreferencesStore.js";
import { buildStreamResumeIdentity } from "./streamResumeIdentity.js";

export function reusableStreamPreference(
  settings,
  itemId,
  videoId,
  store = StreamPreferencesStore
) {
  if (!settings?.streamReuseLastLinkEnabled || !itemId) return null;
  return store.getValid(
    itemId,
    videoId || itemId,
    Number(settings.streamReuseLastLinkCacheHours || 24) * 60 * 60 * 1000
  );
}
export function matchesReusableStream(stream, saved) {
  if (!stream || !saved) return false;
  return !!(
    (saved.resumeIdentity && buildStreamResumeIdentity(stream) === saved.resumeIdentity) ||
    (saved.streamId && String(stream.id) === String(saved.streamId))
  );
}

export function reusablePlaybackUrl(value) {
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password
      ? url.href
      : "";
  } catch {
    return "";
  }
}

export function rememberableStreamCandidate(stream) {
  const url = reusablePlaybackUrl(stream?.url || stream?.externalUrl);
  const hints = stream?.behaviorHints || stream?.raw?.behaviorHints || {};
  if (!url || Object.keys(hints.proxyHeaders?.request || {}).length) return null;
  return {
    id: stream.id,
    url,
    name: stream.name,
    title: stream.title || stream.label,
    description: stream.description,
    addonId: stream.addonId || stream.streamOrigin?.addonId,
    addonName: stream.addonName,
    sourceProviderId: stream.sourceProviderId || stream.streamOrigin?.sourceProviderId,
    addonOrderIndex: stream.addonOrderIndex,
    sourceType: stream.sourceType,
    mimeType: stream.mimeType,
    infoHash: stream.infoHash || stream.clientResolve?.infoHash,
    fileIdx: stream.fileIdx ?? stream.clientResolve?.fileIdx,
    sources: Array.isArray(stream.sources)
      ? stream.sources.filter((source) => typeof source === "string")
      : [],
    behaviorHints: {
      filename: hints.filename || stream.clientResolve?.filename,
      bingeGroup: hints.bingeGroup
    },
    debridCacheStatus:
      stream.debridCacheStatus?.providerId || stream.clientResolve?.service
        ? { providerId: stream.debridCacheStatus?.providerId || stream.clientResolve?.service }
        : undefined
  };
}

export function rememberedAttemptKey(stream) {
  return (
    reusablePlaybackUrl(stream?.url || stream?.externalUrl) ||
    buildStreamResumeIdentity(stream) ||
    String(stream?.id || "")
  );
}

export function selectRememberedRetry(candidates, saved, failed) {
  const available = candidates.filter((stream) => !failed.has(rememberedAttemptKey(stream)));
  return (
    available.find(
      (stream) => saved.resumeIdentity && buildStreamResumeIdentity(stream) === saved.resumeIdentity
    ) ||
    available.find((stream) => matchesReusableStream(stream, saved)) ||
    available[0] ||
    null
  );
}
