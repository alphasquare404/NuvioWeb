// Reconciling this device's progress with the cloud's, given what the cloud
// last looked like. Kept free of storage, network and auth so the decisions can
// be exercised directly -- they are the most conflict-sensitive rules in the app
// and used to be reachable only by standing up the whole sync service.

export function progressKey(item = {}) {
  const contentId = String(item.contentId || "").trim();
  const videoId = String(item.videoId || "main").trim();
  const season = item.season == null ? "" : String(Number(item.season));
  const episode = item.episode == null ? "" : String(Number(item.episode));
  return `${contentId}::${videoId}::${season}::${episode}`;
}

// A progress row identifies an episode by videoId; a watched record identifies
// the same episode by season and number. Matching the two needs a key neither
// side's own identity provides.
export function progressWatchedKey(item = {}) {
  // A default parameter does not cover an explicit null, and these lists come
  // straight out of storage where a null entry is a real possibility.
  const contentId = String(item?.contentId || "").trim();
  const season = item?.season == null ? "" : String(Number(item.season));
  const episode = item?.episode == null ? "" : String(Number(item.episode));
  return `${contentId}::${season}::${episode}`;
}

// When each title was finished, keyed so a progress row can look itself up.
// Built here rather than read from the watched store's own key so this path does
// not depend on a copy that lives somewhere else and can drift.
export function buildWatchedAtByKey(watchedItems = []) {
  const byKey = new Map();
  (Array.isArray(watchedItems) ? watchedItems : []).forEach((item) => {
    const watchedAt = Number(item?.watchedAt || 0);
    if (!item?.contentId || !(watchedAt > 0)) return;
    const key = progressWatchedKey(item);
    // A title finished more than once keeps the latest, because that is the
    // completion any earlier partial has to be measured against.
    if (watchedAt > Number(byKey.get(key) || 0)) byKey.set(key, watchedAt);
  });
  return byKey;
}

export function normalizeProgressItems(items = []) {
  const byKey = new Map();
  (Array.isArray(items) ? items : [])
    .filter((item) => Boolean(item?.contentId))
    .forEach((item) => {
      const key = progressKey(item);
      const existing = byKey.get(key);
      if (!existing || Number(item.updatedAt || 0) > Number(existing.updatedAt || 0)) {
        byKey.set(key, item);
      }
    });
  return Array.from(byKey.values()).sort(
    (left, right) => Number(right.updatedAt || 0) - Number(left.updatedAt || 0)
  );
}

export function progressContentSignature(item = {}) {
  return JSON.stringify([
    String(item.contentId || ""),
    String(item.contentType || "movie"),
    String(item.videoId || ""),
    Number(item.season || 0),
    Number(item.episode || 0),
    Number(item.positionMs || 0),
    Number(item.durationMs || 0),
    Number(item.updatedAt || 0)
  ]);
}

export function itemsByProgressKey(items = []) {
  return new Map(normalizeProgressItems(items).map((item) => [progressKey(item), item]));
}

// Supabase stores the portable progress fields only. Keep device-local metadata
// when the matching remote row wins a merge, just as Android preserves display
// metadata while merging watch progress. streamIdentity is also local-only and
// is what Continue Watching uses to reopen the source selected for this item.
export function preserveLocalProgressMetadata(progress, localItem) {
  if (!progress || !localItem) {
    return progress;
  }
  const localTitle = String(localItem.title || "").trim();
  const localStreamIdentity = String(localItem.streamIdentity || "").trim();
  // Which source a row was recorded under is local-only knowledge: the cloud
  // payload has no column for it, so every pull used to hand the row back as
  // plain "local". That erased the mark Continue Watching uses to keep one
  // source's viewing out of another's, and playback recorded while SIMKL owned
  // progress resurfaced under Nuvio Sync.
  const localSource = String(localItem.source || "").trim();
  return {
    ...progress,
    ...(localSource ? { source: localItem.source } : {}),
    ...(localTitle ? { title: localItem.title } : {}),
    ...(localItem.poster ? { poster: localItem.poster } : {}),
    ...(localItem.background ? { background: localItem.background } : {}),
    ...(localItem.logo ? { logo: localItem.logo } : {}),
    ...(localItem.episodeTitle ? { episodeTitle: localItem.episodeTitle } : {}),
    ...(localItem.imdbId ? { imdbId: localItem.imdbId } : {}),
    ...(localItem.tmdbId ? { tmdbId: localItem.tmdbId } : {}),
    ...(localItem.traktId ? { traktId: localItem.traktId } : {}),
    ...(localItem.year ? { year: localItem.year } : {}),
    ...(localStreamIdentity ? { streamIdentity: localItem.streamIdentity } : {})
  };
}

