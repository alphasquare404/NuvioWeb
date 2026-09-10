export const Environment = {
  isWebOS() {
    return false;
  },

  isTizen() {
    return false;
  },

  isBrowser() {
    return true;
  },

  isBackEvent(event) {
    const key = String(event?.key || "").toLowerCase();
    const keyCode = Number(event?.keyCode || 0);
    return key === "escape" || key === "browserback" || keyCode === 27;
  },

  getDeviceLabel() {
    return "Web Browser";
  }
};
