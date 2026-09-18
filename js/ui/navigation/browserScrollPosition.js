// Which element a screen scrolls is not something to guess any more.
//
// Navigation is layered: the router makes the screen you are looking at its own
// fixed, self-scrolling container, and only the bottom screen -- the one never
// layered over anything -- scrolls the document itself. So the answer follows
// directly from whether this screen is currently a layer.
//
// It used to be guessed, from a `scrollHeight > clientHeight + 1` geometry test
// plus a record of which elements had ever fired a real scroll event. Both are
// facts about the page as a whole rather than about one screen, so a screen
// could be handed a different screen's scroller: on a cold start Detail asked
// for its own scroller, was given `document.body` -- which was Home's -- and
// wrote 0 into it while Home sat alive underneath, discarding the position Back
// was meant to restore. The geometry test also false-positived on
// `document.body` (939 vs 910 here, 896 vs 852 on a real device), so even the
// tie-breaker preferred the wrong element.
function isLayeredScreen(element) {
  // The router owns this inline style: applyLayerChrome sets it when a screen
  // becomes a layer, and releasing that layer removes it again.
  return element?.style?.position === "fixed";
}

export function getBrowserVerticalScrollOwner(routeContainer = null) {
  if (typeof document === "undefined") {
    return null;
  }
  if (isLayeredScreen(routeContainer)) {
    return routeContainer;
  }
  // The bottom screen scrolls the document. That is `document.body` in this
  // app's browser shell -- `document.documentElement` never actually moves,
  // which is why it must not be consulted here.
  return document.body || null;
}

export function getBrowserVerticalScrollTop(routeContainer = null) {
  return Number(getBrowserVerticalScrollOwner(routeContainer)?.scrollTop || 0);
}

export function setBrowserVerticalScrollTop(value = 0, routeContainer = null) {
  const owner = getBrowserVerticalScrollOwner(routeContainer);
  if (!owner) {
    return;
  }
  const maxScrollTop = Math.max(0, Number(owner.scrollHeight || 0) - Number(owner.clientHeight || 0));
  owner.scrollTop = Math.max(0, Math.min(maxScrollTop, Number(value || 0)));
}
