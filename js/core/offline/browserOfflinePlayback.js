import { getBrowserOfflineFile } from "./browserOfflineDownloads.js";

export async function createBrowserOfflinePlayback(downloadId, dependencies = {}) {
  const getFile = dependencies.getOfflineFile || getBrowserOfflineFile;
  const createObjectUrl = dependencies.createObjectUrl || globalThis.URL?.createObjectURL;
  const offline = await getFile(downloadId);
  if (!offline?.file || typeof createObjectUrl !== "function") return null;
  return {
    download: offline.download,
    objectUrl: createObjectUrl(offline.file)
  };
}

export function releaseBrowserOfflinePlayback(playback = null) {
  const objectUrl = String(playback?.objectUrl || "");
  const revokeObjectUrl = globalThis.URL?.revokeObjectURL;
  if (!objectUrl || typeof revokeObjectUrl !== "function") return;
  revokeObjectUrl(objectUrl);
}
