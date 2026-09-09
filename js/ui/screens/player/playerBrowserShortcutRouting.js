export function resolveBrowserPlayerShortcutRoute({
  keyCode = 0,
  code = "",
  isBackKey = false,
  fullscreen = false,
  editable = false,
  pauseOverlayVisible = false,
  dialogOpen = false
} = {}) {
  if (isBackKey && fullscreen) {
    return "allow-fullscreen-exit";
  }
  if (isBackKey) {
    return "back";
  }
  if (editable) {
    return "native-input";
  }
  if (pauseOverlayVisible) {
    return "pause-overlay";
  }
  if (dialogOpen) {
    return "dialog";
  }
  if (keyCode === 70 || code === "KeyF") {
    return "fullscreen";
  }
  if (keyCode === 77 || code === "KeyM") {
    return "mute";
  }
  if (keyCode === 32 || code === "Space" || keyCode === 13 || keyCode === 23) {
    return "play-pause";
  }
  if (keyCode === 37 || keyCode === 39) {
    return "seek";
  }
  if (keyCode === 38 || keyCode === 40) {
    return "volume";
  }
  return "other";
}

export function shouldBlurBrowserPlayerToolbarAfterPointer(event = {}) {
  return Number(event?.detail || 0) > 0 || Boolean(event?.pointerType);
}
