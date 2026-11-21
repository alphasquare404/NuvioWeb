// Keep these viewport conditions aligned with browser-hero.css. A phone in
// landscape is wide but still short; tablet landscape has desktop composition.
export const COMPACT_BROWSER_HERO_QUERY =
  "(any-pointer: coarse) and (orientation: portrait), (any-pointer: coarse) and (orientation: landscape) and (max-height: 599px)";
export const PORTRAIT_BROWSER_HERO_QUERY = "(any-pointer: coarse) and (orientation: portrait)";

export function usesCompactBrowserHero() {
  return Boolean(globalThis.matchMedia?.(COMPACT_BROWSER_HERO_QUERY)?.matches);
}
