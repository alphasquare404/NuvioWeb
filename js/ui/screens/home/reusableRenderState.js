// Home repaints itself whole every time late data lands -- catalog rows, the
// Continue Watching progress, hero metadata. Rewriting the container drops
// every node, so each pass re-creates hundreds of <img> elements that have to
// decode again, and every rail loses the position the viewer put it in. On a
// phone that is the visible glitch: blank posters and a frozen frame, seconds
// after Home already looked finished.
//
// Nothing here changes what is rendered. It only carries the two pieces of
// state that survive a rewrite intact across it.

export function captureReusableRenderState(container) {
  if (!container) {
    return null;
  }
  const trackScrollLeft = new Map();
  container.querySelectorAll(".home-track[data-track-row-key]").forEach((track) => {
    const scrollLeft = Math.round(Number(track.scrollLeft) || 0);
    if (scrollLeft > 0) {
      trackScrollLeft.set(String(track.dataset?.trackRowKey || ""), scrollLeft);
    }
  });
  // Only images that actually finished are worth keeping: reusing a node that
  // never loaded would carry the failure over instead of letting it retry.
  const decodedImages = new Map();
  container.querySelectorAll("img[src]").forEach((image) => {
    if (!image.complete || !image.naturalWidth) {
      return;
    }
    const key = image.src;
    if (key && !decodedImages.has(key)) {
      decodedImages.set(key, image);
    }
  });
  return { trackScrollLeft, decodedImages };
}

// Split from the rail restore below because the two want different moments:
// the posters must be back before the browser paints, while a rail can only be
// positioned once the row has its final width.
export function restoreDecodedImages(container, state) {
  if (!container || !state) {
    return;
  }
  const { decodedImages } = state;
  if (decodedImages?.size) {
    container.querySelectorAll("img[src]").forEach((fresh) => {
      const reused = decodedImages.get(fresh.src);
      // Only a node the update actually dropped may be re-placed. A node still
      // in the document is doing its job where it is, and moving it -- which is
      // what two cards sharing one artwork URL would trigger -- would tear it
      // out of that spot and leave a hole behind.
      if (!reused || reused === fresh || reused.isConnected) {
        return;
      }
      // One node cannot live in two places, so it is spent once placed.
      decodedImages.delete(fresh.src);
      // The fresh node carries this pass's classes and sizing; the old one
      // carries the decoded bitmap. Move the former onto the latter.
      Array.from(fresh.attributes).forEach(({ name, value }) => {
        if (name !== "src" && reused.getAttribute(name) !== value) {
          reused.setAttribute(name, value);
        }
      });
      Array.from(reused.attributes).forEach(({ name }) => {
        if (name !== "src" && !fresh.hasAttribute(name)) {
          reused.removeAttribute(name);
        }
      });
      fresh.replaceWith(reused);
    });
  }
}

export function restoreTrackScroll(container, state) {
  if (!container || !state) {
    return;
  }
  const { trackScrollLeft } = state;
  if (trackScrollLeft?.size) {
    container.querySelectorAll(".home-track[data-track-row-key]").forEach((track) => {
      const scrollLeft = trackScrollLeft.get(String(track.dataset?.trackRowKey || ""));
      if (!scrollLeft) {
        return;
      }
      // Reading the extent first settles layout, so the assignment is not
      // clamped to 0 against a track the parser has not measured yet.
      const maxScrollLeft = Math.max(
        0,
        Number(track.scrollWidth || 0) - Number(track.clientWidth || 0)
      );
      track.scrollLeft = Math.min(scrollLeft, maxScrollLeft);
    });
  }
}
