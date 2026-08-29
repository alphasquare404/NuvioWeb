import { DirectDebridResolver } from "../debrid/directDebridResolver.js";
import {
  createOfflineMediaId,
  createOfflineDownloadId,
  createOfflineSourceFingerprint,
  groupDownloadedMovies,
  groupDownloadedSeries
} from "./offlineDownloadIdentity.js";

export {
  createOfflineMediaId,
  createOfflineDownloadId,
  createOfflineSourceFingerprint,
  groupDownloadedMovies,
  groupDownloadedSeries
} from "./offlineDownloadIdentity.js";

const DATABASE_NAME = "nuvio-offline-downloads";
const DATABASE_VERSION = 1;
const DOWNLOAD_STORE = "downloads";
const OPFS_DIRECTORY_NAME = "nuvio-downloads";
const PROGRESS_PERSIST_INTERVAL_MS = 750;

const listeners = new Set();
const activeDownloads = new Map();
let databasePromise = null;
let initializationPromise = null;

function now() {
  return Date.now();
}

function text(value) {
  return String(value || "").trim();
}

function safeIdentityPart(value) {
  return text(value).replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
}

function isHttpUrl(value) {
  try {
    const url = new URL(text(value));
    return url.protocol === "https:" || url.protocol === "http:";
  } catch (_) {
    return false;
  }
}

function isMagnetUrl(value) {
  return text(value).toLowerCase().startsWith("magnet:");
}

function isSegmentedPlayback(stream = {}, url = "") {
  const descriptor = [
    url,
    stream.mimeType,
    stream.sourceType,
    stream.raw?.mimeType,
    stream.raw?.sourceType
  ]
    .map((value) => text(value).toLowerCase())
    .join(" ");
  return /\.m3u8(?:$|[?#])|\.mpd(?:$|[?#])|mpegurl|dash\+xml/.test(descriptor);
}

function normalizeContentType(value) {
  const type = text(value).toLowerCase();
  return type === "series" || type === "tv" || type === "episode" ? "episode" : "movie";
}

function fileNameForDownload(downloadId) {
  return `${safeIdentityPart(downloadId) || "download"}.media`;
}

function notify(download) {
  const snapshot = download ? { ...download } : null;
  listeners.forEach((listener) => {
    try {
      listener(snapshot);
    } catch (_) {
      // An observer must never interrupt an active media transfer.
    }
  });
}

function openDatabase() {
  if (!globalThis.indexedDB) {
    return Promise.reject(new Error("IndexedDB is unavailable."));
  }
  if (!databasePromise) {
    databasePromise = new Promise((resolve, reject) => {
      const request = globalThis.indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(DOWNLOAD_STORE)) {
          database.createObjectStore(DOWNLOAD_STORE, { keyPath: "downloadId" });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("Could not open offline storage."));
    });
  }
  return databasePromise;
}

async function withStore(mode, callback) {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(DOWNLOAD_STORE, mode);
    const store = transaction.objectStore(DOWNLOAD_STORE);
    let result;
    try {
      result = callback(store);
    } catch (error) {
      reject(error);
      return;
    }
    transaction.oncomplete = () => resolve(result?.result ?? result);
    transaction.onerror = () => reject(transaction.error || result?.error || new Error("Offline storage failed."));
    transaction.onabort = () => reject(transaction.error || new Error("Offline storage aborted."));
  });
}

async function readDownload(downloadId) {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = database.transaction(DOWNLOAD_STORE, "readonly").objectStore(DOWNLOAD_STORE).get(downloadId);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error || new Error("Could not read offline download."));
  });
}

async function listAllDownloads() {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const request = database.transaction(DOWNLOAD_STORE, "readonly").objectStore(DOWNLOAD_STORE).getAll();
    request.onsuccess = () => resolve(Array.isArray(request.result) ? request.result : []);
    request.onerror = () => reject(request.error || new Error("Could not list offline downloads."));
  });
}

async function writeDownload(download) {
  await withStore("readwrite", (store) => store.put(download));
  notify(download);
  return download;
}

