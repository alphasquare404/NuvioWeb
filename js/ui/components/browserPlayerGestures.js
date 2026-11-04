export const PLAYER_GESTURE_DOUBLE_ACTIVATION_MS = 320;
export const PLAYER_GESTURE_SPATIAL_TOLERANCE_PX = 32;
export const PLAYER_GESTURE_HOLD_MS = 550;
export const PLAYER_GESTURE_HOLD_MOVE_TOLERANCE_PX = 12;

export function getBrowserPlayerGestureZone(rect, clientX) {
  const width = Number(rect?.width || 0);
  if (!Number.isFinite(width) || width <= 0) return "center";
  const left = Number(rect?.left || 0);
  const ratio = Math.max(0, Math.min(1, (Number(clientX || 0) - left) / width));
  if (ratio < 0.25) return "left";
  if (ratio >= 0.75) return "right";
  return "center";
}

export function isBrowserPlayerGesturePointer(event) {
  const pointerType = String(event?.pointerType || "");
  if (pointerType === "mouse") return Number(event?.button || 0) === 0;
  return pointerType === "touch" || pointerType === "pen";
}

export function isWithinGestureTolerance(
  start,
  end,
  tolerance = PLAYER_GESTURE_SPATIAL_TOLERANCE_PX
) {
  return (
    Math.hypot(
      Number(end?.x || 0) - Number(start?.x || 0),
      Number(end?.y || 0) - Number(start?.y || 0)
    ) <= tolerance
  );
}

export function getBrowserPlayerVideoTapAction(controlsVisible) {
  return controlsVisible ? "toggle-playback" : "reveal-controls";
}

