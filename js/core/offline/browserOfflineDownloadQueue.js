import {
  canQueueBrowserOfflineDownload,
  cancelBrowserOfflineDownload,
  createOfflineDownloadId,
  createQueuedBrowserOfflineDownload,
  deleteBrowserOfflineDownload,
  getOfflineDownload,
  initializeBrowserOfflineDownloads,
  listOfflineDownloads,
  pauseBrowserOfflineDownload,
  startBrowserOfflineDownload,
  subscribeToOfflineDownloads,
  updateBrowserOfflineDownload
} from "./browserOfflineDownloads.js";
import {
  MAX_CONCURRENT_DOWNLOADS,
  orderQueuedBrowserOfflineDownloads
} from "./browserOfflineDownloadQueueState.js";

export { MAX_CONCURRENT_DOWNLOADS, orderQueuedBrowserOfflineDownloads } from "./browserOfflineDownloadQueueState.js";

let initialized = false;
let initializing = null;
let scheduling = null;
let activeDownloadId = null;
let releaseDownloadSubscription = null;
let onlineListenerBound = false;
// Resolved stream URLs may be signed, so they must never enter persistent
// queue metadata. Keep the current-session request only long enough to start
// its queued transfer; restart recovery uses the sanitized queueRequest.
const runtimeQueuedRequests = new Map();

function isOnline() {
  return globalThis.navigator?.onLine !== false;
}

async function nextQueueSequence() {
  const downloads = await listOfflineDownloads();
  return (
    downloads.reduce((highest, download) => Math.max(highest, Number(download.queueSequence || 0) || 0), 0) +
    1
  );
}

async function runActiveDownload(download) {
  try {
    const request = runtimeQueuedRequests.get(download?.downloadId) || download?.queueRequest;
    if (!request?.stream || !canQueueBrowserOfflineDownload(request)) {
      await updateBrowserOfflineDownload(download.downloadId, {
        status: "failed",
        queueSequence: null,
        queuedAt: null,
        completedAt: null,
        error: "Queued source is unavailable"
      });
      return;
    }
    await startBrowserOfflineDownload(request);
  } catch (_) {
    // The transfer persists its failed/interrupted state. Continue the queue.
  } finally {
    runtimeQueuedRequests.delete(download?.downloadId);
    activeDownloadId = null;
    void scheduleBrowserOfflineDownloads();
  }
}

export function getActiveBrowserOfflineDownloadId() {
  return activeDownloadId;
}

export function isBrowserOfflineQueueActive() {
  return Boolean(activeDownloadId);
}

export async function scheduleBrowserOfflineDownloads() {
  if (!initialized || activeDownloadId || !isOnline()) return;
  if (scheduling) return scheduling;
  scheduling = (async () => {
    if (activeDownloadId || !isOnline()) return;
    const [next] = orderQueuedBrowserOfflineDownloads(await listOfflineDownloads());
    if (!next) return;
    activeDownloadId = next.downloadId;
    void runActiveDownload(next);
  })().finally(() => {
    scheduling = null;
  });
  return scheduling;
}

export async function initializeBrowserOfflineDownloadQueue() {
  if (initialized) return { supported: true };
  if (initializing) return initializing;
  initializing = (async () => {
    const capabilities = await initializeBrowserOfflineDownloads();
    if (!capabilities.supported) return capabilities;
    initialized = true;
    releaseDownloadSubscription?.();
    releaseDownloadSubscription = subscribeToOfflineDownloads((download) => {
      if (download?.status !== "downloading") void scheduleBrowserOfflineDownloads();
    });
    if (!onlineListenerBound && globalThis.addEventListener) {
      onlineListenerBound = true;
      globalThis.addEventListener("online", () => void scheduleBrowserOfflineDownloads());
    }
    void scheduleBrowserOfflineDownloads();
    return capabilities;
  })().finally(() => {
    initializing = null;
  });
  return initializing;
}

export async function enqueueBrowserOfflineDownload(input = {}) {
  await initializeBrowserOfflineDownloadQueue();
  const downloadId = createOfflineDownloadId(input);
  if (!downloadId) throw new Error("This media does not have a stable offline download identity.");
  const existing = await getOfflineDownload(downloadId);
  if (["completed", "downloading", "queued"].includes(String(existing?.status || ""))) {
    if (existing?.status === "queued") runtimeQueuedRequests.set(downloadId, input);
    return { status: "existing", download: existing };
  }
  const result = await createQueuedBrowserOfflineDownload(input, await nextQueueSequence());
  runtimeQueuedRequests.set(downloadId, input);
  void scheduleBrowserOfflineDownloads();
  return result;
}

export async function resumeQueuedBrowserOfflineDownload(downloadId, input = null) {
  await initializeBrowserOfflineDownloadQueue();
  const download = await getOfflineDownload(downloadId);
  if (!download || !["paused", "interrupted", "failed"].includes(String(download.status || ""))) return null;
  if (input?.stream) runtimeQueuedRequests.set(downloadId, input);
  const queued = await updateBrowserOfflineDownload(downloadId, {
    status: "queued",
    queueSequence: await nextQueueSequence(),
    queuedAt: Date.now(),
    completedAt: null,
    error: ""
  });
  void scheduleBrowserOfflineDownloads();
  return queued;
}

export async function pauseQueuedBrowserOfflineDownload(downloadId) {
  const download = await getOfflineDownload(downloadId);
  if (!download) return false;
  if (download.status === "queued") {
    await updateBrowserOfflineDownload(downloadId, {
      status: "paused",
      queueSequence: null,
      queuedAt: null,
      completedAt: null
    });
    return true;
  }
  if (downloadId === activeDownloadId || download.status === "downloading") {
    const paused = await pauseBrowserOfflineDownload(downloadId);
    void scheduleBrowserOfflineDownloads();
    return paused;
  }
  return false;
}

export async function cancelQueuedBrowserOfflineDownload(downloadId) {
  const download = await getOfflineDownload(downloadId);
  if (!download) return false;
  if (download.status === "queued") {
    await deleteBrowserOfflineDownload(downloadId);
    runtimeQueuedRequests.delete(downloadId);
    return true;
  }
  if (downloadId === activeDownloadId || download.status === "downloading") {
    await cancelBrowserOfflineDownload(downloadId);
    await deleteBrowserOfflineDownload(downloadId);
    runtimeQueuedRequests.delete(downloadId);
    void scheduleBrowserOfflineDownloads();
    return true;
  }
  await deleteBrowserOfflineDownload(downloadId);
  runtimeQueuedRequests.delete(downloadId);
  return true;
}
