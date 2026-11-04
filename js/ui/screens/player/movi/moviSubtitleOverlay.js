// The subtitle layer, owned by the app.
//
// movi draws its own subtitles for the tracks inside the container, but an addon
// subtitle is a file the app fetched: nothing in the element knows about it, and
// the spike proved there is no working way to hand one over. So this is a plain
// DOM layer over the picture, driven by the playhead — no dependence on the
// engine's subtitle API, which is also why it can be reused verbatim if the
// engine is ever swapped.
//
// Two rules come from measurement, not taste:
//   1. The playhead reports ~4x/second and the element's own render loop is
//      faster still. This only touches the DOM when the TEXT changes.
//   2. Cue lookup is a binary search. A per-tick scan over a film's cues is
//      waste that shows up as jitter on a phone.

import { findActiveCue } from "./subtitleTextParser.js";

// Viewport-anchored rather than box-anchored, and the screen moves it to the
// element's rectangle. The reason is fullscreen: movi renders to a canvas, so it
// cannot enter native fullscreen the way a <video> does, and its own fullscreen is
// a viewport-fill of the element. A layer anchored to the stage stays where the
// stage was and the subtitles disappear exactly when the picture gets bigger.
const CONTAINER_STYLE = [
  "position:fixed",
  "left:0",
  "top:0",
  "width:100%",
  "height:100%",
  "display:flex",
  "align-items:flex-end",
  "justify-content:center",
  "pointer-events:none",
  "overflow:hidden",
  "z-index:2147483000"
].join(";");

const LINE_STYLE = [
  "max-width:92%",
  "margin:0 0 8% 0",
  "padding:0.1em 0.45em",
  "text-align:center",
  "white-space:pre-wrap",
  "line-height:1.25",
  "font-family:system-ui,sans-serif",
  "font-size:clamp(16px,5.2vw,34px)",
  "color:#fff",
  "text-shadow:0 1px 3px rgba(0,0,0,.9)",
  "background:transparent",
  "border-radius:6px",
  "display:none"
].join(";");

/**
 * @param {object} options
 * @param {HTMLElement} options.host      element the layer sits over
 * @param {Document} [options.documentRef] injected so the layer is testable
 */
export function createMoviSubtitleOverlay({ host, documentRef = host?.ownerDocument } = {}) {
  if (!host || !documentRef) {
    throw new Error("subtitle overlay needs a host element");
  }

  const container = documentRef.createElement("div");
  container.className = "movi-subtitle-overlay";
  container.style.cssText = CONTAINER_STYLE;

  const line = documentRef.createElement("div");
  line.className = "movi-subtitle-line";
  line.style.cssText = LINE_STYLE;
  line.textContent = "";
  container.append(line);

  let cues = [];
  let shownText = null;
  let mounted = false;

  function show(text) {
    if (text === shownText) return;
    shownText = text;
    line.textContent = text;
    line.style.display = text ? "block" : "none";
  }

  return {
    container,
    line,

    mount() {
      if (mounted) return;
      host.append(container);
      mounted = true;
    },

    setCues(next) {
      cues = Array.isArray(next) ? [...next].sort((left, right) => left.start - right.start) : [];
      // Force the next tick to repaint: the same text from a different file is a
      // different cue.
      shownText = null;
      show("");
    },

    setTime(seconds) {
      const cue = findActiveCue(cues, seconds);
      show(cue ? cue.text : "");
    },

    /** Applied over the defaults; anything absent keeps its default. */
    /**
     * Move the layer onto the picture.
     *
     * Called on the playhead tick and on every resize, so the layer follows the
     * element through a fullscreen change instead of guessing where it went.
     */
    anchorTo({ left, top, width, height }) {
      if (![left, top, width, height].every((value) => Number.isFinite(value))) return;
      if (width < 2 || height < 2) return;
      container.style.left = `${Math.round(left)}px`;
      container.style.top = `${Math.round(top)}px`;
      container.style.width = `${Math.round(width)}px`;
      container.style.height = `${Math.round(height)}px`;
    },

    setStyle(style = {}) {
      if (style.color) line.style.color = String(style.color);
      if (style.background) line.style.background = String(style.background);
      if (style.fontSize) line.style.fontSize = String(style.fontSize);
      if (style.textShadow) line.style.textShadow = String(style.textShadow);
      if (style.bottomOffset) line.style.marginBottom = String(style.bottomOffset);
      if (style.maxWidth) line.style.maxWidth = String(style.maxWidth);
    },

    setVisible(visible) {
      container.style.display = visible ? "flex" : "none";
    },

    destroy() {
      mounted = false;
      shownText = null;
      cues = [];
      // Clear before detaching: a layer that is somehow put back must not show
      // the last line of the file that was playing.
      line.textContent = "";
      line.style.display = "none";
      container.remove();
    }
  };
}
