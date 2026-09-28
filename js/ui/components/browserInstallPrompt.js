// Add to Home Screen, offered once and never nagged.
//
// `beforeinstallprompt` fires early and only once, so it is captured at module
// load rather than when a screen mounts -- a screen that mounts a second later
// would never see it. Safari never fires it at all, which is why the manual
// steps exist: there the only install path is the browser's own menu, and the
// app can do no more than say where it is.

import { I18n } from "../../i18n/index.js";
import { openTouchActionSheet } from "./touchActionSheet.js";

function t(key, params = {}, fallback = key) {
  return I18n.t(key, params, { fallback });
}

const DISMISSED_KEY = "nuvioInstallPromptDismissed";
const APP_ICON = "assets/brand/pwa-icon-192.png";

let deferredPrompt = null;
const availabilityListeners = new Set();

function notifyAvailabilityChanged() {
  availabilityListeners.forEach((listener) => {
    try {
      listener();
    } catch {
      // A listener that throws is a screen that has gone away.
    }
  });
}

function readDismissed() {
  try {
    return globalThis.localStorage?.getItem(DISMISSED_KEY) === "true";
  } catch {
    // Private windows and blocked site data both throw here. Forgetting the
    // dismissal is the kinder failure: the banner is dismissible either way.
    return false;
  }
}

export function isAppInstalled() {
  const standalone = globalThis.matchMedia?.("(display-mode: standalone)")?.matches;
  // iOS predates the display-mode query and answers on the navigator instead.
  return Boolean(standalone || globalThis.navigator?.standalone);
}

export function canPromptInstall() {
  return Boolean(deferredPrompt);
}

// The one decision worth testing on its own: whether the banner has any
// business being on screen.
export function shouldOfferInstall({ isBrowser, installed, dismissed } = {}) {
  return Boolean(isBrowser) && !installed && !dismissed;
}

export function isInstallOffered({ isBrowser = true } = {}) {
  return shouldOfferInstall({ isBrowser, installed: isAppInstalled(), dismissed: readDismissed() });
}

export function dismissInstallOffer() {
  try {
    globalThis.localStorage?.setItem(DISMISSED_KEY, "true");
  } catch {
    // Nothing to do: the banner still closes for this visit.
  }
  notifyAvailabilityChanged();
}

export function onInstallAvailabilityChange(listener) {
  if (typeof listener !== "function") return () => {};
  availabilityListeners.add(listener);
  return () => availabilityListeners.delete(listener);
}

export function watchBrowserInstallAvailability() {
  if (typeof globalThis.addEventListener !== "function") return;
  globalThis.addEventListener("beforeinstallprompt", (event) => {
    // Holding the event is what lets the app ask at a moment that makes sense
    // rather than whenever the browser decided to.
    event.preventDefault?.();
    deferredPrompt = event;
    notifyAvailabilityChanged();
  });
  globalThis.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    notifyAvailabilityChanged();
  });
}

export function renderInstallBanner() {
  if (!isInstallOffered()) return "";
  return `
    <aside class="browser-install-banner" aria-label="${escapeAttribute(t("pwa_install_title", {}, "Install Nuvio"))}">
      <img class="browser-install-banner-icon" src="${APP_ICON}" alt="" />
      <div class="browser-install-banner-copy">
        <p class="browser-install-banner-title">${escapeHtml(t("pwa_install_title", {}, "Install Nuvio"))}</p>
        <p class="browser-install-banner-body">${escapeHtml(
          t(
            "pwa_install_pitch",
            {},
            "Full-screen playback, faster launch, one tap from your home screen."
          )
        )}</p>
      </div>
      <button class="browser-install-banner-action" type="button" data-action="installApp">${escapeHtml(
        t("pwa_install_action", {}, "Install")
      )}</button>
      <button class="browser-install-banner-close" type="button" data-action="dismissInstall"
              aria-label="${escapeAttribute(t("pwa_install_dismiss", {}, "Dismiss"))}">
        <span class="material-icons" aria-hidden="true">close</span>
      </button>
    </aside>
  `;
}

// Chrome can install on the spot; Safari cannot be asked at all, so it gets
// the steps instead of a button that would do nothing.
export async function requestInstall() {
  if (!deferredPrompt) {
    openInstallInstructions();
    return "instructions";
  }
  const prompt = deferredPrompt;
  deferredPrompt = null;
  try {
    prompt.prompt();
    const choice = await prompt.userChoice;
    notifyAvailabilityChanged();
    return choice?.outcome === "accepted" ? "accepted" : "dismissed";
  } catch {
    openInstallInstructions();
    return "instructions";
  }
}

export function openInstallInstructions({ onNeverShowAgain = null } = {}) {
  const steps = [
    t("pwa_install_step_menu", {}, "Tap the three dots in the Safari browser"),
    t("pwa_install_step_share", {}, "Tap Share"),
    t("pwa_install_step_add", {}, "Scroll and choose Add to Home Screen"),
    t("pwa_install_step_open", {}, "Tap Add, then open Nuvio from your Home Screen")
  ];

  const content = document.createElement("div");
  content.className = "browser-install-sheet";

  const header = document.createElement("div");
  header.className = "browser-install-sheet-header";
  const icon = document.createElement("img");
  icon.className = "browser-install-sheet-icon";
  icon.src = APP_ICON;
  icon.alt = "";
  const headerCopy = document.createElement("div");
  const title = document.createElement("p");
  title.className = "browser-install-sheet-title";
  title.textContent = t("pwa_install_sheet_title", {}, "Install Nuvio as Progressive Web App");
  const body = document.createElement("p");
  body.className = "browser-install-sheet-body";
  body.textContent = t(
    "pwa_install_sheet_body",
    {},
    "Add it to your Home Screen — it opens full-screen, like a real app."
  );
  headerCopy.append(title, body);
  header.append(icon, headerCopy);
  content.append(header);

  const list = document.createElement("ol");
  list.className = "browser-install-sheet-steps";
  steps.forEach((step, index) => {
    const item = document.createElement("li");
    item.className = "browser-install-sheet-step";
    const badge = document.createElement("span");
    badge.className = "browser-install-sheet-step-number";
    badge.textContent = String(index + 1);
    const label = document.createElement("span");
    label.className = "browser-install-sheet-step-label";
    label.textContent = step;
    item.append(badge, label);
    list.append(item);
  });
  content.append(list);

  const actions = document.createElement("div");
  actions.className = "browser-install-sheet-actions";
  const confirm = document.createElement("button");
  confirm.type = "button";
  confirm.className = "browser-install-sheet-confirm";
  confirm.textContent = t("pwa_install_confirm", {}, "Got it");
  const never = document.createElement("button");
  never.type = "button";
  never.className = "browser-install-sheet-never";
  never.textContent = t("pwa_install_never", {}, "Don’t show again");
  actions.append(confirm, never);
  content.append(actions);

  const sheet = openTouchActionSheet({ content });
  confirm.addEventListener("click", () => sheet?.dismiss?.());
  never.addEventListener("click", () => {
    dismissInstallOffer();
    sheet?.dismiss?.();
    onNeverShowAgain?.();
  });
  return sheet;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escapeAttribute(value) {
  return escapeHtml(value);
}
