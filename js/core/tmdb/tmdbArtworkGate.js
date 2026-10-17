// One question, asked in more places than one: is TMDB allowed to paint the
// artwork it has already fetched? The settings that answer it are the master
// switch and the Artwork toggle; the plates Home and Detail paint are TMDB
// artwork, whether they arrive now or come out of the disk cache.

export function isTmdbArtworkEnabled(settings) {
  return Boolean(settings?.enabled && settings?.useArtwork);
}
