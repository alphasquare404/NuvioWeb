const PULL_THRESHOLD_PX = 84;
const PULL_RESISTANCE = 0.5;
const INTENT_SLOP_PX = 8;

export const BrowserPullToRefresh = {
  threshold: PULL_THRESHOLD_PX,
  resistance: PULL_RESISTANCE,

  getScrollOwner(documentRef = document) {
    const candidates = [
      documentRef?.scrollingElement,
      documentRef?.body,
      documentRef?.documentElement
    ].filter((node, index, nodes) => node && nodes.indexOf(node) === index);
    return (
      candidates.find((node) => Number(node.scrollTop || 0) > 0) ||
      candidates.find((node) => Number(node.scrollHeight || 0) > Number(node.clientHeight || 0)) ||
      candidates[0] ||
      null
    );
  },

  getIntent({ deltaX = 0, deltaY = 0, slop = INTENT_SLOP_PX } = {}) {
    const horizontal = Math.abs(deltaX);
    const vertical = Math.abs(deltaY);
    if (horizontal < slop && vertical < slop) return "pending";
    if (deltaY > 0 && vertical > horizontal) return "pull";
    return "cancel";
  },

  getVisualDistance(rawDistance = 0) {
    return Math.max(0, Number(rawDistance || 0)) * PULL_RESISTANCE;
  },

  isReady(rawDistance = 0) {
    return Number(rawDistance || 0) >= PULL_THRESHOLD_PX;
  }
};

function isInteractiveStart(target) {
  return Boolean(
    target?.closest?.(
      "input, textarea, select, option, video, audio, button, [role='dialog'], [role='menu'], [role='slider'], [data-pull-to-refresh-exclude], .desktop-trailer-modal, .poster-options-menu"
    )
  );
}

function hasOpenOverlay(documentRef) {
  return Boolean(
    documentRef?.querySelector?.(
      "dialog[open], .desktop-trailer-modal, .poster-options-menu, .library-dialog, .detail-hold-dialog, .desktop-library-destination-menu"
    )
  );
}

function createIndicator(documentRef) {
  const indicator = documentRef.createElement("div");
  indicator.className = "browser-pull-to-refresh";
  indicator.setAttribute("aria-live", "polite");
  indicator.setAttribute("aria-atomic", "true");
  indicator.innerHTML = '<span class="browser-pull-to-refresh-icon" aria-hidden="true">↓</span><span class="browser-pull-to-refresh-label">Pull to refresh</span>';
  documentRef.body.append(indicator);
  return indicator;
}

export function bindBrowserPullToRefresh({ documentRef = document, windowRef = window, onRefresh } = {}) {
  if (
    !documentRef?.addEventListener ||
    !windowRef?.addEventListener ||
    typeof onRefresh !== "function" ||
    !windowRef.matchMedia?.("(pointer: coarse)")?.matches
  ) {
    return () => {};
  }

  const indicator = createIndicator(documentRef);
  let gesture = null;
  let refreshing = false;
  let visualRaf = null;
  let pendingVisual = null;

  const render = (state = "idle", rawDistance = 0) => {
    pendingVisual = { state, rawDistance };
    if (visualRaf) return;
    visualRaf = windowRef.requestAnimationFrame(() => {
      visualRaf = null;
      const next = pendingVisual || { state: "idle", rawDistance: 0 };
      const distance = BrowserPullToRefresh.getVisualDistance(next.rawDistance);
      const ready = next.state === "ready";
      const active = next.state === "pulling" || ready || next.state === "refreshing";
      indicator.classList.toggle("is-visible", active);
      indicator.classList.toggle("is-ready", ready);
      indicator.classList.toggle("is-refreshing", next.state === "refreshing");
      indicator.style.setProperty("--pull-distance", `${Math.min(distance, 72)}px`);
      const icon = indicator.querySelector(".browser-pull-to-refresh-icon");
      const label = indicator.querySelector(".browser-pull-to-refresh-label");
      if (icon) icon.textContent = next.state === "refreshing" ? "↻" : ready ? "↑" : "↓";
      if (label) label.textContent = next.state === "refreshing" ? "Refreshing…" : ready ? "Release to refresh" : "Pull to refresh";
    });
  };

  const reset = () => {
    gesture = null;
    if (!refreshing) render();
  };

  const cancel = () => reset();

  const start = (event) => {
    if (refreshing || event.touches?.length !== 1 || hasOpenOverlay(documentRef) || isInteractiveStart(event.target)) {
      return;
    }
    const owner = BrowserPullToRefresh.getScrollOwner(documentRef);
    if (!owner || Number(owner.scrollTop || 0) > 0) return;
    const touch = event.touches[0];
    gesture = { owner, startX: touch.clientX, startY: touch.clientY, intent: "pending", rawDistance: 0 };
  };

  const move = (event) => {
    if (!gesture || refreshing) return;
    if (event.touches?.length !== 1 || Number(gesture.owner?.scrollTop || 0) > 0) {
      cancel();
      return;
    }
    const touch = event.touches[0];
    const deltaX = touch.clientX - gesture.startX;
    const deltaY = touch.clientY - gesture.startY;
    const intent = BrowserPullToRefresh.getIntent({ deltaX, deltaY });
    if (intent === "cancel") {
      cancel();
      return;
    }
    if (intent === "pending") return;
    gesture.intent = "pull";
    gesture.rawDistance = deltaY;
    event.preventDefault();
    render(BrowserPullToRefresh.isReady(deltaY) ? "ready" : "pulling", deltaY);
  };

  const end = async () => {
    const shouldRefresh = Boolean(gesture?.intent === "pull" && BrowserPullToRefresh.isReady(gesture.rawDistance));
    gesture = null;
    if (!shouldRefresh || refreshing) {
      render();
      return;
    }
    refreshing = true;
    render("refreshing", PULL_THRESHOLD_PX);
    try {
      await onRefresh();
    } catch (error) {
      console.warn("Pull to refresh failed", error);
    } finally {
      refreshing = false;
      render();
    }
  };

  documentRef.addEventListener("touchstart", start, { passive: true });
  documentRef.addEventListener("touchmove", move, { passive: false });
  documentRef.addEventListener("touchend", end, { passive: true });
  documentRef.addEventListener("touchcancel", cancel, { passive: true });
  windowRef.addEventListener("orientationchange", cancel);
  windowRef.addEventListener("pagehide", cancel);

  return () => {
    documentRef.removeEventListener("touchstart", start);
    documentRef.removeEventListener("touchmove", move);
    documentRef.removeEventListener("touchend", end);
    documentRef.removeEventListener("touchcancel", cancel);
    windowRef.removeEventListener("orientationchange", cancel);
    windowRef.removeEventListener("pagehide", cancel);
    if (visualRaf) windowRef.cancelAnimationFrame(visualRaf);
    indicator.remove();
    gesture = null;
  };
}
