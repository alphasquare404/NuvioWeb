import { uniqueNonEmptyValues } from "./homeUtils.js";
import { capTmdbImageSize } from "../../../core/media/tmdbImageSize.js";

function normalizeHeroBackdropSource(source) {
  // The hero is the one place a single picture fills the screen, so it is
  // also the one place worth the pixels: a TMDB original rather than the
  // 1280 everything else gets, and metahub's large rather than its medium.
  const value = capTmdbImageSize(String(source || "").trim(), "heroBackdrop");
  if (!value) {
    return "";
  }
  // Continue Watching artwork is cached for up to 14 days. Upgrade only the
  // old TMDB backdrop size so existing installs benefit without flushing the
  // rest of the cache or increasing poster/episode-thumbnail payloads.
  return value.replace(/(\/t\/p\/)w780\//i, "$1w1280/");
}

/**
 * Builds the ordered list of image candidates used by hero, poster and continue-watching cards.
 * @param {import("./homeTypes.js").HomeMediaSourceLike | null | undefined} item
 * @returns {string[]}
 */
export function buildHeroBackdropSources(item = null) {
  return uniqueNonEmptyValues([
    // The plate first where there is one: a hero carries its own logo, and a
    // second title printed into the artwork underneath it reads as a mistake.
    normalizeHeroBackdropSource(item?.textlessBackdrop),
    normalizeHeroBackdropSource(item?.background),
    normalizeHeroBackdropSource(item?.backdrop),
    normalizeHeroBackdropSource(item?.backdropUrl),
    normalizeHeroBackdropSource(item?.landscapePoster),
    item?.poster,
    item?.thumbnail,
    item?.episodeThumbnail
  ]);
}

export function encodeHeroBackdropFallbacks(sources = []) {
  return sources.map((source) => encodeURIComponent(source)).join("|");
}

export function buildImageFallbackErrorHandler() {
  // Inside a <picture>, a matching <source> wins over `src`, so a fallback
  // assigned to `src` would never be shown. Dropping the sources first hands
  // the choice back to the img, and the queue works as it always has.
  return (
    "var p=this.parentElement;if(p&&p.tagName==='PICTURE'){p.querySelectorAll('source').forEach(function(s){s.remove();});}" +
    "var q=(this.dataset.fallbackSrcs||'').split('|').filter(Boolean);var next=q.shift();if(next){this.dataset.fallbackSrcs=q.join('|');this.src=decodeURIComponent(next);return;}this.removeAttribute('src');this.classList.add('placeholder');"
  );
}

/**
 * The same list for a screen taller than it is wide.
 *
 * A backdrop is composed for a wide frame; filling a phone held upright with
 * one means cropping away most of the picture. A poster is already that shape,
 * so upright screens start from the poster plate and only fall back to the
 * wide artwork when a title has none.
 *
 * @param {import("./homeTypes.js").HomeMediaSourceLike | null | undefined} item
 * @returns {string[]}
 */
export function buildHeroPortraitSources(item = null) {
  // The plate, or nothing. An ordinary poster has the title printed on it, and
  // the hero prints its own logo underneath -- two titles, one of them crooked.
  // Without a plate the wide artwork is the better answer, even cropped, so the
  // rest of this list is the landscape one unchanged.
  return uniqueNonEmptyValues([
    capTmdbImageSize(item?.textlessPoster, "heroPoster"),
    ...buildHeroBackdropSources(item)
  ]);
}
