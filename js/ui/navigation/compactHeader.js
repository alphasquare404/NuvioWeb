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
    const visible = compactHeaderVisibleFromGeometry({
      markBottom: rect?.bottom,
      markHeight: rect?.height,
      barHeight,
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
