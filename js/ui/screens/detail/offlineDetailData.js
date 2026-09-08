function text(value) {
  return String(value || "").trim();
}

function selectedIds(itemIds = []) {
  return new Set((Array.isArray(itemIds) ? itemIds : [itemIds]).map(text).filter(Boolean));
}

export function selectCompletedOfflineDetailDownloads(downloads = [], { itemType, itemIds } = {}) {
  const ids = selectedIds(itemIds);
  const isSeries = ["series", "tv", "show"].includes(String(itemType || "").toLowerCase());
  return (Array.isArray(downloads) ? downloads : []).filter((download) => {
    if (download?.status !== "completed") return false;
    if (isSeries) return download?.contentType === "episode" && ids.has(text(download?.seriesId));
    return (
      download?.contentType === "movie" &&
      [download?.mediaId, download?.movieId].some((id) => ids.has(text(id)))
    );
  });
}

export function createOfflineEpisodeEntries(downloads = []) {
  const byEpisode = new Map();
  (Array.isArray(downloads) ? downloads : []).forEach((download) => {
    const season = Number(download?.seasonNumber);
    const episode = Number(download?.episodeNumber);
    if (!Number.isInteger(season) || season < 0 || !Number.isInteger(episode) || episode <= 0) return;
    const key = `${season}:${episode}`;
    const current = byEpisode.get(key);
    if (current && Number(current.completedAt || 0) >= Number(download?.completedAt || 0)) return;
    byEpisode.set(key, {
      id: text(download?.episodeId) || `offline:${text(download?.mediaIdentity || download?.downloadId)}`,
      title: text(download?.displaySnapshot?.episode?.title || download?.title) || `Episode ${episode}`,
      seriesId: text(download?.seriesId),
      seriesTitle: text(download?.seriesTitle),
      season,
      episode,
      thumbnail: text(download?.displaySnapshot?.episode?.still) || null,
      overview: text(download?.displaySnapshot?.episode?.overview || download?.episodeOverview || download?.description),
      runtimeMinutes: Number(download?.displaySnapshot?.episode?.runtimeMinutes || download?.episodeRuntimeMinutes || download?.runtimeMinutes || 0) || 0,
      released: text(download?.displaySnapshot?.episode?.released),
      available: true,
      offlineDownloadId: text(download?.downloadId),
      offlineMediaIdentity: text(download?.mediaIdentity),
      offlineSourceFingerprint: text(download?.sourceFingerprint)
    });
  });
  return [...byEpisode.values()].sort(
    (left, right) => left.season - right.season || left.episode - right.episode
  );
}

export function mergeDetailEpisodesWithOfflineDownloads(remoteEpisodes = [], offlineEpisodes = []) {
  const offlineByKey = new Map(
    (Array.isArray(offlineEpisodes) ? offlineEpisodes : []).map((episode) => [
      `${Number(episode?.season)}:${Number(episode?.episode)}`,
      episode
    ])
  );
  const merged = (Array.isArray(remoteEpisodes) ? remoteEpisodes : []).map((episode) => {
    const offline = offlineByKey.get(`${Number(episode?.season)}:${Number(episode?.episode)}`);
    if (offline) offlineByKey.delete(`${Number(episode?.season)}:${Number(episode?.episode)}`);
    return offline
      ? { ...episode, offlineDownloadId: offline.offlineDownloadId, offlineMediaIdentity: offline.offlineMediaIdentity }
      : episode;
  });
  return [...merged, ...offlineByKey.values()].sort(
    (left, right) => Number(left?.season) - Number(right?.season) || Number(left?.episode) - Number(right?.episode)
  );
}

export function hasPlayableOfflineDownload(download = null) {
  return Boolean(download?.downloadId && download?.status === "completed" && download?.fileName);
}
