// Deployment policy only. No media requests, codec guesses or player side effects.
export function normalizeRemuxPolicy({ mode = "", endpoint = "" } = {}) {
  const token = String(mode ?? "")
    .trim()
    .toLowerCase();
  if (token)
    return {
      mode: ["off", "client", "server"].includes(token) ? token : "off",
      explicit: true,
      reason: ["off", "client", "server"].includes(token) ? null : "invalid-remux-mode"
    };
  return { mode: String(endpoint || "").trim() ? "server" : "off", explicit: false, reason: null };
}

export function normalizeRemuxCacheMiB(value) {
  const token = String(value ?? "").trim();
  if (!token) return 512;
  if (!/^\d+$/.test(token)) return 0;
  const amount = Number(token);
  if (!Number.isSafeInteger(amount) || amount < 128) return 0;
  return Math.min(512, amount);
}

export function resolveRemuxRoute({
  policy = normalizeRemuxPolicy(),
  method = "unknown",
  audioIndex = 0,
  clientAvailable = false,
  serverAvailable = false
} = {}) {
  const plan = { method, audioIndex, route: "unknown", state: "needs-preflight", reason: null };
  if (method === "direct") return { ...plan, route: "direct", state: "ready" };
  if (method === "audio-transcode") return { ...plan, reason: "audio-transcode-policy-separate" };
  if (method === "transcode")
    return {
      ...plan,
      route: "unavailable",
      state: "unavailable",
      reason: "full-transcode-not-offered"
    };
  if (method !== "remux") return plan;
  const unavailable = (reason) => ({ ...plan, route: "unavailable", state: "unavailable", reason });
  if (!Number.isInteger(audioIndex) || audioIndex < 0) return unavailable("invalid-audio-index");
  if (policy.mode === "off") return unavailable(policy.reason || "remux-disabled");
  if (policy.mode === "client")
    return clientAvailable
      ? { ...plan, route: "client", state: "ready" }
      : unavailable("client-remux-not-installed");
  // Explicit and legacy server modes share the existing copy/HLS relay.
  if (policy.mode === "server" && !policy.explicit) return { ...plan, route: "server" };
  if (policy.mode === "server")
    return serverAvailable
      ? { ...plan, route: "server", state: "ready" }
      : unavailable("server-remux-not-installed");
  return unavailable("invalid-remux-mode");
}

export function assertConfiguredRemuxRoute(
  policy,
  audioIndex = 0,
  { serverAvailable = false } = {}
) {
  // Unset mode preserves legacy playback, including saved explicit relay URLs.
  if (!policy.explicit) return;
  const plan = resolveRemuxRoute({ policy, method: "remux", audioIndex, serverAvailable });
  if (plan.state !== "unavailable") return;
  const messages = {
    "client-remux-not-installed": "Client remux is not installed yet on this deployment.",
    "server-remux-not-installed": "Server remux is unavailable on this deployment.",
    "remux-disabled": "Remux is disabled by this host.",
    "invalid-remux-mode": "The host remux configuration is invalid."
  };
  const error = new Error(messages[plan.reason] || "This remux route is unavailable.");
  error.code = "REMUX_ROUTE_UNAVAILABLE";
  error.reason = plan.reason;
  throw error;
}

// Only recognize this deployment's existing copy relay. An arbitrary HLS source
// or a separately authorized audio conversion is not a remux fallback.
export function isConfiguredCopyRelayUrl(
  source,
  { endpoint = "", baseUrl = "http://localhost/" } = {}
) {
  if (!endpoint) return false;
  try {
    const url = new URL(source, baseUrl),
      relay = new URL(endpoint, baseUrl);
    const basePath = relay.pathname.replace(/\/+$/, "");
    return (
      url.origin === relay.origin &&
      [basePath, basePath + "/hls/index.m3u8"].includes(url.pathname) &&
      url.searchParams.has("u") &&
      url.searchParams.get("v") === "copy" &&
      url.searchParams.get("a") === "copy"
    );
  } catch {
    return false;
  }
}