export function bindBrowserPlayerGestures(
  surface,
  {
    isInteractiveTarget = () => false,
    onSeek = () => {},
    onHoldChange = () => {},
    onSwipeStart = () => false,
    onSwipeMove = () => {},
    onSwipeEnd = () => {},
    getSingleTapContext = () => null,
    onSingleTap = () => {},
    schedule = setTimeout,
    cancelScheduled = clearTimeout,
    getPoint = (event) => ({ x: Number(event?.clientX || 0), y: Number(event?.clientY || 0) }),
    getSurfaceRect = () => surface.getBoundingClientRect(),
    getNow = Date.now
  } = {}
) {
  if (!(surface instanceof HTMLElement)) return () => {};

  let active = null;
  let pendingTap = null;
  let suppressionTimer = null;
  let suppressNextClick = false;
  let ignoreDoubleClickUntil = 0;

  const clearClickSuppression = () => {
    suppressNextClick = false;
    if (suppressionTimer) cancelScheduled(suppressionTimer);
    suppressionTimer = null;
  };
  const suppressClick = () => {
    suppressNextClick = true;
    if (suppressionTimer) cancelScheduled(suppressionTimer);
    suppressionTimer = schedule(clearClickSuppression, 700);
  };
  const clearPendingTap = () => {
    if (pendingTap?.timer) cancelScheduled(pendingTap.timer);
    pendingTap = null;
  };
  const clearActive = ({ restoreHold = true } = {}) => {
    if (!active) return null;
    const current = active;
    active = null;
    if (current.holdActive && restoreHold) onHoldChange(false);
    return current;
  };
  const cancelActive = () => {
    const current = clearActive();
    if (current?.holdTimer) cancelScheduled(current.holdTimer);
    if (current?.swiping) onSwipeEnd({ cancelled: true });
    clearPendingTap();
  };
  const targetIsValid = (target, event) =>
    target instanceof Element && surface.contains(target) && !isInteractiveTarget(target, event);
  const pointFor = getPoint;

  const onPointerDown = (event) => {
    if (!isBrowserPlayerGesturePointer(event)) return;
    if (active) {
      // A second touch is a system multi-touch gesture, not a player gesture.
      cancelActive();
      return;
    }
    if (event.isPrimary === false || !targetIsValid(event.target, event)) return;
    const point = pointFor(event);
    const current = {
      pointerId: event.pointerId,
      pointerType: String(event.pointerType || ""),
      point,
      zone: getBrowserPlayerGestureZone(getSurfaceRect(), point.x),
      moved: false,
      swiping: false,
      axis: null,
      width: getSurfaceRect().width,
      holdActive: false,
      holdTimer: null,
      singleTapContext: getSingleTapContext()
    };
    current.holdTimer = schedule(() => {
      if (active !== current || current.moved) return;
      current.holdActive = true;
      clearPendingTap();
      onHoldChange(true);
    }, PLAYER_GESTURE_HOLD_MS);
    active = current;
    try {
      surface.setPointerCapture?.(event.pointerId);
    } catch (_) {
      // Pointer capture is best effort; lifecycle cleanup remains registered.
    }
  };

  const onPointerMove = (event) => {
    if (!active || active.pointerId !== event.pointerId || active.holdActive) return;
    const point = pointFor(event);
    const deltaX = point.x - active.point.x;
    const deltaY = point.y - active.point.y;
    if (!active.axis && Math.hypot(deltaX, deltaY) > PLAYER_GESTURE_HOLD_MOVE_TOLERANCE_PX) {
      active.moved = true;
      clearPendingTap();
      cancelScheduled(active.holdTimer);
      active.holdTimer = null;
      active.axis = Math.abs(deltaX) > Math.abs(deltaY) * 1.2 ? "horizontal" : "vertical";
      if (active.axis === "horizontal" && active.pointerType !== "mouse") {
        clearPendingTap();
        active.swiping = onSwipeStart() !== false;
      }
    }
    if (active.swiping) {
      event.preventDefault();
      onSwipeMove({ deltaX, width: active.width });
    }
  };

  const finishPointer = (event, { cancelled = false } = {}) => {
    if (!active || active.pointerId !== event.pointerId) return;
    const current = clearActive();
    cancelScheduled(current.holdTimer);
    try {
      surface.releasePointerCapture?.(event.pointerId);
    } catch (_) {
      // Capture may already have ended in the browser.
    }
    if (current.swiping) {
      suppressClick();
      ignoreDoubleClickUntil = getNow() + 700;
      onSwipeEnd({ cancelled });
      return;
    }
    if (current.holdActive) {
      suppressClick();
      return;
    }
    if (cancelled || current.moved) return;
    const now = getNow();
    const point = pointFor(event);
    const previous = pendingTap;
    if (
      previous &&
      now - previous.at <= PLAYER_GESTURE_DOUBLE_ACTIVATION_MS &&
      previous.zone === current.zone &&
      isWithinGestureTolerance(previous.point, point)
    ) {
      clearPendingTap();
      if (current.zone !== "center") {
        ignoreDoubleClickUntil = now + 700;
        suppressClick();
        onSeek(current.zone);
      }
      return;
    }
    if (previous) {
      clearPendingTap();
      onSingleTap(previous.context);
    }
    const nextPendingTap = {
      at: now,
      point,
      zone: current.zone,
      context: current.singleTapContext,
      timer: null
    };
    pendingTap = nextPendingTap;
    suppressClick();
    nextPendingTap.timer = schedule(() => {
      if (pendingTap !== nextPendingTap) return;
      pendingTap = null;
      onSingleTap(nextPendingTap.context);
    }, PLAYER_GESTURE_DOUBLE_ACTIVATION_MS);
  };

  const onDoubleClick = (event) => {
    if (
      getNow() < ignoreDoubleClickUntil ||
      event.button !== 0 ||
      !targetIsValid(event.target, event)
    )
      return;
    const zone = getBrowserPlayerGestureZone(getSurfaceRect(), pointFor(event).x);
    if (zone === "center") return;
    clearPendingTap();
    onSeek(zone);
    event.preventDefault();
    event.stopPropagation();
  };
  const onClick = (event) => {
    if (!suppressNextClick || !targetIsValid(event.target, event)) return;
    clearClickSuppression();
    event.preventDefault();
    event.stopImmediatePropagation?.();
    event.stopPropagation();
  };
  const onContextMenu = (event) => {
    const touchMenu =
      event.pointerType === "touch" ||
      event.pointerType === "pen" ||
      (!event.pointerType && window.matchMedia?.("(pointer: coarse)").matches);
    if (touchMenu && targetIsValid(event.target, event)) event.preventDefault();
  };
  const onWindowBlur = () => cancelActive();
  const onVisibilityChange = () => {
    if (document.hidden) cancelActive();
  };
  const onPointerCancel = (event) => finishPointer(event, { cancelled: true });
  const onLostPointerCapture = (event) => finishPointer(event, { cancelled: true });

  surface.addEventListener("pointerdown", onPointerDown, true);
  surface.addEventListener("pointermove", onPointerMove, true);
  surface.addEventListener("pointerup", finishPointer, true);
  surface.addEventListener("pointercancel", onPointerCancel, true);
  surface.addEventListener("lostpointercapture", onLostPointerCapture, true);
  surface.addEventListener("contextmenu", onContextMenu);
  surface.addEventListener("dblclick", onDoubleClick, true);
  surface.addEventListener("click", onClick, true);
  window.addEventListener("blur", onWindowBlur);
  document.addEventListener("visibilitychange", onVisibilityChange);

  return () => {
    cancelActive();
    clearClickSuppression();
    surface.removeEventListener("pointerdown", onPointerDown, true);
    surface.removeEventListener("pointermove", onPointerMove, true);
    surface.removeEventListener("pointerup", finishPointer, true);
    surface.removeEventListener("pointercancel", onPointerCancel, true);
    surface.removeEventListener("lostpointercapture", onLostPointerCapture, true);
    surface.removeEventListener("contextmenu", onContextMenu);
    surface.removeEventListener("dblclick", onDoubleClick, true);
    surface.removeEventListener("click", onClick, true);
    window.removeEventListener("blur", onWindowBlur);
    document.removeEventListener("visibilitychange", onVisibilityChange);
  };
}
