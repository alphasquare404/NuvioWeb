// Skip intro / recap / outro, as a decision rather than a button.
//
// The intervals come from IntroDB through skipIntroRepository, the same source the
// built-in player asks. What differs is who acts on them: here the engine only
// reports a position, so the guide answers one question per tick — nothing to do,
// offer the skip, or take it — and remembers what it already did, because a
// 4x/second tick inside a 60-second intro would otherwise offer the same skip
// sixty times or seek sixty times.

// `Number(null)` is 0 and `Number("")` is 0, so a missing bound would arrive as a
// very real interval starting at zero. Absent is absent, not zero.
function toSeconds(value) {
  if (value === null || value === undefined || value === "") return Number.NaN;
  return Number(value);
}

export function normalizeIntervals(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((entry) => ({
      startTime: toSeconds(entry?.startTime),
      endTime: toSeconds(entry?.endTime),
      type: String(entry?.type || "intro").toLowerCase()
    }))
    .filter(
      (entry) =>
        Number.isFinite(entry.startTime) &&
        Number.isFinite(entry.endTime) &&
        entry.endTime > entry.startTime
    )
    .sort((left, right) => left.startTime - right.startTime);
}

/**
 * The identity IntroDB is asked about — resolved the way the built-in player
 * resolves it, because the same rule has to hold in both engines or the feature
 * exists in one and not the other.
 *
 * Two details carried over from playerScreen.buildPlaybackIdentityContext:
 *  - the id may sit on `videoId` or `itemId` rather than `imdbId`, and an id like
 *    "tt123:1:2" is an imdb id followed by episode coordinates;
 *  - there is no skip data for a film. IntroDB is asked per episode, so a season
 *    and an episode have to be present and positive.
 */
export function resolvePlayableImdbId(params = {}) {
  const source = params || {};
  for (const raw of [source.imdbId, source.imdb_id, source.videoId, source.itemId]) {
    const candidate = String(raw ?? "")
      .trim()
      .split(":")[0];
    if (/^tt\d+$/i.test(candidate)) return candidate;
  }
  return "";
}

export function resolveSkipIdentity(params = {}) {
  const source = params || {};
  const imdbId = resolvePlayableImdbId(source);
  if (!imdbId) return { reason: "no-imdb-id" };
  const season = Number(source.season);
  const episode = Number(source.episode);
  if (!Number.isFinite(season) || season <= 0) return { reason: "no-season" };
  if (!Number.isFinite(episode) || episode <= 0) return { reason: "no-episode" };
  return { imdbId, season, episode };
}

export function segmentLabel(type) {
  const normalized = String(type || "").toLowerCase();
  if (normalized === "recap") return "Skip recap";
  if (normalized === "outro") return "Skip outro";
  return "Skip intro";
}

/**
 * @param {object} options
 * @param {Array} options.intervals        from normalizeIntervals
 * @param {string[]} options.autoSkipTypes types the profile asked to skip without
 *                                        being asked (intro / recap / outro)
 */
export function createSkipGuide({ intervals = [], autoSkipTypes = [] } = {}) {
  const auto = new Set(
    (Array.isArray(autoSkipTypes) ? autoSkipTypes : []).map((type) => String(type).toLowerCase())
  );
  const handled = new Set();
  const keyOf = (segment) => `${segment.type}:${Math.round(segment.startTime)}`;

  return {
    /**
     * What to do at this position.
     *
     * `auto` is returned at most once per segment, and marking it handled is what
     * makes that true — the caller seeks, and the next tick will not ask again.
     */
    evaluate(seconds) {
      const time = Number(seconds);
      if (!Number.isFinite(time)) return { action: "none" };
      const segment = intervals.find((entry) => time >= entry.startTime && time < entry.endTime);
      if (!segment) return { action: "none" };
      if (handled.has(keyOf(segment))) return { action: "none", segment };
      if (auto.has(segment.type)) {
        handled.add(keyOf(segment));
        return { action: "auto", segment };
      }
      return { action: "prompt", segment };
    },

    markHandled(segment) {
      if (segment) handled.add(keyOf(segment));
    },

    reset() {
      handled.clear();
    }
  };
}
