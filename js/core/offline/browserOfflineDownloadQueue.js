import {
  canQueueBrowserOfflineDownload,
  cancelBrowserOfflineDownload,
  createOfflineDownloadId,
  createQueuedBrowserOfflineDownload,
  createOfflineSubtitleFingerprint,
  downloadBrowserOfflineSubtitle,
  deleteBrowserOfflineDownload,
  getOfflineDownload,
  initializeBrowserOfflineDownloads,
  listOfflineDownloads,
  pauseBrowserOfflineDownload,
  startBrowserOfflineDownload,
  subscribeToOfflineDownloads,
  updateBrowserOfflineDownload
} from "./browserOfflineDownloads.js";
import { subtitleRepository } from "../../data/repository/subtitleRepository.js";
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

async function downloadSelectedSubtitleAfterVideo(download) {
  const descriptor = download?.offlineSubtitle || download?.queueRequest?.offlineSubtitle;
  if (!descriptor || download?.status !== "completed") return;
  try {
    await updateBrowserOfflineDownload(download.downloadId, { offlineSubtitleStatus: "downloading" });
    const request = download.queueRequest || {};
    const type = String(request.itemType || request.contentType || "movie").toLowerCase() === "tv" ? "series" : String(request.itemType || request.contentType || "movie").toLowerCase();
    const subtitles = await subtitleRepository.getSubtitles(type, request.imdbId || request.itemId || request.mediaId, request.videoId || null, {
      season: request.season,
      episode: request.episode,
      title: request.title,
      year: request.year
    });
    const subtitle = subtitles.find((candidate) =>
      createOfflineSubtitleFingerprint(candidate) === descriptor.fingerprint &&
      (!descriptor.addonId || String(candidate.addonId || "") === descriptor.addonId)
    );
    if (!subtitle) throw new Error("Selected subtitle is no longer available");
    await downloadBrowserOfflineSubtitle({
      mediaIdentity: download.mediaIdentity,
      offlineCopyId: download.downloadId,
      sourceFingerprint: download.sourceFingerprint,
      track: subtitle
    });
    await updateBrowserOfflineDownload(download.downloadId, { offlineSubtitleStatus: "completed", offlineSubtitleError: "" });
  } catch (error) {
    // A subtitle failure must never downgrade an otherwise usable video copy.
    await updateBrowserOfflineDownload(download.downloadId, {
      offlineSubtitleStatus: "failed",
      offlineSubtitleError: String(error?.message || "Subtitle download failed")
    }).catch(() => {});
  }
}

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
    const result = await startBrowserOfflineDownload(request);
    if (result?.status === "completed") {
      await downloadSelectedSubtitleAfterVideo(result.download);
    }
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
    // Recover the small post-video subtitle step after an app/browser restart.
    // Completed video copies remain playable even if this recovery fails.
    const pendingSubtitleDownloads = (await listOfflineDownloads()).filter(
      (download) =>
        download?.status === "completed" &&
        download?.offlineSubtitle &&
        ["pending", "downloading"].includes(String(download?.offlineSubtitleStatus || "pending"))
    );
    void Promise.all(pendingSubtitleDownloads.map((download) => downloadSelectedSubtitleAfterVideo(download)));
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
