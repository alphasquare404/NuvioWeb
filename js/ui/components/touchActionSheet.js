// Bottom action sheet for touch long-press.
//
// Modelled on NuvioDesktop's ContinueWatchingActionSheet: opens fully expanded
// (no half-stop), a poster/title/subtitle header, divider-separated rows with
// icons, destructive action last, and safe-area padding so the final row is not
// under the home indicator. Selecting an action dismisses the sheet.
//
// This is not the desktop menu. A compact cursor- or card-anchored menu
// is wrong under a thumb.

import { I18n } from "../../i18n/index.js";

function t(key, params = {}, fallback = key) {
  return I18n.t(key, params, { fallback });
}

// The sheet's thumbnail is the only place a poster is already loaded and in
// front of someone, so it is the natural place to open a bigger one. The image
// is fitted rather than sized: 90% of the width and 90% of the height at once,
// so whichever runs out first decides, and one rule covers both a portrait
// phone and a landscape one.
function openPosterViewer(src, title = "") {
  const viewer = document.createElement("div");
  viewer.className = "nuvio-poster-viewer";
  viewer.setAttribute("role", "dialog");
  viewer.setAttribute("aria-modal", "true");
  if (title) viewer.setAttribute("aria-label", String(title));

  const image = document.createElement("img");
  image.className = "nuvio-poster-viewer-image";
  image.src = src;
  image.alt = String(title || "");
  image.decoding = "async";
  viewer.append(image);

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    document.removeEventListener("keydown", onKeyDown, true);
    viewer.classList.remove("is-open");
    // Let the fade finish before the node goes, but never leave it behind if
    // the transition never fires.
    setTimeout(() => viewer.remove(), 220);
  };
  const onKeyDown = (event) => {
    if (event.key !== "Escape") return;
    // The sheet underneath also closes on Escape; the topmost layer takes it.
    event.stopPropagation();
    close();
  };

  viewer.addEventListener("click", close);
  document.addEventListener("keydown", onKeyDown, true);
  document.body.append(viewer);
  requestAnimationFrame(() => viewer.classList.add("is-open"));
  return { close };
}

const DEFAULT_ACTION_ICONS = {
  details: "info",
  playManually: "play_arrow",
  startOver: "replay",
  resume: "play_arrow",
  remove: "delete_outline",
  toggleLibrary: "bookmark_border",
  manageLists: "playlist_add",
  toggleWatched: "check_circle_outline"
};

export function actionSheetIconFor(action = {}) {
  if (action.icon) return String(action.icon);
  return DEFAULT_ACTION_ICONS[String(action.key || action.action || "")] || "chevron_right";
}

export function openTouchActionSheet({
  header = null,
  items = [],
  content = null,
  onSelect = () => {},
  onDismiss = () => {}
} = {}) {
  const actions = (Array.isArray(items) ? items : []).filter((item) => item && item.label);
  // A caller may bring its own body instead of a list of rows -- the sheet's
  // job here is the chrome: the scrim, the grabber, Escape, and the exit.
  if (!actions.length && !content) return null;

  let destroyed = false;

  const scrim = document.createElement("div");
  scrim.className = "nuvio-action-sheet-scrim";

  const sheet = document.createElement("div");
  sheet.className = "nuvio-action-sheet";
  sheet.setAttribute("role", "dialog");
  sheet.setAttribute("aria-modal", "true");

  const grabber = document.createElement("div");
  grabber.className = "nuvio-action-sheet-grabber";
  grabber.setAttribute("aria-hidden", "true");
  sheet.append(grabber);

  if (header && (header.title || header.poster)) {
    const headerNode = document.createElement("div");
    headerNode.className = "nuvio-action-sheet-header";

    const art = document.createElement("div");
    art.className = "nuvio-action-sheet-poster";
    // An episode still is 16:9, and cropping one into the poster box cut the
    // frame down to a slice of its middle. The caller says which it is holding.
    if (header.artShape === "landscape") {
      art.classList.add("is-landscape");
    }
    if (header.poster) {
      const img = document.createElement("img");
      img.src = header.poster;
      img.alt = "";
      img.loading = "lazy";
      img.decoding = "async";
      art.append(img);
      art.classList.add("is-openable");
      art.setAttribute("role", "button");
      art.setAttribute("tabindex", "0");
      art.setAttribute("aria-label", t("poster_view_larger", {}, "View poster"));
      const openPoster = (event) => {
        event.preventDefault();
        event.stopPropagation();
        openPosterViewer(header.poster, header.title);
      };
      art.addEventListener("click", openPoster);
      art.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") openPoster(event);
      });
    } else {
      art.textContent = String(header.title || "").slice(0, 24);
      art.classList.add("is-text");
    }
    headerNode.append(art);

    const text = document.createElement("div");
    text.className = "nuvio-action-sheet-text";
    const title = document.createElement("p");
    title.className = "nuvio-action-sheet-title";
    title.textContent = String(header.title || "");
    text.append(title);
    if (header.subtitle) {
      const subtitle = document.createElement("p");
      subtitle.className = "nuvio-action-sheet-subtitle";
      subtitle.textContent = String(header.subtitle);
      text.append(subtitle);
    }
    headerNode.append(text);
    sheet.append(headerNode);
  }

  if (content) {
    sheet.append(content);
  }

  const list = document.createElement("div");
  list.className = "nuvio-action-sheet-actions";
  actions.forEach((action) => {
    const row = document.createElement("button");
    row.type = "button";
    row.className = `nuvio-action-sheet-row${action.danger ? " is-danger" : ""}`;
    const icon = document.createElement("span");
    icon.className = "material-icons nuvio-action-sheet-icon";
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = actionSheetIconFor(action);
    const label = document.createElement("span");
    label.className = "nuvio-action-sheet-label";
    label.textContent = action.label;
    row.append(icon, label);
    row.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      destroy();
      onSelect(action);
    });
    list.append(row);
  });
  if (!content) {
    sheet.append(list);
  }

  function destroy({ afterExit = null } = {}) {
    if (destroyed) {
      // Teardown happens once; the caller's continuation is not teardown.
      // Selecting a row closes the sheet before the action runs, and actions
      // like openContinueWatchingDetails navigate by passing afterExit to a
      // later close. Dropping it would close the sheet and go nowhere.
      if (typeof afterExit === "function") afterExit();
      return;
    }
    destroyed = true;
    window.removeEventListener("keydown", onKeyDown, true);
    sheet.classList.remove("is-open");
    scrim.classList.remove("is-open");
    const remove = () => {
      sheet.remove();
      scrim.remove();
    };
    // Let the exit transition play, but never strand the nodes if it does not.
    setTimeout(remove, 200);
    if (typeof afterExit === "function") afterExit();
  }

  function dismiss() {
    if (destroyed) return;
    destroy();
    onDismiss();
  }

  function onKeyDown(event) {
    if (destroyed || event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation?.();
    dismiss();
  }

  scrim.addEventListener("click", dismiss);
  window.addEventListener("keydown", onKeyDown, true);

  document.body.append(scrim, sheet);
  requestAnimationFrame(() => {
    scrim.classList.add("is-open");
    sheet.classList.add("is-open");
  });

  return { destroy, dismiss, element: sheet };
}
