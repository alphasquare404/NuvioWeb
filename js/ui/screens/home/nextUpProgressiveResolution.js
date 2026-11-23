// Next Up resolution in stages.
//
// Home used to resolve at most its first batch of candidates and never look at
// the rest, so a show whose last watched episode was old enough to rank beyond
// the batch never produced a card -- even though its watched row was in the
// cloud and on the official app. The first batch still paints immediately; the
// remaining candidates stay pending and are resolved a small batch at a time
// as the Continue Watching row is scrolled.

export function splitNextUpCandidates(candidates = [], initialLimit = 32) {
  const all = Array.isArray(candidates) ? candidates : [];
  const limit = Math.max(0, Math.trunc(Number(initialLimit) || 0));
  return {
    initial: all.slice(0, limit),
    pending: all.slice(limit)
  };
}

/**
 * Add resolved Next Up cards to the current display.
 *
 * One card per title: a show that already has a progress card or another Next
 * Up card is skipped. The result is re-sorted and bounded by the visible-row
 * maximum, exactly like the initial build.
 */
export function mergeNextUpItemsIntoDisplay(
  displayItems = [],
  nextUpItems = [],
  { sort = null, maxItems = 300 } = {}
) {
  const display = Array.isArray(displayItems) ? displayItems : [];
  const existingContentIds = new Set(
    display.map((item) => String(item?.contentId || "").trim()).filter(Boolean)
  );
  const seen = new Set();
  const additions = [];
  (Array.isArray(nextUpItems) ? nextUpItems : []).forEach((item) => {
    const contentId = String(item?.contentId || "").trim();
    if (!item?.isNextUp || !contentId) {
      return;
    }
    if (existingContentIds.has(contentId) || seen.has(contentId)) {
      return;
    }
    seen.add(contentId);
    additions.push(item);
  });
  if (!additions.length) {
    return { items: display, added: 0 };
  }
  const combined = [...display, ...additions];
  const sorted = typeof sort === "function" ? sort(combined) : combined;
  const limit = Math.max(0, Math.trunc(Number(maxItems) || 0)) || sorted.length;
  return { items: sorted.slice(0, limit), added: additions.length };
}
