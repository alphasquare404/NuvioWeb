import {
  getBrowserOfflineFile,
  getBrowserOfflineSubtitleFile
} from "../../core/offline/browserOfflineDownloads.js";
import {
  buildOfflineHandoffFileName,
  buildOfflineHandoffSubtitleFileName,
  resolveOfflineHandoffContainer,
  resolveOfflineSubtitleContainer
} from "../../core/offline/offlineHandoffFileName.js";
import {
  describeOfflineHandoffStorage,
  readStorageHeadroom
} from "../../core/offline/offlineHandoffPolicy.js";
import { beginExternalPlaybackHandoff } from "./browserExternalPlaybackHandoff.js";
import { ProfileManager } from "../../core/profile/profileManager.js";

const REVOKE_DELAY_MS = 30_000;

// iOS reaches a video player through its document-interaction sheet, which a
// download of a typed blob opens. The share sheet never lists video players at
// all: they register as document handlers, not as share extensions.
export function isOfflineMediaHandoffSupported(runtime = globalThis) {
  const document = runtime?.document;
  if (!document || typeof document.createElement !== "function") return false;
  if (typeof runtime.URL?.createObjectURL !== "function") return false;
  return "download" in document.createElement("a");
}

// A slice spanning the whole blob is by reference: it re-labels the bytes for
// the receiving app without copying a single one of them.
function retype(blob, mimeType) {
  const type = String(mimeType || "").trim();
  if (!type || blob.type === type || typeof blob.slice !== "function") return blob;
  return blob.slice(0, blob.size, type);
}

export function deliverFileToDevice({ blob, fileName, mimeType = "", runtime = globalThis } = {}) {
  if (!blob || !fileName || !isOfflineMediaHandoffSupported(runtime)) return false;
  const document = runtime.document;
  const url = runtime.URL.createObjectURL(retype(blob, mimeType));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.rel = "noopener";
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  try {
    anchor.click();
  } finally {
    // The sheet reads the blob after the click returns, and a large file is
    // still being handed across well after it, so the URL outlives the anchor.
    runtime.setTimeout(() => {
      anchor.remove();
      runtime.URL.revokeObjectURL(url);
    }, REVOKE_DELAY_MS);
  }
  return true;
}

export async function getOfflineHandoffDetails(downloadId, runtime = globalThis) {
  const offline = await getBrowserOfflineFile(downloadId).catch(() => null);
  if (!offline?.file) return null;
  const estimate = await runtime?.navigator?.storage?.estimate?.().catch(() => null);
  return {
    download: offline.download,
    file: offline.file,
    fileName: buildOfflineHandoffFileName(offline.download),
    // Taken from the same resolver as the name, so the two always agree.
    mimeType: resolveOfflineHandoffContainer(offline.download).mimeType,
    sizeBytes: offline.file.size,
    storage: describeOfflineHandoffStorage({
      sizeBytes: offline.file.size,
      freeBytes: readStorageHeadroom(estimate)
    })
  };
}

export function handOffOfflineMedia(details, runtime = globalThis) {
  if (!details?.file || !details?.fileName) return false;
  return deliverFileToDevice({
    blob: details.file,
    fileName: details.fileName,
    mimeType: details.mimeType || resolveOfflineHandoffContainer(details.download).mimeType,
    runtime
  });
}

// A document handoff never reports a duration, so "Set playback position" has
// nothing to bound the entry with and nothing to turn it into a percentage --
// and the report is refused outright. The download already records the runtime.
export function resolveOfflineRuntimeMs(download = {}) {
  const isEpisode = String(download.contentType || "").toLowerCase() === "episode";
  const candidates = isEpisode
    ? [
        download.episodeRuntimeMinutes,
        download.displaySnapshot?.episode?.runtimeMinutes,
        download.runtimeMinutes,
        download.displaySnapshot?.runtimeMinutes
      ]
    : [download.runtimeMinutes, download.displaySnapshot?.runtimeMinutes];
  const minutes = candidates.map(Number).find((value) => Number.isFinite(value) && value > 0);
  return minutes ? Math.round(minutes * 60_000) : 0;
}

// Reading the file is the slow half, and it must not happen between a tap and
// the hand-over: iOS grants the sheet to the tap itself, not to whatever an
// await resumes into afterwards. So reading and delivering are separable, and a
// caller offering a choice can read everything before the choice is made.
export async function prepareOfflineSubtitleHandoff(download, subtitleId, runtime = globalThis) {
  if (!download || !subtitleId || !isOfflineMediaHandoffSupported(runtime)) return null;
  const offline = await getBrowserOfflineSubtitleFile(subtitleId).catch(() => null);
  if (!offline?.file) return null;
  const subtitle = offline.subtitle || {};
  return {
    subtitleId: String(subtitleId),
    blob: offline.file,
    fileName: buildOfflineHandoffSubtitleFileName(download, subtitle),
    mimeType: resolveOfflineSubtitleContainer(subtitle).mimeType
  };
}

// Deliberately synchronous, so a click handler can call it without an await.
export function deliverPreparedOfflineFile(prepared, runtime = globalThis) {
  if (!prepared?.blob || !prepared?.fileName) return false;
  return deliverFileToDevice({
    blob: prepared.blob,
    fileName: prepared.fileName,
    mimeType: prepared.mimeType,
    runtime
  });
}

// Only one file crosses per tap, and the first one navigates this page away, so
// the sidecar cannot ride along with the video. It is handed over on its own,
// named after the video, which is the only thing that pairs them again.
export async function handOffOfflineSubtitle(download, subtitleId, runtime = globalThis) {
  const prepared = await prepareOfflineSubtitleHandoff(download, subtitleId, runtime);
  return deliverPreparedOfflineFile(prepared, runtime);
}

export function buildOfflineProgressContext(download = {}, overrides = {}) {
  const isEpisode = String(download.contentType || "").toLowerCase() === "episode";
  const season = Number(download.seasonNumber);
  const episode = Number(download.episodeNumber);
  const context = {
    itemId: download.seriesId || download.mediaId || download.movieId || "",
    itemType: isEpisode ? "series" : "movie",
    videoId: isEpisode ? download.episodeId || null : null,
    season: isEpisode && Number.isFinite(season) ? season : null,
    episode: isEpisode && Number.isFinite(episode) ? episode : null,
    title: download.seriesTitle || download.displaySnapshot?.title || download.title || null,
    episodeTitle: isEpisode
      ? download.displaySnapshot?.episode?.title || download.title || null
      : null,
    poster: download.poster || null,
    background: download.backdrop || null,
    streamIdentity: download.downloadId || null
  };
  return { ...context, ...overrides };
}

// Nothing comes back from a document handoff -- no callback scheme, no report --
// so the only way progress is ever recorded is the prompt shown on return.
export function beginOfflineMediaHandoff({
  download = {},
  progressContext = null,
  profileId = null,
  startingPositionMs = 0,
  knownDurationMs = 0,
  runtime = globalThis
} = {}) {
  return beginExternalPlaybackHandoff({
    runtime,
    playerMode: "offline-file",
    automatic: false,
    progressMode: "manual",
    callbackCapable: false,
    manualPromptEligible: true,
    // Handing the file over navigates this page away and the app comes back as a
    // cold start, so there is no visibility transition for the prompt to wait on.
    navigationLaunch: true,
    progressContext: progressContext || buildOfflineProgressContext(download),
    profileId: profileId ?? ProfileManager.getActiveProfileId(),
    startingPositionMs,
    knownDurationMs:
      Number(knownDurationMs) > 0 ? knownDurationMs : resolveOfflineRuntimeMs(download)
  });
}
