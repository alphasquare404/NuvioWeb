import {
  WatchProgressSyncService,
  noteWatchProgressReconnectPullOwed
} from "./watchProgressSyncService.js";

// Nothing carried progress up when the network came back. Pushes ride on
// playback events, so anything watched offline could sit unsent until the next
// thing was played -- and if that never happened, until the app was reopened.
//
// Two triggers, because one of them cannot be relied on. `online` is the
// obvious signal, but whether an installed iOS PWA fires it when Airplane Mode
// is switched off is not something this code can assume. Returning to the app
// is a transition the platform does report, and the app already depends on it
// elsewhere -- so a push still owed is retried then too.
//
// Kept apart from the sync service so the wiring can be exercised with a fake
// runtime, and so the service does not grow module-level state for listeners.
let bound = false;

export function installWatchProgressReconnectSync({
  runtime = globalThis,
  sync = (trigger) => WatchProgressSyncService.syncAfterReconnect(trigger),
  notePullOwed = () => noteWatchProgressReconnectPullOwed(),
  hasPendingWork = () => WatchProgressSyncService.hasUnsyncedProgress(),
  onError = (error) => console.warn("Watch progress reconnect sync failed", error)
} = {}) {
  // Binding twice would run two merges against one another on every reconnect.
  if (bound || typeof runtime?.addEventListener !== "function") return false;
  bound = true;

  const run = (trigger) => {
    // Recorded before anything awaits, because the push owed from the offline
    // session is already on its debounce and would otherwise get out first --
    // publishing this device's older position over viewing another device did
    // while this one was away.
    notePullOwed();
    try {
      void Promise.resolve(sync(trigger)).catch(onError);
    } catch (error) {
      // A throw here would escape into the browser's own event dispatch, where
      // nothing reports it.
      onError(error);
    }
  };

  runtime.addEventListener("online", () => run("online"));

  // Neither event fires when the app is simply opened again. Coming back online
  // is far more often something that happens while Nuvio is closed -- the
  // network returns, and only later does the app get launched -- and then there
  // is no `online` to hear, because the network was already up before the page
  // existed, and no return to the foreground, because the page is born visible.
  // Startup pulls but never pushes, so viewing recorded offline sat on the
  // device until something else happened to push it: playing something else,
  // which is exactly the workaround that used to be needed.
  //
  // Asked the same way the foreground trigger asks it, so a device with nothing
  // owed still costs nothing at startup.
  void Promise.resolve()
    .then(() => {
      if (runtime.navigator?.onLine === false) {
        return null;
      }
      return hasPendingWork();
    })
    .then((pending) => {
      if (pending === null) return;
      if (!pending) {
        return;
      }
      run("startup");
    })
    .catch(onError);

  runtime.document?.addEventListener?.("visibilitychange", () => {
    if (runtime.document.visibilityState !== "visible") return;
    if (runtime.navigator?.onLine === false) {
      return;
    }
    // Every foreground would otherwise mean a full pull and push. The question
    // is asked of the data -- is this device holding viewing the cloud has not
    // accepted -- rather than of a failure flag, because a push that was never
    // attempted leaves no flag, and an offline session is exactly when one
    // might not be.
    void Promise.resolve()
      .then(() => hasPendingWork())
      .then((pending) => {
        if (!pending) {
          return;
        }
        run("foreground");
      })
      .catch(onError);
  });

  return true;
}

// Only for tests: the guard above is deliberately process-wide.
export function resetWatchProgressReconnectSyncForTests() {
  bound = false;
}
