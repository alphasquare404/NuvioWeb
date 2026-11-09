import { parseHttpsPlaybackUrl } from "../../../services/debrid-api-bridge/addonPlaybackPolicy.mjs";
import { secureMediaUrl } from "./secureMediaUrl.js";
import {
  resolveTorboxAddonUrl,
  parseTorrentioTorboxUrl
} from "../debrid/torboxAddonUrlResolver.js";

// On-demand URL resolution. Host assistance is a separate explicit opt-in.
// Signed URLs live in a short page-memory cache; never persist/log them.
export function createClientMediaUrlResolver({
  now = Date.now,
  ttlMs = 60000,
  maxEntries = 100,
  allowHostResolve = false,
  hostResolve = resolveTorboxAddonUrl,
  supportsHostUrl = parseTorrentioTorboxUrl
} = {}) {
  const cache = new Map(),
    pending = new Map();
  const hostAllowed = () =>
    typeof allowHostResolve === "function" ? allowHostResolve() : allowHostResolve;
  const http = (value) => {
    try {
      const url = new URL(String(value || ""));
      return ["https:", "http:"].includes(url.protocol) ? url.href : "";
    } catch {
      return "";
    }
  };
  const cached = (url) => {
    const key = http(url),
      entry = cache.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= now()) {
      cache.delete(key);
      return null;
    }
    return { ...entry.result };
  };
  const remember = (original, finalUrl) => {
    const key = http(original),
      url = http(finalUrl);
    if (!key || !url) return null;
    const result = { ok: true, url };
    cache.set(key, { result, expiresAt: now() + ttlMs });
    while (cache.size > maxEntries) cache.delete(cache.keys().next().value);
    return result;
  };
  return {
    cached,
    remember,
    canUseHost(url) {
      return Boolean(hostAllowed() && supportsHostUrl(url));
    },
    canPreResolve(url) {
      return Boolean(hostAllowed() && parseTorrentioTorboxUrl(url));
    },
    invalidate(url) {
      cache.delete(http(url));
    },
    async resolve(
      original,
      { fetchImpl = globalThis.fetch, timeoutMs = 8000, signal, skipDirect = false } = {}
    ) {
      const key = http(original);
      if (!key) return { ok: false, reason: "unsupported-url" };
      if (signal?.aborted) return { ok: false, reason: "aborted" };
      const hit = cached(key);
      if (hit) return hit;
      if (pending.has(key)) return pending.get(key);
      const controller = new AbortController();
      const abort = () => controller.abort();
      signal?.addEventListener("abort", abort, { once: true });
      const timer = setTimeout(abort, Math.max(1, timeoutMs));
      const task = (async () => {
        const fromHost = async () => {
          const allowed = hostAllowed();
          if (controller.signal.aborted) return { ok: false, reason: "aborted" };
          if (!allowed) return { ok: false, reason: "cors-or-network" };
          let failure;
          const result = await hostResolve(key, {
            signal: controller.signal,
            onFailure: (facts) => {
              failure = facts;
            }
          }).catch(() => null);
          return result?.url
            ? remember(key, result.url)
            : { ok: false, reason: "host-resolve-failed", ...(failure ? { failure } : {}) };
        };
        if (skipDirect) return fromHost();
        const options = {
          mode: "cors",
          credentials: "omit",
          cache: "no-store",
          signal: controller.signal
        };
        const requestUrl = secureMediaUrl(key);
        let response;
        try {
          response = await fetchImpl(requestUrl, { ...options, method: "HEAD" });
        } catch {
          /* Some services only allow GET through CORS. */
        }
        if ((!response || [405, 501].includes(response.status)) && !controller.signal.aborted) {
          await response?.body?.cancel().catch(() => {});
          try {
            response = await fetchImpl(requestUrl, { ...options, headers: { Range: "bytes=0-0" } });
          } catch {
            return fromHost();
          }
        }
        if (!response)
          return { ok: false, reason: controller.signal.aborted ? "aborted" : "cors-or-network" };
        // Only response headers are needed, even if Range was ignored.
        await response.body?.cancel().catch(() => {});
        if (controller.signal.aborted) return { ok: false, reason: "aborted" };
        if (![200, 206].includes(response.status))
          return { ok: false, reason: "http-status", status: response.status };
        if (/text\/html/i.test(response.headers.get("Content-Type") || ""))
          return { ok: false, reason: "not-media" };
        return (
          remember(key, response.url || requestUrl) || { ok: false, reason: "unsupported-url" }
        );
      })()
        .catch(() => ({
          ok: false,
          reason: controller.signal.aborted ? "aborted" : "cors-or-network"
        }))
        .finally(() => {
          clearTimeout(timer);
          signal?.removeEventListener("abort", abort);
          pending.delete(key);
        });
      pending.set(key, task);
      return task;
    }
  };
}

async function resolveConfiguredAddonUrl(url, { signal, onFailure }) {
  const response = await fetch("/api/debrid/link/from-addon", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
    signal
  });
  if (!response.ok) {
    onFailure({ status: response.status, stage: "host", reason: "request-failed" });
    return null;
  }
  const target = parseHttpsPlaybackUrl((await response.json()).data);
  return target ? { url: target.href } : null;
}

export const clientMediaUrlResolver = createClientMediaUrlResolver({
  supportsHostUrl: (url) => Boolean(parseHttpsPlaybackUrl(url)),
  hostResolve: (url, options) =>
    parseTorrentioTorboxUrl(url)
      ? resolveTorboxAddonUrl(url, options)
      : parseHttpsPlaybackUrl(url)
        ? resolveConfiguredAddonUrl(url, options)
        : Promise.resolve(null),
  allowHostResolve: () =>
    ["1", "true"].includes(
      String(globalThis.__NUVIO_ENV__?.MEDIA_URL_HOST_RESOLVE_ENABLED || "")
        .trim()
        .toLowerCase()
    )
});
