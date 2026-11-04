import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { bindMediaContextMenu } from "../../components/mediaContextActions.js";

const source = readFileSync(new URL("./streamScreen.js", import.meta.url), "utf8");
function method(name, deps) {
  const start = source.indexOf(`  ${name}() {`);
  const end = source.indexOf("\n  }", start);
  assert.ok(start >= 0);
  return new Function(...Object.keys(deps), `return ({${source.slice(start, end + 4)}}).${name}`)(
    ...Object.values(deps)
  );
}
class ElementMock {
  constructor() {
    this.listeners = new Map();
  }
  addEventListener(type, handler) {
    const handlers = this.listeners.get(type) || new Set();
    handlers.add(handler);
    this.listeners.set(type, handlers);
  }
  removeEventListener(type, handler) {
    this.listeners.get(type)?.delete(handler);
  }
  contains(node) {
    return node === this.card;
  }
}

test("stream right-click survives repeated route cleanup and reopening with nested card targets", () => {
  const previous = {
    Element: globalThis.Element,
    HTMLElement: globalThis.HTMLElement,
    matchMedia: globalThis.matchMedia
  };
  globalThis.Element = globalThis.HTMLElement = ElementMock;
  globalThis.matchMedia = () => ({ matches: true });
  try {
    const container = new ElementMock();
    const card = new ElementMock();
    card.dataset = { streamId: "s1" };
    container.card = card;
    const badge = new ElementMock();
    badge.closest = () => card;
    let menus = 0,
      touchBindings = 0;
    const bind = method("bindStreamCardContextMenu", {
      bindMediaContextMenu,
      bindBrowserCardTouchIntent: () => {
        touchBindings++;
        return () => {};
      }
    });
    const cleanup = method("cleanup", { ScreenUtils: { hide() {} } });
    const ctx = {
      container,
      openStreamCardContextMenu: () => {
        menus++;
      },
      clearExternalHandoffWatch() {},
      cancelAutoPlayCountdown() {},
      cancelAutoPlaySelectionWait() {},
      cancelScheduledRender() {}
    };
    for (let visit = 0; visit < 4; visit++) {
      bind.call(ctx);
      bind.call(ctx); // Batch/list redraws must not duplicate the listener.
      assert.equal(container.listeners.get("contextmenu")?.size, 1, `visit ${visit}`);
      let prevented = false;
      const event = {
        target: badge,
        clientX: 10,
        clientY: 20,
        preventDefault: () => {
          prevented = true;
        },
        stopPropagation() {}
      };
      for (const handler of container.listeners.get("contextmenu")) handler(event);
      assert.equal(prevented, true, "the browser menu is suppressed on card descendants");
      assert.equal(menus, visit + 1);
      cleanup.call(ctx);
      assert.equal(container.listeners.get("contextmenu").size, 0);
    }
    assert.equal(touchBindings, 4);
  } finally {
    Object.assign(globalThis, previous);
  }
});
