// Layout height and decorative media height are deliberately separate. Extending
// the artwork must never push the next rail down.
export function updateBrowserHeroGeometry(hero, mediaHost, nextCard, extend) {
  if (!hero || !mediaHost) return;
  const bounds = hero.getBoundingClientRect();
  const card = nextCard?.getBoundingClientRect();
  const end = extend && card ? Math.max(bounds.bottom, card.top + card.height / 3) : bounds.bottom;
  mediaHost.style.setProperty("--browser-hero-media-height", `${Math.round(end - bounds.top)}px`);
  mediaHost.style.setProperty("--browser-hero-tail", `${Math.round(end - bounds.bottom)}px`);
}
