// A service worker takes control of the page it just updated, but it cannot
// make the page run the build it just cached: the document keeps the JavaScript
// it loaded with. Without something here, a shipped fix reaches an installed PWA
// only after the user has closed and reopened it twice -- once for the new worker
// to install, once for the page to boot from the new cache.

export function shouldReloadForNewWorker({
  hadController = false,
  reloading = false,
  playbackActive = false
} = {}) {
  // No previous controller means this is the first install: there is no older
  // build to replace, and reloading would only interrupt the first visit.
  if (!hadController || reloading) {
    return false;
  }
  // Reloading mid-playback would stop what the viewer is watching; the page can
  // take the new build on the reload they were going to make anyway.
  return !playbackActive;
}

export function hasActivePlayback(documentRef = globalThis.document) {
  const media = documentRef?.querySelectorAll?.("video, audio");
  if (!media) {
    return false;
  }
  return Array.from(media).some((element) => !element.paused && !element.ended);
}

/**
 * Reloads the page once when a newer worker takes control of it.
 *
 * @param {{addEventListener?: Function, removeEventListener?: Function}} serviceWorker
 * @param {{hadController?: boolean, reload?: Function, documentRef?: object}} options
 * @returns {Function} removes the listener
 */
export function watchServiceWorkerTakeover(
  serviceWorker,
  { hadController = false, reload, documentRef = globalThis.document } = {}
) {
  if (!serviceWorker?.addEventListener) {
    return () => {};
  }

  let reloading = false;
  const onChange = () => {
    if (
      !shouldReloadForNewWorker({
        hadController,
        reloading,
        playbackActive: hasActivePlayback(documentRef)
      })
    ) {
      return;
    }
    reloading = true;
    if (typeof reload === "function") {
      reload();
    }
  };

  serviceWorker.addEventListener("controllerchange", onChange);
  return () => serviceWorker.removeEventListener?.("controllerchange", onChange);
}
