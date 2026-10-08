// One waiting screen that spans several routes.
//
// Continue Watching reaches the player through Detail and then the stream
// route, and the viewer asked to see neither: Detail is mounted only to load
// the metadata, the stream route only to start playback. Router says as much
// itself -- "Continue Watching mounts Detail only to resolve the Stream target"
// -- but each one still painted its own page, so one tap looked like three
// screens going past.
//
// Both paint this instead, from the same image, so the wait reads as a single
// screen whose caption changes rather than a sequence of them. Nothing here
// knows which route it is on; that is the point.
//
// The classes are its own rather than the stream route's. 126 `stream-route-*`
// rules are scoped to `#stream` in desktop.css, so borrowing them inside
// `#detail` would miss every browser override and land on the television-scale
// rules in components.css instead -- bigger, not smaller.

// The label sits in text position, where `&` and `<` are the only characters
// that can change the parse. This is deliberately not a 36th copy of
// escapeHtml: attribute and URL escaping are handled separately below, and
// consolidating those 35 copies is its own change.
function escapeText(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;");
}

// A CSS url() in an inline style, so the quote that would end the declaration
// is the one that has to go. Matches what the stream route already did.
function backdropStyle(backdrop) {
  const url = String(backdrop || "").trim();
  if (!url) {
    return "";
  }
  return ` style="background-image:url('${url.replace(/'/g, "%27")}')"`;
}

/**
 * @param {object} options
 * @param {string} options.backdrop image for the title being opened, so the
 *   screen the viewer came from appears to stay put
 * @param {string} options.label already translated, since this module has no
 *   business deciding what the wait is called
 */
export function renderRouteHandoffShell({ backdrop = "", label = "" } = {}) {
  return `
      <div class="route-handoff">
        <div class="route-handoff-backdrop"${backdropStyle(backdrop)}></div>
        <div class="route-handoff-dim"></div>
        <div class="route-handoff-status" role="status" aria-live="polite">
          <span class="route-handoff-spinner" aria-hidden="true"></span>
          <span>${escapeText(label)}</span>
        </div>
      </div>
    `;
}
