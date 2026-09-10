import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

async function loadSearchScreen() {
  const result = await build({
    entryPoints: [fileURLToPath(new URL("./searchScreen.js", import.meta.url))],
    bundle: true,
    format: "esm",
    platform: "node",
    write: false,
    plugins: [
      {
        name: "search-screen-browser-mocks",
        setup(buildApi) {
          const mocks = new Map([
            ["router", `export const Router = { navigate: async () => {}, back: () => {} };`],
            ["screen", `export const ScreenUtils = { show: (node) => { node.style.display = "block"; } }; export const ensureSpatialFocusVisible = () => {};`],
            ["layout", `export const LayoutPreferences = { get: () => ({ modernSidebar: true }) };`],
            ["sidebar", `export const getSidebarProfileState = async () => null; export const bindRootSidebarEvents = () => {}; export const renderRootSidebar = () => ""; export const activateLegacySidebarAction = () => {}; export const focusWithoutAutoScroll = () => {}; export const getRootSidebarNodes = () => []; export const getRootSidebarSelectedNode = () => null; export const isSelectedSidebarAction = () => false; export const isRootSidebarNode = () => false; export const setModernSidebarExpanded = () => {}; export const setModernSidebarPillIconOnly = () => {}; export const setLegacySidebarExpanded = () => {};`]
          ]);
          for (const [filter, path] of [
            [/router\.js$/, "router"],
            [/navigation\/screen\.js$/, "screen"],
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

test("SearchScreen mounts in the browser without a Platform global", async () => {
  const { SearchScreen } = await loadSearchScreen();
  const originalDocument = globalThis.document;
  const originalRefreshWatchedTitleIds = SearchScreen.refreshWatchedTitleIds;
  const originalRenderLoading = SearchScreen.renderLoading;
  const originalReloadRows = SearchScreen.reloadRows;
  const container = { style: { display: "none" } };
  let renderedLoading = 0;
  let loadedRows = 0;

  globalThis.document = {
    getElementById(id) {
      return id === "search" ? container : null;
    }
  };
  delete globalThis.Platform;
  SearchScreen.refreshWatchedTitleIds = async () => {};
  SearchScreen.renderLoading = () => {
    renderedLoading += 1;
  };
  SearchScreen.reloadRows = async () => {
    loadedRows += 1;
  };

  try {
    await SearchScreen.mount();
    assert.equal(container.style.display, "block");
    assert.equal(renderedLoading, 1);
    assert.equal(loadedRows, 1);
  } finally {
    SearchScreen.refreshWatchedTitleIds = originalRefreshWatchedTitleIds;
    SearchScreen.renderLoading = originalRenderLoading;
    SearchScreen.reloadRows = originalReloadRows;
    if (originalDocument) {
      globalThis.document = originalDocument;
    } else {
      delete globalThis.document;
    }
  }
});
