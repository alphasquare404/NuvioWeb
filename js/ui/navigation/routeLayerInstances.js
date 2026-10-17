/**
 * Layering a route under itself.
 *
 * Navigation is layered: a forward step draws the new screen as a fixed,
 * self-scrolling layer over the previous one, which stays mounted and inert
 * underneath, so Back is a removal rather than a rebuild. One case was outside
 * that rule -- a route reached from itself. Detail -> More Like This -> Detail
 * shared one screen object and one container, so the first page was torn down
 * and rebuilt from its snapshot on the way back, which is why it came back at a
 * different scroll position.
 *
 * The fix is to stop sharing: a route listed here gets a container of its own
 * and a screen instance of its own for each history entry that needs one. The
 * instance is `Object.create(blueprint)`, so every method is shared and every
 * piece of state lands on the instance -- the screens keep all their state on
 * `this` and declare no data properties, which is what makes this safe.
 */

// Routes that may be layered under themselves. A route belongs here only if its
// screen keeps all state on `this` (no module-level mutables, no data
// properties on the screen object) and scopes its DOM reads to `this.container`.
export const STACKABLE_ROUTES = new Set(["detail"]);

// Marks a container the router made, as opposed to the one the app shell ships
// with. Only the former may be removed again.
const ALLOCATED_FLAG = "routeLayerAllocated";

export function canStackRouteUnderItself({
  routeName,
  currentRoute,
  isBrowser = false,
  fromHistory = false,
  isBackNavigation = false,
  replaceHistory = false,
  historyIndex = null,
  sameScreen = false,
  nonBackstack = false
} = {}) {
  return Boolean(
    isBrowser &&
    STACKABLE_ROUTES.has(routeName) &&
    currentRoute === routeName &&
    // A Back or Forward is resolved against the layer stack, never by adding
    // to it; and an entry that is being replaced leaves nothing to come back
    // to.
    !fromHistory &&
    !isBackNavigation &&
    !replaceHistory &&
    !nonBackstack &&
    // The same title opened again is the same screen, not a second one.
    !sameScreen &&
    Number.isInteger(historyIndex)
  );
}

/**
 * A sibling container for the next instance of a route.
 *
 * It carries the route's id, because that is what the stylesheets select on
 * (`#detail .series-detail-logo` and some fifty others), and two live Detail
 * layers are two elements with that id. Nothing reads these by id: the router
 * hands each instance its own container, and the screens query inside it.
 */
export function createRouteContainer(documentRef, routeName) {
  if (!documentRef?.createElement) {
    return null;
  }
  const container = documentRef.createElement("div");
  container.id = routeName;
  container.className = "screen";
  container.dataset[ALLOCATED_FLAG] = "true";
  container.dataset.routeName = routeName;
  const shell = documentRef.getElementById?.("app") || documentRef.body;
  shell?.appendChild?.(container);
  return container;
}

export function isAllocatedRouteContainer(container) {
  return Boolean(container?.dataset?.[ALLOCATED_FLAG]);
}

/**
 * The methods a second instance of a screen is built from.
 *
 * Taken before the screen has run, and only then. A screen that has run
 * carries a page's worth of state, and not all of that state is data: these
 * screens keep their event handlers as functions on `this` and bind them
 * behind `if (this.boundX) return;`. A prototype taken afterwards hands the
 * next instance those handlers, which then believes it is already bound and
 * binds nothing -- a second Detail where only the markup responds, because
 * the one handler still attached belongs to the page underneath it.
 *
 * Data properties are left out for the same reason in the other direction:
 * a new page must not read the old one's meta, episodes or scroll position.
 */
export function createScreenPrototype(screen) {
  if (!screen) {
    return null;
  }
  const prototype = Object.create(Object.getPrototypeOf(screen) || Object.prototype);
  Object.getOwnPropertyNames(screen).forEach((name) => {
    const descriptor = Object.getOwnPropertyDescriptor(screen, name);
    if (!descriptor) {
      return;
    }
    if (typeof descriptor.value === "function" || descriptor.get || descriptor.set) {
      Object.defineProperty(prototype, name, descriptor);
    }
  });
  return prototype;
}

export function createRouteInstance(prototype, container) {
  if (!prototype) {
    return null;
  }
  const instance = Object.create(prototype);
  if (container) {
    instance.container = container;
  }
  return instance;
}

/**
 * Takes an instance out of the page.
 *
 * Only a container this module made is removed; the shell's own stays where it
 * is, emptied by the screen's own cleanup the way it always was.
 */
export function destroyRouteInstance(screen) {
  const container = screen?.container;
  if (!isAllocatedRouteContainer(container)) {
    return false;
  }
  container.remove?.();
  return true;
}
