// A health response confirms the service, not admission of every remote source.
export async function resolveRelayAvailability({
  endpoint = "",
  token = "",
  transcode = false,
  fetchImpl = globalThis.fetch,
  timeoutMs = 2500,
  capability = ""
} = {}) {
  if (!String(endpoint).trim()) return false;
  if (endpoint.includes("?") || typeof fetchImpl !== "function") return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(`${endpoint.replace(/\/+$/, "")}/health`, {
      signal: controller.signal,
      cache: "no-store"
    });
    if (!response?.ok) return false;
    const data = await response.json();
    if (data?.ok !== true) return null;
    if (
      capability &&
      (data.ffmpeg?.verified !== true ||
        data.ffmpeg?.available !== true ||
        data.ffmpeg?.[capability] !== true)
    )
      return false;
    if (Number(data.dailyBudgetBytes) > 0 && Number(data.remainingBytesToday) <= 0) return false;
    if (transcode) {
      if (data.access === "token") return token.trim() ? true : false;
      if (data.access !== "open") return null; // LAN admission is enforced on the actual request.
    }
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
