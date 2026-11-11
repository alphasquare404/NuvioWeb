import { secureMediaUrl } from "../streams/secureMediaUrl.js";
import { inspectProbeHttpFailure } from "./probeDiagnostics.js";

export const PROBE_CHUNK_BYTES = 256 * 1024;
export const PROBE_MAX_CHUNK_BYTES = 1024 * 1024;
export const PROBE_MAX_BYTES = 13 * 1024 * 1024;

// Read response headers before the body. A server ignoring Range must never
// cause a multi-gigabyte video download or memory allocation in the client.
export function createProbeRangeReader(
  url,
  {
    fetchImpl = globalThis.fetch,
    signal,
    maxBytes = PROBE_MAX_BYTES,
    resolveHead,
    urlResolver = clientMediaUrlResolver
  } = {}
) {
  const originalUrl = String(url || "");
  let target = urlResolver.cached(originalUrl)?.url || secureMediaUrl(originalUrl),
    totalSize = null,
    used = 0,
    lastEnd = null,
    lastChunkBytes = PROBE_CHUNK_BYTES;
  let diagnostics =
      target !== originalUrl && originalUrl.startsWith("http:") ? { secureUpgrade: true } : {},
    usedHostResolve = false,
    prepared = false;
  const visibleLength = (value) =>
    value == null
      ? "hidden"
      : /^\d+$/.test(value) && Number.isSafeInteger(Number(value))
        ? Number(value)
        : "invalid";
  const positions = new Set();
  return {
    get size() {
      return totalSize;
    },
    get bytesRead() {
      return used;
    },
    get diagnostics() {
      return { ...diagnostics, ...(usedHostResolve ? { hostResolved: true } : {}) };
    },
    async prepare() {
      if (prepared) return;
      prepared = true;
      const canPreResolve = urlResolver.canPreResolve || urlResolver.canUseHost;
      if (!urlResolver.cached(originalUrl) && canPreResolve?.call(urlResolver, originalUrl)) {
        diagnostics = { request: "host-resolve" };
        const started = Date.now();
        const resolved = await urlResolver.resolve(originalUrl, {
          signal,
          skipDirect: true,
          // Allow the host's 15s timeout response to arrive before this request
          // is aborted. The runner still enforces its total/selection deadline.
          timeoutMs: 16000
        });
        const hostFacts = {
          hostResolveMs: Date.now() - started,
          hostResolveStatus: resolved.ok ? "success" : "failed",
          ...(resolved.failure ? { hostFailure: resolved.failure } : {})
        };
        diagnostics = { request: "range", ...hostFacts };
        if (signal?.aborted) throw new Error("probe-range-aborted");
        if (resolved.ok) {
          target = resolved.url;
          usedHostResolve = true;
        }
        // Host assistance is optional. A source may already redirect straight
        // to a CORS-enabled CDN even when the helper cannot resolve it.
      }
    },
    async read(position = 0) {
      if (!Number.isSafeInteger(position) || position < 0 || signal?.aborted)
        throw new Error("probe-range-aborted");
      const start = Math.floor(position / PROBE_CHUNK_BYTES) * PROBE_CHUNK_BYTES;
      if (positions.has(start)) throw new Error("probe-range-repeated");
      // Keep the initial/random read small. Consecutive reads can amortize
      // network round trips and repeated ffprobe runs, within the same budget.
      const chunkBytes =
        start === lastEnd ? Math.min(lastChunkBytes * 2, PROBE_MAX_CHUNK_BYTES) : PROBE_CHUNK_BYTES;
      const end = Math.min(
        start + Math.min(chunkBytes, maxBytes - used) - 1,
        totalSize == null ? Infinity : totalSize - 1
      );
      if (end < start || used + end - start + 1 > maxBytes) throw new Error("probe-byte-budget");
      diagnostics = { ...diagnostics, request: "range", start, end };
      await this.prepare();
      Object.assign(diagnostics, { start, end });
      const requestOptions = {
        mode: "cors",
        credentials: "omit",
        cache: "no-store",
        signal,
        headers: { Range: "bytes=" + start + "-" + end }
      };
      let response;
      try {
        response = await fetchImpl(target, requestOptions);
      } catch (error) {
        const resolved =
          prepared && diagnostics.hostResolveStatus === "failed"
            ? { ok: false }
            : await urlResolver.resolve(originalUrl, { signal, skipDirect: true });
        if (signal?.aborted) throw error;
        if (resolved.ok && resolved.url !== target) {
          target = resolved.url;
          usedHostResolve = true;
        } else {
          if (error?.name !== "TypeError") throw error;
          await new Promise((resolve) => setTimeout(resolve, 200));
          signal?.throwIfAborted();
          diagnostics.rangeNetworkRetry = true;
        }
        response = await fetchImpl(target, requestOptions);
      }
      // A redirected request can arrive at the CDN as a full GET. Cancel it
      // without reading the body, then ask that CORS-readable final URL for
      // the same range directly. Never accept 200 as file data or loop retries.
      if (
        response.status === 200 &&
        response.redirected === true &&
        response.url &&
        /^https?:/i.test(response.url) &&
        response.url !== target
      ) {
        const finalUrl = response.url;
        diagnostics.redirectRangeRetry = true;
        diagnostics.initialRangeStatus = response.status;
        await response.body?.cancel();
        target = finalUrl;
        response = await fetchImpl(target, requestOptions);
      }
      const rangeHeader = response.headers.get("Content-Range");
      const range = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(rangeHeader || "");
      Object.assign(diagnostics, {
        rangeStatus: response.status,
        rangeType: ["basic", "cors", "default", "error", "opaque", "opaqueredirect"].includes(
          response.type
        )
          ? response.type
          : "unknown",
        redirected: response.redirected === true,
        rangeHeader: rangeHeader == null ? "hidden" : range ? "valid" : "invalid",
        partialLength: visibleLength(response.headers.get("Content-Length"))
      });
      // Some CORS-enabled CDNs expose Content-Length (a safelisted header),
      // but not Content-Range. HEAD gives the full resource size; a 206 with
      // exactly the requested Content-Length still bounds each partial read.
      if (response.status === 206 && rangeHeader == null && totalSize == null) {
        try {
          diagnostics.request = "head";
          const headUrl = response.url || target;
          let head;
          try {
            head = await fetchImpl(headUrl, {
              method: "HEAD",
              mode: "cors",
              credentials: "omit",
              cache: "no-store",
              signal
            });
          } catch (error) {
            if (error?.name !== "TypeError" || !resolveHead || signal?.aborted) throw error;
            const length = await resolveHead(headUrl, {}, signal);
            signal?.throwIfAborted();
            if (!length) throw error;
            head = new Response(null, { status: 200, headers: { "Content-Length": length } });
            diagnostics.headViaHost = true;
          }
          const length = head.headers.get("Content-Length");
          Object.assign(diagnostics, {
            headStatus: head.status,
            headLength: visibleLength(length),
            headSameResource: !head.url || !response.url || head.url === response.url
          });
          const size = /^\d+$/.test(length || "") ? Number(length) : 0;
          if (
            head.status !== 200 ||
            !Number.isSafeInteger(size) ||
            size <= 0 ||
            (head.url && head.url !== headUrl)
          )
            throw new Error("probe-head-size-unavailable");
          totalSize = size;
        } catch (error) {
          await response.body?.cancel();
          throw error;
        }
      }
      const rangeEnd = Math.min(end, (range ? Number(range[3]) : totalSize) - 1);
      if (Number.isFinite(rangeEnd) && rangeEnd >= start)
        diagnostics.expectedLength = rangeEnd - start + 1;
      const hiddenRangeValid =
        rangeHeader == null &&
        totalSize != null &&
        rangeEnd >= start &&
        response.headers.get("Content-Length") === String(rangeEnd - start + 1);
      if (
        response.status !== 206 ||
        (!hiddenRangeValid &&
          (!range ||
            Number(range[1]) !== start ||
            Number(range[2]) !== rangeEnd ||
            !Number.isSafeInteger(Number(range[3])) ||
            Number(range[3]) <= 0 ||
            (totalSize != null && totalSize !== Number(range[3]))))
      ) {
        if (response.status >= 400)
          Object.assign(diagnostics, await inspectProbeHttpFailure(response));
        else await response.body?.cancel();
        throw new Error("probe-range-or-cors-unavailable");
      }
      const reader = response.body?.getReader();
      if (!reader) throw new Error("probe-response-not-streamable");
      const expected = rangeEnd - start + 1;
      const bytes = new Uint8Array(expected);
      let offset = 0;
      try {
        while (true) {
          const part = await reader.read();
          if (part.done) break;
          if (offset + part.value.byteLength > expected) throw new Error("probe-range-overflow");
          bytes.set(part.value, offset);
          offset += part.value.byteLength;
        }
        if (offset !== expected) throw new Error("probe-range-truncated");
      } catch (error) {
        await reader.cancel().catch(() => {});
        throw error;
      }
      if (range) totalSize = Number(range[3]);
      used += offset;
      lastEnd = start + offset;
      lastChunkBytes = chunkBytes;
      positions.add(start);
      // Use the final CORS-readable CDN URL for subsequent ranges, without
      // resolving the addon repeatedly. Never log or persist signed URLs.
      if (response.url && /^https?:/i.test(response.url)) target = response.url;
      urlResolver.remember(originalUrl, target);
      return { start, bytes };
    }
  };
}
import { clientMediaUrlResolver } from "../streams/clientMediaUrlResolver.js";
