import { LayoutPreferences } from "../data/local/layoutPreferences.js";

export const FAST_HORIZONTAL_NAVIGATION_KEY = "fastHorizontalNavigationEnabled";

export function getArrowCodeFromKey(key) {
  if (key === "ArrowUp") return 38;
  if (key === "ArrowDown") return 40;
  if (key === "ArrowLeft") return 37;
  if (key === "ArrowRight") return 39;
  return null;
}

function getBrowserKeyCode(key) {
  if (key === "Enter") return 13;
  if (key === "Escape" || key === "Esc") return 27;
  if (key === "Backspace") return 8;
  if (key === "Delete") return 46;
  if (key === "Tab") return 9;
  if (key === " " || key === "Spacebar") return 32;
  return 0;
}

function isEditableTarget(target) {
  const tagName = String(target?.tagName || "").toUpperCase();
  return Boolean(
    target?.isContentEditable ||
    tagName === "INPUT" ||
    tagName === "TEXTAREA" ||
    tagName === "SELECT"
  );
}

export function isFastHorizontalNavigationEnabled() {
  return Boolean(LayoutPreferences.get().fastHorizontalNavigationEnabled);
}

export function normalizeKeyEvent(event) {
  const key = String(event?.key || "");
  const code = String(event?.code || "");
  const rawCode = Number(
    getArrowCodeFromKey(key) || event?.keyCode || event?.which || getBrowserKeyCode(key) || 0
  );
  const isBack = isBackEvent(event);
  return {
    key,
    code,
    keyName: "",
    keyCode: rawCode,
    originalKeyCode: rawCode,
    isArrow: rawCode >= 37 && rawCode <= 40,
    isEnter: rawCode === 13 || key === "Enter",
    isBack
  };
}

export function isBackEvent(event) {
  const target = event?.target || null;
  const key = String(event?.key || "");
  const code = String(event?.code || "");
  const rawCode = Number(event?.keyCode || event?.which || 0);

  if (
    isEditableTarget(target) &&
    (key === "Backspace" || rawCode === 8 || key === "Delete" || rawCode === 46)
  ) {
    return false;
  }

  if (
    key === "Escape" ||
    key === "Esc" ||
    key === "Backspace" ||
    key === "GoBack" ||
    key === "XF86Back" ||
    code === "BrowserBack" ||
    code === "GoBack"
  ) {
    return true;
  }

  return false;
}
