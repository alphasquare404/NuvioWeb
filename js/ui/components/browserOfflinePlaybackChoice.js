import { NuvioDialog } from "./nuvioDialog.js";
import { normalizeSubtitleForDisplay } from "./browserSubtitleDisplay.js";
import { renderLoadingIndicator } from "./loadingIndicator.js";
import {
  OFFLINE_PLAYBACK_TARGETS,
  normalizeOfflinePlaybackTarget,
  resolveOfflinePlaybackTarget
} from "../../core/offline/offlineHandoffPolicy.js";
import { clearExternalPlaybackHandoff } from "./browserExternalPlaybackHandoff.js";
import {
  beginOfflineMediaHandoff,
  deliverPreparedOfflineFile,
  getOfflineHandoffDetails,
  handOffOfflineMedia,
  handOffOfflineSubtitle,
  isOfflineMediaHandoffSupported,
  prepareOfflineSubtitleHandoff
} from "./browserOfflineMediaHandoff.js";
import { PlayerSettingsStore } from "../../data/local/playerSettingsStore.js";

// Asking every time is the safe default, but a viewer who always makes the same
// choice should not be asked forever -- so the prompt can answer the setting.
function createRememberRow(state) {
  const label = document.createElement("label");
  label.className = "nuvio-dialog-remember";
  const input = document.createElement("input");
  input.type = "checkbox";
  input.addEventListener("change", () => {
    state.remember = input.checked;
  });
  const copy = document.createElement("span");
  copy.textContent = "Remember my choice";
  label.appendChild(input);
  label.appendChild(copy);
  return label;
}

function openOfflinePlaybackChoice({
  title = "",
  storageMessage = "",
  canHandOff = true,
  onChoose = () => {},
  onDismiss = () => {}
} = {}) {
  const state = { remember: false, settled: false };
  const settle = (target) => {
    if (state.settled) return;
    state.settled = true;
    dialog.destroy?.();
    onChoose({ target, remember: state.remember });
  };
  const choice = (label, description, target) => ({
    label,
    className: "desktop-external-player-choice",
    content: () => {
      const copy = document.createElement("span");
      copy.className = "desktop-external-player-choice-copy";
      const heading = document.createElement("strong");
      heading.textContent = label;
      const detail = document.createElement("small");
      detail.textContent = description;
      copy.appendChild(heading);
      copy.appendChild(detail);
      return copy;
    },
    onAction: () => settle(target)
  });

  const dialog = new NuvioDialog({
    title: title || "Play downloaded file",
    subtitle: storageMessage,
    widthVw: 32,
    panelClassName: "desktop-external-player-dialog",
    actionsClassName: "desktop-external-player-actions",
    content: () => createRememberRow(state),
    buttons: [
      choice(
        "Play in Nuvio",
        "Use the built-in player, with your downloaded subtitles.",
        OFFLINE_PLAYBACK_TARGETS.INTERNAL
      ),
      ...(canHandOff
        ? [
            choice(
              "Open in another app",
              "Hand the file to a video player. The player keeps its own copy.",
              OFFLINE_PLAYBACK_TARGETS.EXTERNAL
            )
          ]
        : [])
    ],
    onDismiss: () => {
      if (state.settled) return;
      state.settled = true;
      onDismiss();
    }
  });
  dialog.mount(document.body);
  return dialog;
}

// iOS takes a visible moment to prepare the sheet for a large file, and until it
// appears the screen shows nothing at all -- which reads as a tap that never
// registered. This says the tap landed and something is happening.
//
// The longest measured wait for a 430MB file was 48 seconds, so the backstop is
// well past that: dismissing early would put the viewer back in front of the
// blank screen this exists to prevent. It is only a backstop -- returning to the
// app clears it, and it can be tapped away.
const HANDOFF_NOTICE_TIMEOUT_MS = 90_000;

function showOfflineHandoffNotice(message, detail, runtime = globalThis) {
  const view = runtime?.document;
  if (!view?.body || typeof view.createElement !== "function") return () => {};
  view.querySelector?.(".offline-handoff-notice")?.remove();
  const notice = view.createElement("div");
  notice.className = "offline-handoff-notice";
  notice.setAttribute("role", "status");
  notice.innerHTML = renderLoadingIndicator({ label: message });
  const copy = view.createElement("span");
  copy.className = "offline-handoff-notice-copy";
  const label = view.createElement("strong");
  label.textContent = message;
  copy.appendChild(label);
  if (detail) {
    const note = view.createElement("small");
    note.textContent = detail;
    copy.appendChild(note);
  }
  notice.appendChild(copy);
  view.body.appendChild(notice);

  let dismissed = false;
  const onVisible = () => {
    // Returning without the page having reloaded means the sheet was dismissed;
    // there is nothing left to wait for either way.
    if (view.visibilityState === "visible") dismiss();
  };
  function dismiss() {
    if (dismissed) return;
    dismissed = true;
    view.removeEventListener?.("visibilitychange", onVisible);
    notice.remove();
  }
  view.addEventListener?.("visibilitychange", onVisible);
  // An escape hatch, and a backstop if nothing else ever clears it.
  notice.addEventListener?.("click", dismiss);
  runtime.setTimeout?.(dismiss, HANDOFF_NOTICE_TIMEOUT_MS);
  return dismiss;
}

