export const DESKTOP_CONTINUE_WATCHING_SETTINGS_PAYLOAD_FEATURE =
  "continue_watching_settings_payload";

export function isMeaningfulDesktopContinueWatchingSettingsPayload(payload) {
  return typeof payload === "string" && Boolean(payload.trim());
}

export function parseDesktopContinueWatchingSettingsPayload(payload) {
  if (typeof payload !== "string") return null;
  try {
    const parsed = JSON.parse(payload);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function desktopContinueWatchingShowUnairedNextUp(payload) {
  const parsed = parseDesktopContinueWatchingSettingsPayload(payload);
  if (!Object.prototype.hasOwnProperty.call(parsed || {}, "show_unaired_next_up")) {
    return null;
  }
  return typeof parsed.show_unaired_next_up === "boolean"
    ? parsed.show_unaired_next_up
    : null;
}

export function patchDesktopContinueWatchingSettingsPayload(payload, showUnairedNextUp) {
  const parsed = parseDesktopContinueWatchingSettingsPayload(payload) || {};
  return JSON.stringify({
    ...parsed,
    show_unaired_next_up: showUnairedNextUp === true
  });
}
