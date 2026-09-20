import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// A small DOM stand-in. Enough for the menu to build, position, key-navigate
// and tear itself down, without pulling in a full browser environment.
function installDom({
  viewport = { width: 1000, height: 800 },
  menuSize = { width: 200, height: 160 }
} = {}) {
  const listeners = { window: new Map(), document: new Map() };
  const make = (tag) => {
    const node = {
      tag,
      children: [],
      parent: null,
      isConnected: false,
      textContent: "",
      tabIndex: 0,
      style: {},
      focusCount: 0,
      classes: new Set(),
      attrs: new Map(),
      handlers: new Map(),
      classList: {
        add: (c) => node.classes.add(c),
        remove: (c) => node.classes.delete(c),
        contains: (c) => node.classes.has(c)
      },
      setAttribute: (k, v) => node.attrs.set(k, v),
      append: (...kids) =>
        kids.forEach((k) => {
          k.parent = node;
          k.isConnected = true;
          node.children.push(k);
        }),
      remove: () => {
        node.isConnected = false;
        if (node.parent) node.parent.children = node.parent.children.filter((c) => c !== node);
      },
      addEventListener: (type, fn) => node.handlers.set(type, fn),
      removeEventListener: (type) => node.handlers.delete(type),
      contains: (other) => other === node || node.children.includes(other),
      focus: () => {
        node.focusCount += 1;
      },
      getBoundingClientRect: () => ({
        width: menuSize.width,
        height: menuSize.height,
        left: 0,
        top: 0,
        bottom: 0
      }),
      get className() {
        return [...node.classes].join(" ");
      },
      set className(v) {
        node.classes = new Set(String(v).split(" ").filter(Boolean));
      }
    };
    return node;
  };
  const body = make("body");
  globalThis.document = {
    body,
    createElement: make,
    addEventListener: (t, fn) => listeners.document.set(t, fn),
    removeEventListener: (t) => listeners.document.delete(t),
    querySelector: () => null
  };
  globalThis.window = {
    innerWidth: viewport.width,
    innerHeight: viewport.height,
    addEventListener: (t, fn) => listeners.window.set(t, fn),
    removeEventListener: (t) => listeners.window.delete(t)
  };
  return {
    body,
    listeners,
    key: (k) => listeners.window.get("keydown")?.(keyEvent(k)),
    keyUp: () => listeners.window.get("keyup")?.(keyEvent("Enter"))
  };
}

function keyEvent(key) {
  return {
    key,
    prevented: false,
    preventDefault() {
      this.prevented = true;
    },
    stopPropagation() {},
    stopImmediatePropagation() {}
  };
}

const dom = installDom();
const { openDesktopContextMenu, anchorPositionForRect, clampContextMenuPosition } =
  await import("./desktopContextMenu.js");

const ITEMS = [
  { key: "details", label: "Go to details", icon: "info" },
  { key: "startOver", label: "Start from beginning", icon: "replay" },
  { key: "remove", label: "Remove", icon: "delete_outline", danger: true }
];

// --- anchoring ---------------------------------------------------------------

test("right-click anchors to the pointer", () => {
  assert.equal(anchorPositionForRect(null), null, "no rect means pointer coordinates are used");
});

test("Hold Enter anchors under the focused card so the two stay associated", () => {
  const pos = anchorPositionForRect({ left: 120, bottom: 300 });
  assert.equal(pos.x, 120);
  assert.ok(pos.y > 300, "sits just below the card, not on top of it");
});

test("a menu with room stays where it was asked to go", () => {
  assert.deepEqual(
    clampContextMenuPosition({
      x: 100,
      y: 120,
      menuWidth: 200,
      menuHeight: 160,
      viewportWidth: 1000,
      viewportHeight: 800
    }),
    { left: 100, top: 120 }
  );
});

test("a menu near an edge flips instead of hanging off", () => {
  const pos = clampContextMenuPosition({
    x: 960,
    y: 780,
    menuWidth: 200,
    menuHeight: 160,
    viewportWidth: 1000,
    viewportHeight: 800
  });
  assert.ok(pos.left + 200 <= 1000 && pos.top + 160 <= 800);
});

// --- behaviour ---------------------------------------------------------------

test("selecting a row runs that action once and closes the menu", () => {
  const picked = [];
  const handle = openDesktopContextMenu({
    x: 10,
    y: 10,
    items: ITEMS,
    onSelect: (a) => picked.push(a.key)
  });
  const rows = handle.element.children;
  rows[0].handlers.get("click")({ preventDefault() {}, stopPropagation() {} });
  assert.deepEqual(picked, ["details"]);
  assert.equal(handle.element.isConnected, false, "menu closes on selection");
});