function sendToAnotherApp(details, options, runtime) {
  // Nothing reports back from a document handoff, so the return prompt this
  // registers is the only chance the watch has of being recorded at all. It has
  // to exist before the file leaves, because the handover navigates the page.
  const handoff = beginOfflineMediaHandoff({
    download: details.download,
    progressContext: options.progressContext,
    profileId: options.profileId,
    startingPositionMs: options.resumePositionMs,
    knownDurationMs: options.knownDurationMs,
    runtime
  });
  // Raised before the hand-over, and synchronously, so the tap's own permission
  // to open the sheet is still intact when the file is delivered.
  const dismissNotice = showOfflineHandoffNotice(
    "Opening in another app…",
    "A large file takes a moment to hand over.",
    runtime
  );
  const delivered = handOffOfflineMedia(details, runtime);
  if (!delivered) {
    dismissNotice();
    // A handoff left behind by a delivery that never happened would ask, on the
    // next launch, how playback went for a file that was never handed over.
    if (handoff) clearExternalPlaybackHandoff({ runtime });
  }
  return delivered;
}

export async function startOfflinePlayback({
  downloadId,
  playInternally = async () => false,
  progressContext = null,
  profileId = null,
  resumePositionMs = 0,
  knownDurationMs = 0,
  runtime = globalThis
} = {}) {
  const setting = normalizeOfflinePlaybackTarget(PlayerSettingsStore.get().offlinePlaybackTarget);
  if (setting === OFFLINE_PLAYBACK_TARGETS.INTERNAL || !isOfflineMediaHandoffSupported(runtime)) {
    return playInternally();
  }
  const details = await getOfflineHandoffDetails(downloadId, runtime);
  // A missing or unfinished file is the internal path's problem to report; it
  // already has the message and the status refresh for exactly this case.
  if (!details) return playInternally();

  const options = { progressContext, profileId, resumePositionMs, knownDurationMs };
  const target = resolveOfflinePlaybackTarget({ setting, download: details.download });
  if (target === OFFLINE_PLAYBACK_TARGETS.INTERNAL) return playInternally();
  if (target === OFFLINE_PLAYBACK_TARGETS.EXTERNAL) {
    return sendToAnotherApp(details, options, runtime) || playInternally();
  }

  return new Promise((resolve) => {
    openOfflinePlaybackChoice({
      title: details.fileName.replace(/\.[^.]+$/, ""),
      storageMessage: details.storage.message,
      onChoose: ({ target: chosen, remember }) => {
        if (remember) PlayerSettingsStore.set({ offlinePlaybackTarget: chosen });
        if (chosen === OFFLINE_PLAYBACK_TARGETS.EXTERNAL) {
          resolve(sendToAnotherApp(details, options, runtime) || playInternally());
          return;
        }
        resolve(playInternally());
      },
      onDismiss: () => resolve(false)
    });
  });
}

