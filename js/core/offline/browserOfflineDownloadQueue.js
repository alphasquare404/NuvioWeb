import {
  canQueueBrowserOfflineDownload,
  cancelBrowserOfflineDownload,
  createOfflineDownloadId,
  createOfflineSubtitleId,
  createQueuedBrowserOfflineDownload,
  createOfflineSubtitleFingerprint,
  getOfflineSubtitleIdentityParts,
  downloadBrowserOfflineSubtitle,
  isOfflineSubtitleStepUnfinished,
  deleteBrowserOfflineDownload,
  getOfflineDownload,
  getOfflineSubtitle,
  getOfflineSubtitleSelection,
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
  orderQueuedBrowserOfflineDownloads,
  reorderQueuedBrowserOfflineDownloads
} from "./browserOfflineDownloadQueueState.js";

export {
  MAX_CONCURRENT_DOWNLOADS,
  orderQueuedBrowserOfflineDownloads,
  reorderQueuedBrowserOfflineDownloads
} from "./browserOfflineDownloadQueueState.js";

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
const MAX_CONCURRENT_OFFLINE_SUBTITLE_DOWNLOADS = 3;

async function allSettledInBatches(items, limit, worker) {
  const results = [];
  for (let start = 0; start < items.length; start += limit) {
    const batch = items.slice(start, start + limit);
    results.push(...(await Promise.allSettled(batch.map(worker))));
  }
  return results;
}

function descriptorMatchesResolvedSubtitle(descriptor = {}, subtitle = {}) {
  if (createOfflineSubtitleFingerprint(subtitle) === descriptor.fingerprint) return true;
  if (descriptor.addonId && String(subtitle.addonId || "") !== descriptor.addonId) return false;
  const candidate = getOfflineSubtitleIdentityParts(subtitle);
  if (descriptor.providerSubtitleId && candidate.providerSubtitleId) {
    return descriptor.providerSubtitleId === candidate.providerSubtitleId;
  }
  if (descriptor.urlIdentity && candidate.urlIdentity) {
    return descriptor.urlIdentity === candidate.urlIdentity;
  }
  return (
    Boolean(descriptor.lang && descriptor.fileName) &&
    descriptor.lang.toLowerCase() === candidate.language &&
    descriptor.fileName.toLowerCase().replace(/\s+/g, " ") === candidate.fileName &&
    Boolean(descriptor.forced) === candidate.forced &&
    Boolean(descriptor.sdh) === candidate.sdh
  );
}

async function downloadSelectedSubtitleAfterVideo(download) {
  const subtitleSelection = getOfflineSubtitleSelection({
    offlineSubtitleMode: download?.offlineSubtitleMode || download?.queueRequest?.offlineSubtitleMode,
    offlineSubtitleLanguage: download?.offlineSubtitleLanguage || download?.queueRequest?.offlineSubtitleLanguage,
    offlineSubtitleDescriptors:
      download?.offlineSubtitleDescriptors || download?.queueRequest?.offlineSubtitleDescriptors,
    offlineSubtitle: download?.offlineSubtitle || download?.queueRequest?.offlineSubtitle
  });
  const descriptors = subtitleSelection.descriptors;
  if (!descriptors.length || download?.status !== "completed") return;
  try {
    const pendingDescriptors = (
      await Promise.all(
        descriptors.map(async (descriptor) => ({
          descriptor,
          existing: await getOfflineSubtitle(
            createOfflineSubtitleId({ mediaIdentity: download.mediaIdentity, fingerprint: descriptor.fingerprint })
          )
        }))
      )
    )
      .filter(({ existing }) => existing?.status !== "completed")
      .map(({ descriptor }) => descriptor);
    if (!pendingDescriptors.length) {
      await updateBrowserOfflineDownload(download.downloadId, {
        offlineSubtitleStatus: "completed",
        offlineSubtitleError: "",
        offlineSubtitleCompletedCount: descriptors.length
      });
      return;
    }
    await updateBrowserOfflineDownload(download.downloadId, { offlineSubtitleStatus: "processing" });
    const request = download.queueRequest || {};
    const type = String(request.itemType || request.contentType || "movie").toLowerCase() === "tv" ? "series" : String(request.itemType || request.contentType || "movie").toLowerCase();
    const subtitles = await subtitleRepository.getSubtitles(type, request.imdbId || request.itemId || request.mediaId, request.videoId || null, {
      season: request.season,
      episode: request.episode,
      title: request.title,
      year: request.year
    });
    const outcomes = await allSettledInBatches(
      pendingDescriptors,
      MAX_CONCURRENT_OFFLINE_SUBTITLE_DOWNLOADS,
      async (descriptor) => {
        const subtitle = subtitles.find((candidate) => descriptorMatchesResolvedSubtitle(descriptor, candidate));
        if (!subtitle) throw new Error("Selected subtitle is no longer available");
        return downloadBrowserOfflineSubtitle({
          mediaIdentity: download.mediaIdentity,
          offlineCopyId: download.downloadId,
          sourceFingerprint: download.sourceFingerprint,
          track: subtitle
        });
      }
    );
    const completed = outcomes.filter((outcome) => outcome.status === "fulfilled").length;
    const rejected = outcomes.filter((outcome) => outcome.status === "rejected");
    await updateBrowserOfflineDownload(download.downloadId, {
      offlineSubtitleStatus: rejected.length ? "partial" : "completed",
      offlineSubtitleError: rejected.length ? String(rejected[0]?.reason?.message || "Some subtitles failed") : "",
      offlineSubtitleAttemptedCount: pendingDescriptors.length,
      offlineSubtitleCompletedCount: descriptors.length - pendingDescriptors.length + completed,
      offlineSubtitleFailedCount: rejected.length
    });
  } catch (error) {
    // A subtitle failure must never downgrade an otherwise usable video copy.
    await updateBrowserOfflineDownload(download.downloadId, {
      offlineSubtitleStatus: "partial",
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
        getOfflineSubtitleSelection(download).descriptors.length &&
        isOfflineSubtitleStepUnfinished(download?.offlineSubtitleStatus)
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

async function reorderQueuedBrowserOfflineDownload(downloadId, position) {
  await initializeBrowserOfflineDownloadQueue();
  const downloads = await listOfflineDownloads();
  const ordered = reorderQueuedBrowserOfflineDownloads(downloads, downloadId, position);
  if (!ordered.some((download) => download.downloadId === downloadId)) return null;
  await Promise.all(
    ordered.map((download, index) =>
      updateBrowserOfflineDownload(download.downloadId, { queueSequence: index + 1 })
    )
  );
  return ordered;
}

export function moveBrowserOfflineDownloadUp(downloadId) {
  return reorderQueuedBrowserOfflineDownload(downloadId, "up");
}

export function moveBrowserOfflineDownloadDown(downloadId) {
  return reorderQueuedBrowserOfflineDownload(downloadId, "down");
}

export function moveBrowserOfflineDownloadToTop(downloadId) {
  return reorderQueuedBrowserOfflineDownload(downloadId, "top");
}

export function moveBrowserOfflineDownloadToBottom(downloadId) {
  return reorderQueuedBrowserOfflineDownload(downloadId, "bottom");
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
