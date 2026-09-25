// Bottom action sheet for touch long-press.
//
// Modelled on NuvioDesktop's ContinueWatchingActionSheet: opens fully expanded
// (no half-stop), a poster/title/subtitle header, divider-separated rows with
// icons, destructive action last, and safe-area padding so the final row is not
// under the home indicator. Selecting an action dismisses the sheet.
//
// This is not the desktop menu. A compact cursor- or card-anchored menu
// is wrong under a thumb.

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
  onSelect = () => {},
  onDismiss = () => {}
} = {}) {
  const actions = (Array.isArray(items) ? items : []).filter((item) => item && item.label);
  if (!actions.length) return null;

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
  sheet.append(list);

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
