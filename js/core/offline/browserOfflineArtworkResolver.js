import { getBrowserOfflineArtwork } from "./browserOfflineDownloads.js";
import { createOfflineArtworkUrlPool } from "./offlineArtworkUrlPool.js";

export function createBrowserOfflineArtworkResolver({ getArtwork = getBrowserOfflineArtwork } = {}) {
  return createOfflineArtworkUrlPool({ getArtwork });
}
