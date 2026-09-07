export const MAX_CONCURRENT_DOWNLOADS = 1;

export function orderQueuedBrowserOfflineDownloads(downloads = []) {
  return downloads
    .filter((download) => download?.status === "queued")
    .sort(
      (left, right) =>
        Number(left.queueSequence || Number.MAX_SAFE_INTEGER) -
          Number(right.queueSequence || Number.MAX_SAFE_INTEGER) ||
        Number(left.queuedAt || 0) - Number(right.queuedAt || 0) ||
        String(left.downloadId || "").localeCompare(String(right.downloadId || ""))
    );
}
