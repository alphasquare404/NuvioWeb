/**
 * Whether re-applying the focus should also bring the focused card into view.
 *
 * The stream list re-renders whenever anything it shows changes, and while a
 * download runs that is a few times a second. Every one of those renders ends
 * by applying the focus again, and revealing the focused card on each of them
 * drags the list back out from under whoever is reading it -- scrolling away
 * only buys them until the next byte arrives.
 *
 * The reveal belongs to the focus moving, so it happens when the focus moves.
 * The descriptor is what says whether it did: the same row and the same action
 * is the same place, however many times the markup around it was rebuilt.
 */
export function streamFocusRevealKey(focusState = null) {
  if (!focusState) return "";
  if (focusState.zone === "card") {
    return `card:${Number(focusState.row || 0)}:${String(focusState.action || "play")}`;
  }
  return `filter:${Number(focusState.index || 0)}`;
}

export function shouldRevealFocusedStreamItem(appliedKey, nextKey) {
  // Nothing applied yet is the first paint of the screen, where the remembered
  // row does have to be brought into view.
  if (!appliedKey) return true;
  return appliedKey !== nextKey;
}
