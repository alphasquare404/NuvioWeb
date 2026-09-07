function episodeNumber(entry = {}) {
  return Number(entry?.episode ?? entry?.episodeNumber ?? 0);
}

function seasonNumber(entry = {}) {
  return Number(entry?.season ?? entry?.seasonNumber ?? 0);
}

export function orderSeasonEpisodes(episodes = []) {
  return [...(Array.isArray(episodes) ? episodes : [])].sort(
    (left, right) =>
      seasonNumber(left) - seasonNumber(right) ||
      episodeNumber(left) - episodeNumber(right) ||
      String(left?.id || "").localeCompare(String(right?.id || ""))
  );
}

export function getMissingSeasonEpisodes({ episodes = [], completedMediaIds = new Set(), createMediaId }) {
  return orderSeasonEpisodes(episodes).filter((episode) => {
    const mediaId = typeof createMediaId === "function" ? createMediaId(episode) : "";
    return !mediaId || !completedMediaIds.has(mediaId);
  });
}

// Mirrors Stream Selection's addon-group order without resolving a playable
// URL up front. The queue resolves resolver-backed sources only when active.
export function flattenSeasonDownloadStreams(streamResult = {}) {
  if (streamResult?.status !== "success") return [];
  const streams = [];
  (Array.isArray(streamResult.data) ? streamResult.data : []).forEach((group = {}) => {
    const addonName = group.addonName || "Addon";
    (Array.isArray(group.streams) ? group.streams : []).forEach((stream = {}, index) => {
      streams.push({
        ...stream,
        id: stream.id || `${addonName}-${index}-${stream.url || stream.externalUrl || stream.infoHash || ""}`,
        addonId: stream.addonId || group.addonId || group.streamOrigin?.addonId || "",
        addonName: stream.addonName || addonName,
        addonLogo: stream.addonLogo || group.addonLogo || "",
        addonOrderIndex: Number(stream.addonOrderIndex ?? group.addonOrderIndex ?? Number.MAX_SAFE_INTEGER),
        streamOrigin: { ...(group.streamOrigin || {}), ...(stream.streamOrigin || {}) },
        behaviorHints: stream.behaviorHints || stream.raw?.behaviorHints || {},
        raw: stream.raw || stream
      });
    });
  });
  return streams;
}

export function firstEligibleSeasonDownloadStream(streams = [], buildContext, canQueue) {
  for (const stream of streams) {
    const context = typeof buildContext === "function" ? buildContext(stream) : null;
    if (context && typeof canQueue === "function" && canQueue(context)) {
      return { stream, context };
    }
  }
  return null;
}

export async function prepareAutomaticSeasonDownloads({
  episodes = [],
  resolveStreams,
  buildContext,
  canQueue,
  concurrency = 3,
  onProgress,
  isCancelled
} = {}) {
  const candidates = orderSeasonEpisodes(episodes);
  const results = new Array(candidates.length);
  let nextIndex = 0;
  let completed = 0;
  const workerCount = Math.max(1, Math.min(Number(concurrency) || 1, candidates.length || 1));
  const worker = async () => {
    while (nextIndex < candidates.length) {
      if (typeof isCancelled === "function" && isCancelled()) return;
      const index = nextIndex++;
      const episode = candidates[index];
      try {
        const streams = flattenSeasonDownloadStreams(await resolveStreams(episode));
        const selected = firstEligibleSeasonDownloadStream(
          streams,
          (stream) => buildContext(episode, stream),
          canQueue
        );
        results[index] = selected
          ? { episode, status: "selected", ...selected }
          : { episode, status: "unavailable" };
      } catch (_) {
        results[index] = { episode, status: "unavailable" };
      }
      completed += 1;
      onProgress?.({ completed, total: candidates.length, episode, result: results[index] });
    }
  };
  await Promise.all(Array.from({ length: workerCount }, worker));
  return results.filter(Boolean);
}

export async function enqueueSeasonDownloadSelections(selections = [], enqueue) {
  const outcomes = [];
  for (const selection of selections) {
    if (!selection?.context) continue;
    try {
      outcomes.push({ selection, result: await enqueue(selection.context) });
    } catch (error) {
      outcomes.push({ selection, error });
    }
  }
  return outcomes;
}
