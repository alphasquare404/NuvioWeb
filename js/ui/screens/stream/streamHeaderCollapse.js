// The Stream header collapses once the page has scrolled past 64px, and expands
// again only near the top (below 12px). Two thresholds, not one, and the lower
// one is deliberately close to the top: the header in its collapsed state is
// about 120px shorter than in its open state, so on a short page collapsing
// clamps the scroll position up to the new maximum. A lower threshold anywhere
// near that maximum would expand the header, lengthen the page, and collapse it
// again -- a loop that never settles.

export const STREAM_HEADER_COLLAPSE_AT = 64;
export const STREAM_HEADER_EXPAND_AT = 12;

/**
 * Whether the Stream header should be in its collapsed state.
 *
 * @param {number} scrollTop how far the page has been scrolled
 * @param {boolean} collapsed the state the header is in right now
 */
export function shouldCollapseStreamHeader(scrollTop, collapsed = false) {
  const position = Number(scrollTop);
  if (!Number.isFinite(position) || position <= 0) {
    return false;
  }
  return collapsed ? position >= STREAM_HEADER_EXPAND_AT : position >= STREAM_HEADER_COLLAPSE_AT;
}
