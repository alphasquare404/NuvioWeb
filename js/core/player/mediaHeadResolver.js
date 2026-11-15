import { httpRequest } from "../network/httpClient.js";
import { SessionStore } from "../storage/sessionStore.js";
import { isPrivateMediaUrl } from "../streams/privateMediaSource.js";

export async function resolveMediaHead(url, headers, signal) {
  if (isPrivateMediaUrl(url) || !SessionStore.accessToken || SessionStore.isAnonymousSession) {
    return null;
  }
  try {
    if (new URL(url).protocol !== "https:") return null;
    const result = await httpRequest("/api/debrid/plugin/fetch", {
      method: "POST",
      body: JSON.stringify({ url, method: "GET", headers, metadataOnly: true }),
      redirect: "error",
      signal
    });
    return result?.url === url && Number.isSafeInteger(result.size) && result.size > 0
      ? String(result.size)
      : null;
  } catch {
    return null;
  }
}
