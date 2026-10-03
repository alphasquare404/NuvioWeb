// Focus rings are for people navigating by keyboard. A mouse click and a tap
// both move focus too, and the ring that follows is noise: the person already
// knows what they just pressed.
//
// The app marks focus with a `focused` class of its own rather than relying on
// `:focus-visible`, so the browser's own heuristic never gets a say. This puts
// the modality on the document instead, and the stylesheet reads it.

const KEYBOARD_CLASS = "nuvio-keyboard-nav";

// Keys that move focus. Typing into a field is not navigation, and neither is
// a modifier on its own.
const NAVIGATION_KEYS = new Set([
  "Tab",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Home",
  "End",
  "PageUp",
  "PageDown"
]);

export function installBrowserFocusModality() {
  const root = globalThis.document?.documentElement;
  if (!root || typeof globalThis.addEventListener !== "function") {
    return;
  }

  const show = () => root.classList.add(KEYBOARD_CLASS);
  const hide = () => root.classList.remove(KEYBOARD_CLASS);

  globalThis.addEventListener(
    "keydown",
    (event) => {
      if (NAVIGATION_KEYS.has(event.key)) show();
    },
    true
  );
  // Pointer and touch both mean the ring is not wanted; `pointerdown` covers
  // pen and touch on browsers that send it, and `touchstart` covers the rest.
  globalThis.addEventListener("pointerdown", hide, true);
  globalThis.addEventListener("touchstart", hide, true);
  globalThis.addEventListener("mousedown", hide, true);
}

export const KEYBOARD_NAV_CLASS = KEYBOARD_CLASS;
