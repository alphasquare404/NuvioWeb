function fallbackName(baseUrl) {
  try {
    return new URL(String(baseUrl || "")).host || String(baseUrl || "");
  } catch (_) {
    return String(baseUrl || "");
  }
}

export function buildConfiguredAddonEntry({ baseUrl = "", cached = null, failed = false, displayName = "" } = {}) {
  if (cached) {
    return { ...cached, runtimeStatus: "available" };
  }
  const name = fallbackName(baseUrl);
  return {
    id: `configured-${baseUrl}`,
    baseUrl,
    name,
    displayName: displayName || name,
    description: failed
      ? "Unavailable — the manifest will be retried when online."
      : "Loading addon manifest…",
    runtimeStatus: failed ? "unavailable" : "loading",
    configured: true
  };
}
