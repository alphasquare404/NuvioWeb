const HORIZONTAL_INTENT_THRESHOLD_PX = 8;
const CLICK_SUPPRESSION_WINDOW_MS = 700;

function findChangedTouch(event, identifier) {
  return Array.from(event?.changedTouches || []).find((touch) => touch.identifier === identifier) || null;
}

// Browser tab activation is delegated by each screen. Native touch scrolling can
// still synthesize a click at the end of a horizontal swipe, so keep the gesture
// native and suppress only that matching follow-up click.
export function bindBrowserHorizontalTabScroll(container, tabRows = []) {
  if (!(container instanceof HTMLElement) || !Array.isArray(tabRows) || !tabRows.length) {
    return () => {};
  }

  let activeTouch = null;
  let suppressedRow = null;
  let suppressionTimer = null;

  const clearSuppression = () => {
    suppressedRow = null;
    if (suppressionTimer) clearTimeout(suppressionTimer);
    suppressionTimer = null;
  };

  const suppressClickFor = (row) => {
    suppressedRow = row;
    if (suppressionTimer) clearTimeout(suppressionTimer);
    suppressionTimer = setTimeout(clearSuppression, CLICK_SUPPRESSION_WINDOW_MS);
  };

  const findRow = (target) => {
    if (!(target instanceof Element)) return null;
    for (const config of tabRows) {
      const row = target.closest(config.rowSelector);
      if (!(row instanceof HTMLElement) || !container.contains(row)) continue;
      const tab = target.closest(config.tabSelector);
      if (tab instanceof HTMLElement && row.contains(tab)) {
        return row;
      }
    }
    return null;
  };

  const clearActiveTouch = ({ suppress = false } = {}) => {
    if (!activeTouch) return;
    const current = activeTouch;
    activeTouch = null;
    current.row.removeEventListener("scroll", current.onScroll);
    if (suppress && (current.horizontalIntent || current.didScroll)) {
      suppressClickFor(current.row);
    }
  };

  const onTouchStart = (event) => {
    clearActiveTouch();
    clearSuppression();
    const touch = event.touches?.[0];
    const row = findRow(event.target);
    if (!touch || !row) return;
    const state = {
      row,
      identifier: touch.identifier,
      startX: touch.clientX,
      startY: touch.clientY,
      startScrollLeft: row.scrollLeft,
      horizontalIntent: false,
      didScroll: false,
      onScroll: null
    };
    state.onScroll = () => {
      if (Math.abs(row.scrollLeft - state.startScrollLeft) > 1) {
        state.didScroll = true;
      }
    };
    row.addEventListener("scroll", state.onScroll, { passive: true });
    activeTouch = state;
  };

  const onTouchMove = (event) => {
    if (!activeTouch) return;
    const touch = findChangedTouch(event, activeTouch.identifier);
    if (!touch) return;
    const deltaX = touch.clientX - activeTouch.startX;
    const deltaY = touch.clientY - activeTouch.startY;
    if (
      Math.abs(deltaX) >= HORIZONTAL_INTENT_THRESHOLD_PX &&
      Math.abs(deltaX) > Math.abs(deltaY)
    ) {
      activeTouch.horizontalIntent = true;
    }
  };

  const onTouchEnd = (event) => {
    if (!activeTouch || !findChangedTouch(event, activeTouch.identifier)) return;
    clearActiveTouch({ suppress: true });
  };

  const onTouchCancel = (event) => {
    if (!activeTouch || !findChangedTouch(event, activeTouch.identifier)) return;
    clearActiveTouch({ suppress: true });
  };

  const onClick = (event) => {
    const row = findRow(event.target);
    if (!row || row !== suppressedRow) return;
    clearSuppression();
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation?.();
  };

  container.addEventListener("touchstart", onTouchStart, { capture: true, passive: true });
  container.addEventListener("touchmove", onTouchMove, { capture: true, passive: true });
  container.addEventListener("touchend", onTouchEnd, true);
  container.addEventListener("touchcancel", onTouchCancel, true);
  container.addEventListener("click", onClick, true);

  return () => {
    container.removeEventListener("touchstart", onTouchStart, true);
    container.removeEventListener("touchmove", onTouchMove, true);
    container.removeEventListener("touchend", onTouchEnd, true);
    container.removeEventListener("touchcancel", onTouchCancel, true);
    container.removeEventListener("click", onClick, true);
    clearActiveTouch();
    clearSuppression();
  };
}
