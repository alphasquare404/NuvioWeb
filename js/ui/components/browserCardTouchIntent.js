export const CARD_TOUCH_LONG_PRESS_MS = 550;
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
export function bindBrowserCardTouchIntent(container, { cardSelector } = {}) {
  if (!(container instanceof HTMLElement) || !cardSelector) return () => {};

  let active = null;
  let suppressionTimer = null;
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

  const findCard = (target) => {
    const node = target instanceof Element ? target.closest(cardSelector) : null;
    return node instanceof HTMLElement && container.contains(node) ? node : null;
  };

  const onPointerDown = (event) => {
    if (!shouldTrackCardTouchPointer(event.pointerType)) return;
    clearSuppression();
    const card = findCard(event.target);
    if (!card) return;
    active = { card, pointerId: event.pointerId, startedAt: getNow() };
  };

  const finish = (event) => {
    if (!active || active.pointerId !== event.pointerId) return;
    const current = active;
    active = null;
    if (classifyCardTouchIntent({ durationMs: getNow() - current.startedAt }) === "longpress") {
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
  container.addEventListener("pointerup", finish, true);
  container.addEventListener("pointercancel", finish, true);
  container.addEventListener("click", onClick, true);

  return () => {
    container.removeEventListener("pointerdown", onPointerDown, true);
    container.removeEventListener("pointerup", finish, true);
    container.removeEventListener("pointercancel", finish, true);
    container.removeEventListener("click", onClick, true);
    active = null;
    clearSuppression();
  };
}
