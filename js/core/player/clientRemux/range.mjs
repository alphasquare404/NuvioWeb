export const MAX_READ = 8 * 1024 * 1024;
const NETWORK_RETRY_DELAYS_MS = [150, 400];
const headSizes = new WeakMap();
const rangeSources = new WeakMap();
const positiveSize = (value) =>
  value !== null && /^\d+$/.test(value) && Number.isSafeInteger(Number(value)) && Number(value) > 0
    ? Number(value)
    : null;

export function createRangeFetcher(sourceUrl, requestHeaders, fetchImpl = fetch, resolveSource) {
  const sourceOrigin = new URL(sourceUrl).origin;
  const request = (url, options) => {
    const headers = new Headers(
      new URL(url).origin === sourceOrigin ? (requestHeaders ?? undefined) : undefined
    );
    for (const [name, value] of Object.entries(options.headers || {})) headers.set(name, value);
    return fetchImpl(url, { ...options, headers });
  };
  return async (url, options) => {
    try {
      return await request(url, options);
    } catch (error) {
      if (
        error?.name !== "TypeError" ||
        !resolveSource ||
        url !== sourceUrl ||
        !options.headers?.Range ||
        options.signal?.aborted
      )
        throw error;
      const resolved = await resolveSource();
      options.signal?.throwIfAborted();
      if (!resolved || resolved === url) throw error;
      return request(resolved, options);
    }
  };
}

function responseTarget(response, target, requireRedirect = true) {
  if ((requireRedirect && !response.redirected) || !response.url) return target;
  try {
    const url = new URL(response.url);
    const secure = url.protocol === "https:";
    const localHttp = url.protocol === "http:" && new URL(target).protocol === "http:";
    if ((secure || localHttp) && !url.username && !url.password) return url.href;
  } catch {}
  return target;
}

function headSize(url, signal, stats, fetcher) {
  let record = headSizes.get(stats);
  if (
    !record ||
    record.url !== url ||
    record.fetcher !== fetcher ||
    (!record.done && record.signal !== signal)
  ) {
    record = { url, fetcher, signal, done: false };
    record.promise = (async () => {
      const began = performance.now();
      let response;
      stats.lastHeadStatus = 0;
      stats.headRequests = (stats.headRequests || 0) + 1;
      try {
        signal?.throwIfAborted();
        response = await fetcher(url, {
          method: "HEAD",
          signal,
          credentials: "omit",
          cache: "no-store"
        });
        stats.lastHeadStatus = response.status;
        const size = positiveSize(response.headers.get("content-length"));
        const encoding = response.headers.get("content-encoding");
        if (
          response.status !== 200 ||
          (response.url && response.url !== url) ||
          !size ||
          (stats.size != null && stats.size !== size) ||
          (encoding && encoding.toLowerCase() !== "identity")
        )
          throw Error("range-head-invalid");
        record.done = true;
        return size;
      } finally {
        await response?.body?.cancel().catch(() => {});
        stats.lastHeadMs = Math.round(performance.now() - began);
        stats.totalHeadMs = (stats.totalHeadMs || 0) + stats.lastHeadMs;
      }
    })().catch((error) => {
      if (headSizes.get(stats) === record) headSizes.delete(stats);
      throw error;
    });
    headSizes.set(stats, record);
  }
  return record.promise;
}

export async function readRange(url, start, end, signal, stats, fetcher = fetch) {
  for (let attempt = 0; ; attempt++) {
    signal?.throwIfAborted();
    try {
      return await readRangeAttempt(url, start, end, signal, stats, fetcher);
    } catch (error) {
      signal?.throwIfAborted();
      const transient = error?.name === "TypeError" || error?.message === "range-body-truncated";
      if (!transient || attempt >= NETWORK_RETRY_DELAYS_MS.length) throw error;
      stats.rangeNetworkRetries = (stats.rangeNetworkRetries || 0) + 1;
      await new Promise((resolve) => setTimeout(resolve, NETWORK_RETRY_DELAYS_MS[attempt]));
    }
  }
}

