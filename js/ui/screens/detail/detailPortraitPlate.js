import { capTmdbImageSize } from "../../../core/media/tmdbImageSize.js";
import { isTmdbArtworkEnabled } from "../../../core/tmdb/tmdbArtworkGate.js";
import { heroArtworkKey, readHeroArtwork } from "../../../data/local/heroArtworkCache.js";
import { TmdbSettingsStore } from "../../../data/local/tmdbSettingsStore.js";

/**
 * What TMDB artwork is remembered for a title, keyed the way Home remembers it
 * too -- the two screens ask about the same titles and share the answer.
 */
export function detailArtworkKey(meta) {
  return heroArtworkKey(meta);
}

/**
 * The plate a portrait Detail paints. A remembered plate is TMDB artwork as much
 * as a fresh one is, so it is refused for the same reason: `enabled` plus the
 * Artwork toggle. Without that check, turning Artwork off left every title seen
 * before still wearing the plate the cache held.
 */
export function resolveDetailPortraitBackdrop(meta, options = {}) {
  const settings = options.settings || TmdbSettingsStore.get();
  const readRemembered = options.readRemembered || readHeroArtwork;

  if (!isTmdbArtworkEnabled(settings)) {
    return "";
  }

  const remembered = meta?.textlessPoster ? null : readRemembered(detailArtworkKey(meta));
  const plate = meta?.textlessPoster || remembered?.poster || "";
  return capTmdbImageSize(String(plate), "heroPoster");
}
