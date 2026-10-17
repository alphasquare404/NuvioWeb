// The heading collapses once the page has scrolled past 80px, and expands again
// only below 64px. Two thresholds, not one: a single threshold makes the
// heading flicker whenever the scroll comes to rest on it, and a heading that
// twitches under the finger is worse than one that never moves.

export const SETTINGS_HEADER_COLLAPSE_AT = 80;
export const SETTINGS_HEADER_EXPAND_AT = 64;

/**
 * Whether the page heading should be in its collapsed state.
 *
 * @param {number} scrollTop how far the page has been scrolled
 * @param {boolean} collapsed the state the heading is in right now
 */
export function shouldCollapseSettingsHeader(scrollTop, collapsed = false) {
  const position = Number(scrollTop);
  if (!Number.isFinite(position) || position <= 0) {
    return false;
  }
  // Already collapsed: stay collapsed until the page is back above the lower
  // threshold. Otherwise: collapse once the upper one is passed.
  return collapsed
    ? position >= SETTINGS_HEADER_EXPAND_AT
    : position >= SETTINGS_HEADER_COLLAPSE_AT;
}
