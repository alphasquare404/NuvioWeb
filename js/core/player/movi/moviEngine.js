// Loading and tearing down the movi element.
//
// The element is a 410 KB module and its WASM blob another ~2 MB, so it is
// imported at the moment a playback needs it — never for a profile that kept the
// built-in player. The local copy wins when the build shipped one; the CDN is
// the same fallback the streaming libraries already use (see
// js/runtime/loadStreamingLibs.js).

export const MOVI_CDN_ENTRY = "https://cdn.jsdelivr.net/npm/movi-player@0.4.1/dist/element.js";
export const MOVI_LOCAL_ENTRY = "assets/libs/movi/element.js";

/**
 * A loader that remembers its work.
 *
 * Built as a factory rather than a module-level promise so a test can hand it
 * its own import function: the real one steals a network request per call, and
 * the cached result would leak between test cases.
 */
export function createMoviLoader({
  importImpl = (specifier) => import(specifier),
  baseUrl = globalThis.document?.baseURI || "http://localhost/",
  localEntry = MOVI_LOCAL_ENTRY,
  cdnEntry = MOVI_CDN_ENTRY
} = {}) {
  let pending = null;

  return function loadMoviModule() {
    if (!pending) {
      pending = (async () => {
        try {
          await importImpl(new URL(localEntry, baseUrl).href);
          return { source: "local" };
        } catch (localError) {
          try {
            await importImpl(cdnEntry);
            return { source: "cdn" };
          } catch (cdnError) {
            throw new Error(`movi engine could not be loaded: ${cdnError?.message || cdnError}`, {
              cause: localError
            });
          }
        }
      })();
      // A failed load must be retryable: a dead network on the first attempt is
      // not a verdict about the whole session.
      pending.catch(() => {
        pending = null;
      });
    }
    return pending;
  };
}

export const loadMoviModule = createMoviLoader();

/**
 * Put a `<movi-player>` in `container` and start it on `src`.
 *
 * Returns a handle rather than leaking the element: the router never suspends
 * this route (the decoder and its cache have to go when the screen does), so
 * `destroy()` is the one path out.
 */
export function mountMoviElement({
  container,
  src,
  headers = null,
  startAt = 0,
  title = "",
  muted = false,
  controlsList = null
} = {}) {
  if (!container) {
    throw new Error("movi engine needs a container element");
  }
  if (!src) {
    throw new Error("movi engine needs a source");
  }

  const documentRef = container.ownerDocument || globalThis.document;
  const element = documentRef.createElement("movi-player");
  element.setAttribute("controls", "");
  element.setAttribute("playsinline", "");
  // The route owns fullscreen. movi draws to a canvas, so it cannot enter native
  // fullscreen the way a <video> can: its own button only fills the viewport with
  // the picture, while the subtitle layer lives outside that box and disappears.
  // Hiding its button and fullscreening the stage keeps picture, controls and
  // subtitles in one box.
  if (controlsList) element.setAttribute("controlslist", String(controlsList));
  if (muted) element.setAttribute("muted", "");
  if (title) element.setAttribute("title", String(title));

  const resumeSeconds = Math.floor(Number(startAt) || 0);
  if (resumeSeconds > 0) element.setAttribute("startat", String(resumeSeconds));

  // movi reads headers from a JSON attribute (proven in the spike: 9–12
  // requests carried them). Only forwarded when the source actually has any.
  const headerEntries = headers && typeof headers === "object" ? Object.entries(headers) : [];
  if (headerEntries.length)
    element.setAttribute("headers", JSON.stringify(Object.fromEntries(headerEntries)));

  element.src = src;
  container.append(element);

  return {
    element,
    destroy() {
      // Order matters: pause, free the decoders, drop the reference, then the
      // node — a detached element that still owns a decoder can keep playing.
      try {
        element.pause?.();
      } catch {
        /* the element may already be torn down */
      }
      try {
        element.dispose?.();
      } catch {
        /* dispose is best-effort on a half-built element */
      }
      try {
        element.player?.destroy?.();
      } catch {
        /* the core is gone with the element on some paths */
      }
      try {
        element.remove?.();
      } catch {
        /* already detached */
      }
    }
  };
}
