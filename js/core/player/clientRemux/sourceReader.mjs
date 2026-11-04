import { readRange, MAX_READ } from "./range.mjs";

export const METADATA_PAGE_BYTES = 64 * 1024;
export const METADATA_CACHE_BYTES = 2 * METADATA_PAGE_BYTES;
export const LIBRARY_CACHE_BYTES = 2 * 1024 * 1024 - METADATA_CACHE_BYTES;
const SMALL_READ_BYTES = 4096;

// Only small reads acquire bounded adjacent bytes. Large media reads remain exact.
// This cache belongs to one input/session; it is never shared across source URLs.
export function createSourceReader({ url, signal, stats, fetcher = fetch }) {
  const pages = new Map();
  let queue = Promise.resolve();
  const update = () => {
    stats.metadataCacheBytes = Array.from(pages.values()).reduce((n, p) => n + p.length, 0);
    stats.peakMetadataCacheBytes = Math.max(
      stats.peakMetadataCacheBytes || 0,
      stats.metadataCacheBytes
    );
  };
  async function smallRead(start, end) {
    signal?.throwIfAborted();
    const out = new Uint8Array(end - start);
    for (let at = start; at < end;) {
      const pageStart = Math.floor(at / METADATA_PAGE_BYTES) * METADATA_PAGE_BYTES;
      const pageEnd = Math.min(pageStart + METADATA_PAGE_BYTES, stats.size);
      let page = pages.get(pageStart);
      if (page) {
        pages.delete(pageStart);
        pages.set(pageStart, page);
        stats.metadataCacheHits = (stats.metadataCacheHits || 0) + 1;
      } else {
        // Evict before fetching so the incoming page fits the same cache budget.
        if (pages.size === 2) {
          pages.delete(pages.keys().next().value);
          update();
        }
        page = await readRange(url, pageStart, pageEnd, signal, stats, fetcher);
        pages.set(pageStart, page);
        update();
      }
      const last = Math.min(end, pageEnd);
      out.set(page.subarray(at - pageStart, last - pageStart), at - start);
      at = last;
    }
    return out;
  }
  return (start, end) => {
    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      start < 0 ||
      end <= start ||
      end - start > MAX_READ
    )
      return Promise.reject(Error("range-read-limit"));
    if (!Number.isSafeInteger(stats.size) || end > stats.size)
      return Promise.reject(Error("range-read-limit"));
    stats.sourceReadStrategy = "bounded-64k-metadata-pages";
    if (end - start > SMALL_READ_BYTES) return readRange(url, start, end, signal, stats, fetcher);
    const pending = queue.then(() => smallRead(start, end));
    queue = pending.catch(() => {});
    return pending;
  };
}