async function readRangeAttempt(url, start, end, signal, stats, fetcher) {
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    end <= start ||
    end - start > MAX_READ
  )
    throw Error("range-read-limit");
  const out = new Uint8Array(end - start);
  stats.maxRead = Math.max(stats.maxRead || 0, out.length);
  // The output allocation was already bounded above. Request exactly this
  // range instead of paying a network round trip for every 256 KiB.
  const last = end - 1;
  stats.maxNetworkRangeBytes = Math.max(stats.maxNetworkRangeBytes || 0, out.length);
  const rangeStarted = performance.now();
  stats.rangeAttempts = (stats.rangeAttempts || 0) + 1;
  stats.rangeRequestsInFlight = (stats.rangeRequestsInFlight || 0) + 1;
  stats.currentRangeStartedAt = Date.now();
  let count = 0,
    rangeStatus = 0,
    rangeHeadersMs = null,
    headWaitMs = 0;
  stats.rangeStep = "request";
  stats.rangeRedirected = null;
  stats.rangeContentRangeVisible = null;
  stats.rangeRedirectRetry = false;
  let source = rangeSources.get(stats);
  if (!source || source.original !== url || source.fetcher !== fetcher) {
    source = { original: url, target: url, fetcher };
    rangeSources.set(stats, source);
  }
  const startingTarget = source.target;
  let target = startingTarget;
  let retriedRedirect = false;
  try {
    const requestOptions = {
      headers: { Range: `bytes=${start}-${last}` },
      signal,
      credentials: "omit",
      cache: "no-store"
    };
    let response = await fetcher(target, requestOptions);
    if (target !== url && [401, 403, 410].includes(response.status)) {
      await response.body?.cancel().catch(() => {});
      signal?.throwIfAborted();
      if (source.target === target) source.target = url;
      target = url;
      response = await fetcher(target, requestOptions);
    }
    const finalTarget = responseTarget(response, target);
    if (response.status === 200 && finalTarget !== target) {
      // Cancel the full response before retrying the same bounded read at the CDN.
      stats.rangeRedirected = true;
      retriedRedirect = true;
      stats.rangeRedirectRetry = true;
      await response.body?.cancel().catch(() => {});
      signal?.throwIfAborted();
      target = finalTarget;
      response = await fetcher(target, requestOptions);
    }
    rangeHeadersMs = Math.round(performance.now() - rangeStarted);
    rangeStatus = response.status;
    stats.rangeRedirected = retriedRedirect || response.redirected === true;
    stats.rangeStep = "headers";
    stats.rangeContentRangeVisible = response.headers.has("content-range");
    if (response.status !== 206) {
      stats.invalidRangeContentLength = positiveSize(response.headers.get("content-length"));
      stats.invalidRangeContentType = response.headers
        .get("content-type")
        ?.split(";")[0]
        ?.trim()
        .toLowerCase();
      try {
        stats.invalidRangeHost = new URL(response.url).hostname;
      } catch {
        stats.invalidRangeHost = null;
      }
    }
    try {
      if (response.status !== 206) throw Error("range-response-invalid");
      const contentRange = response.headers.get("content-range");
      stats.rangeContentRangeVisible = contentRange !== null;
      if (contentRange !== null) {
        const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(contentRange);
        if (
          !match ||
          !Number.isSafeInteger(+match[3]) ||
          +match[1] !== start ||
          +match[2] !== last ||
          +match[3] <= last ||
          (stats.size != null && stats.size !== +match[3])
        )
          throw Error("range-response-invalid");
        stats.size = +match[3];
        stats.rangeValidation = "content-range";
      } else {
        stats.headFallbackAttempted = true;
        // Content-Length is CORS-safelisted. Reject an oversized/full body
        // before HEAD or body consumption; never downgrade a visible bad range.
        if (positiveSize(response.headers.get("content-length")) !== out.length)
          throw Error("range-response-invalid");
        const encoding = response.headers.get("content-encoding");
        if (encoding && encoding.toLowerCase() !== "identity")
          throw Error("range-response-invalid");
        const began = performance.now();
        let size;
        try {
          stats.rangeStep = "head-fallback";
          size = await headSize(responseTarget(response, target, false), signal, stats, fetcher);
        } finally {
          headWaitMs = Math.round(performance.now() - began);
        }
        signal?.throwIfAborted();
        if (end > size || (stats.size != null && stats.size !== size))
          throw Error("range-head-invalid");
        stats.size = size;
        stats.headFallbackUsed = true;
        stats.rangeValidation = "head-status-length";
      }
    } catch (error) {
      await response.body?.cancel().catch(() => {});
      throw error;
    }
    stats.requests = (stats.requests || 0) + 1;
    stats.rangeStep = "body";
    const reader = response.body.getReader();
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        if (count + value.length > out.length) throw Error("range-body-too-large");
        stats.maxResponseChunkBytes = Math.max(stats.maxResponseChunkBytes || 0, value.length);
        out.set(value, count);
        count += value.length;
        stats.bytes = (stats.bytes || 0) + value.length;
      }
      if (count !== out.length) throw Error("range-body-truncated");
      const validatedTarget = responseTarget(response, target, false);
      if (source.target === startingTarget || source.target === url)
        source.target = validatedTarget;
      stats.rangeSuccesses = (stats.rangeSuccesses || 0) + 1;
      stats.rangeStep = "complete";
    } finally {
      await reader.cancel().catch(() => {});
    }
  } finally {
    stats.lastRangeMs = Math.round(performance.now() - rangeStarted);
    stats.lastRangeStatus = rangeStatus;
    stats.lastRangeHeadersMs = rangeHeadersMs;
    stats.lastRangeHeadWaitMs = headWaitMs;
    stats.totalRangeMs = (stats.totalRangeMs || 0) + stats.lastRangeMs;
    stats.lastRangeBodyBytes = count;
    stats.rangeRequestsInFlight--;
  }
  return out;
}
