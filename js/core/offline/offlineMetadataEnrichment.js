import { metaRepository } from "../../data/repository/metaRepository.js";
import { TmdbService } from "../tmdb/tmdbService.js";
import { TmdbMetadataService } from "../tmdb/tmdbMetadataService.js";
import { TmdbSettingsStore } from "../../data/local/tmdbSettingsStore.js";
import { createOfflineDisplaySnapshot } from "./offlineDisplaySnapshot.js";
import {
  enrichBrowserOfflineDownloadDisplay,
  getOfflineDownload,
  updateBrowserOfflineDownload
} from "./browserOfflineDownloads.js";

export async function fetchOfflineDisplaySnapshot(
  download,
  {
    repository = metaRepository,
    tmdb = TmdbService,
    metadata = TmdbMetadataService,
    settings = TmdbSettingsStore.get()
  } = {}
) {
  const request = download.queueRequest || {};
  const series = download.contentType === "episode";
  const type = series ? "series" : "movie";
  const id = request.itemId || download.seriesId || download.mediaId;
  if (!id) return null;
  const result = await repository.getMetaFromAllAddons(type, id).catch(() => null);
  let meta = result?.status === "success" ? result.data : null;
  let episode = series
    ? (meta?.videos || []).find(
        (video) =>
          Number(video.season) === Number(download.seasonNumber) &&
          Number(video.episode) === Number(download.episodeNumber)
      )
    : null;
  if (settings.enabled) {
    try {
      const tmdbId = request.tmdbId || (await tmdb.ensureTmdbId(id, type));
      if (tmdbId) {
        const enriched = await metadata.fetchEnrichment({
          tmdbId,
          contentType: type,
          language: settings.language
        });
        if (enriched) {
          meta = {
            ...(meta || {}),
            ...(settings.useBasicInfo
              ? {
                  name: enriched.localizedTitle || meta?.name,
                  description: enriched.description || meta?.description,
                  genres: enriched.genres?.length ? enriched.genres : meta?.genres
                }
              : {}),
            ...(settings.useArtwork
              ? {
                  poster: enriched.poster || meta?.poster,
                  background: enriched.backdrop || meta?.background,
                  logo: enriched.logo || meta?.logo
                }
              : {}),
            ...(settings.useDetails
              ? {
                  runtimeMinutes: Number.parseFloat(enriched.runtime) || meta?.runtimeMinutes,
                  country: enriched.country || meta?.country,
                  language: enriched.language || meta?.language
                }
              : {}),
            ...(settings.useReleaseDates
              ? { releaseInfo: meta?.releaseInfo || enriched.releaseInfo }
              : {})
          };
        }
        if (series && settings.useEpisodes) {
          const episodes = await metadata.fetchEpisodeEnrichment({
            tmdbId,
            seasonNumbers: [download.seasonNumber],
            language: settings.language
          });
          const info = episodes.get(`${download.seasonNumber}:${download.episodeNumber}`);
          if (info)
            episode = {
              ...(episode || {}),
              title: info.title || episode?.title,
              overview: info.overview || episode?.overview,
              thumbnail: info.thumbnail || episode?.thumbnail,
              runtimeMinutes: info.runtime || episode?.runtimeMinutes,
              released: settings.useReleaseDates
                ? info.airDate || episode?.released
                : episode?.released
            };
        }
      }
    } catch {
      /* Addon metadata remains useful when optional TMDB enrichment fails. */
    }
  }
  return meta ? createOfflineDisplaySnapshot({ ...meta, episode }) : null;
}

// One background metadata job at a time, independent of the video queue.
// A stalled provider must never block downloads or publish a late snapshot.
export function createOfflineMetadataEnricher({
  fetchSnapshot = fetchOfflineDisplaySnapshot,
  read = getOfflineDownload,
  update = updateBrowserOfflineDownload,
  save = enrichBrowserOfflineDownloadDisplay,
  timeoutMs = 15000
} = {}) {
  const jobs = new Map();
  let tail = Promise.resolve();
  return (download) => {
    const id = download?.downloadId;
    if (!id || download.status !== "completed") return Promise.resolve(false);
    if (jobs.has(id)) return jobs.get(id);
    const job = tail
      .catch(() => {})
      .then(async () => {
        let timer;
        try {
          const current = await read(id);
          if (current?.status !== "completed" || current.offlineMetadataStatus === "completed")
            return false;
          await update(id, { offlineMetadataStatus: "processing" });
          const snapshot = await Promise.race([
            fetchSnapshot(current),
            new Promise((resolve) => {
              timer = setTimeout(() => resolve(null), timeoutMs);
            })
          ]);
          clearTimeout(timer);
          if (!snapshot) {
            await update(id, { offlineMetadataStatus: "partial" });
            return false;
          }
          if ((await read(id))?.status !== "completed") return false;
          await save(id, snapshot);
          await update(id, { offlineMetadataStatus: "completed" });
          return true;
        } catch {
          await update(id, { offlineMetadataStatus: "partial" }).catch(() => {});
          return false;
        } finally {
          clearTimeout(timer);
        }
      });
    jobs.set(id, job);
    tail = job;
    void job.finally(() => jobs.delete(id));
    return job;
  };
}
export const enrichOfflineDownloadMetadata = createOfflineMetadataEnricher();
