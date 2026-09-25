import assert from "node:assert/strict";
import test from "node:test";

// Which menu a card gets.
//
// One branch in `openContextActionsForNode` decides whether a card is handed
// the Continue Watching action list -- Go to details, Start from beginning,
// Remove -- or the ordinary poster list, with Add to Library and Mark as
// watched. Nothing exercised that branch: the parity test asserts on source
// text, which only proves the function names appear in the file, and the
// details-target test stubs `isContinueWatchingHoldTarget` to false so it walks
// the poster path exclusively.
//
// Both behaviours work today. The point is that either could be inverted or
// dropped and the whole suite would still pass, so the break would ship: a
// long-press on a Continue Watching card would open "Add to Library" with no
// way to remove the card, or nothing would open at all.
//
// This drives the real dispatcher rather than reading the source, because the
// defect this guards against lives in which branch runs, not in how it reads.

function installDom() {
  const element = () => ({
    style: {},
    dataset: {},
    classList: { add() {}, remove() {}, contains: () => false },
    setAttribute() {},
    append() {},
    addEventListener() {},
    removeEventListener() {},
    remove() {},
    focus() {},
    contains: () => false,
    getBoundingClientRect: () => ({ width: 200, height: 160, left: 0, top: 0, bottom: 0 })
  });
  globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  globalThis.document = {
    body: { append() {} },
    createElement: element,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener() {},
    removeEventListener() {}
  };
  globalThis.window = {
    innerWidth: 1000,
    innerHeight: 800,
    addEventListener() {},
    removeEventListener() {},
    matchMedia: () => ({ matches: false })
  };
}

installDom();

// The screens import each other through the router, so the router has to be
// evaluated first or the cycle hits a temporal dead zone under plain ESM.
await import("../navigation/router.js");
const { HomeScreen } = await import("../screens/home/homeScreen.js");

const card = (id) => ({
  dataset: { itemId: id, itemType: "movie", itemTitle: id, focusKey: `key-${id}` }
});

// A screen that records which menu was asked for instead of mounting one.
function screenWith({ isContinueWatching }) {
  const opened = [];
  const screen = Object.create(HomeScreen);
  screen.isContinueWatchingHoldTarget = () => isContinueWatching;
  screen.isPosterHoldTarget = () => !isContinueWatching;
  screen.requestBackgroundRender = () => {};
  screen.openDetailFromNode = () => {};
  screen.openContinueWatchingMenu = (node, options) => {
    opened.push({ menu: "continueWatching", id: node?.dataset?.itemId, options });
    return true;
  };
  return { screen, opened };
}

test("a Continue Watching card is routed to the Continue Watching menu", () => {
  const { screen, opened } = screenWith({ isContinueWatching: true });

  const result = screen.openContextActionsForNode(card("A"), null);

  assert.equal(result, true, "the dispatcher must report that it opened something");
  assert.deepEqual(
    opened.map((entry) => entry.menu),
    ["continueWatching"]
  );
  assert.equal(opened[0].id, "A", "the menu must open on the card it was invoked from");
});

test("the invocation is carried through, so touch and pointer stay distinguishable", () => {
  // A sheet under a thumb and a menu beside a cursor are chosen from this.
  const { screen, opened } = screenWith({ isContinueWatching: true });
  const invocation = { type: "pointer", x: 120, y: 240 };

  screen.openContextActionsForNode(card("A"), invocation);

  assert.deepEqual(opened[0].options?.invocation, invocation);
});

// The other side of the same branch. If it inverted, an ordinary catalog poster
// would offer Remove and Start from beginning for a title it has no progress on.
test("an ordinary poster is not routed to the Continue Watching menu", () => {
  const { screen, opened } = screenWith({ isContinueWatching: false });

  screen.openContextActionsForNode(card("B"), null);

  assert.deepEqual(opened, [], "the Continue Watching menu must not be opened for a poster");
  assert.ok(
    screen.sharedPosterOptionsController,
    "the poster path must have built its own controller instead"
  );
});

// A node that is neither is not a menu target at all -- a row heading, a tab,
// the gap between cards.
test("a node that is neither kind opens nothing", () => {
  const screen = Object.create(HomeScreen);
  screen.isContinueWatchingHoldTarget = () => false;
  screen.isPosterHoldTarget = () => false;
  screen.requestBackgroundRender = () => {};
  screen.openContinueWatchingMenu = () => {
    throw new Error("the Continue Watching menu must not open for a non-target");
  };

  assert.equal(screen.openContextActionsForNode(card("C"), null), false);
});
