const DRAG_THRESHOLD_PX = 6;
const CLICK_SUPPRESSION_MS = 350;

/**
 * Mouse drag-to-scroll for horizontal rails that rely on native overflow.
 *
 * Touch is deliberately left alone: these rails keep native panning on
 * phones and tablets. The pointer listeners are delegated from the screen
 * container, so rails that are re-rendered do not need to be re-bound.
 */
export function bindHorizontalRailDragScroll({
  container,
  trackSelector,
  draggingClass = "horizontal-rail-drag-active"
} = {}) {
  if (!(container instanceof HTMLElement) || !trackSelector) {
    return () => {};
  }

  let state = null;
  let suppression = null;

  const rowTrack = (node) => (node instanceof Element ? node.closest(trackSelector) : null);

  const clearState = ({ suppressClick = false } = {}) => {
    if (!state) return;
    const current = state;
    state = null;
    current.track.classList.remove(draggingClass);
    if (suppressClick && current.dragging) {
      suppression = {
        track: current.track,
        until: Date.now() + CLICK_SUPPRESSION_MS
      };
    }
    if (current.track.hasPointerCapture?.(current.pointerId)) {
      current.track.releasePointerCapture?.(current.pointerId);
    }
  };

  const onClickCapture = (event) => {
    if (!suppression) return;
    if (Date.now() > suppression.until) {
      suppression = null;
      return;
    }
    const target = event.target;
    if (!(target instanceof Node) || !suppression.track.contains(target)) {
      return;
    }
    event.preventDefault?.();
    event.stopImmediatePropagation?.();
    suppression = null;
  };

  const onPointerDown = (event) => {
    if (event.pointerType !== "mouse" || event.button !== 0) {
      return;
    }
    const track = rowTrack(event.target);
    if (!track || !container.contains(track) || track.scrollWidth <= track.clientWidth) {
      return;
    }
    suppression = null;
    clearState();
    state = {
      track,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startScrollLeft: track.scrollLeft,
      dragging: false
    };
  };

  const onPointerMove = (event) => {
    if (!state || state.pointerId !== event.pointerId) {
      return;
    }
    const distance = event.clientX - state.startX;
    const verticalDistance = event.clientY - state.startY;
    if (
      !state.dragging &&
      (Math.abs(distance) < DRAG_THRESHOLD_PX || Math.abs(distance) <= Math.abs(verticalDistance))
    ) {
      return;
    }
    if (!state.dragging) {
      state.dragging = true;
      state.track.setPointerCapture?.(event.pointerId);
    }
    state.track.classList.add(draggingClass);
    state.track.scrollLeft = state.startScrollLeft - distance;
    event.preventDefault?.();
  };

  const onPointerUp = (event) => {
    if (!state || state.pointerId !== event.pointerId) {
      return;
    }
    clearState({ suppressClick: state.dragging });
  };

  const onPointerCancel = (event) => {
    if (!state || state.pointerId !== event.pointerId) {
      return;
    }
    clearState();
  };

  const onDragStart = (event) => {
    if (rowTrack(event.target) && event.target instanceof HTMLImageElement) {
      event.preventDefault();
    }
  };

  container.addEventListener("click", onClickCapture, true);
  container.addEventListener("pointerdown", onPointerDown);
  container.addEventListener("pointermove", onPointerMove);
  container.addEventListener("pointerup", onPointerUp);
  container.addEventListener("pointercancel", onPointerCancel);
  container.addEventListener("lostpointercapture", onPointerCancel);
  container.addEventListener("dragstart", onDragStart);

  return () => {
    clearState();
    container.removeEventListener("click", onClickCapture, true);
    container.removeEventListener("pointerdown", onPointerDown);
    container.removeEventListener("pointermove", onPointerMove);
    container.removeEventListener("pointerup", onPointerUp);
    container.removeEventListener("pointercancel", onPointerCancel);
    container.removeEventListener("lostpointercapture", onPointerCancel);
    container.removeEventListener("dragstart", onDragStart);
  };
}
