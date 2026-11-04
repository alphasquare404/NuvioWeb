import { bindRotatedPlayerScroll } from "./browserPlayerOrientation.js";
import test from "node:test";
import assert from "node:assert/strict";
import {
  createPlayerOrientation,
  playerLocalPoint,
  playerLocalRect
} from "./browserPlayerOrientation.js";
function fixture() {
  const classes = () => ({ toggle() {}, remove() {} });
  const props = () => ({ setProperty() {}, removeProperty() {} });
  const container = { classList: classes(), style: props(), dataset: {} };
  const scope = {
    innerWidth: 390,
    innerHeight: 844,
    navigator: { maxTouchPoints: 1 },
    matchMedia: () => ({ matches: true }),
    document: { body: { classList: classes(), style: props() } },
    getComputedStyle: () => ({ getPropertyValue: () => "0px" }),
    addEventListener() {},
    removeEventListener() {},
    screen: {
      orientation: {
        lock: async () => {
          throw Error("denied");
        }
      }
    }
  };
  return { container, scope };
}
test("initial landscape canvas supports Rotate and cleanup restores page", async () => {
  const { container, scope } = fixture();
  const state = createPlayerOrientation(container, { scope });
  await Promise.resolve();
  assert.equal(state.rotated, true);
  assert.equal(state.width, 844);
  assert.equal(container.dataset.playerToolbarSize, "regular");
  assert.equal(state.height, 390);
  assert.deepEqual(playerLocalPoint({ clientX: 90, clientY: 400 }, state), { x: 400, y: 300 });
  const rect = playerLocalRect(
    {
      getBoundingClientRect: () => ({
        left: 80,
        right: 90,
        top: 100,
        bottom: 700,
        width: 10,
        height: 600
      })
    },
    state
  );
  assert.equal(rect.left, 100);
  assert.equal(rect.top, 300);
  assert.equal(rect.width, 600);
  state.toggle();
  assert.equal(state.preference, "portrait");
  assert.equal(container.dataset.playerToolbarSize, "compact");
  assert.equal(state.rotated, false);
  scope.innerWidth = 844;
  scope.innerHeight = 390;
  state.toggle();
  assert.equal(state.preference, "landscape");
  assert.equal(state.rotated, false);
  state.destroy();
  assert.equal(container.dataset.playerOrientation, undefined);
});
test("desktop is not forced into an orientation", () => {
  const { container, scope } = fixture();
  scope.navigator.maxTouchPoints = 0;
  scope.matchMedia = () => ({ matches: false });
  const state = createPlayerOrientation(container, { scope });
  assert.equal(state.mobile, false);
  assert.equal(container.dataset.playerOrientation, undefined);
  state.destroy();
});

test("rotated lists scroll in local Y and suppress the trailing card click", () => {
  const handlers = new Map();
  const body = {
    addEventListener: (name, fn) => handlers.set(name, fn),
    removeEventListener: (name) => handlers.delete(name)
  };
  const node = { scrollTop: 0, scrollHeight: 600, clientHeight: 100 };
  const target = { closest: () => node };
  const state = { rotated: true, height: 390 };
  const cleanup = bindRotatedPlayerScroll(body, state);
  const event = (x) => ({
    target,
    pointerType: "touch",
    pointerId: 1,
    clientX: x,
    clientY: 300,
    preventDefault() {}
  });
  handlers.get("pointerdown")(event(100));
  handlers.get("pointermove")(event(180));
  assert.equal(node.scrollTop, 80);
  handlers.get("pointerup")(event(180));
  let blocked = false;
  handlers.get("click")({
    target: node,
    preventDefault() {
      blocked = true;
    },
    stopImmediatePropagation() {}
  });
  assert.equal(blocked, true);
  state.rotated = false;
  handlers.get("pointerdown")(event(100));
  handlers.get("pointermove")(event(180));
  assert.equal(node.scrollTop, 80);
  cleanup();
  assert.equal(handlers.size, 0);
});

