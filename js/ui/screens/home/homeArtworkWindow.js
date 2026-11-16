// What Home is allowed to hold decoded, and when it has to give it back.
//
// Home keeps every catalog row mounted for the life of the screen, and a painted
// poster keeps its bitmap once it has been decoded. A profile with a hundred
// catalogs is roughly fifteen hundred 500x750 posters -- about 2 GB of decoded
// artwork -- which is far past what an installed web app on a phone is given;
// the process is killed and the page comes back at the top, which is what
// scrolling Home down looked like.
//
// So the rows load one window around the viewer, and the same window decides
// what to hand back. The release margin is deliberately wider than the load
// margin: a row that only just left the screen keeps its bitmaps, so a small
// scroll back and forth does not re-decode anything.
//
// All rectangles are in client coordinates, the space getBoundingClientRect
// returns.

/** How far past the visible edge a row may sit before its artwork loads. */
export const HOME_ARTWORK_HYDRATE_VERTICAL_MARGIN_PX = 1200;
export const HOME_ARTWORK_HYDRATE_HORIZONTAL_MARGIN_PX = 1000;
/**
 * How far past that edge a painted row keeps its decoded bitmaps: twice the load
 * margin, so scrolling back re-paints from cache instead of the network while
 * the rows that are actually reachable stay bounded.
 */
export const HOME_ARTWORK_RELEASE_VERTICAL_MARGIN_PX = 2400;
/**
 * The margin a whole row is judged by.
 *
 * It is the load margin, not zero: rows below the fold are the ones a viewer
 * scrolls into next, and the row gate runs before any per-image measurement, so
 * a zero margin here left every row past the first screen blank until it was
 * already on screen. Horizontally the row spans the window, so nothing is
 * trimmed on that axis -- the images inside it get their own margin.
 */
export const HOME_ARTWORK_ROW_MARGIN = {
  vertical: HOME_ARTWORK_HYDRATE_VERTICAL_MARGIN_PX,
  horizontal: 0
};

function clampNumber(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return null;
  }
  return Math.min(max, Math.max(min, number));
}

/**
 * The rectangle of the window the viewer can actually see.
 *
 * The element Home hands over is not always the scroll port: on the desktop
 * layout the rows wrapper sits in normal flow and reports the whole 37 000px of
 * catalogs, while the screen scrolls around it. Measuring against that box
 * meant every row was "near the viewport" and the whole catalog loaded at once.
 * Clamping to the browser viewport makes the answer the same for a scroll port,
 * a content wrapper, and the document scroller.
 *
 * @param {{top: number, bottom: number} | null | undefined} rect client-space box of the element
 * @param {number} viewportWidth
 * @param {number} viewportHeight
 * @returns {{top: number, bottom: number, left: number, right: number}}
 */
export function windowRectFromViewport(rect, viewportWidth, viewportHeight) {
  const width = Math.max(0, Number(viewportWidth || 0) || 0);
  const height = Math.max(0, Number(viewportHeight || 0) || 0);
  if (!width || !height) {
    // No viewport to clamp to -- a measurement taken before layout, or a context
    // that does not report one. Judge the box as it is rather than making the
    // window empty, which would leave every poster unloaded.
    const top = Number(rect?.top);
    const bottom = Number(rect?.bottom);
    if (!Number.isFinite(top) || !Number.isFinite(bottom)) {
      return { top: 0, bottom: 0, left: 0, right: 0 };
    }
    return { top, bottom, left: 0, right: Number(rect?.right) || 0 };
  }
  const full = { top: 0, bottom: height, left: 0, right: width };
  const top = clampNumber(rect?.top, 0, height);
  const bottom = clampNumber(rect?.bottom, 0, height);
  if (top == null || bottom == null || bottom <= top) {
    // Nothing of that box is on screen -- a scrolled-away wrapper, or one that
    // has not been laid out yet. The viewport is the honest answer.
    return full;
  }
  return { top, bottom, left: 0, right: width };
}

function marginsOf(margin) {
  if (typeof margin === "number") {
    return { vertical: margin, horizontal: margin };
  }
  const vertical = margin?.vertical;
  const horizontal = margin?.horizontal;
  return {
    vertical: vertical == null ? HOME_ARTWORK_HYDRATE_VERTICAL_MARGIN_PX : Number(vertical) || 0,
    horizontal:
      horizontal == null ? HOME_ARTWORK_HYDRATE_HORIZONTAL_MARGIN_PX : Number(horizontal) || 0
  };
}

/**
 * @param {{top: number, bottom: number} | null | undefined} rect
 * @param {{top: number, bottom: number, left: number, right: number}} windowRect
 * @param {number | {vertical?: number, horizontal?: number}} [margin]
 * @returns {boolean}
 */
export function isRectNearWindow(rect, windowRect, margin) {
  if (!rect || !windowRect) {
    return false;
  }
  const { vertical, horizontal } = marginsOf(margin);
  return (
    Number(rect.bottom) >= windowRect.top - vertical &&
    Number(rect.top) <= windowRect.bottom + vertical &&
    Number(rect.right) >= windowRect.left - horizontal &&
    Number(rect.left) <= windowRect.right + horizontal
  );
}

/**
 * Whether a row is far enough past the window that its decoded artwork is only
 * costing memory. Only the vertical axis counts: a rail scrolled sideways is
 * still on screen, and unloading it would throw the bitmaps away for nothing.
 *
 * @param {{top: number, bottom: number} | null | undefined} rect
 * @param {{top: number, bottom: number}} windowRect
 * @param {number} [margin]
 * @returns {boolean}
 */
export function isRectBeyondWindow(
  rect,
  windowRect,
  margin = HOME_ARTWORK_RELEASE_VERTICAL_MARGIN_PX
) {
  if (!rect || !windowRect) {
    return false;
  }
  const reach = Number(margin || 0) || 0;
  return (
    Number(rect.bottom) < windowRect.top - reach || Number(rect.top) > windowRect.bottom + reach
  );
}

/**
 * Hands a painted poster's decoded bitmap back to the browser.
 *
 * The row keeps its markup -- the frame, the copy, the focus target -- and gets
 * its `data-src` back, so the next pass over it loads the picture again exactly
 * the way the first one did. Only the pixels go. An image that never painted
 * (still carrying `data-src`) or is already released is left alone.
 *
 * @param {{getAttribute: Function, setAttribute: Function, removeAttribute: Function,
 *   dataset?: object, loading?: string} | null | undefined} image
 * @returns {boolean} whether a bitmap was handed back
 */
export function releasePaintedArtwork(image) {
  if (!image || typeof image.getAttribute !== "function") {
    return false;
  }
  const paintedSrc = String(image.getAttribute("src") || "").trim();
  if (!paintedSrc || image.dataset?.src) {
    return false;
  }
  image.setAttribute("data-src", paintedSrc);
  image.removeAttribute("src");
  image.loading = "lazy";
  return true;
}
