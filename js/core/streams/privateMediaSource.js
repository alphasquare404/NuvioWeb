const privateOrigins = new Set();

export function registerPrivateMediaOrigin(value) {
  privateOrigins.add(new URL(value).origin);
}

export function isPrivateMediaUrl(value) {
  try {
    const url = new URL(String(value || ""));
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;
    if (
      privateOrigins.has(url.origin) ||
      (url.searchParams.has("api_key") && /\/Videos\/[^/]+\/stream(?:\.|$)/i.test(url.pathname))
    ) {
      return true;
    }
    const host = url.hostname.toLowerCase().replace(/\.$/, "");
    if (host.startsWith("[")) {
      return /^\[(?:::(?:1?\]|ffff:)|f[cd]|fe[89ab])/.test(host);
    }
    return (
      !host.includes(".") ||
      /(?:^|\.)(?:localhost|local|lan|internal|home\.arpa)$/.test(host) ||
      /^(?:0\.|10\.|127\.|169\.254\.|172\.(?:1[6-9]|2\d|3[01])\.|192\.168\.|100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/.test(
        host
      )
    );
  } catch {
    return false;
  }
}

export function isPrivateMediaKey(value) {
  return /^(?:server:|media:|nuvio-server:\/\/)/.test(String(value || ""));
}
