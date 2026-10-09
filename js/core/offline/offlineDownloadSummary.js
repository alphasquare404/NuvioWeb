/**
 * One line for the stream panel's header saying what is happening in the list
 * underneath it, so nobody has to scroll a few hundred sources to find out
 * that something is downloading.
 *
 * It reports only what is still in motion or already usable. A failed or
 * paused download is the card's business: the header is a count, and a count
 * cannot say why something stopped. Nothing to report returns "" rather than
 * three zeroes, because a header that always says something teaches people to
 * stop reading it.
 */
export function summariseOfflineDownloads(downloads = []) {
  const counts = (Array.isArray(downloads) ? downloads : []).reduce(
    (totals, download) => {
      const status = String(download?.status || "");
      if (status === "downloading") totals.downloading += 1;
      else if (status === "queued") totals.queued += 1;
      else if (status === "completed") totals.offline += 1;
      return totals;
    },
    { downloading: 0, queued: 0, offline: 0 }
  );
  return [
    counts.downloading ? `${counts.downloading} downloading` : "",
    counts.queued ? `${counts.queued} queued` : "",
    counts.offline ? `${counts.offline} offline` : ""
  ]
    .filter(Boolean)
    .join(" · ");
}
