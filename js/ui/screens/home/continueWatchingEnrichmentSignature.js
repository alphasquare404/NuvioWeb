// Identifies the TMDB settings a cached Continue Watching entry was built
// under, so a cache entry can be told apart from one produced under different
// settings.
//
// Entries live for two weeks and nothing invalidated them when the settings
// changed, so turning "Enrich Continue Watching" on appeared to do nothing:
// every item was already cached, and the staleness test only asked whether
// anything was *missing* -- an item that already carried artwork from its addon
// counted as finished, so TMDB was never consulted for it.
//
// Only the settings that actually reach Continue Watching enrichment belong
// here. Including the rest (credits, productions, trailers, collections...)
// would re-enrich every item whenever an unrelated toggle moved.
export function continueWatchingEnrichmentSignatureFor(settings = {}, hasApiKey = false) {
  const active = Boolean(settings.enabled && settings.enrichContinueWatching && hasApiKey);
  if (!active) {
    return "tmdb:off";
  }
  return [
    "tmdb:on",
    settings.language || "",
    settings.useArtwork !== false ? "art" : "-",
    settings.useBasicInfo !== false ? "basic" : "-",
    settings.useDetails !== false ? "details" : "-",
    settings.useReleaseDates !== false ? "dates" : "-",
    settings.useEpisodes !== false ? "eps" : "-"
  ].join(":");
}
