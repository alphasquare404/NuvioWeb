export function summarizeBrowserOfflineStorage(downloads = [], subtitles = [], mediaSizes = new Map(), subtitleSizes = new Map()) {
  const completed = downloads.filter((download) => download?.status === "completed");
  const mediaBytes = completed.reduce((total, download) => total + Number(mediaSizes.get(download.downloadId) || 0), 0);
  const partialBytes = downloads
    .filter((download) => download?.status !== "completed")
    .reduce((total, download) => total + Number(mediaSizes.get(download.downloadId) || 0), 0);
  const subtitleBytes = subtitles.reduce((total, subtitle) => total + Number(subtitleSizes.get(subtitle.subtitleId) || 0), 0);
  const statusCounts = downloads.reduce((counts, download) => {
    const status = String(download?.status || "unknown");
    counts[status] = (counts[status] || 0) + 1;
    return counts;
  }, {});
  return {
    mediaBytes,
    partialBytes,
    subtitleBytes,
    totalOfflineBytes: mediaBytes + partialBytes + subtitleBytes,
    movies: completed.filter((download) => download.contentType === "movie").length,
    series: new Set(completed.filter((download) => download.contentType === "episode").map((download) => download.seriesId)).size,
    episodes: completed.filter((download) => download.contentType === "episode").length,
    subtitles: subtitles.filter((subtitle) => subtitle?.status === "completed").length,
    statusCounts
  };
}
