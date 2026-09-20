// Desktop right-click invocation for media context actions.
//
// The native browser menu is suppressed only when the event actually lands on
// an actionable Nuvio target. Right-clicking anywhere else -- page background,
// text, an image, a link -- keeps the browser's own menu, so copy/inspect/open
// in new tab all still work. Nothing is disabled globally.
//
// Touch is deliberately excluded: a long press on mobile also emits
// `contextmenu`, and the action sheet is already driven by the touch intent
// binder. Handling both would open two menus for one gesture.

export function isFinePointerEnvironment() {
  return Boolean(globalThis.matchMedia?.("(pointer: fine)")?.matches);
}

/**
 * The actionable node for a context event, or null to let the browser handle it.
 */
export function resolveContextMenuTarget(eventTarget, { container, cardSelector } = {}) {
  if (!cardSelector || !container) return null;
  const node = eventTarget instanceof Element ? eventTarget.closest(cardSelector) : null;
  if (!(node instanceof HTMLElement)) return null;
  return container.contains(node) ? node : null;
}

export function bindMediaContextMenu(
  container,
  { cardSelector, onInvoke, isEnabled = isFinePointerEnvironment } = {}
) {
  if (!(container instanceof HTMLElement) || !cardSelector || typeof onInvoke !== "function") {
    return () => {};
  }

  const onContextMenu = (event) => {
    if (!isEnabled()) return;
    const node = resolveContextMenuTarget(event.target, { container, cardSelector });
    if (!node) return;
    event.preventDefault();
    event.stopPropagation();
    onInvoke(node, { x: event.clientX, y: event.clientY });
  };

  container.addEventListener("contextmenu", onContextMenu);
  return () => container.removeEventListener("contextmenu", onContextMenu);
}
