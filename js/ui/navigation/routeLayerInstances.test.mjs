import assert from "node:assert/strict";
import test from "node:test";

import {
  canStackRouteUnderItself,
  createRouteContainer,
  createRouteInstance,
  createScreenPrototype,
  destroyRouteInstance,
  isAllocatedRouteContainer,
  STACKABLE_ROUTES
} from "./routeLayerInstances.js";

const base = {
  routeName: "detail",
  currentRoute: "detail",
  isBrowser: true,
  historyIndex: 3,
  sameScreen: false
};

test("a forward step from a route to itself is layered", () => {
  assert.equal(canStackRouteUnderItself(base), true);
});

test("a Back, a Forward, or a replaced entry is never layered", () => {
  // Back and Forward are answered from the stack; adding to it would bury the
  // entry they are trying to reach.
  assert.equal(canStackRouteUnderItself({ ...base, fromHistory: true }), false);
  assert.equal(canStackRouteUnderItself({ ...base, isBackNavigation: true }), false);
  // A replaced entry leaves nothing to come back to.
  assert.equal(canStackRouteUnderItself({ ...base, replaceHistory: true }), false);
  assert.equal(canStackRouteUnderItself({ ...base, nonBackstack: true }), false);
  assert.equal(canStackRouteUnderItself({ ...base, historyIndex: null }), false);
});

test("the same title opened again is the same screen, not a second one", () => {
  assert.equal(canStackRouteUnderItself({ ...base, sameScreen: true }), false);
});

test("only a listed route stacks, and only from itself", () => {
  assert.equal(
    canStackRouteUnderItself({ ...base, routeName: "library", currentRoute: "library" }),
    false
  );
  assert.equal(canStackRouteUnderItself({ ...base, currentRoute: "home" }), false);
  assert.equal(canStackRouteUnderItself({ ...base, isBrowser: false }), false);
  assert.ok(STACKABLE_ROUTES.has("detail"));
});

// The instance is what makes two live pages possible: methods are shared, and
// every piece of state lands on the instance that wrote it.
test("instances share methods and keep their own state", () => {
  const blueprint = {
    describe() {
      return `${this.name}:${this.items?.length ?? 0}`;
    }
  };
  const first = createRouteInstance(blueprint, null);
  const second = createRouteInstance(blueprint, null);
  first.name = "A";
  first.items = [1, 2];
  second.name = "B";
  second.items = [];
  assert.equal(first.describe(), "A:2");
  assert.equal(second.describe(), "B:0");
  assert.equal(blueprint.name, undefined);
  assert.equal(first.describe, second.describe);
});

test("a container the router made can be taken back out; the shell's cannot", () => {
  const removed = [];
  const fakeDocument = {
    createElement: () => ({
      dataset: {},
      style: {},
      remove() {
        removed.push(this);
      }
    }),
    getElementById: () => ({ appendChild: () => {} })
  };
  const container = createRouteContainer(fakeDocument, "detail");
  assert.equal(container.id, "detail");
  assert.equal(container.className, "screen");
  assert.equal(isAllocatedRouteContainer(container), true);
  assert.equal(destroyRouteInstance({ container }), true);
  assert.equal(removed.length, 1);

  const shellContainer = { dataset: {}, remove: () => removed.push("shell") };
  assert.equal(isAllocatedRouteContainer(shellContainer), false);
  assert.equal(destroyRouteInstance({ container: shellContainer }), false);
  assert.equal(removed.length, 1);
});

// A screen that has already run holds a page's worth of state. A second layer
// must not be able to read it.
test("a second instance inherits methods, never the running screen's state", () => {
  const registered = {
    render() {
      return `${this.title ?? "none"}/${this.items?.length ?? 0}`;
    }
  };
  // The registered screen is also the one that runs.
  registered.title = "First page";
  registered.items = [1, 2, 3];
  registered.container = { dataset: {} };

  const prototype = createScreenPrototype(registered);
  const second = createRouteInstance(prototype, { dataset: { routeLayerAllocated: "true" } });

  assert.equal(second.title, undefined);
  assert.equal(second.items, undefined);
  assert.equal(second.render(), "none/0");
  // The running screen is untouched by any of this.
  assert.equal(registered.render(), "First page/3");
  // And the method really is shared rather than copied per instance.
  assert.equal(Object.getPrototypeOf(second).render, registered.render);
});

// The hazard that decides when the prototype may be taken. These screens keep
// their event handlers as functions on `this` and bind them behind
// `if (this.boundX) return;`, so a prototype taken after the screen has run
// hands the next instance handlers it never attached.
test("a prototype taken after the screen has run carries its bound handlers", () => {
  const screen = {
    bindActions() {
      if (this.boundActionHandler) {
        return "skipped";
      }
      this.boundActionHandler = () => "first page";
      return "bound";
    }
  };

  const pristine = createScreenPrototype(screen);
  screen.bindActions();
  const tainted = createScreenPrototype(screen);

  // Taken before the screen ran: the next instance binds its own handler.
  const clean = createRouteInstance(pristine, null);
  assert.equal(clean.boundActionHandler, undefined);
  assert.equal(clean.bindActions(), "bound");

  // Taken afterwards: it inherits the first page's handler and binds nothing,
  // which is the second Detail where only the markup responded.
  const shared = createRouteInstance(tainted, null);
  assert.equal(typeof shared.boundActionHandler, "function");
  assert.equal(shared.bindActions(), "skipped");
});