// Both sides moved since the cloud last looked like the baseline, so one has to
// give. This used to be settled by `updatedAt`, which is the writing device's
// own wall clock: two devices a few minutes apart decided it arbitrarily, and
// the loser's viewing was simply erased. Position is the one thing both sides
// measure the same way.
//
// The cost is a deliberate restart losing to the further side. That is a seek
// away, where the other direction silently discards minutes already watched.
export function furthestProgress(localItem, remoteItem) {
  const localPosition = Number(localItem?.positionMs || 0);
  const remotePosition = Number(remoteItem?.positionMs || 0);
  if (localPosition !== remotePosition)
    return localPosition > remotePosition ? localItem : remoteItem;
  // Identical positions are not a conflict worth arbitrating; keep the newer
  // record so its metadata is the fresher of the two.
  return Number(localItem?.updatedAt || 0) >= Number(remoteItem?.updatedAt || 0)
    ? localItem
    : remoteItem;
}

export function mergeProgressItems(
  localItems = [],
  remoteItems = [],
  baselineItems = [],
  { watchedAtByKey = new Map(), onRetireDecision = null } = {}
) {
  const localByKey = itemsByProgressKey(localItems);
  const remoteByKey = itemsByProgressKey(remoteItems);
  const baselineByKey = itemsByProgressKey(baselineItems);
  const keys = new Set([...localByKey.keys(), ...remoteByKey.keys(), ...baselineByKey.keys()]);
  const merged = [];

  keys.forEach((key) => {
    const localItem = localByKey.get(key) || null;
    const remoteItem = remoteByKey.get(key) || null;
    const baselineItem = baselineByKey.get(key) || null;

    if (localItem && remoteItem) {
      const localChanged =
        !baselineItem ||
        progressContentSignature(localItem) !== progressContentSignature(baselineItem);
      const remoteChanged =
        !baselineItem ||
        progressContentSignature(remoteItem) !== progressContentSignature(baselineItem);
      if (localChanged && !remoteChanged) {
        // Only this device moved, so this device decides -- including when it
        // moved backwards. Rewinding to watch something again is a deliberate
        // act, and settling this on position instead threw it away: the cloud's
        // further position came straight back and the rewind was impossible to
        // make stick.
        //
        // The exception is the baseline being wrong about the cloud. It is
        // written from a pull's own snapshot, so a pull that recorded it and
        // then failed to store its rows leaves it agreeing with a cloud this
        // device never took in -- after which every pull reads as "only I
        // moved" and the device silently stops following the cloud for good.
        //
        // A timestamp separates the two, and it is the one question where it is
        // the right instrument: not whose clock is correct, but which write
        // happened last. A rewind here is newer than the cloud's row, while a
        // cloud this device never merged is newer than anything local.
        const remoteIsNewer = Number(remoteItem.updatedAt || 0) > Number(localItem.updatedAt || 0);
        merged.push(
          remoteIsNewer ? preserveLocalProgressMetadata(remoteItem, localItem) : localItem
        );
        return;
      }
      if (remoteChanged && !localChanged) {
        merged.push(preserveLocalProgressMetadata(remoteItem, localItem));
        return;
      }
      merged.push(
        preserveLocalProgressMetadata(furthestProgress(localItem, remoteItem), localItem)
      );
      return;
    }

    if (remoteItem && !localItem) {
      const remoteChanged =
        baselineItem &&
        progressContentSignature(remoteItem) !== progressContentSignature(baselineItem);
      if (!baselineItem || remoteChanged) {
        merged.push(remoteItem);
      }
      return;
    }

    if (localItem && !remoteItem) {
      const localChanged =
        baselineItem &&
        progressContentSignature(localItem) !== progressContentSignature(baselineItem);
      if (!baselineItem || localChanged) {
        // Finishing a title deletes its progress row rather than setting it to
        // 100%, so "the cloud has no row" is how a completion reaches this
        // device. Pushing a local partial back then returns a film already
        // finished elsewhere to Continue Watching part-watched.
        //
        // A rewatch has to be told apart from that leftover, and the obvious
        // signal -- which came first -- is two devices' wall clocks compared
        // against each other. Minutes of drift decide it, which is the same
        // reason position rather than time settles the both-changed case above.
        //
        // Two clock-free facts separate them instead. A leftover still has the
        // baseline row the cloud has since deleted; by the time a rewatch
        // starts, that deletion has already been taken in and the baseline is
        // empty. And a leftover carries on past where the cloud last knew,
        // where a rewatch starts behind it.
        const watchedKey = progressWatchedKey(localItem);
        const watched = Number(watchedAtByKey?.get?.(watchedKey) || 0) > 0;
        const continuedFromBaseline =
          Number(localItem.positionMs || 0) >= Number(baselineItem?.positionMs || 0);
        const retire = watched && Boolean(baselineItem) && continuedFromBaseline;
        // Reported rather than inferred: whether a row is retired turns on a key
        // match and an ordering, and a count of watched records says nothing
        // about either.
        onRetireDecision?.({
          key: watchedKey,
          watched,
          hadBaseline: Boolean(baselineItem),
          positionMs: Number(localItem.positionMs || 0),
          baselinePositionMs: Number(baselineItem?.positionMs || 0),
          retire
        });
        if (retire) return;
        merged.push(localItem);
      }
    }
  });

  return normalizeProgressItems(merged);
}
