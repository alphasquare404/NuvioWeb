import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

async function loadLibraryScreen() {
  const result = await build({
    entryPoints: [fileURLToPath(new URL("./libraryScreen.js", import.meta.url))],
    bundle: true,
    format: "esm",
    platform: "node",
    write: false,
    plugins: [
      {
        name: "library-screen-focus-mocks",
        setup(buildApi) {
          const mocks = new Map([
            ["router", `export const Router = { getCurrent: () => "library", navigate: async () => {}, back: () => {} };`],
            ["screen", `export const ensureSpatialFocusVisible = () => { globalThis.__libraryEnsureVisibleCalls = (globalThis.__libraryEnsureVisibleCalls || 0) + 1; }; export const ScreenUtils = { show: () => {}, hide: () => {}, indexFocusables: () => {} };`],
            ["platform", `export const Platform = { isBrowser: () => true };`],
            ["layout", `export const LayoutPreferences = { get: () => ({ modernSidebar: true }) };`],
            ["sidebar", `export const activateLegacySidebarAction = () => {}; export const bindRootSidebarEvents = () => {}; export const focusWithoutAutoScroll = () => {}; export const getRootSidebarNodes = () => []; export const getRootSidebarSelectedNode = () => null; export const getSidebarProfileState = async () => null; export const isSelectedSidebarAction = () => false; export const isRootSidebarNode = () => false; export const renderRootSidebar = () => ""; export const setLegacySidebarExpanded = () => {}; export const setModernSidebarExpanded = () => {}; export const setModernSidebarPillIconOnly = () => {};`]
          ]);
          for (const [filter, path] of [
            [/router\.js$/, "router"],
            [/navigation\/screen\.js$/, "screen"],
            [/platform\/index\.js$/, "platform"],
            [/layoutPreferences\.js$/, "layout"],
            [/sidebarNavigation\.js$/, "sidebar"]
          ]) {
            buildApi.onResolve({ filter }, () => ({ path, namespace: "test" }));
          }
          buildApi.onLoad({ filter: /.*/, namespace: "test" }, (args) => ({
            contents: mocks.get(args.path)
          }));
        }
      }
    ]
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].contents).toString("base64")}`);
}

function makeCard() {
  const classes = new Set();
  return {
    dataset: { focusKey: "movie:x" },
    classList: {
      add: (name) => classes.add(name),
      remove: (name) => classes.delete(name),
      contains: (name) => classes.has(name)
    },
    closest: () => null,
    matches: () => false,
    focus() {}
  };
}

function makePassiveRestoreScreen(LibraryScreen, card, state) {
  return {
    container: {
      querySelectorAll: () => [],
      querySelector: (selector) => (
        selector.includes("data-focus-key") || selector.includes(".focusable") ? card : null
      )
    },
    controller: {
      getState: () => state,
      setFocusedPosterKey: () => {}
    },
    layoutPrefs: { modernSidebar: true },
    focusZone: "content",
    lastMainFocus: null,
    pendingActionRestore: null,
    pendingCloudSearchFocus: false,
    pendingPickerRestore: null,
    pendingPresentationModeScroll: false,
    downloadedPickerOpen: false,
    isModalFocusLocked: () => false,
    isSidebarNode: () => false,
    resolveLastMainFocus: () => null,
    setFocusedNode: LibraryScreen.setFocusedNode
  };
}

test("Library passive Genre and Year rerenders retain the card identity without scrolling to it", async () => {
  const { LibraryScreen } = await loadLibraryScreen();
  for (const filterState of [
    { selectedGenre: "Thriller", selectedYear: null },
    { selectedGenre: null, selectedYear: "2024" }
  ]) {
    const card = makeCard();
    const screen = makePassiveRestoreScreen(LibraryScreen, card, {
      ...filterState,
      lastFocusedPosterKey: "movie:x",
      listEditorState: null,
      showDeleteConfirm: false,
      showManageDialog: false,
      cloudFilePickerItem: null,
      expandedPicker: null
    });
    globalThis.__libraryEnsureVisibleCalls = 0;

    LibraryScreen.restoreFocus.call(screen);

    assert.equal(card.classList.contains("focused"), true);
    assert.equal(globalThis.__libraryEnsureVisibleCalls, 0, "passive filter rendering must not scroll to Movie X");
  }
});

test("Library explicit keyboard focus still keeps its target visible", async () => {
  const { LibraryScreen } = await loadLibraryScreen();
  const card = makeCard();
  const screen = makePassiveRestoreScreen(LibraryScreen, card, {
    lastFocusedPosterKey: null
  });
  globalThis.__libraryEnsureVisibleCalls = 0;

  LibraryScreen.setFocusedNode.call(screen, card);

  assert.equal(globalThis.__libraryEnsureVisibleCalls, 1);
});
