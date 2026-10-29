export const MAX_READ = 8 * 1024 * 1024;
const headSizes = new WeakMap();
const positiveSize = (value) =>
  value !== null && /^\d+$/.test(value) && Number.isSafeInteger(Number(value)) && Number(value) > 0
    ? Number(value)
    : null;

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
      stats.headRequests = (stats.headRequests || 0) + 1;
      try {
        signal?.throwIfAborted();
        response = await fetcher(url, {
          method: "HEAD",
          signal,
          credentials: "omit",
          cache: "no-store"
        });
        const size = positiveSize(response.headers.get("content-length"));
        const encoding = response.headers.get("content-encoding");
        if (
          response.status !== 200 ||
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
  // range once instead of paying a network round trip for every 256 KiB.
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
  try {
    const response = await fetcher(url, {
      headers: { Range: `bytes=${start}-${last}` },
      signal,
      credentials: "omit",
      cache: "no-store"
    });
    rangeHeadersMs = Math.round(performance.now() - rangeStarted);
    rangeStatus = response.status;
    try {
      if (response.status !== 206) throw Error("range-response-invalid");
      const contentRange = response.headers.get("content-range");
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
          size = await headSize(url, signal, stats, fetcher);
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
      stats.rangeSuccesses = (stats.rangeSuccesses || 0) + 1;
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
