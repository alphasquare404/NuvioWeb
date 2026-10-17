// A thin bar that takes over a screen's title mark once the mark itself has
// been scrolled out of view.
//
// The bar is an overlay: it is `position: fixed` and the screen keeps its own
// layout, so showing it never moves the hero or the page under it.
//
// Two things are deliberately re-read on every tick rather than captured once:
// the bar and the mark. A Detail page re-renders while it loads -- enrichment
// arrives, episodes are rebuilt -- and each render replaces both elements. A
// binding that held the first pair would go on watching nodes that are no
// longer in the document, which looks exactly like "the bar never appears".
//
// An IntersectionObserver was tried first and had the same blindness in another
// form: it only speaks when the intersection changes, so the extra condition
// (the mark must be behind the bar, not merely leaving the screen) could never
// be satisfied when the first callback arrived too early.

const DEFAULT_BAR_HEIGHT = 52;

/**
 * Whether the bar should be showing, from the mark's position.
 *
 * The mark has to be fully behind the bar (`bottom` at or above the bar's
 * height), it has to have a size (a logo that failed to load has none), and the
 * page has to have been scrolled at all -- otherwise a very short window, where
 * the mark starts above the bar, would show it before anyone moved the page.
 *
 * @param {{ markBottom?: number, markHeight?: number, barHeight?: number, scrollTop?: number }} state
 */
export function compactHeaderVisibleFromGeometry(state = {}) {
  const bottom = Number(state.markBottom);
  const scrollTop = Number(state.scrollTop);
  if (!Number.isFinite(bottom) || !Number.isFinite(scrollTop) || scrollTop <= 0) {
    return false;
  }
  const height = Number(state.markHeight);
  if (Number.isFinite(height) && height <= 0) {
    return false;
  }
  const barHeight = Number(state.barHeight);
  const coveredAt = Number.isFinite(barHeight) && barHeight >= 0 ? barHeight : DEFAULT_BAR_HEIGHT;
  return bottom <= coveredAt;
}

/**
 * Keeps a bar's visibility in step with its mark.
 *
 * @param {{
 *   resolveBar?: () => Element | null,
 *   resolveMark?: () => Element | null,
 *   barHeight?: number,
 *   getScrollTop?: () => number
 * }} options
 * @returns {{ refresh: () => void, cleanup: () => void }}
 */
export function bindCompactHeader({
  resolveBar,
  resolveMark,
  barHeight = DEFAULT_BAR_HEIGHT,
  getScrollTop = () => 0
} = {}) {
  if (typeof resolveBar !== "function" || typeof resolveMark !== "function") {
    return { refresh: () => {}, cleanup: () => {} };
  }

  let frame = 0;

  const setState = (bar, visible) => {
    const next = visible ? "true" : "false";
    if (bar.dataset.visible !== next) {
      bar.dataset.visible = next;
    }
    const hidden = visible ? "false" : "true";
    if (bar.getAttribute("aria-hidden") !== hidden) {
      bar.setAttribute("aria-hidden", hidden);
    }
  };

  const apply = () => {
    const bar = resolveBar();
    if (!bar) {
      return;
    }
    const mark = resolveMark();
    const rect = mark?.getBoundingClientRect?.();
    // The bar's own height is what has to be cleared, and on a notched phone it
    // is taller than the nominal height because it carries the safe area.
    const measuredBarHeight = Number(bar.getBoundingClientRect?.().height);
    const visible = compactHeaderVisibleFromGeometry({
      markBottom: rect?.bottom,
      markHeight: rect?.height,
      barHeight:
        Number.isFinite(measuredBarHeight) && measuredBarHeight > 0 ? measuredBarHeight : barHeight,
      scrollTop: getScrollTop()
    });
    setState(bar, visible);
  };

  const run = () => {
    frame = 0;
    apply();
  };

  const request = () => {
    if (frame) {
      return;
    }
    const id = globalThis.requestAnimationFrame?.(run);
    if (id) {
      frame = id;
      return;
    }
    run();
  };

  apply();
  globalThis.document?.addEventListener?.("scroll", request, { capture: true, passive: true });
  globalThis.addEventListener?.("resize", request, { passive: true });

  return {
    refresh: request,
    cleanup: () => {
      globalThis.document?.removeEventListener?.("scroll", request, true);
      globalThis.removeEventListener?.("resize", request);
      if (frame) {
        globalThis.cancelAnimationFrame?.(frame);
        frame = 0;
      }
    }
  };
}

/**
 * The other half of the same idea: a heading that is already on the page and
 * shrinks in place once the page has moved.
 *
 * Settings, Collection and Cast each grew their own copy of this; the list
 * pages use it too, so the behaviour is one function rather than four. The
 * heading is marked `data-collapsed`, and the stylesheet decides what that
 * looks like.
 *
 * @param {{
 *   resolveHeader?: () => Element | null,
 *   getScrollTop?: () => number,
 *   collapseAt?: number,
 *   expandAt?: number
 * }} options
 * @returns {{ refresh: () => void, cleanup: () => void }}
 */
export function bindCollapsingHeader({
  resolveHeader,
  getScrollTop = () => 0,
  collapseAt = 28,
  // Open only at the very top. Above this the bar is still pinned to the edge,
  // so opening it there would grow it in place while it is stuck -- which reads
  // as the title glitching as the page comes back to the top.
  expandAt = 2
} = {}) {
  if (typeof resolveHeader !== "function") {
    return { refresh: () => {}, cleanup: () => {} };
  }

  let frame = 0;

  const apply = () => {
    const header = resolveHeader();
    if (!header) {
      return;
    }
    const scrollTop = Number(getScrollTop());
    const position = Number.isFinite(scrollTop) ? scrollTop : 0;
    const wasCollapsed = header.dataset.collapsed === "true";
    // Where the heading actually is decides, not a scroll distance: a page with
    // a tall top margin keeps its heading far from the edge for a while, and a
    // distance rule shrank it out in the open. The heading is at the edge only
    // when its top is at zero.
    const top = Number(header.getBoundingClientRect?.().top);
    const hasTop = Number.isFinite(top);
    // Hysteresis around that edge, so a scroll that comes to rest on it cannot
    // flicker the title between its two sizes.
    const collapsed = hasTop
      ? wasCollapsed
        ? top < 4 && position > 0
        : top <= 1 && position > 0
      : position >= (wasCollapsed ? expandAt : collapseAt);
    const next = collapsed ? "true" : "false";
    if (header.dataset.collapsed !== next) {
      header.dataset.collapsed = next;
    }
  };

  const run = () => {
    frame = 0;
    apply();
  };

  const request = () => {
    if (frame) {
      return;
    }
    const id = globalThis.requestAnimationFrame?.(run);
    if (id) {
      frame = id;
      return;
    }
    run();
  };

  apply();
  globalThis.document?.addEventListener?.("scroll", request, { capture: true, passive: true });
  globalThis.addEventListener?.("resize", request, { passive: true });

  return {
    refresh: request,
    cleanup: () => {
      globalThis.document?.removeEventListener?.("scroll", request, true);
      globalThis.removeEventListener?.("resize", request);
      if (frame) {
        globalThis.cancelAnimationFrame?.(frame);
        frame = 0;
      }
    }
  };
}
