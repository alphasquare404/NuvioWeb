import { browserAdapter } from "./adapters/browserAdapter.js";

function getAdapter() {
  if (!Platform.current) {
    Platform.current = browserAdapter;
  }
  return Platform.current;
}

export const Platform = {
  current: null,

  init() {
    const adapter = getAdapter();
    adapter.init?.();
    return adapter;
  },

  getName() {
    return getAdapter().name;
  },

  // Transitional browser-only compatibility for shared screens. These no
  // longer inspect native globals or select a TV runtime.
  isWebOS() {
    return false;
  },

  getWebOsMajorVersion() {
    return 0;
  },

  isTizen() {
    return false;
  },

  isBrowser() {
    return true;
  },

  exitApp() {
    if (globalThis.document && typeof globalThis.CustomEvent === "function") {
      const beforeExitEvent = new CustomEvent("nuvio:beforeExitApp", {
        cancelable: true
      });
      globalThis.document.dispatchEvent(beforeExitEvent);
      if (beforeExitEvent.defaultPrevented) {
        return false;
      }
    }
    return getAdapter().exitApp();
  },

  isBackEvent(event) {
    return getAdapter().isBackEvent(event);
  },

  normalizeKey(event) {
    return getAdapter().normalizeKey(event);
  },

  getDeviceLabel() {
    return getAdapter().getDeviceLabel();
  },

  getCapabilities() {
    return getAdapter().getCapabilities();
  }
};
