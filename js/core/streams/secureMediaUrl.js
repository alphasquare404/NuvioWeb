// Match the secure delivery expected by an HTTPS web app without rewriting LAN
// addresses or changing HTTP deployments. Never downgrade after a TLS failure.
export function secureMediaUrl(value, pageProtocol = globalThis.location?.protocol) {
  const original = String(value || "");
  if (pageProtocol !== "https:") return original;
  try {
    const url = new URL(original);
    const host = url.hostname.toLowerCase();
    if (
      url.protocol !== "http:" ||
      !host.includes(".") ||
      host.endsWith(".local") ||
      /^\d+(\.\d+){3}$/.test(host) ||
      host.includes(":")
    )
      return original;
    url.protocol = "https:";
    return url.href;
  } catch {
    return original;
  }
}
