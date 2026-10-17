// The Stream header takes the mark once the mark itself has been scrolled past,
// and gives it back near the top. The point where it happens is the height of
// the mark's own block, so the small mark never shows while the large one is
// still on screen -- which is why the caller passes it in rather than relying on
// a single number here.

export const STREAM_HEADER_COLLAPSE_AT = 96;
export const STREAM_HEADER_EXPAND_AT = 12;

/**
 * Whether the Stream header should be holding the mark.
 *
 * @param {number} scrollTop how far the page has been scrolled
 * @param {boolean} collapsed whether the header is holding it right now
 * @param {{ collapseAt?: number, expandAt?: number }} [thresholds]
 */
export function shouldCollapseStreamHeader(scrollTop, collapsed = false, thresholds = {}) {
  const position = Number(scrollTop);
  if (!Number.isFinite(position) || position <= 0) {
    return false;
  }
  const collapseAt = Number(thresholds.collapseAt);
  const expandAt = Number(thresholds.expandAt);
  const upper =
    Number.isFinite(collapseAt) && collapseAt > 0 ? collapseAt : STREAM_HEADER_COLLAPSE_AT;
  const lower =
    Number.isFinite(expandAt) && expandAt >= 0 && expandAt < upper
      ? expandAt
      : STREAM_HEADER_EXPAND_AT;
  return collapsed ? position >= lower : position >= upper;
}
