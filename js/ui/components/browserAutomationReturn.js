// Coming back from an external player by Shortcuts Automation.
//
// The notification path needs a Push subscription, a configured relay and, on
// iOS, an installed PWA. An Automation needs none of that: Shortcuts watches
// the player app, and when it closes it opens NuvioWeb. The app then returns to
// the foreground, which is the one event the return coordinator already waits
// for -- so nothing new has to run here for progress to arrive.
//
// The Shortcut itself uses the Open App action, so it can only open an app that
// exists on the Home Screen. That is why this is offered on iOS and only once
// the PWA is installed: offering it in Safari would be offering something that
// cannot be built.

import { AUTOMATION_SHORTCUT_URL } from "../../config.js";
import { I18n } from "../../i18n/index.js";
import { getBrowserExternalPlayerPlatform } from "./browserExternalPlayer.js";
import { isAppInstalled } from "./browserInstallPrompt.js";

function t(key, params = {}, fallback = key) {
  return I18n.t(key, params, { fallback });
}

function escapeHtml(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export const AUTOMATION_TUTORIAL_URL = "https://youtube.com/shorts/m_1-JQSLo58";
const AUTOMATION_TUTORIAL_ID = "m_1-JQSLo58";

// What the Shortcut has to open. The scheme reaches an installed Home Screen
// web app on iOS 16.4 and later, and it carries the host it was installed
// under -- which is why this is read off the page rather than written down
// anywhere: every self-hosted deployment needs its own.
export function getAutomationShortcutTarget(runtime = globalThis) {
  const host = String(runtime?.location?.host || "").trim();
  return host ? `webapp://${host}/` : "";
}

// The two decisions worth testing without a DOM.
export function isAutomationReturnSupported({ platform, installed } = {}) {
  return platform === "ios" && Boolean(installed);
}

// iOS in a browser tab is the one place worth saying something: the Automation
// is real and reachable, but only after Add to Home Screen. Anywhere else
// Shortcuts does not exist and silence is the honest answer.
export function getAutomationReturnAvailability({
  platform = getBrowserExternalPlayerPlatform(),
  installed = isAppInstalled()
} = {}) {
  if (isAutomationReturnSupported({ platform, installed })) return "available";
  return platform === "ios" ? "needs-install" : "unsupported";
}

export function hasPublishedAutomationShortcut() {
  return Boolean(AUTOMATION_SHORTCUT_URL);
}

export function openAutomationShortcut(runtime = globalThis) {
  if (!AUTOMATION_SHORTCUT_URL) return;
  runtime.open?.(AUTOMATION_SHORTCUT_URL, "_blank", "noopener");
}

// Clipboard access can be refused or absent; the address is on screen either
// way, so a refusal costs the person a tap, not the feature.
export async function copyAutomationShortcutTarget(runtime = globalThis) {
  const target = getAutomationShortcutTarget(runtime);
  const clipboard = runtime?.navigator?.clipboard;
  if (!target || typeof clipboard?.writeText !== "function") return false;
  try {
    await clipboard.writeText(target);
    return true;
  } catch {
    return false;
  }
}

export function openAutomationTutorial(runtime = globalThis) {
  runtime.open?.(AUTOMATION_TUTORIAL_URL, "_blank", "noopener");
}

// youtube-nocookie keeps the viewer out of YouTube's ad profile. The trailer
// proxy is deliberately not reused: that exists for the IFrame API and for
// file:// origins on TV, and this is a static clip on a real https origin.
export function renderAutomationTutorialFrame() {
  const src = `https://www.youtube-nocookie.com/embed/${AUTOMATION_TUTORIAL_ID}?playsinline=1&rel=0`;
  return `
    <div class="automation-return-video">
      <iframe class="automation-return-frame" src="${escapeHtml(src)}"
              title="${escapeHtml(t("automation_return_tutorial_title", {}, "Setting up the Shortcut automation"))}"
              referrerpolicy="origin-when-cross-origin"
              allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
              allowfullscreen scrolling="no"></iframe>
    </div>`;
}

// Step one is "get the Shortcut", so whatever does that -- a one-tap link, or
// the address to paste -- belongs inside that step rather than after the list.
const FIRST_STEP_PUBLISHED = [
  "automation_return_step_shortcut",
  "Add the Shortcut below. It is one action: open NuvioWeb."
];

const FIRST_STEP_BUILD = [
  "automation_return_step_build",
  "Open the Shortcuts app, make a new Shortcut, add the Open URL action, and paste this address into it:"
];

const REMAINING_STEPS = [
  [
    "automation_return_step_automation",
    "In the Shortcuts app open Automation, then New, and choose App."
  ],
  [
    "automation_return_step_app",
    "Pick your external player, untick Is Opened, and tick Is Closed."
  ],
  ["automation_return_step_immediately", "Choose Run Immediately, so nothing asks you to confirm."],
  ["automation_return_step_pick", "Choose the Shortcut you just added."]
];

// Used by Quick Setup inside a step body and by Settings inside an option
// dialog, so this returns markup only: each host already owns one delegated
// click listener, and both dispatch on data-action.
export function renderAutomationReturnGuide({
  availability = getAutomationReturnAvailability(),
  shortcutTarget = getAutomationShortcutTarget()
} = {}) {
  if (availability === "unsupported") return "";

  if (availability === "needs-install") {
    return `
      <div class="automation-return-guide">
        <p class="automation-return-note">${escapeHtml(
          t(
            "automation_return_needs_install",
            {},
            "This needs Nuvio on your Home Screen first. In Safari, open the Share menu and choose Add to Home Screen, then come back here — the Shortcut opens the installed app, so it has nothing to open until then."
          )
        )}</p>
      </div>`;
  }

  // A Shortcut carries the address it opens, so a published one only ever
  // belongs to the deployment that published it. Where none was, the address
  // is shown instead: it is the single thing that differs between deployments,
  // and the page already knows it.
  const firstStep = hasPublishedAutomationShortcut()
    ? `
    <li>${escapeHtml(t(FIRST_STEP_PUBLISHED[0], {}, FIRST_STEP_PUBLISHED[1]))}
      <button class="automation-return-get focusable" type="button" data-action="addReturnShortcut">${escapeHtml(
        t("automation_return_add_shortcut", {}, "Add the Shortcut")
      )}</button>
    </li>`
    : `
    <li>${escapeHtml(t(FIRST_STEP_BUILD[0], {}, FIRST_STEP_BUILD[1]))}
      <span class="automation-return-target">
        <code class="automation-return-target-value">${escapeHtml(shortcutTarget)}</code>
        <button class="automation-return-copy focusable" type="button" data-action="copyReturnShortcutTarget">${escapeHtml(
          t("automation_return_copy_address", {}, "Copy")
        )}</button>
      </span>
    </li>`;

  const rest = REMAINING_STEPS.map(
    ([key, fallback]) => `<li>${escapeHtml(t(key, {}, fallback))}</li>`
  ).join("");

  return `
    <div class="automation-return-guide">
      <ol class="automation-return-steps">${firstStep}${rest}</ol>
      <p class="automation-return-tutorial-caption">${escapeHtml(
        t("automation_return_tutorial_caption", {}, "Watch this tutorial video for clearer steps.")
      )}</p>
      ${renderAutomationTutorialFrame()}
      <button class="automation-return-link focusable" type="button" data-action="openReturnTutorial">${escapeHtml(
        t("automation_return_tutorial_open", {}, "Trouble playing it? Open on YouTube")
      )}</button>
      <p class="automation-return-note">${escapeHtml(
        t(
          "automation_return_caution",
          {},
          "The Automation runs when the player closes, so close the player by its own Close button. Swiping it away from the app switcher still sends nothing back."
        )
      )}</p>
    </div>`;
}
