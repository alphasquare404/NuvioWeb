import { browserAdapter } from "./adapters/browserAdapter.js";

const ADAPTERS = {
  browser: browserAdapter
};

function getAdapter() {
  if (!Platform.current) {
    Platform.current = ADAPTERS.browser;
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

  isWebOS() {
    return this.getName() === "webos";
  },

  getWebOsMajorVersion() {
    return 0;
  },

  isTizen() {
    return this.getName() === "tizen";
  },

  isBrowser() {
    return this.getName() === "browser";
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
  },

  prepareVideoElement(videoElement) {
    return getAdapter().prepareVideoElement?.(videoElement);
  }
};
