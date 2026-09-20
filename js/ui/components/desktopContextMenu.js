// Compact context menu for card actions on desktop.
//
// Shared by two invocations: right-click anchors it to the pointer, Hold Enter
// anchors it to the focused card. Deliberately not NuvioDialog -- that is a
// centered modal with a backdrop, which takes over the screen for what is a
// short list of actions on one card.
//
// Escape is claimed by the focus engine at document capture, which calls
// stopImmediatePropagation, so a document-level listener here would never run.
// Listening on window in the capture phase runs earlier in the propagation
// path, and is how NuvioDialog already handles the same problem.

const MENU_VIEWPORT_MARGIN_PX = 8;

/**
 * Preferred position for a menu anchored to a card rather than a pointer.
 *
 * Sits just under the card's leading edge so the card stays visually attached
 * to its own menu; clamping then keeps it on screen.
 */
export function anchorPositionForRect(rect = null, { gap = 6 } = {}) {
  if (!rect) return null;
  return { x: Number(rect.left || 0), y: Number(rect.bottom || 0) + gap };
}

/**
 * Keep the menu fully on screen.
 *
 * Flips rather than merely clamping when there is no room below or to the
 * right, so a menu opened near an edge does not end up covering the very card
 * it belongs to.
 */
export function clampContextMenuPosition({
  x = 0,
  y = 0,
  menuWidth = 0,
  menuHeight = 0,
  viewportWidth = 0,
  viewportHeight = 0,
  margin = MENU_VIEWPORT_MARGIN_PX
} = {}) {
  const maxLeft = Math.max(margin, viewportWidth - menuWidth - margin);
  const maxTop = Math.max(margin, viewportHeight - menuHeight - margin);
  let left = x;
  let top = y;
  if (left + menuWidth + margin > viewportWidth) {
    left = x - menuWidth;
  }
  if (top + menuHeight + margin > viewportHeight) {
    top = y - menuHeight;
  }
  return {
    left: Math.min(Math.max(margin, left), maxLeft),
    top: Math.min(Math.max(margin, top), maxTop)
  };
}

export function openDesktopContextMenu({
  x = 0,
  y = 0,
  anchorRect = null,
  items = [],
  onSelect = () => {},
  onDismiss = () => {},
  restoreFocusTo = null,
  suppressEnterUntilKeyUp = null
} = {}) {
  const actions = (Array.isArray(items) ? items : []).filter((item) => item && item.label);
  if (!actions.length) return null;

  // Anchored to a card means the keyboard opened it, so the first row takes
  // focus and the arrows work without an extra keypress.
  const keyboardInvoked = Boolean(anchorRect);
  // Hold Enter opens this while Enter is still down, and a held key repeats.
  // Without this the first repeat would select row one the instant the menu
  // appeared, so the menu looked like it never opened at all. NuvioDialog
  // solves the same problem the same way.
  let enterSuppressed =
    suppressEnterUntilKeyUp === null ? keyboardInvoked : Boolean(suppressEnterUntilKeyUp);
  let destroyed = false;
  let focusedIndex = -1;

  const menu = document.createElement("div");
  menu.className = "nuvio-context-menu";
  menu.setAttribute("role", "menu");
  menu.tabIndex = -1;

  const buttons = actions.map((action, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `nuvio-context-menu-item${action.danger ? " is-danger" : ""}`;
    button.setAttribute("role", "menuitem");

    const label = document.createElement("span");
    label.className = "nuvio-context-menu-label";
    label.textContent = action.label;
    button.append(label);

    if (action.icon) {
      const icon = document.createElement("span");
      icon.className = "material-icons nuvio-context-menu-icon";
      icon.setAttribute("aria-hidden", "true");
      icon.textContent = String(action.icon);
      button.append(icon);
    }

    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      select(index);
    });
    button.addEventListener("mouseenter", () => focusIndex(index, { scroll: false }));
    menu.append(button);
    return button;
  });

  function focusIndex(index, { scroll = true } = {}) {
    if (!buttons.length) return;
    const next = ((index % buttons.length) + buttons.length) % buttons.length;
    focusedIndex = next;
    buttons[next].focus({ preventScroll: !scroll });
  }

  function select(index) {
    const action = actions[index];
    if (!action) return;
    destroy();
    onSelect(action);
  }

  function destroy({ afterExit = null } = {}) {
    if (destroyed) {
      // Teardown is idempotent, but the caller's continuation is not part of
      // teardown. Selecting a row closes the menu before the action runs, and
      // that action (openContinueWatchingDetails) performs its navigation by
      // passing afterExit to a later close. Dropping it here is what left
      // "Go to details" closing the menu and staying on Home.
      if (typeof afterExit === "function") afterExit();
      return;
    }
    destroyed = true;
    window.removeEventListener("keydown", onKeyDown, true);
    window.removeEventListener("keyup", onKeyUp, true);
    window.removeEventListener("resize", onViewportChange, true);
    window.removeEventListener("scroll", onViewportChange, true);
    document.removeEventListener("pointerdown", onPointerDown, true);
    menu.remove();
    // A keyboard user must land back on the card they opened this from.
    if (restoreFocusTo?.isConnected) {
      restoreFocusTo.focus?.({ preventScroll: true });
    }
    // Callers hang navigation off this, so it must survive every close path.
    if (typeof afterExit === "function") afterExit();
  }

  function dismiss() {
    if (destroyed) return;
    destroy();
    onDismiss();
  }

  function onKeyDown(event) {
    if (destroyed) return;
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation?.();
      dismiss();
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      event.stopPropagation();
      focusIndex(focusedIndex + 1);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      event.stopPropagation();
      focusIndex(focusedIndex - 1);
      return;
    }
    if (event.key === "Enter") {
      if (enterSuppressed) {
        // Still the keypress that opened the menu.
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (focusedIndex >= 0) {
        event.preventDefault();
        event.stopPropagation();
        select(focusedIndex);
      }
    }
  }

  function onKeyUp() {
    enterSuppressed = false;
  }

  function onPointerDown(event) {
    if (destroyed || menu.contains(event.target)) return;
    dismiss();
  }

  function onViewportChange() {
    dismiss();
  }

  document.body.append(menu);
  const rect = menu.getBoundingClientRect();
  const anchored = anchorPositionForRect(anchorRect);
  const { left, top } = clampContextMenuPosition({
    x: anchored ? anchored.x : x,
    y: anchored ? anchored.y : y,
    menuWidth: rect.width,
    menuHeight: rect.height,
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight
  });
  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
  menu.classList.add("is-open");

  window.addEventListener("keydown", onKeyDown, true);
  window.addEventListener("keyup", onKeyUp, true);
  window.addEventListener("resize", onViewportChange, true);
  window.addEventListener("scroll", onViewportChange, true);
  document.addEventListener("pointerdown", onPointerDown, true);

  if (keyboardInvoked) {
    focusIndex(0, { scroll: false });
  } else {
    menu.focus({ preventScroll: true });
  }

  return { destroy, dismiss, element: menu };
}
