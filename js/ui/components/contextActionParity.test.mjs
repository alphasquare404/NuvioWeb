import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// The rule this file protects: right-click, long-press and Hold Enter are three
// ways to invoke one action system, not three action systems. Presentation may
// differ; the definitions and the executor may not.
//
// Asserted from source because the alternative -- instantiating three DOM
// presentations -- would test the widgets rather than the thing that matters.

const posterMenuUrl = new URL("./posterOptionsMenu.js", import.meta.url);
const homeUrl = new URL("../screens/home/homeScreen.js", import.meta.url);
const collectionUrl = new URL("../screens/collection/folderDetailScreen.js", import.meta.url);

const SHARED_SCREENS = [
  ["search", "../screens/search/searchScreen.js"],
  ["discover", "../screens/search/discoverScreen.js"],
  ["library", "../screens/library/libraryScreen.js"],
  ["catalogSeeAll", "../screens/catalog/catalogSeeAllScreen.js"],
  ["cast", "../screens/cast/castDetailScreen.js"],
  ["collection", "../screens/collection/folderDetailScreen.js"]
];

test("all three invocations build their options from one definition source", async () => {
  const source = await readFile(posterMenuUrl, "utf8");
  // One getPosterOptions call feeds the shared `actions` array, which both the
  // pointer and touch presenters render and the keyboard dialog falls back to.
  assert.equal(
    (source.match(/getPosterOptions\(this\.state\)/g) || []).length,
    1,
    "options are computed once per open, not per presentation"
  );
  assert.match(source, /const actions = options\.map\(/);
});

test("all three invocations run one executor", async () => {
  const source = await readFile(posterMenuUrl, "utf8");
  // Pointer and keyboard share one branch; touch has its own.
  const menuBlock = source.slice(source.indexOf('if (this.invocation?.type !== "touch")'));
  assert.match(menuBlock, /onSelect: \(action\) => void this\.activateOption\(action\.key\)/);
  const touchBlock = source.slice(source.indexOf('if (this.invocation?.type === "touch"'));
  assert.match(touchBlock, /onSelect: \(action\) => void this\.activateOption\(action\.key\)/);
  // Exactly two presentations, one executor between them.
  assert.equal((source.match(/void this\.activateOption\(action\.key\)/g) || []).length, 2);
});

test("the invocation chooses presentation only", async () => {
  const source = await readFile(posterMenuUrl, "utf8");
  assert.match(source, /openDesktopContextMenu\(/, "pointer gets the anchored menu");
  assert.match(source, /openTouchActionSheet\(/, "touch gets the sheet");
  // Hold Enter now shares the compact menu, anchored to the focused card
  // instead of opening the large centred modal.
  assert.match(source, /anchorRect: focused\?\.getBoundingClientRect\?\.\(\) \|\| null/);
  assert.match(source, /restoreFocusTo: focused \|\| null/);
  assert.doesNotMatch(
    source,
    /this\.dialog = new NuvioDialog\(\{[\s\S]{0,200}home_poster_dialog_subtitle/,
    "the modal presentation for card actions is gone"
  );
});

test("every shared surface wires right-click and long-press to its poster menu", async () => {
  for (const [name, rel] of SHARED_SCREENS) {
    const source = await readFile(new URL(rel, import.meta.url), "utf8");
    assert.match(source, /bindMediaContextMenu\(/, `${name} binds right-click`);
    assert.match(source, /onLongPress:/, `${name} binds long-press`);
    assert.match(
      source,
      /invocation: \{ type: "touch" \}/,
      `${name} long-press opens the shared actions`
    );
    assert.match(
      source,
      /invocation: \{ type: "pointer"/,
      `${name} right-click opens the shared actions`
    );
  }
});

test("Collection adopts the shared poster action system", async () => {
  const source = await readFile(collectionUrl, "utf8");
  assert.match(source, /PosterOptionsDialogController/, "uses the shared controller");
  assert.match(source, /posterItemFromNode/, "uses the shared target resolution");
  assert.match(source, /startPendingPosterHold/, "Hold Enter is supported");
  assert.match(source, /completePendingPosterHold/);
  // The broad layout gate must not have been loosened just to get menus.
  assert.match(source, /!this\.isDesktopBrowser &&/, "the useHomeFollowLayout gate is left intact");
});

test("Home routes pointer and touch through one entry point", async () => {
  const source = await readFile(homeUrl, "utf8");
  assert.match(source, /openContextActionsForNode\(node, invocation\)/);
  // Continue Watching keeps its own action set, and still runs the same executor.
  assert.match(source, /this\.openContinueWatchingMenu\(node, \{ invocation \}\)/);
  assert.match(source, /void this\.activateContinueWatchingMenuOption\(\)/);
  // Everything else on Home goes to the shared system rather than a third copy.
  assert.match(source, /sharedPosterOptionsController/);
});

test("Continue Watching details navigates rather than only closing the menu", async () => {
  const source = await readFile(homeUrl, "utf8");
  // The action resolves to openContinueWatchingDetails, which performs its
  // Router.navigate inside destroyHomeHoldDialog({ afterExit }). The menu
  // handle therefore has to forward close options.
  assert.match(
    source,
    /option\.action === "details"[\s\S]{0,120}openContinueWatchingDetails\(item\)/
  );
  assert.match(
    source,
    /destroyHomeHoldDialog\(\{[\s\S]{0,60}afterExit:[\s\S]{0,80}Router\.navigate\("detail"/
  );
  assert.match(source, /destroy: \(closeOptions\) => handle\.destroy\(closeOptions\)/);
});

test("Continue Watching uses one resolver and executor for every invocation", async () => {
  const source = await readFile(homeUrl, "utf8");
  // One options list, one run(), shared by sheet and compact menu.
  assert.equal(
    (source.match(/const actions = options\.map\(/g) || []).length,
    1,
    "the Continue Watching action list is built once, not per presentation"
  );
  const block = source.slice(source.indexOf("const handle ="));
  assert.match(block.slice(0, 2000), /openTouchActionSheet\({[\s\S]{0,600}onSelect: run/);
  assert.match(block.slice(0, 2000), /openDesktopContextMenu\({[\s\S]{0,600}onSelect: run/);
});

test("long-press can actually reach a Continue Watching card", async () => {
  // CW cards carry data-action="resumeProgress". The touch selector only
  // listed openDetail/openCollection cards and the title links, so a long
  // press on a CW card never matched and nothing opened -- while right-click,
  // which used a different selector, worked.
  const source = await readFile(homeUrl, "utf8");
  const touchBlock = source.slice(source.indexOf("bindBrowserCardTouchIntent(this.container"));
  assert.match(
    touchBlock.slice(0, 700),
    /\.home-continue-card\.focusable/,
    "the long-press selector must include Continue Watching cards"
  );
  const menuBlock = source.slice(source.indexOf("bindMediaContextMenu(this.container"));
  assert.match(menuBlock.slice(0, 700), /\.home-continue-card\.focusable/);
});

test("Continue Watching is recognised before the generic poster path", async () => {
  const source = await readFile(homeUrl, "utf8");
  const entry = source.slice(source.indexOf("openContextActionsForNode(node, invocation)"));
  const cwIndex = entry.indexOf("isContinueWatchingHoldTarget");
  const posterIndex = entry.indexOf("isPosterHoldTarget");
  assert.ok(cwIndex > -1 && posterIndex > cwIndex, "CW is checked first");
});

test("Hold Enter uses the same entry point as pointer and touch", async () => {
  const source = await readFile(homeUrl, "utf8");
  const hold = source.slice(source.indexOf("openHoldMenuForNode(node) {"));
  assert.match(
    hold.slice(0, 200),
    /return this\.openContextActionsForNode\(node, null\)/,
    "Hold Enter must not have its own dispatch; CW vs poster is decided once"
  );
});

test("no Home card action opens the old centred modal", async () => {
  const source = await readFile(homeUrl, "utf8");
  // mountPosterHoldDialog / mountContinueWatchingDialog were the two modal
  // presentations for card actions. Neither may be reachable from the one
  // entry point that every invocation now funnels through.
  const entry = source.slice(source.indexOf("openContextActionsForNode(node, invocation)"));
  const body = entry.slice(0, entry.indexOf("openHoldMenuForNode"));
  assert.doesNotMatch(body, /mountPosterHoldDialog/);
  assert.doesNotMatch(body, /openPosterHoldMenu/);
});

test("Continue Watching keyboard invocation opens the compact menu", async () => {
  const source = await readFile(homeUrl, "utf8");
  const block = source.slice(source.indexOf("const handle ="));
  // No invocation type means Hold Enter: anchored compact menu, not a sheet
  // and not the old centred modal.
  assert.match(
    block.slice(0, 2000),
    /invocation\?\.type === "touch"[\s\S]{0,40}openTouchActionSheet/
  );
  assert.match(block.slice(0, 2000), /openDesktopContextMenu\({[\s\S]{0,500}anchorRect:/);
  assert.doesNotMatch(source, /cw_dialog_subtitle/, "the old Continue Watching modal is gone");
});

test("both presentations forward the action's continuation", async () => {
  // Selecting a row closes the presenter before the action runs, so a close
  // that treats afterExit as part of teardown silently drops navigation.
  // This bit the desktop menu first; the sheet had the same shape.
  const menu = await readFile(new URL("./desktopContextMenu.js", import.meta.url), "utf8");
  const sheet = await readFile(new URL("./touchActionSheet.js", import.meta.url), "utf8");
  for (const [name, source] of [
    ["desktop menu", menu],
    ["touch sheet", sheet]
  ]) {
    assert.match(
      source,
      /function destroy\(\{ afterExit = null \} = \{\}\)/,
      `${name} accepts afterExit`
    );
    assert.match(
      source,
      /if \(destroyed\) \{[\s\S]{0,400}afterExit === "function"\) afterExit\(\)/,
      `${name} runs the continuation even after teardown`
    );
  }
});
