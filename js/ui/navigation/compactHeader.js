// A thin bar that takes over a screen's title mark once the mark itself has
// been scrolled out of view.
//
// The bar is an overlay: it is `position: fixed` and the screen keeps its own
// layout, so showing it never moves the hero or the page under it. That is the
// difference from a sticky heading, which changes the page's height as it
// changes state and can therefore oscillate around its own threshold.
//
// The trigger is an IntersectionObserver on the mark, not a scroll position:
// there is no number to tune, and the browser tells us when the mark has gone.

const DEFAULT_ROOT_MARGIN = "-64px 0px 0px 0px";

/**
 * Whether the bar should be showing, from an IntersectionObserver entry.
 *
 * @param {{ isIntersecting?: boolean } | null | undefined} entry
 */
export function compactHeaderVisible(entry) {
  if (!entry || typeof entry.isIntersecting !== "boolean") {
    return false;
  }
  return !entry.isIntersecting;
}

/**
 * Keeps a bar's visibility in step with its mark.
 *
 * @param {{ bar?: Element | null, mark?: Element | null, rootMargin?: string }} options
 * @returns {() => void} removes the observer
 */
export function bindCompactHeader({ bar, mark, rootMargin = DEFAULT_ROOT_MARGIN } = {}) {
  if (!bar || !mark || typeof globalThis.IntersectionObserver !== "function") {
    return () => {};
  }

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
  const observer = new globalThis.IntersectionObserver(
    (entries) => {
      apply(compactHeaderVisible(entries[entries.length - 1]));
    },
    { rootMargin, threshold: 0 }
  );
  observer.observe(mark);

  return () => observer.disconnect();
}