test("arrow keys move the selection and Enter activates it", () => {
  const picked = [];
  const handle = openDesktopContextMenu({
    x: 10,
    y: 10,
    anchorRect: { left: 0, bottom: 0 },
    items: ITEMS,
    onSelect: (a) => picked.push(a.key)
  });
  // Hold Enter opened this, so the key must be released before Enter selects.
  dom.keyUp();
  dom.key("ArrowDown");
  dom.key("Enter");
  assert.deepEqual(picked, ["startOver"], "opened on the first row, one step down is the second");
  assert.equal(handle.element.isConnected, false);
});

test("Escape closes without running anything", () => {
  let dismissed = false;
  const picked = [];
  const handle = openDesktopContextMenu({
    x: 10,
    y: 10,
    items: ITEMS,
    onSelect: (a) => picked.push(a.key),
    onDismiss: () => {
      dismissed = true;
    }
  });
  dom.key("Escape");
  assert.equal(dismissed, true);
  assert.deepEqual(picked, []);
  assert.equal(handle.element.isConnected, false);
});

test("closing restores focus to the card the keyboard opened it from", () => {
  const card = {
    isConnected: true,
    focusCount: 0,
    focus() {
      this.focusCount += 1;
    }
  };
  const handle = openDesktopContextMenu({
    x: 0,
    y: 0,
    anchorRect: { left: 0, bottom: 0 },
    items: ITEMS,
    restoreFocusTo: card
  });
  handle.destroy();
  assert.equal(card.focusCount, 1, "focus goes back to the originating card");
});

// --- the Continue Watching "Go to details" regression -------------------------

test("destroy forwards afterExit, which is how navigation is performed", () => {
  // openContinueWatchingDetails hangs Router.navigate off afterExit. A close
  // path that swallows it shuts the menu and leaves the user on Home.
  let navigated = false;
  const handle = openDesktopContextMenu({ x: 0, y: 0, items: ITEMS });
  handle.destroy({
    afterExit: () => {
      navigated = true;
    }
  });
  assert.equal(navigated, true);
});

test("the real Continue Watching sequence navigates exactly once", () => {
  // Reproduces the actual chain that failed manually:
  //   select row -> presenter closes itself -> CW action runs ->
  //   openContinueWatchingDetails -> destroyHomeHoldDialog({ afterExit }) ->
  //   handle.destroy({ afterExit }) -> Router.navigate("detail")
  // The presenter has already torn down by the time the action runs, so a
  // destroy() that treats the continuation as part of teardown drops it and
  // the user stays on Home.
  let navigations = 0;
  let handle = null;

  const destroyHomeHoldDialog = ({ afterExit = null } = {}) => {
    const dialog = handle;
    if (dialog) dialog.destroy({ afterExit });
    else if (afterExit) afterExit();
  };
  const openContinueWatchingDetails = () =>
    destroyHomeHoldDialog({
      afterExit: () => {
        navigations += 1;
      }
    });

  handle = openDesktopContextMenu({
    x: 10,
    y: 10,
    items: ITEMS,
    onSelect: (action) => {
      if (action.key === "details") openContinueWatchingDetails();
    }
  });
  handle.element.children[0].handlers.get("click")({ preventDefault() {}, stopPropagation() {} });

  assert.equal(navigations, 1, "Go to details must actually navigate");
});

test("a held Enter does not instantly activate the first row", () => {
  // Hold Enter opens the menu while Enter is still down, and a held key
  // repeats. Without suppression the menu selected row one immediately and
  // looked like it never opened.
  const picked = [];
  const handle = openDesktopContextMenu({
    x: 0,
    y: 0,
    anchorRect: { left: 0, bottom: 0 },
    items: ITEMS,
    onSelect: (a) => picked.push(a.key)
  });
  dom.key("Enter");
  assert.deepEqual(picked, [], "the keypress that opened the menu must not select");
  assert.equal(handle.element.isConnected, true, "menu stays open");
  dom.keyUp();
  dom.key("Enter");
  assert.deepEqual(picked, ["details"], "Enter works once the key has been released");
});

test("right-click is not subject to the Enter guard", () => {
  const picked = [];
  openDesktopContextMenu({ x: 5, y: 5, items: ITEMS, onSelect: (a) => picked.push(a.key) });
  dom.key("ArrowDown");
  dom.key("Enter");
  assert.deepEqual(picked, ["details"], "no key was held, so Enter activates immediately");
});

test("Home forwards close options rather than swallowing them", async () => {
  const source = await readFile(new URL("../screens/home/homeScreen.js", import.meta.url), "utf8");
  assert.match(
    source,
    /destroy: \(closeOptions\) => handle\.destroy\(closeOptions\)/,
    "the Continue Watching menu handle must pass afterExit through"
  );
  assert.doesNotMatch(
    source,
    /destroy: \(\) => handle\.destroy\(\)/,
    "the swallowing form is gone"
  );
});

test("an empty action list opens nothing", () => {
  assert.equal(openDesktopContextMenu({ x: 0, y: 0, items: [] }), null);
});
