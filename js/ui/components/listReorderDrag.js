// Dragging a row to reorder it, in one place.
//
// Five lists had their own copy of this, and all five shared one fault that
// made a drag good for exactly one step:
//
//   The handle captured the pointer, and the handle lives inside the row being
//   dragged. Moving that row is a remove and an insert, and a node leaving the
//   document loses the capture it held. So the first reorder killed the gesture
//   that caused it. No further moves arrived, no pointerup arrived either, and
//   the row was left with its dragging class still on. Picking a row up and
//   carrying it three places was never possible; you could nudge it one step
//   and then had to let go and start again.
//
//   Measured on the old code: pointerdown, gotpointercapture, one pointermove,
//   lostpointercapture, and nothing after it.
//
// Listening on the window instead means the gesture belongs to the drag, not to
// whichever node happens to be under the pointer or still in the document.
//
// Two smaller faults went with it. A row was found by asking which one
// contained the pointer -- between two rows, above the first or below the last,
// none does, so the drag went dead exactly where a person aims when moving
// something to an end; nearest centre always answers. And `touch-action: pan-y`
// on the handle handed the vertical drag to the page scroller, which cancelled
// the pointer, so on a touchscreen the list simply scrolled instead.

const DRAG_THRESHOLD_PX = 6;

// One drag at a time, anywhere on the page, so this can be module scope.
let reorderInProgress = false;
const deferredWork = new Set();

/**
 * Hold a redraw until the finger is off the screen.
 *
 * These lists redraw by writing their markup again, which destroys every row
 * and makes new ones. A redraw that lands mid-drag therefore throws away the
 * row being dragged -- it blinks, and what is left under the finger is a node
 * that is no longer in the document. Nothing the person did causes it: it is a
 * sync from the previous action reporting back, a second or two later, while
 * they are already dragging the next row.
 *
 * The list on screen is already in the order the drag has put it, so the
 * redraw has nothing to say until the drag is over. It waits.
 *
 * Returns true when the work was deferred, so a caller can stop there.
 */
export function deferWhileReordering(work) {
  if (!reorderInProgress || typeof work !== "function") return false;
  deferredWork.add(work);
  return true;
}

function runDeferredWork() {
  const pending = [...deferredWork];
  deferredWork.clear();
  pending.forEach((work) => {
    try {
      work();
    } catch (_) {
      // A deferred redraw failing must not take the others with it.
    }
  });
}

/**
 * Which row the pointer is asking for.
 *
 * Asking which row contains the pointer leaves three places with no answer:
 * the gaps between rows, above the first, and below the last -- and the last
 * two are exactly where someone aims when moving a row to an end. Nearest
 * centre always answers, and answers the same thing inside a row.
 *
 * Ties go to the earlier row, so a pointer exactly between two rows does not
 * flicker between them as it is held still.
 */
export function nearestRowIndex(centres = [], pointerY = 0) {
  let index = -1;
  let shortest = Infinity;
  centres.forEach((centre, candidate) => {
    const distance = Math.abs(pointerY - centre);
    if (distance < shortest) {
      shortest = distance;
      index = candidate;
    }
  });
  return index;
}

const EDGE_SCROLL_ZONE_PX = 72;
const EDGE_SCROLL_MAX_PX = 14;
const SETTLE_MS = 180;
const SETTLE_EASING = "cubic-bezier(0.2, 0.7, 0.3, 1)";

