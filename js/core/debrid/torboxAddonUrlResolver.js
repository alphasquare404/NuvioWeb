import { DebridApi } from "../../data/remote/api/debridApi.js";

// Only this known provider URL shape may use the credential bridge. Do not send
// an arbitrary source URL to the host, and never persist/log the parsed token.
export function parseTorrentioTorboxUrl(value) {
  try {
    const url = new URL(String(value || ""));
    if (
      url.protocol !== "https:" ||
      url.host !== "torrentio.strem.fun" ||
      url.username ||
      url.password
    )
      return null;
    const parts = url.pathname.split("/").slice(1).map(decodeURIComponent);
    if (![6, 7].includes(parts.length) || parts[0] !== "resolve" || parts[1] !== "torbox")
      return null;
    const [, , apiKey, infoHash, entry, index, filename] = parts;
    if (
      !apiKey ||
      apiKey.length > 2048 ||
      /\s/.test(apiKey) ||
      [...apiKey].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) ||
      !/^[a-f0-9]{40}$/i.test(infoHash) ||
      !/^\d+$/.test(index)
    )
      return null;
    const fileIdx = Number(index);
    if (!Number.isSafeInteger(fileIdx)) return null;
    return {
      apiKey,
      infoHash: infoHash.toLowerCase(),
      fileIdx,
      entry,
      filename: filename || entry
    };
  } catch {
    return null;
  }
}

export async function resolveTorboxAddonUrl(value, { signal, onFailure = () => {} } = {}) {
  const source = parseTorrentioTorboxUrl(value);
  if (!source || signal?.aborted) return null;
  const { apiKey, infoHash, fileIdx, entry, filename } = source;
  // Existing fixed same-origin routes use Authorization + POST bodies. The host
  // reads addon redirect headers and TorBox JSON, never the media CDN.
  const linked = await DebridApi.torboxResolveAddonLink(
    apiKey,
    { infoHash, fileIdx, entry, filename },
    { signal }
  );
  if (!linked.ok || typeof linked.data?.data !== "string" || signal?.aborted) {
    const data = linked.data || {};
    onFailure({
      status: Number.isInteger(linked.status) ? linked.status : 0,
      stage: ["addon", "provider"].includes(data.resolveStage) ? data.resolveStage : "host",
      upstreamStatus: Number.isInteger(data.upstreamStatus) ? data.upstreamStatus : 0,
      reason: [
        "timeout",
        "missing-redirect",
        "untrusted-redirect",
        "invalid-file-id",
        "invalid-descriptor",
        "network-or-invalid-redirect"
      ].includes(data.resolveReason)
        ? data.resolveReason
        : "request-failed"
    });
    return null;
  }
  try {
    const url = new URL(linked.data.data);
    return url.protocol === "https:" && !url.username && !url.password ? { url: url.href } : null;
  } catch {
    return null;
  }
}
