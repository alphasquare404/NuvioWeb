import { isBackEvent, normalizeKeyEvent } from "../sharedKeys.js";

export const browserAdapter = {
  name: "browser",

  init() {},

  exitApp() {
    try {
      globalThis.close?.();
    } catch (_) {
      // Browsers commonly block window.close(); ignore that.
    }
  },

  isBackEvent(event) {
    return isBackEvent(event);
  },

  normalizeKey(event) {
    return normalizeKeyEvent(event);
  },

  getDeviceLabel() {
    return "Web Browser";
  },

  getCapabilities() {
    return {
      hlsJs: Boolean(globalThis.Hls?.isSupported?.()),
      dashJs: Boolean(globalThis.dashjs?.MediaPlayer),
      nativeVideo: true,
      webosAvplay: false,
      tizenAvplay: false
    };
  },

  prepareVideoElement() {}
};