// iOS hands over one file per tap, so several downloaded subtitles cannot travel
// together. Rather than silently picking one, the choice is shown -- and taking
// a second one is simply another trip through here.
function openOfflineSubtitleChoice({ subtitles = [], onSelect = () => {} } = {}) {
  const state = { settled: false };
  const settle = (subtitle) => {
    if (state.settled) return;
    state.settled = true;
    try {
      // Act before closing: the exit animation must not sit between the tap and
      // the hand-over it was meant to trigger.
      if (subtitle) onSelect(subtitle);
    } finally {
      // Whatever happens above, the dialog closes. A click listener swallows
      // anything thrown out of it, so without this a failure left the dialog
      // sitting there and the tap looked like it never registered.
      dialog.destroy?.();
    }
  };
  const dialog = new NuvioDialog({
    title: "Send subtitle",
    subtitle: "One file crosses at a time. Come back to send another.",
    widthVw: 32,
    panelClassName: "desktop-external-player-dialog desktop-offline-subtitle-dialog",
    actionsClassName: "desktop-external-player-actions",
    buttons: subtitles.map((subtitle) => {
      const display = normalizeSubtitleForDisplay(subtitle);
      // Nine English subtitles all read "English · AIOStreams". The release name
      // is the only thing that tells them apart, and the only way to match one
      // against the video that was actually downloaded -- so it is shown in full,
      // laid out the way Download Options already shows the same subtitles.
      //
      // An addon that returned no release name leaves nothing to show, and rows
      // that read identically are worse than useless when the whole point is
      // picking one. Format and size always exist, so they stand in -- and seeing
      // them is itself the answer to "was a name ever stored for this?".
      const size =
        Number(subtitle.byteLength) > 0
          ? `${Math.max(1, Math.round(Number(subtitle.byteLength) / 1024))} KB`
          : "";
      const detail =
        display.meta ||
        [String(subtitle.extension || "").toUpperCase(), size].filter(Boolean).join(" · ");
      return {
        label: [display.language, display.release].filter(Boolean).join(" - "),
        className: "desktop-external-player-choice desktop-offline-subtitle-choice",
        content: () => {
          const copy = document.createElement("span");
          copy.className = "desktop-external-player-choice-copy";
          const provider = document.createElement("span");
          provider.className = "desktop-offline-subtitle-provider";
          provider.textContent = display.provider;
          const heading = document.createElement("strong");
          heading.textContent = display.language;
          copy.append(provider, heading);
          if (detail) {
            const meta = document.createElement("small");
            meta.textContent = detail;
            copy.appendChild(meta);
          }
          return copy;
        },
        onAction: () => settle(subtitle)
      };
    }),
    onDismiss: () => settle(null)
  });
  dialog.mount(document.body);
  return dialog;
}

// Whether a downloaded file has anything worth offering to another app. Kept
// pure so both screens ask the same question and it can be tested without a DOM.
export function canOfferOfflineSubtitleHandoff(subtitles = [], runtime = globalThis) {
  const list = Array.isArray(subtitles) ? subtitles : [];
  return list.some((subtitle) => subtitle?.subtitleId) && isOfflineMediaHandoffSupported(runtime);
}

// One route for both screens: send it outright when there is nothing to choose,
// and ask only when there genuinely is.
export async function sendOfflineSubtitleFor(
  download,
  subtitles = [],
  { onError = () => {}, runtime = globalThis } = {}
) {
  const list = (Array.isArray(subtitles) ? subtitles : []).filter((entry) => entry?.subtitleId);
  // Distinct wording on purpose: a silent no-op tells nobody anything, and these
  // two refusals have completely different causes.
  if (!download) {
    onError("The downloaded file's record could not be read.");
    return false;
  }
  if (!list.length) {
    onError("No downloaded subtitle for this file.");
    return false;
  }
  if (!isOfflineMediaHandoffSupported(runtime)) {
    onError("This browser cannot hand files to another app.");
    return false;
  }
  if (list.length === 1) {
    const sent = await handOffOfflineSubtitle(download, list[0].subtitleId, runtime);
    if (!sent) onError("Could not send the subtitle.");
    return sent;
  }
  // The dialog opens first. Reading fourteen files before showing anything is a
  // silent pause on a tap, which is indistinguishable from a dead button -- and
  // the reading exists only to make the eventual choice instant, so it belongs
  // behind the dialog rather than in front of it.
  //
  // One at a time, deliberately. A read that throws marks that subtitle failed
  // for good, so firing them all at once turns one transient error into several
  // downloads that quietly no longer exist.
  const prepared = new Map();
  openOfflineSubtitleChoice({
    subtitles: list,
    onSelect: (subtitle) => {
      try {
        const entry = prepared.get(String(subtitle.subtitleId));
        // Warmed: hand over straight from the tap, with no await in between to
        // spend the permission the tap carries.
        if (entry) {
          if (!deliverPreparedOfflineFile(entry, runtime)) onError("Could not send the subtitle.");
          return;
        }
        // Not warmed yet -- still offer it. A choice that might fail beats one
        // that was never shown.
        void handOffOfflineSubtitle(download, subtitle.subtitleId, runtime).then(
          (sent) => {
            if (!sent) onError("Could not send the subtitle.");
          },
          (error) => onError(`Subtitle handoff failed: ${String(error?.message || error)}`)
        );
      } catch (error) {
        onError(`Subtitle handoff failed: ${String(error?.message || error)}`);
      }
    }
  });
  void (async () => {
    for (const subtitle of list) {
      const entry = await prepareOfflineSubtitleHandoff(download, subtitle.subtitleId, runtime);
      if (entry) prepared.set(String(entry.subtitleId), entry);
    }
  })();
  return true;
}
