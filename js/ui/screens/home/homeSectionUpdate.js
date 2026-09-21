// A late Home update -- the Continue Watching progress correcting itself, hero
// metadata arriving -- changes a few hundred bytes and repaints the entire
// screen: every node dropped, every poster re-decoded, the whole tree laid out
// again. On a phone that is a visibly frozen frame, seconds after Home already
// looked finished.
//
// This walks the new markup against the live DOM and touches only the parts
// that actually differ. It is deliberately conservative: anything it cannot
// align one-to-one it replaces wholesale at that level, and it verifies its own
// result at the end. A caller that gets `false` must fall back to the full
// rewrite, and the DOM is safe to overwrite either way.
//
// Known limit: only element children are walked. An element whose own text
// changed while its child elements stayed aligned is not updated here -- the
// check at the end catches it and the caller rewrites, so the result is still
// correct, just not cheaper.

// Home nests shell > main > route-content > stage > viewport > scroll > row >
// track > card > frame, so stopping any shallower than this throws away whole
// rails over one changed title: at 8 a single card edit recreated 61 nodes,
// at 10 it recreates none, and both measured the same. The extra levels are
// only ever walked down the one path that actually differs.
export const MAX_DEPTH = 10;

export function keyOf(element) {
  return (
    element.getAttribute?.("data-row-key") ||
    element.getAttribute?.("data-track-row-key") ||
    element.id ||
    ""
  );
}

function syncAttributes(live, next) {
  Array.from(next.attributes).forEach(({ name, value }) => {
    if (live.getAttribute(name) !== value) {
      live.setAttribute(name, value);
    }
  });
  Array.from(live.attributes).forEach(({ name }) => {
    if (!next.hasAttribute(name)) {
      live.removeAttribute(name);
    }
  });
}

export function childrenAlign(live, next) {
  const liveKids = live.children;
  const nextKids = next.children;
  if (liveKids.length !== nextKids.length || !liveKids.length) {
    return false;
  }
  for (let index = 0; index < liveKids.length; index += 1) {
    if (liveKids[index].tagName !== nextKids[index].tagName) {
      return false;
    }
    if (keyOf(liveKids[index]) !== keyOf(nextKids[index])) {
      return false;
    }
  }
  return true;
}

function morphElement(live, next, depth, knownDifferent = false) {
  // An untouched subtree is the whole point: leaving it alone is what keeps its
  // posters decoded and its rail where the viewer left it.
  //
  // Serialising both sides is the price of knowing that, so it is not paid
  // where the answer is already in hand -- at the root, which the caller only
  // reaches once the markup is known to differ.
  if (!knownDifferent && live.outerHTML === next.outerHTML) {
    return;
  }
  if (live.tagName !== next.tagName || depth <= 0 || !childrenAlign(live, next)) {
    // Moved, not cloned: the parsed tree is discarded after this pass, and
    // deep-cloning the very subtrees being replaced is the cost this avoids.
    live.replaceWith(next);
    return;
  }
  syncAttributes(live, next);
  const liveKids = Array.from(live.children);
  const nextKids = Array.from(next.children);
  for (let index = 0; index < liveKids.length; index += 1) {
    morphElement(liveKids[index], nextKids[index], depth - 1);
  }
}

export function applySectionScopedUpdate(container, nextMarkup, { maxDepth = MAX_DEPTH } = {}) {
  if (!container || typeof nextMarkup !== "string" || !container.children?.length) {
    return false;
  }
  const doc = container.ownerDocument;
  const template = doc?.createElement?.("template");
  if (!template) {
    return false;
  }
  template.innerHTML = nextMarkup;
  // The parsed-then-serialized form is what the DOM will report, so comparing
  // against it -- rather than the raw string -- is not defeated by the parser
  // normalising quotes, void tags or attribute spelling. Held for the check at
  // the end; the caller has already ruled out "nothing changed" far more
  // cheaply, so it is not worth serialising the live tree to ask again here.
  const expected = template.innerHTML;

  const liveRoots = Array.from(container.children);
  const nextRoots = Array.from(template.content.children);
  if (liveRoots.length !== nextRoots.length) {
    return false;
  }
  for (let index = 0; index < liveRoots.length; index += 1) {
    morphElement(liveRoots[index], nextRoots[index], maxDepth, true);
  }

  // Self-check: whatever this produced must be exactly what a full rewrite
  // would have produced, or the caller redoes it the blunt way.
  return container.innerHTML === expected;
}