async function removeMetadata(downloadId) {
  await withStore("readwrite", (store) => store.delete(downloadId));
  notify({ downloadId, status: "idle" });
}

async function getDownloadsDirectory(create = true) {
  const root = await globalThis.navigator.storage.getDirectory();
  return root.getDirectoryHandle(OPFS_DIRECTORY_NAME, { create });
}

async function removeOpfsFile(fileName) {
  if (!fileName) return;
  try {
    const directory = await getDownloadsDirectory(false);
    await directory.removeEntry(fileName);
  } catch (error) {
    if (error?.name !== "NotFoundError") throw error;
  }
}

function buildMetadata(input, downloadId, fileName) {
  const contentType = normalizeContentType(input.contentType || input.itemType);
  const seriesId = text(input.seriesId || input.itemId || input.mediaId);
  const seasonNumber = Number(input.seasonNumber ?? input.season);
  const episodeNumber = Number(input.episodeNumber ?? input.episode);
  return {
    downloadId,
    mediaIdentity: createOfflineMediaId(input),
    sourceFingerprint: text(input.sourceFingerprint || createOfflineSourceFingerprint(input)),
    status: "downloading",
    createdAt: now(),
    completedAt: null,
    title: text(input.title || input.playerTitle || input.itemTitle),
    poster: text(input.poster || input.posterUrl),
    backdrop: text(input.backdrop || input.backdropUrl),
    year: text(input.year || input.releaseYear || input.releaseInfo).match(/\b(19|20)\d{2}\b/)?.[0] || "",
    contentType,
    mediaId: text(input.mediaId || input.itemId || input.tmdbId || input.imdbId),
    mediaIdType: text(input.mediaIdType || (input.tmdbId ? "tmdb" : input.imdbId ? "imdb" : "item")),
    movieId: contentType === "movie" ? text(input.movieId || input.mediaId || input.itemId) : "",
    seriesId: contentType === "episode" ? seriesId : "",
    seriesTitle: contentType === "episode" ? text(input.seriesTitle || input.itemTitle || input.title) : "",
    seasonNumber: contentType === "episode" && Number.isFinite(seasonNumber) ? seasonNumber : null,
    episodeNumber: contentType === "episode" && Number.isFinite(episodeNumber) ? episodeNumber : null,
    episodeId: contentType === "episode" ? text(input.episodeId || input.videoId) : "",
    sourceName: text(input.sourceName || input.addonName),
    sourceAddonId: text(input.stream?.addonId || input.stream?.streamOrigin?.addonId),
    quality: text(input.stream?.quality || input.stream?.qualityValue),
    videoSize: Number(input.stream?.behaviorHints?.videoSize || input.stream?.videoSize || 0) || null,
    filename: text(input.filename),
    mimeType: text(input.mimeType) || "video/mp4",
    downloadedBytes: 0,
    totalBytes: null,
    opfsPath: `${OPFS_DIRECTORY_NAME}/${fileName}`,
    fileName
  };
}

function directUrlForStream(stream = {}) {
  const candidates = [stream.url, stream.externalUrl, stream.raw?.url, stream.raw?.externalUrl];
  return candidates.find(
    (candidate) =>
      isHttpUrl(candidate) && !isMagnetUrl(candidate) && !isSegmentedPlayback(stream, candidate)
  ) || "";
}

function resolvedStreamMetadata(stream = {}, result = {}) {
  return {
    ...stream,
    url: result.stream?.url || stream.url || "",
    mimeType: result.stream?.mimeType || stream.mimeType || stream.raw?.mimeType || "",
    behaviorHints: result.stream?.behaviorHints || stream.behaviorHints || stream.raw?.behaviorHints || {}
  };
}

export function isBrowserOfflineDownloadSupported() {
  const storage = globalThis.navigator?.storage;
  return Boolean(
    storage &&
      typeof storage.getDirectory === "function" &&
      globalThis.indexedDB &&
      typeof globalThis.fetch === "function"
  );
}

export function canResolveBrowserOfflineDownload(stream = {}, context = {}) {
  if (!isBrowserOfflineDownloadSupported()) return false;
  if (directUrlForStream(stream)) return true;
  return DirectDebridResolver.canResolveStream(stream, {
    season: context.season ?? null,
    episode: context.episode ?? null
  });
}

