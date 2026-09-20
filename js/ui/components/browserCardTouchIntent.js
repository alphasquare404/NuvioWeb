export const CARD_TOUCH_LONG_PRESS_MS = 550;
export const CARD_TOUCH_MOVE_TOLERANCE_PX = 10;
const CARD_TOUCH_SUPPRESSION_WINDOW_MS = 700;

function getNow() {
  return globalThis.performance?.now?.() ?? Date.now();
}

export function shouldTrackCardTouchPointer(pointerType) {
  return pointerType === "touch";
}

export function classifyCardTouchIntent({
  durationMs = 0,
  longPressMs = CARD_TOUCH_LONG_PRESS_MS
} = {}) {
  return (Number(durationMs) || 0) >= longPressMs ? "longpress" : "tap";
}

/**
 * Whether the finger has travelled far enough that this is a scroll, not a hold.
 *
 * Without this a slow drag down a shelf still counted as a long press once it
 * had lasted long enough, so scrolling would open the action sheet.
 */
export function exceedsCardTouchMoveTolerance({
  startX = 0,
  startY = 0,
  x = 0,
  y = 0,
  tolerancePx = CARD_TOUCH_MOVE_TOLERANCE_PX
} = {}) {
  const dx = Number(x) - Number(startX);
  const dy = Number(y) - Number(startY);
  return Math.hypot(dx, dy) > Number(tolerancePx);
}

export function createCardTouchClickSuppressor() {
  let card = null;
  return {
    suppress(nextCard) {
      card = nextCard || null;
    },
    consume(targetCard) {
      if (!card || card !== targetCard) return false;
      card = null;
      return true;
    },
    clear() {
      card = null;
    }
  };
}

// Browser cards are usually activated through delegated click handlers. A
// touch long-press can still synthesize that click on release, so suppress only
// the matching card's next click. Mouse and keyboard activation remain normal.
//
// `onLongPress` fires while the finger is still down, which is what makes a
// long press feel like one: the sheet appears under your thumb rather than
// after you let go. It fires at most once per press, never after a scroll, and
// the click it would otherwise synthesize is swallowed.
export function bindBrowserCardTouchIntent(
  container,
  {
    cardSelector,
    onLongPress = null,
    longPressMs = CARD_TOUCH_LONG_PRESS_MS,
    moveTolerancePx = CARD_TOUCH_MOVE_TOLERANCE_PX
  } = {}
) {
  if (!(container instanceof HTMLElement) || !cardSelector) return () => {};

  let active = null;
  let suppressionTimer = null;
  let longPressTimer = null;
  const suppressor = createCardTouchClickSuppressor();

  const clearSuppression = () => {
    suppressor.clear();
    if (suppressionTimer) clearTimeout(suppressionTimer);
    suppressionTimer = null;
  };

  const suppressCard = (card) => {
    suppressor.suppress(card);
    if (suppressionTimer) clearTimeout(suppressionTimer);
    suppressionTimer = setTimeout(clearSuppression, CARD_TOUCH_SUPPRESSION_WINDOW_MS);
  };

  const cancelLongPressTimer = () => {
    if (longPressTimer) clearTimeout(longPressTimer);
    longPressTimer = null;
  };

  const findCard = (target) => {
    const node = target instanceof Element ? target.closest(cardSelector) : null;
    return node instanceof HTMLElement && container.contains(node) ? node : null;
  };

  const onPointerDown = (event) => {
    if (!shouldTrackCardTouchPointer(event.pointerType)) return;
    clearSuppression();
    cancelLongPressTimer();
    const card = findCard(event.target);
    if (!card) return;
    active = {
      card,
      pointerId: event.pointerId,
      startedAt: getNow(),
      startX: event.clientX,
      startY: event.clientY,
      triggered: false
    };
    if (typeof onLongPress !== "function") return;
    longPressTimer = setTimeout(() => {
      longPressTimer = null;
      if (!active || active.card !== card || active.triggered) return;
      // A card the caller has no actions for is not a long-press target: it
      // must keep behaving like an ordinary tap, so only suppress the click
      // once the callback says it handled the press.
      if (onLongPress(card, event) === false) return;
      active.triggered = true;
      suppressCard(card);
    }, longPressMs);
  };

  const onPointerMove = (event) => {
    if (!active || active.pointerId !== event.pointerId || active.triggered) return;
    if (
      exceedsCardTouchMoveTolerance({
        startX: active.startX,
        startY: active.startY,
        x: event.clientX,
        y: event.clientY,
        tolerancePx: moveTolerancePx
      })
    ) {
      // Scrolling, not holding.
      cancelLongPressTimer();
      active = null;
    }
  };

  const finish = (event) => {
    if (!active || active.pointerId !== event.pointerId) return;
    const current = active;
    active = null;
    cancelLongPressTimer();
    if (current.triggered) return;
    if (
      classifyCardTouchIntent({ durationMs: getNow() - current.startedAt, longPressMs }) ===
      "longpress"
    ) {
      suppressCard(current.card);
    }
  };

  const onClick = (event) => {
    const card = findCard(event.target);
    if (!suppressor.consume(card)) return;
    if (suppressionTimer) clearTimeout(suppressionTimer);
    suppressionTimer = null;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation?.();
  };

  container.addEventListener("pointerdown", onPointerDown, true);
  container.addEventListener("pointermove", onPointerMove, true);
  container.addEventListener("pointerup", finish, true);
  container.addEventListener("pointercancel", finish, true);
  container.addEventListener("click", onClick, true);

  return () => {
    container.removeEventListener("pointerdown", onPointerDown, true);
    container.removeEventListener("pointermove", onPointerMove, true);
    container.removeEventListener("pointerup", finish, true);
    container.removeEventListener("pointercancel", finish, true);
    container.removeEventListener("click", onClick, true);
    active = null;
    cancelLongPressTimer();
    clearSuppression();
  };
}
