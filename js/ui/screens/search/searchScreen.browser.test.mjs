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

test("SearchScreen consumes a route snapshot only for an eligible history restoration", async () => {
  const { SearchScreen } = await loadSearchScreen();
  const originalDocument = globalThis.document;
  const originalRefreshWatchedTitleIds = SearchScreen.refreshWatchedTitleIds;
  const originalRenderLoading = SearchScreen.renderLoading;
  const originalReloadRows = SearchScreen.reloadRows;
  const originalRender = SearchScreen.render;
  const container = { style: { display: "none" } };

  globalThis.document = {
    getElementById(id) {
      return id === "search" ? container : null;
    }
  };
  SearchScreen.refreshWatchedTitleIds = async () => {};
  SearchScreen.renderLoading = () => {};
  SearchScreen.reloadRows = async () => {};
  SearchScreen.render = () => {};

  const snapshot = {
    query: "batman",
    mode: "search",
    rows: [{ title: "Results", items: [{ id: "movie-1" }] }]
  };

  try {
    await SearchScreen.mount({}, { restoreRouteState: false, restoredState: snapshot });
    assert.equal(SearchScreen.query, "");
    assert.deepEqual(SearchScreen.rows, []);

    await SearchScreen.mount({}, { restoreRouteState: true, restoredState: snapshot });
    assert.equal(SearchScreen.query, "batman");
    assert.equal(SearchScreen.mode, "search");
    assert.equal(SearchScreen.rows[0]?.title, "Results");
  } finally {
    SearchScreen.refreshWatchedTitleIds = originalRefreshWatchedTitleIds;
    SearchScreen.renderLoading = originalRenderLoading;
    SearchScreen.reloadRows = originalReloadRows;
    SearchScreen.render = originalRender;
    if (originalDocument) {
      globalThis.document = originalDocument;
    } else {
      delete globalThis.document;
    }
  }
});