test("startup landscape follows physical rotations; Rotate lasts until the next physical rotation", () => {
  const { container, scope } = fixture();
  const handlers = new Map();
  scope.addEventListener = (name, fn) => handlers.set(name, fn);
  scope.screen.orientation.type = "portrait-primary";
  scope.screen.orientation.angle = 0;
  let locks = 0;
  scope.screen.orientation.lock = () => locks++;
  const state = createPlayerOrientation(container, { scope });
  assert.equal(state.preference, "landscape");
  assert.equal(state.rotation, 90);
  assert.equal(locks, 0, "do not prevent subsequent physical rotation with a native lock");
  scope.screen.orientation.type = "landscape-primary";
  scope.screen.orientation.angle = 90;
  handlers.get("orientationchange")();
  assert.equal(
    state.rotation,
    90,
    "orientation signal before resize must not flip the old viewport"
  );
  scope.innerWidth = 844;
  scope.innerHeight = 390;
  handlers.get("resize")();
  assert.equal(state.rotation, 0);
  assert.equal(state.preference, "landscape");
  state.toggle();
  assert.equal(state.preference, "portrait");
  assert.equal(state.rotation, -90);
  scope.innerWidth = 800;
  handlers.get("resize")();
  assert.equal(state.preference, "portrait", "ordinary viewport resize preserves manual choice");
  assert.deepEqual(playerLocalPoint({ clientX: 80, clientY: 100 }, state), { x: 290, y: 80 });
  const rect = playerLocalRect(
    { getBoundingClientRect: () => ({ left: 50, top: 80, right: 100, bottom: 180 }) },
    state
  );
  assert.equal(rect.left, 210);
  assert.equal(rect.top, 50);
  scope.screen.orientation.type = "portrait-primary";
  scope.screen.orientation.angle = 0;
  scope.innerWidth = 390;
  scope.innerHeight = 844;
  handlers.get("resize")();
  assert.equal(state.preference, "portrait");
  assert.equal(state.rotation, 0);
  scope.screen.orientation.type = "landscape-secondary";
  scope.screen.orientation.angle = 270;
  scope.innerWidth = 844;
  scope.innerHeight = 390;
  handlers.get("resize")();
  assert.equal(state.preference, "landscape");
  assert.equal(state.rotation, 0);
  state.toggle();
  assert.equal(state.rotation, 90, "manual portrait respects the other landscape direction");
  state.destroy();
});

test("viewport-only browsers follow axis changes but not same-axis resizes", () => {
  const { scope, container } = fixture();
  const handlers = new Map();
  scope.addEventListener = (name, fn) => handlers.set(name, fn);
  const state = createPlayerOrientation(container, { scope });
  scope.innerHeight = 790;
  handlers.get("resize")();
  assert.equal(state.preference, "landscape");
  scope.innerWidth = 844;
  scope.innerHeight = 390;
  handlers.get("resize")();
  assert.equal(state.rotated, false);
  scope.innerWidth = 390;
  scope.innerHeight = 844;
  handlers.get("resize")();
  assert.equal(state.preference, "portrait");
  assert.equal(state.rotated, false);
  state.destroy();
});

test("independent loading orientation never alters or clears the active player body canvas", () => {
  const { container, scope } = fixture();
  let writes = 0;
  scope.document.body.classList = {
    toggle() {
      writes++;
    },
    remove() {
      writes++;
    }
  };
  scope.document.body.style = {
    setProperty() {
      writes++;
    },
    removeProperty() {
      writes++;
    }
  };
  const state = createPlayerOrientation(container, { scope, manageBody: false });
  assert.equal(state.rotated, true);
  state.setPreference("portrait");
  assert.equal(state.rotated, false);
  state.setPreference("landscape");
  assert.equal(state.rotated, true);
  state.destroy();
  assert.equal(writes, 0);
});

test("rotated track drawers scroll their parent when the nearest rail has no overflow", () => {
  const handlers = new Map();
  const body = { addEventListener: (name, fn) => handlers.set(name, fn), removeEventListener() {} };
  const drawer = { scrollTop: 0, scrollHeight: 800, clientHeight: 200 };
  const rail = { scrollHeight: 100, clientHeight: 100, parentElement: { closest: () => drawer } };
  const target = { closest: () => rail };
  const cleanup = bindRotatedPlayerScroll(body, { rotated: true, height: 390 });
  const event = (x) => ({
    target,
    pointerType: "touch",
    pointerId: 7,
    clientX: x,
    clientY: 100,
    preventDefault() {}
  });
  handlers.get("pointerdown")(event(100));
  handlers.get("pointermove")(event(170));
  assert.equal(drawer.scrollTop, 70);
  cleanup();
});

test("safe areas rotate with the canvas and native orientation restores inherited insets", () => {
  const { container, scope } = fixture();
  const values = new Map();
  container.style = {
    setProperty: (key, value) => values.set(key, value),
    removeProperty: (key) => values.delete(key)
  };
  const physicalInsets = {
    "--browser-safe-area-top": "44px",
    "--browser-safe-area-right": "0px",
    "--browser-safe-area-bottom": "34px",
    "--browser-safe-area-left": "0px"
  };
  scope.getComputedStyle = () => ({ getPropertyValue: (key) => physicalInsets[key] || "" });
  const state = createPlayerOrientation(container, { scope });
  assert.equal(state.rotation, 90);
  assert.equal(values.get("--browser-safe-area-left"), "44px");
  assert.equal(values.get("--browser-safe-area-right"), "34px");
  assert.equal(values.get("--browser-safe-area-top"), "0px");
  state.toggle();
  assert.equal(state.rotation, 0);
  assert.equal(values.has("--browser-safe-area-left"), false);
  state.destroy();
});
