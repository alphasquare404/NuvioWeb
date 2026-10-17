// A thin bar that takes over a screen's title mark once the mark itself has
// been scrolled out of view.
//
// The bar is an overlay: it is `position: fixed` and the screen keeps its own
// layout, so showing it never moves the hero or the page under it. That is the
// difference from a sticky heading, which changes the page's height as it
// changes state and can therefore oscillate around its own threshold.
//
// The trigger is an IntersectionObserver on the mark, not a scroll position:
// the browser tells us when the mark has gone. Two extra conditions keep it
// from appearing early: the mark must be fully behind the bar, and the page
// must actually have been scrolled.

const DEFAULT_BAR_HEIGHT = 52;

/**
 * Whether the bar should be showing, from an IntersectionObserver entry.
 *
 * `boundingClientRect.bottom` above the bar's height means the mark is still
 * partly visible below it, so the bar waits. A mark that starts above the bar
 * on a very short window is not a reason to show it, hence the scroll check.
 *
 * @param {{ isIntersecting?: boolean, boundingClientRect?: { bottom?: number } } | null | undefined} entry
 * @param {{ barHeight?: number, scrollTop?: number }} [context]
 */
export function compactHeaderVisible(entry, context = {}) {
  if (!entry || typeof entry.isIntersecting !== "boolean") {
    return false;
  }
  const barHeight = Number(context.barHeight);
  const coveredAt = Number.isFinite(barHeight) && barHeight >= 0 ? barHeight : DEFAULT_BAR_HEIGHT;
  const scrollTop = Number(context.scrollTop);
  if (!Number.isFinite(scrollTop) || scrollTop <= 0) {
    return false;
  }
  const bottom = Number(entry.boundingClientRect?.bottom);
  if (Number.isFinite(bottom) && bottom > coveredAt) {
    return false;
  }
  // A hidden element -- a logo that failed to load, say -- reports no rectangle
  // at all. Reading that as "scrolled past" would put an empty bar on screen.
  const height = Number(entry.boundingClientRect?.height);
  if (Number.isFinite(height) && height <= 0) {
    return false;
  }
  return !entry.isIntersecting;
}

/**
 * Keeps a bar's visibility in step with its mark.
 *
 * @param {{
 *   bar?: Element | null,
 *   mark?: Element | null,
 *   rootMargin?: string,
 *   barHeight?: number,
 *   getScrollTop?: () => number
 * }} options
 * @returns {() => void} removes the observer
 */
export function bindCompactHeader({
  bar,
  mark,
  rootMargin,
  barHeight = DEFAULT_BAR_HEIGHT,
  getScrollTop = () => 0
} = {}) {
  if (!bar || !mark || typeof globalThis.IntersectionObserver !== "function") {
    return () => {};
  }

  const margin = rootMargin ?? `-${Math.max(0, Math.round(barHeight))}px 0px 0px 0px`;

  const apply = (visible) => {
    const next = visible ? "true" : "false";
    if (bar.dataset.visible !== next) {
      bar.dataset.visible = next;
    }
    const hidden = visible ? "false" : "true";
    if (bar.getAttribute("aria-hidden") !== hidden) {
      bar.setAttribute("aria-hidden", hidden);
    }
  };

  apply(false);
  // The observer only speaks when the intersection changes, so its root has to
  // be narrowed by exactly the bar's height: then "no longer intersecting" and
  // "the mark is fully behind the bar" are the same moment. A larger margin
  // (e.g. 64px) would fire once, while the mark was still peeking below the bar,
  // and never again.
  const observer = new globalThis.IntersectionObserver(
    (entries) => {
      const entry = entries[entries.length - 1];
      apply(compactHeaderVisible(entry, { barHeight, scrollTop: getScrollTop() }));
    },
    { rootMargin: margin, threshold: 0 }
  );
  observer.observe(mark);

  return () => observer.disconnect();
}
