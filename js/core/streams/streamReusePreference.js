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