export async function initializeBrowserOfflineDownloads() {
  if (!isBrowserOfflineDownloadSupported()) {
    return { supported: false, persistent: false, usage: null, quota: null };
  }
  if (!initializationPromise) {
    initializationPromise = (async () => {
      const storage = globalThis.navigator.storage;
      let persistent = false;
      try {
        persistent = (await storage.persisted?.()) === true;
        if (!persistent && typeof storage.persist === "function") {
          persistent = (await storage.persist()) === true;
        }
      } catch (_) {
        // Persistence is best effort; OPFS remains usable when the browser declines.
      }
      let estimate = {};
      try {
        estimate = (await storage.estimate?.()) || {};
      } catch (_) {}
      await openDatabase();
      await getDownloadsDirectory(true);
      const legacyDownloads = (await listAllDownloads()).filter(
        (download) => download && !download.mediaIdentity
      );
      await Promise.all(
        legacyDownloads.map((download) =>
          writeDownload({
            ...download,
            mediaIdentity: createOfflineMediaId(download),
            // Existing media-only records remain playable, but never falsely match a live row.
            sourceFingerprint: text(download.sourceFingerprint)
          })
        )
      );
      const interrupted = (await listAllDownloads()).filter(
        (download) => download?.status === "downloading"
      );
      await Promise.all(
        interrupted.map(async (download) => {
          await removeOpfsFile(download.fileName).catch(() => {});
          await writeDownload({
            ...download,
            status: "failed",
            completedAt: null,
            error: "Download interrupted"
          });
        })
      );
      return {
        supported: true,
        persistent,
        usage: Number.isFinite(Number(estimate.usage)) ? Number(estimate.usage) : null,
        quota: Number.isFinite(Number(estimate.quota)) ? Number(estimate.quota) : null
      };
    })();
  }
  return initializationPromise;
}

export async function resolveBrowserOfflineDownloadSource(stream = {}, context = {}) {
  const directUrl = directUrlForStream(stream);
  if (directUrl) return resolvedStreamMetadata(stream, { stream: { url: directUrl } });
  const resolverContext = { season: context.season ?? null, episode: context.episode ?? null };
  if (!DirectDebridResolver.canResolveStream(stream, resolverContext)) {
    throw new Error("This source cannot be downloaded in the browser.");
  }
  const result = await DirectDebridResolver.resolve(stream, resolverContext);
  if (
    result?.status !== "success" ||
    !isHttpUrl(result.stream?.url) ||
    isSegmentedPlayback(result.stream, result.stream?.url)
  ) {
    throw new Error("Could not resolve a downloadable media source.");
  }
  return resolvedStreamMetadata(stream, result);
}

export async function getOfflineDownload(downloadId) {
  if (!downloadId || !isBrowserOfflineDownloadSupported()) return null;
  return readDownload(downloadId);
}

export async function listOfflineDownloads() {
  if (!isBrowserOfflineDownloadSupported()) return [];
  return listAllDownloads();
}

export async function isMovieDownloaded(mediaId) {
  return (await listOfflineDownloads()).some(
    (download) => download.status === "completed" && download.mediaIdentity === createOfflineMediaId({ contentType: "movie", mediaId })
  );
}

export async function isEpisodeDownloaded(seriesId, seasonNumber, episodeNumber) {
  const mediaIdentity = createOfflineMediaId({ contentType: "episode", seriesId, seasonNumber, episodeNumber });
  return (await listOfflineDownloads()).some(
    (download) => download.status === "completed" && download.mediaIdentity === mediaIdentity
  );
}

export async function listOfflineDownloadsForMedia(input = {}) {
  const mediaIdentity = createOfflineMediaId(input);
  return (await listOfflineDownloads()).filter(
    (download) => download.status === "completed" && (download.mediaIdentity || createOfflineMediaId(download)) === mediaIdentity
  );
}

export async function listDownloadedMovies() {
  return groupDownloadedMovies(await listOfflineDownloads());
}

