import { resolveHeadingProgress } from "./scrollHeadingProgress.js";

export const PAGE_HEADING_PROGRESS_RANGE = 96;

export function resolvePageHeadingProgress(scrollTop) {
  return resolveHeadingProgress(scrollTop, PAGE_HEADING_PROGRESS_RANGE);
}

/**
 * Publish the heading progress on the screen container, not on the heading
 * itself: the container survives the screen's re-renders, while the heading
 * markup is replaced with every render. CSS reads --page-heading-progress.
 */
export function bindPageHeadingCollapse({
  container,
  target = container,
  scrollSelector = ""
} = {}) {
  if (!container || !target) {
    return () => {};
  }

  const root = globalThis?.document?.documentElement;
  let frame = 0;
  let observer = null;
  const getScrollOwner = () =>
    scrollSelector && typeof container.querySelector === "function"
      ? container.querySelector(scrollSelector)
      : null;

  const isScrollable = (element) => {
    if (!element || element.scrollHeight <= element.clientHeight + 1) {
      return false;
    }
    const overflow = String(globalThis.getComputedStyle?.(element)?.overflowY || "");
    return overflow === "auto" || overflow === "scroll" || overflow === "overlay";
  };

  const readScrollTop = () => {
    const scrollOwner = getScrollOwner();
    if (isScrollable(scrollOwner)) {
      return Number(scrollOwner.scrollTop || 0);
    }
    if (isScrollable(container)) {
      return Number(container.scrollTop || 0);
    }
    const document = globalThis.document;
    return Number(document?.scrollingElement?.scrollTop ?? globalThis.scrollY ?? 0);
  };

  const apply = () => {
    frame = 0;
    if (typeof target?.style?.setProperty !== "function") {
      return;
    }
    const layout = String(root?.dataset?.layout || "");
    const wideLayout = layout
      ? layout === "desktop"
      : typeof globalThis.matchMedia === "function" &&
        globalThis.matchMedia("(min-width: 601px)").matches;
    if (wideLayout) {
      target.style.setProperty("--page-heading-progress", "0");
      target.removeAttribute?.("data-page-heading-collapsed");
      return;
    }
    const progress = resolvePageHeadingProgress(readScrollTop());
    target.style.setProperty("--page-heading-progress", progress.toFixed(4));
    if (target.dataset) {
      const collapsed = progress >= 0.999 ? "true" : "false";
      if (target.dataset.pageHeadingCollapsed !== collapsed) {
        target.dataset.pageHeadingCollapsed = collapsed;
      }
    }
  };

  const schedule = () => {
    if (frame) {
      return;
    }
    const request = globalThis.requestAnimationFrame?.(apply);
    if (request) {
      frame = request;
      return;
    }
    apply();
  };

  const onScroll = () => schedule();
  globalThis.document?.addEventListener?.("scroll", onScroll, {
    capture: true,
    passive: true
  });
  globalThis.addEventListener?.("resize", schedule, { passive: true });
  globalThis.addEventListener?.("orientationchange", schedule, { passive: true });

  // A new heading is written with every render; the state still belongs to the
  // container, so the replacement only needs a fresh frame to pick it up.
  if (typeof globalThis.MutationObserver === "function" && typeof container.nodeType === "number") {
    observer = new globalThis.MutationObserver(schedule);
    observer.observe(container, { childList: true, subtree: true });
  }

  schedule();

  return () => {
    globalThis.document?.removeEventListener?.("scroll", onScroll, true);
    globalThis.removeEventListener?.("resize", schedule);
    globalThis.removeEventListener?.("orientationchange", schedule);
    observer?.disconnect();
    if (frame) {
      globalThis.cancelAnimationFrame?.(frame);
      frame = 0;
    }
  };
}
