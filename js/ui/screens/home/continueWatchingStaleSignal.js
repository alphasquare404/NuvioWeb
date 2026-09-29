// Says "Continue Watching is out of date" to Home, including when Home is not
// there to hear it yet.
//
// The store subscriptions Home relies on are bound in its mount. Returning
// from an external player is the one moment that reliably happens too late:
// the callback navigates the PWA away, so coming back is a cold start, and the
// report is collected during bootstrap while Home is still mounting. The write
// was announced to an empty room, and the card kept the position the player had
// already moved past until a pull-to-refresh.
//
// A signal raised before anyone is listening waits for the first listener
// rather than being dropped.
const listeners = new Set();
let pending = false;

export function markContinueWatchingStale() {
  if (!listeners.size) {
    pending = true;
    return;
  }
  listeners.forEach((listener) => {
    try {
      listener();
    } catch (error) {
      console.warn("Continue watching stale listener failed", error);
    }
  });
}

export function onContinueWatchingStale(listener) {
  if (typeof listener !== "function") return () => {};
  listeners.add(listener);
  if (pending) {
    pending = false;
    listener();
  }
  return () => listeners.delete(listener);
}

export function resetContinueWatchingStaleSignal() {
  listeners.clear();
  pending = false;
}