export async function listDownloadedSeries() {
  return groupDownloadedSeries(await listOfflineDownloads());
}

export function subscribeToOfflineDownloads(listener) {
  if (typeof listener !== "function") return () => {};
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export async function startBrowserOfflineDownload(input = {}) {
  const capabilities = await initializeBrowserOfflineDownloads();
  if (!capabilities.supported) throw new Error("Offline downloads are unavailable in this browser.");
  const downloadId = createOfflineDownloadId(input);
  if (!downloadId) throw new Error("This media does not have a stable offline download identity.");
  const existing = await readDownload(downloadId);
  if (existing?.status === "completed") return { status: "already-completed", download: existing };
  if (activeDownloads.has(downloadId)) return activeDownloads.get(downloadId).promise;

  const fileName = fileNameForDownload(downloadId);
  const controller = new AbortController();
  const task = { controller, promise: null };
  task.promise = (async () => {
    let writable = null;
    let metadata = buildMetadata(input, downloadId, fileName);
    let completed = false;
    let lastPersistAt = 0;
    try {
      const resolved = await resolveBrowserOfflineDownloadSource(input.stream, input);
      metadata = {
        ...metadata,
        filename: text(
          input.filename || resolved.behaviorHints?.filename || resolved.raw?.behaviorHints?.filename
        ),
        mimeType: text(resolved.mimeType) || metadata.mimeType
      };
      await writeDownload(metadata);
      const response = await globalThis.fetch(resolved.url, { signal: controller.signal });
      if (!response.ok || !response.body) {
        throw new Error(`Download request failed (${response.status || "unavailable"}).`);
      }
      const total = Number(response.headers.get("content-length"));
      metadata.totalBytes = Number.isFinite(total) && total > 0 ? total : null;
      const directory = await getDownloadsDirectory(true);
      const fileHandle = await directory.getFileHandle(fileName, { create: true });
      writable = await fileHandle.createWritable();
      const reader = response.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          await writable.write(value);
          metadata.downloadedBytes += value.byteLength;
          if (now() - lastPersistAt >= PROGRESS_PERSIST_INTERVAL_MS) {
            lastPersistAt = now();
            await writeDownload({ ...metadata });
          }
        }
      }
      await writable.close();
      writable = null;
      completed = true;
      metadata = { ...metadata, status: "completed", completedAt: now() };
      await writeDownload(metadata);
      return { status: "completed", download: metadata };
    } catch (error) {
      try {
        if (writable) await writable.abort();
      } catch (_) {}
      await removeOpfsFile(fileName).catch(() => {});
      if (error?.name === "AbortError") {
        await removeMetadata(downloadId).catch(() => {});
        return { status: "cancelled", downloadId };
      }
      const failed = { ...metadata, status: "failed", completedAt: null, error: "Download failed" };
      await writeDownload(failed).catch(() => {});
      throw error;
    } finally {
      if (!completed && writable) {
        try {
          await writable.abort();
        } catch (_) {}
      }
      activeDownloads.delete(downloadId);
    }
  })();
  activeDownloads.set(downloadId, task);
  return task.promise;
}

export async function cancelBrowserOfflineDownload(downloadId) {
  const active = activeDownloads.get(downloadId);
  if (!active) return false;
  active.controller.abort();
  try {
    await active.promise;
  } catch (_) {}
  return true;
}

export async function deleteBrowserOfflineDownload(downloadId) {
  if (!downloadId) return;
  await cancelBrowserOfflineDownload(downloadId);
  const download = await getOfflineDownload(downloadId);
  if (download?.fileName) await removeOpfsFile(download.fileName);
  await removeMetadata(downloadId);
}

export async function getBrowserOfflineFile(downloadId) {
  const download = await getOfflineDownload(downloadId);
  if (download?.status !== "completed" || !download.fileName) return null;
  try {
    const directory = await getDownloadsDirectory(false);
    const file = await (await directory.getFileHandle(download.fileName)).getFile();
    return { download, file };
  } catch (_) {
    await writeDownload({
      ...download,
      status: "failed",
      completedAt: null,
      error: "Offline file is unavailable"
    }).catch(() => {});
    return null;
  }
}
