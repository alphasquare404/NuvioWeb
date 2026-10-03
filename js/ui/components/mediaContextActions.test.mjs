import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// resolveContextMenuTarget guards on `instanceof Element`, so the stub must
// exist before the module under test is imported.
class FakeElement {}
globalThis.Element = FakeElement;
globalThis.HTMLElement = FakeElement;

const { resolveContextMenuTarget } = await import("./mediaContextActions.js");
const { clampContextMenuPosition } = await import("./desktopContextMenu.js");

function fakeTarget({ matches = true, contained = true } = {}) {
  const node = new FakeElement();
  node.closest = () => (matches ? node : null);
  return { node, container: { contains: () => contained } };
}

// --- right-click target resolution ------------------------------------------

test("a right-click on an actionable card resolves a target", () => {
  const { node, container } = fakeTarget();
  assert.equal(resolveContextMenuTarget(node, { container, cardSelector: ".card" }), node);
});

test("a right-click outside any card resolves nothing, so the browser menu stands", () => {
  const { node, container } = fakeTarget({ matches: false });
  assert.equal(resolveContextMenuTarget(node, { container, cardSelector: ".card" }), null);
});

test("a card outside this screen's container is not ours to claim", () => {
  const { node, container } = fakeTarget({ contained: false });
  assert.equal(resolveContextMenuTarget(node, { container, cardSelector: ".card" }), null);
});

test("missing configuration never claims the event", () => {
  assert.equal(resolveContextMenuTarget(null, {}), null);
  assert.equal(
    resolveContextMenuTarget(new FakeElement(), { container: {}, cardSelector: "" }),
    null
  );
});

test("the native menu is only ever suppressed after a target is found", async () => {
  // preventDefault must be unreachable unless a node was resolved -- that is
  // what keeps right-click working everywhere else on the page.
  const source = await readFile(new URL("./mediaContextActions.js", import.meta.url), "utf8");
  const guardIndex = source.indexOf("if (!node) return;");
  const preventIndex = source.indexOf("event.preventDefault()");
  assert.ok(guardIndex > 0 && preventIndex > guardIndex);
  assert.doesNotMatch(source, /document\.addEventListener\(\s*"contextmenu"/);
});

test("a finger's long press loses the browser menu without gaining the desktop one", async () => {
  // The same hold that opens the action sheet also emits contextmenu, and the
  // callout the browser answered with landed on top of the sheet. Taking the
  // event away is not the same as claiming it: the pointer check still stands
  // between a touch and the desktop menu.
  const source = await readFile(new URL("./mediaContextActions.js", import.meta.url), "utf8");
  const preventIndex = source.indexOf("event.preventDefault()");
  const enabledIndex = source.indexOf("if (!isEnabled()) return;");
  const invokeIndex = source.indexOf("onInvoke(node,");
  assert.ok(enabledIndex > preventIndex, "the native menu goes for touch as well as mouse");
  assert.ok(invokeIndex > enabledIndex, "only a fine pointer opens the desktop menu");
});

// --- viewport clamping -------------------------------------------------------------

test("a menu with room stays exactly at the pointer", () => {
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

test("a menu near the right or bottom edge flips instead of hanging off", () => {
  const pos = clampContextMenuPosition({
    x: 960,
    y: 780,
    menuWidth: 200,
    menuHeight: 160,
    viewportWidth: 1000,
    viewportHeight: 800
  });
  assert.ok(pos.left + 200 <= 1000, "stays inside horizontally");
  assert.ok(pos.top + 160 <= 800, "stays inside vertically");
});

test("a menu larger than the viewport is still reachable, never negative", () => {
  const pos = clampContextMenuPosition({
    x: 10,
    y: 10,
    menuWidth: 5000,
    menuHeight: 5000,
    viewportWidth: 400,
    viewportHeight: 300
  });
  assert.ok(pos.left >= 0 && pos.top >= 0);
});