export function bindListReorderDrag({
  container,
  handleSelector,
  itemSelector,
  draggingClass = "is-dragging",
  dragOverClass = "",
  bodyClass = "",
  onMove = null,
  onDrop = null
} = {}) {
  if (!container || !handleSelector || !itemSelector) return;
  const move = typeof onMove === "function" ? onMove : () => {};
  const drop = typeof onDrop === "function" ? onDrop : () => {};
  const items = () => Array.from(container.querySelectorAll(itemSelector));
  let drag = null;

  // Where every row sits, measured once and kept. Measuring all of them on each
  // pointer event forced a layout per row per event -- eleven rows, sixty-odd
  // events a second -- and that cost is paid in the one place a person can feel
  // it. They only move when the order does, or when the page scrolls under the
  // finger, so that is when they are measured again.
  const measure = () => {
    drag.rows = items();
    // One rect per row answers both questions, so the row that is nearest and
    // the distance each row has to travel cost the same single read.
    const rects = drag.rows.map((item) => item.getBoundingClientRect());
    // The dragged row is carrying a transform, so its rect is where the finger
    // has put it rather than where the layout has. Measured as it is drawn, its
    // centre chases the finger, the row nearest the finger keeps changing, and
    // the list swaps back and forth under its own transform. Its own offset is
    // taken back out so every row is measured where it actually sits.
    const dragged = drag.rows.indexOf(drag.row);
    drag.tops = rects.map((rect, index) => rect.top - (index === dragged ? drag.applied : 0));
    drag.centres = drag.tops.map((top, index) => top + rects[index].height / 2);
  };

  // Scrolling moves every row by the same amount, which is arithmetic rather
  // than a question for the layout engine. Measuring again here would be a
  // read per row per frame for the whole time a row is held near an edge.
  const shiftMeasurements = (by) => {
    drag.tops = drag.tops.map((top) => top - by);
    drag.centres = drag.centres.map((centre) => centre - by);
  };

  // Rows displaced by a reorder slide to their new place instead of appearing
  // there. Each is put back where it was with a transform and then released,
  // which the compositor can animate without touching layout again.
  const settleDisplacedRows = (tops) => {
    drag.rows.forEach((item, index) => {
      if (item === drag.row) return;
      const was = tops.get(item);
      const now = drag.tops[index];
      if (was === undefined || was === now) return;
      item.style.transition = "none";
      item.style.transform = `translateY(${was - now}px)`;
      drag.settling.add(item);
    });
    requestAnimationFrame(() => {
      if (!drag) return;
      drag.settling.forEach((item) => {
        item.style.transition = `transform ${SETTLE_MS}ms ${SETTLE_EASING}`;
        item.style.transform = "";
      });
    });
  };

  const clearSettled = (rows) => {
    rows.forEach((item) => {
      item.style.transition = "";
      item.style.transform = "";
    });
  };

  // Eleven rows do not fit on a phone, so a drag that cannot reach past the
  // edge cannot reach half the list. Holding the row near the top or bottom
  // scrolls the page, faster the closer to the edge it is held.
  const edgeScroll = () => {
    const viewport = window.innerHeight || document.documentElement.clientHeight || 0;
    if (!viewport) return 0;
    const fromTop = drag.pointerY;
    const fromBottom = viewport - drag.pointerY;
    let step = 0;
    if (fromTop < EDGE_SCROLL_ZONE_PX) {
      step = -Math.ceil(
        ((EDGE_SCROLL_ZONE_PX - fromTop) / EDGE_SCROLL_ZONE_PX) * EDGE_SCROLL_MAX_PX
      );
    } else if (fromBottom < EDGE_SCROLL_ZONE_PX) {
      step = Math.ceil(
        ((EDGE_SCROLL_ZONE_PX - fromBottom) / EDGE_SCROLL_ZONE_PX) * EDGE_SCROLL_MAX_PX
      );
    }
    if (!step) return 0;
    const before = window.scrollY;
    window.scrollBy(0, step);
    return window.scrollY - before;
  };

  // One pass per frame, however many pointer events arrived in it. A finger can
  // report faster than the screen refreshes, and doing this work per event was
  // work the screen never showed.
  const tick = () => {
    drag.frame = 0;
    if (!drag.row.isConnected) {
      finishDrag();
      return;
    }

    const scrolled = edgeScroll();
    if (scrolled) {
      // The page moved under the row, so where the row is anchored moved too.
      drag.startY -= scrolled;
      shiftMeasurements(scrolled);
    }

    const from = drag.rows.indexOf(drag.row);
    const to = from < 0 ? -1 : nearestRowIndex(drag.centres, drag.pointerY);
    if (to >= 0 && to !== from) {
      // Where everything sat a moment ago, taken from the last measurement
      // rather than asked for again.
      const tops = new Map(drag.rows.map((item, index) => [item, drag.tops[index]]));
      if (to > from) drag.rows[to].after(drag.row);
      else drag.rows[to].before(drag.row);
      move(from, to);
      measure();
      // The row just changed places in the layout. Folding that jump into its
      // transform is what keeps it under the pointer rather than leaping ahead.
      drag.offset += tops.get(drag.row) - drag.tops[drag.rows.indexOf(drag.row)];
      settleDisplacedRows(tops);
      if (dragOverClass) {
        drag.rows.forEach((item) => item.classList.toggle(dragOverClass, item === drag.rows[to]));
      }
    }

    drag.applied = drag.pointerY - drag.startY + drag.offset;
    drag.row.style.transform = `translateY(${drag.applied}px)`;
    // Keep the loop alive while the row is held in a scrolling zone, so it goes
    // on scrolling without the finger having to move.
    if (scrolled) schedule();
  };

  const schedule = () => {
    if (!drag || drag.frame) return;
    drag.frame = requestAnimationFrame(() => {
      if (drag) tick();
    });
  };

  const onPointerMove = (event) => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    drag.pointerY = event.clientY;
    if (!drag.started) {
      if (Math.abs(drag.pointerY - drag.startY) < DRAG_THRESHOLD_PX) return;
      drag.started = true;
      reorderInProgress = true;
      drag.row.classList.add(draggingClass);
      drag.row.style.willChange = "transform";
      if (bodyClass) document.body.classList.add(bodyClass);
      measure();
    }
    event.preventDefault();
    schedule();
  };

  function finishDrag() {
    if (!drag) return;
    const reordered = drag.started;
    const settled = [...drag.settling];
    if (drag.frame) cancelAnimationFrame(drag.frame);
    drag.row.classList.remove(draggingClass);
    drag.row.style.transform = "";
    drag.row.style.willChange = "";
    clearSettled(settled);
    if (dragOverClass) items().forEach((item) => item.classList.remove(dragOverClass));
    if (bodyClass) document.body.classList.remove(bodyClass);
    drag = null;
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", endDrag);
    window.removeEventListener("pointercancel", endDrag);
    reorderInProgress = false;
    // Whatever was held back while the finger was down happens now, before the
    // drop writes anything, so a stale status cannot outlive the drag.
    runDeferredWork();
    if (reordered) void drop();
  }

  const endDrag = (event) => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    finishDrag();
  };

  container.querySelectorAll(handleSelector).forEach((handle) => {
    const row = handle.closest(itemSelector);
    if (!row) return;
    // Said here rather than in a stylesheet so that wiring a list up is all it
    // takes: a handle not told this hands its gesture to the scroller.
    handle.style.touchAction = "none";

    handle.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      drag = {
        pointerId: event.pointerId,
        row,
        startY: event.clientY,
        pointerY: event.clientY,
        offset: 0,
        applied: 0,
        started: false,
        frame: 0,
        rows: [],
        centres: [],
        settling: new Set()
      };
      // passive: false because the move handler has to be able to refuse the
      // browser's own interpretation of the gesture.
      window.addEventListener("pointermove", onPointerMove, { passive: false });
      window.addEventListener("pointerup", endDrag);
      window.addEventListener("pointercancel", endDrag);
    });
  });
}
