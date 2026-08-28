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

export function isWithinGestureTolerance(start, end, tolerance = PLAYER_GESTURE_SPATIAL_TOLERANCE_PX) {
  return Math.hypot(Number(end?.x || 0) - Number(start?.x || 0), Number(end?.y || 0) - Number(start?.y || 0)) <= tolerance;
}

export function bindBrowserPlayerGestures(surface, {
  isInteractiveTarget = () => false,
  onSeek = () => {},
  onHoldChange = () => {}
} = {}) {
  if (!(surface instanceof HTMLElement)) return () => {};

  let active = null;
  let pendingTouchTap = null;
  let suppressionTimer = null;
  let suppressNextClick = false;
  let ignoreDoubleClickUntil = 0;

  const clearClickSuppression = () => {
    suppressNextClick = false;
    if (suppressionTimer) clearTimeout(suppressionTimer);
    suppressionTimer = null;
  };
  const suppressClick = () => {
    suppressNextClick = true;
    if (suppressionTimer) clearTimeout(suppressionTimer);
    suppressionTimer = setTimeout(clearClickSuppression, 700);
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
    if (current?.holdTimer) clearTimeout(current.holdTimer);
    pendingTouchTap = null;
  };
  const targetIsValid = (target) => target instanceof Element && surface.contains(target) && !isInteractiveTarget(target);
  const pointFor = (event) => ({ x: Number(event?.clientX || 0), y: Number(event?.clientY || 0) });

  const onPointerDown = (event) => {
    if (!isBrowserPlayerGesturePointer(event) || !targetIsValid(event.target) || event.isPrimary === false) return;
    if (active) {
      // A second touch is a system multi-touch gesture, not a player gesture.
      cancelActive();
      return;
    }
    const point = pointFor(event);
    const current = {
      pointerId: event.pointerId,
      pointerType: String(event.pointerType || ""),
      point,
      zone: getBrowserPlayerGestureZone(surface.getBoundingClientRect(), point.x),
      moved: false,
      holdActive: false,
      holdTimer: null
    };
    current.holdTimer = setTimeout(() => {
      if (active !== current || current.moved) return;
      current.holdActive = true;
      pendingTouchTap = null;
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
    if (!isWithinGestureTolerance(active.point, pointFor(event), PLAYER_GESTURE_HOLD_MOVE_TOLERANCE_PX)) {
      active.moved = true;
      clearTimeout(active.holdTimer);
      active.holdTimer = null;
    }
  };

  const finishPointer = (event, { cancelled = false } = {}) => {
    if (!active || active.pointerId !== event.pointerId) return;
    const current = clearActive();
    clearTimeout(current.holdTimer);
    try {
      surface.releasePointerCapture?.(event.pointerId);
    } catch (_) {
      // Capture may already have ended in the browser.
    }
    if (current.holdActive) {
      suppressClick();
      return;
    }
    if (cancelled || current.moved || current.pointerType !== "touch") return;
    const now = Date.now();
    const point = pointFor(event);
    const previous = pendingTouchTap;
    pendingTouchTap = null;
    if (
      previous &&
      now - previous.at <= PLAYER_GESTURE_DOUBLE_ACTIVATION_MS &&
      previous.zone === current.zone &&
      isWithinGestureTolerance(previous.point, point)
    ) {
      if (current.zone !== "center") {
        ignoreDoubleClickUntil = now + 700;
        onSeek(current.zone);
      }
      return;
    }
    pendingTouchTap = { at: now, point, zone: current.zone };
  };

  const onDoubleClick = (event) => {
    if (Date.now() < ignoreDoubleClickUntil || event.button !== 0 || !targetIsValid(event.target)) return;
    const zone = getBrowserPlayerGestureZone(surface.getBoundingClientRect(), Number(event.clientX || 0));
    if (zone === "center") return;
    pendingTouchTap = null;
    onSeek(zone);
    event.preventDefault();
    event.stopPropagation();
  };
  const onClick = (event) => {
    if (!suppressNextClick || !targetIsValid(event.target)) return;
    clearClickSuppression();
    event.preventDefault();
    event.stopImmediatePropagation?.();
    event.stopPropagation();
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
    surface.removeEventListener("dblclick", onDoubleClick, true);
    surface.removeEventListener("click", onClick, true);
    window.removeEventListener("blur", onWindowBlur);
    document.removeEventListener("visibilitychange", onVisibilityChange);
  };
}
