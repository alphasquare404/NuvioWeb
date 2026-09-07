export const MAX_CONCURRENT_DOWNLOADS = 1;
export const MANAGEABLE_OFFLINE_DOWNLOAD_STATUSES = new Set([
  "downloading",
  "queued",
  "paused",
  "interrupted",
  "failed"
]);

export function listManageableBrowserOfflineDownloads(downloads = []) {
  return downloads.filter((download) =>
    MANAGEABLE_OFFLINE_DOWNLOAD_STATUSES.has(String(download?.status || ""))
  );
}

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

export function reorderQueuedBrowserOfflineDownloads(downloads = [], downloadId, position = "up") {
  const queued = orderQueuedBrowserOfflineDownloads(downloads);
  const currentIndex = queued.findIndex((download) => download?.downloadId === downloadId);
  if (currentIndex < 0) return queued;
  const [job] = queued.splice(currentIndex, 1);
  const targetIndex = {
    top: 0,
    bottom: queued.length,
    up: Math.max(0, currentIndex - 1),
    down: Math.min(queued.length, currentIndex + 1)
  }[position];
  if (!Number.isInteger(targetIndex)) return orderQueuedBrowserOfflineDownloads(downloads);
  queued.splice(targetIndex, 0, job);
  return queued;
}
