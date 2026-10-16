/**
 * Whether the detail page's backdrop, title logo and ratings should wait.
 *
 * With enrichment on, the page used to paint the add-on's artwork and the
 * add-on's rating and then swap both out a moment later -- a flicker on every
 * open, and the answer was always going to arrive. Where an answer is coming,
 * the page holds those three places empty instead and settles once.
 *
 * It waits only where there is something to wait for: the feature off, no key
 * to ask with, or ratings already on the meta, and it paints straight away.
 */

const MDBLIST_RATING_KEYS = [
  "trakt",
  "imdb",
  "tmdb",
  "letterboxd",
  "tomatoes",
  "audience",
  "metacritic"
];

export function hasMdbListRatings(ratings = {}) {
  return MDBLIST_RATING_KEYS.some(
    (key) => ratings?.[key] != null && String(ratings[key]).trim() !== ""
  );
}

// How long the page waits before giving up and showing what the add-on sent.
// Enrichment answers in a few hundred milliseconds on a warm connection; this
// is the ceiling, not the plan.
export const DETAIL_ENRICHMENT_HOLD_MS = 2000;

export function resolveDetailEnrichmentHold({
  tmdbSettings = {},
  tmdbApiKey = "",
  mdbListSettings = {},
  meta = null
} = {}) {
  return {
    // No shortcut for a remembered plate: what is remembered is the plate the
    // home hero uses, while this page also waits on the backdrop and the title
    // logo, which enrichment rewrites either way.
    artwork: Boolean(tmdbSettings.enabled && tmdbSettings.useArtwork && tmdbApiKey),
    ratings: Boolean(
      mdbListSettings.enabled &&
      String(mdbListSettings.apiKey || "").trim() &&
      !hasMdbListRatings(meta?.mdbListRatings)
    )
  };
}
