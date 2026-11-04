// Keeping the screen awake while a canvas is playing.
//
// iOS decides the display may sleep based on whether the page is *playing media*,
// and only a real media element counts. movi draws to a canvas, so from the
// system's point of view nothing is playing and the auto-lock timer runs — the
// screen dims, then locks, in the middle of a film.
//
// The lever the platform does offer is the Screen Wake Lock API. It is not a
// nicety here: without it the engine is unusable for anything longer than the
// phone's auto-lock delay.
//
// Two properties of the API shape this module:
//  1. Safari drops the lock whenever the page is hidden, so it has to be taken
//     again on the way back — a single request at the start is not enough.
//  2. It needs a secure context. Over plain http on a LAN it does not exist at
//     all, which is a no-op here rather than an error.

export function createWakeLock({
  wakeLockApi = globalThis.navigator?.wakeLock,
  visibilitySource = globalThis.document,
  warn = (message, error) => console.warn(message, error)
} = {}) {
  let sentinel = null;
  let wanted = false;
  let listenerBound = false;

  async function acquire() {
    if (!wanted || sentinel) return Boolean(sentinel);
    if (!wakeLockApi || typeof wakeLockApi.request !== "function") return false;
    try {
      const next = await wakeLockApi.request("screen");
      sentinel = next || null;
      // The browser can release it on its own (tab hidden, battery saver). Clear
      // the handle so the next visible tick takes it again.
      sentinel?.addEventListener?.("release", () => {
        sentinel = null;
      });
      return Boolean(sentinel);
    } catch (error) {
      warn("movi: screen wake lock was refused", error);
      return false;
    }
  }

  function handleVisibility() {
    if (visibilitySource?.visibilityState === "visible") void acquire();
  }

  return {
    async start() {
      wanted = true;
      if (!listenerBound) {
        visibilitySource?.addEventListener?.("visibilitychange", handleVisibility);
        listenerBound = true;
      }
      return acquire();
    },

    async stop() {
      wanted = false;
      if (listenerBound) {
        visibilitySource?.removeEventListener?.("visibilitychange", handleVisibility);
        listenerBound = false;
      }
      const held = sentinel;
      sentinel = null;
      try {
        await held?.release?.();
      } catch {
        // Already released by the browser; nothing to undo.
      }
    },

    isHeld() {
      return Boolean(sentinel);
    },

    isWanted() {
      return wanted;
    }
  };
}
