import assert from "node:assert/strict";
import test from "node:test";

// "Go to details" must open the card the menu was opened on.
//
// Home and Collection both reuse one PosterOptionsDialogController across every
// card. When their details callback closed over the `node` of the open that
// happened to construct the controller, the first card of the session became
// the permanent target: opening the menu on card A, then on card B, and
// choosing "Go to details" navigated to A. Every invocation -- right-click,
// long-press, Hold Enter -- shared the fault, because they all share the
// controller.
//
// These drive the real screen dispatchers rather than asserting on source text,
// since the defect lived in when the target is resolved, not in how the code
// reads.

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
const { FolderDetailScreen } = await import("../screens/collection/folderDetailScreen.js");

const card = (id) => ({
  dataset: { itemId: id, itemType: "movie", itemTitle: id, focusKey: `key-${id}` }
});

// The menu closes itself before the action runs, so the pending open() promise
// is irrelevant to what the callback resolves; let it settle either way.
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

test("Home resolves Go to details against the card the menu was opened on", async () => {
  const navigated = [];
  const screen = Object.create(HomeScreen);
  screen.isContinueWatchingHoldTarget = () => false;
  screen.isPosterHoldTarget = () => true;
  screen.requestBackgroundRender = () => {};
  screen.openDetailFromNode = (node) => navigated.push(node?.dataset?.itemId ?? null);

  screen.openContextActionsForNode(card("A"), null);
  screen.sharedPosterOptionsController.onDetails({ id: "A" });

  screen.openContextActionsForNode(card("B"), null);
  screen.sharedPosterOptionsController.onDetails({ id: "B" });

  await settle();
  assert.deepEqual(navigated, ["A", "B"], "the second menu must open B, not the first card again");
});

test("Home keeps resolving the current card across many opens", async () => {
  const navigated = [];
  const screen = Object.create(HomeScreen);
  screen.isContinueWatchingHoldTarget = () => false;
  screen.isPosterHoldTarget = () => true;
  screen.requestBackgroundRender = () => {};
  screen.openDetailFromNode = (node) => navigated.push(node?.dataset?.itemId ?? null);

  for (const id of ["A", "B", "C", "D"]) {
    screen.openContextActionsForNode(card(id), null);
    screen.sharedPosterOptionsController.onDetails({ id });
  }

  await settle();
  assert.deepEqual(navigated, ["A", "B", "C", "D"], "no open leaks its card into a later one");
});

test("Home reuses one controller rather than rebuilding it per card", async () => {
  // Rebuilding on every open would also hide the stale closure, but it would
  // throw away the controller's own state each time. The fix must be the
  // target resolution, not a new controller.
  const screen = Object.create(HomeScreen);
  screen.isContinueWatchingHoldTarget = () => false;
  screen.isPosterHoldTarget = () => true;
  screen.requestBackgroundRender = () => {};
  screen.openDetailFromNode = () => {};

  screen.openContextActionsForNode(card("A"), null);
  const first = screen.sharedPosterOptionsController;
  screen.openContextActionsForNode(card("B"), null);

  await settle();
  assert.equal(
    screen.sharedPosterOptionsController,
    first,
    "the controller is shared, not rebuilt"
  );
});

test("Collection resolves Go to details against the card the menu was opened on", async () => {
  const navigated = [];
  const screen = Object.create(FolderDetailScreen);
  screen.openDetailFromNode = (node) => navigated.push(node?.dataset?.itemId ?? null);
  screen.container = null;
  screen.focusNode = () => {};

  await screen.openPosterOptionsMenu(card("A"), {}).catch(() => {});
  screen.posterOptionsController.onDetails({ id: "A" });

  await screen.openPosterOptionsMenu(card("B"), {}).catch(() => {});
  screen.posterOptionsController.onDetails({ id: "B" });

  await settle();
  assert.deepEqual(navigated, ["A", "B"], "Collection has its own wiring and its own regression");
});

test("Collection keeps the focusKey of the card actually acted on", async () => {
  // openDetailFromNode reads node.dataset.focusKey, which the resolved item
  // does not carry -- so the callback has to receive the real element.
  const seen = [];
  const screen = Object.create(FolderDetailScreen);
  screen.openDetailFromNode = (node) => seen.push(node?.dataset?.focusKey ?? null);
  screen.container = null;
  screen.focusNode = () => {};

  await screen.openPosterOptionsMenu(card("A"), {}).catch(() => {});
  await screen.openPosterOptionsMenu(card("B"), {}).catch(() => {});
  screen.posterOptionsController.onDetails({ id: "B" });

  await settle();
  assert.deepEqual(seen, ["key-B"], "the live element is passed through, not a rebuilt item");
});
