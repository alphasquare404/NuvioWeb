import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import {
  activeContentDiscoveryTopic,
  visibleContentDiscoveryTopics
} from "./contentDiscoveryPresentation.js";

test("Discovery keeps one valid topic and allows all narrow cards to close", () => {
  assert.equal(activeContentDiscoveryTopic(undefined), "addons");
  assert.equal(activeContentDiscoveryTopic("collections"), "collections");
  assert.equal(activeContentDiscoveryTopic(null), null);
  assert.equal(activeContentDiscoveryTopic(null, { wide: true }), "addons");
  assert.equal(activeContentDiscoveryTopic("missing"), "addons");
});

test("Essential mode never offers or selects the Plugins manager", () => {
  assert.deepEqual(visibleContentDiscoveryTopics(true), ["addons", "collections"]);
  assert.equal(activeContentDiscoveryTopic("plugins", { wide: true, essential: true }), "addons");
  assert.equal(activeContentDiscoveryTopic("plugins", { essential: false }), "plugins");
});

async function managerFactory(file, factoryName, dependencyNames, dependencies) {
  const source = (await readFile(new URL(`../../components/${file}.js`, import.meta.url), "utf8"))
    .replace(/^import[^;]+;\s*/gm, "")
    .replace(`export function ${factoryName}`, `function ${factoryName}`);
  return new Function(...dependencyNames, `${source}\nreturn ${factoryName};`)(...dependencies);
}

function controls() {
  const handlers = new Map(),
    nodes = new Map();
  const node = (selector) => {
    if (!nodes.has(selector))
      nodes.set(selector, {
        value: "",
        addEventListener(event, fn) {
          handlers.set(`${selector}:${event}`, fn);
        }
      });
    return nodes.get(selector);
  };
  return { handlers, node, container: { querySelector: node, querySelectorAll: () => [] } };
}

test("addon tab refresh reuses local records and retains disclosure/draft without new manifest reads", async () => {
  let reloads = 0;
  const addons = [{ name: "Fixture", baseUrl: "https://example.test/manifest.json", version: "1" }];
  const create = await managerFactory(
    "desktopAddonManager",
    "createDesktopAddonManager",
    [
      "AuthManager",
      "StartupSyncService",
      "bindListReorderDrag",
      "deferWhileReordering",
      "addonRepository"
    ],
    [
      { isAuthenticated: false },
      {},
      () => {},
      () => false,
      {
        getConfiguredAddons: () => addons,
        isAddonEnabled: () => true,
        reloadConfiguredAddons: async () => {
          reloads++;
        },
        onInstalledAddonsChanged: () => () => {}
      }
    ]
  );
  const manager = create({ requestRender: async () => {} }),
    c = controls();
  assert.equal(manager.count, 1);
  await manager.load();
  assert.equal(reloads, 1);
  manager.bind(c.container);
  c.handlers.get("[data-addon-add-disclosure]:toggle")({ currentTarget: { open: true } });
  c.handlers.get("[data-addon-url]:input")({ target: { value: "https://example.test/draft" } });
  await manager.load({ refresh: false });
  assert.equal(reloads, 1);
  assert.match(manager.render(), /data-addon-add-disclosure open/);
  assert.match(manager.render(), /value="https:\/\/example.test\/draft"/);
  c.handlers.get("[data-addon-add-disclosure]:toggle")({
    currentTarget: { open: false, isConnected: false }
  });
  assert.match(manager.render(), /data-addon-add-disclosure open/);
  manager.dispose();
});

test("plugin manager preserves its local source draft and uses existing add behavior", async () => {
  const sources = [];
  let mutation;
  const create = await managerFactory(
    "desktopPluginManager",
    "createDesktopPluginManager",
    ["AuthManager", "PluginManager", "PluginSyncService"],
    [
      { isAuthenticated: false },
      {
        pluginsEnabled: false,
        repositories: { listRepositories: () => [], canEdit: () => true },
        listPluginSources: () => sources,
        addPluginSource: (s) => sources.push(s)
      },
      {
        recordLocalMutation: (...args) => {
          mutation = args;
        }
      }
    ]
  );
  const manager = create({ requestRender: async () => {} }),
    c = controls();
  await manager.load();
  manager.bind(c.container);
  c.handlers.get("[data-plugin-add-disclosure]:toggle")({ currentTarget: { open: true } });
  c.handlers.get("[data-plugin-name]:input")({ target: { value: "Fixture source" } });
  c.handlers.get("[data-plugin-url]:input")({ target: { value: "https://example.test/{tmdbId}" } });
  await manager.load();
  assert.match(manager.render(), /value="Fixture source"/);
  assert.match(manager.render(), /data-plugin-add-disclosure open/);
  c.handlers.get("[data-plugin-form]:submit")({ preventDefault() {} });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(manager.count, 1);
  assert.equal(sources[0].urlTemplate, "https://example.test/{tmdbId}");
  assert.ok(mutation);
});

test("collection manager retains draft and opens the existing editor on creation", async () => {
  let collections = [],
    navigation;
  const create = await managerFactory(
    "desktopCollectionManager",
    "createDesktopCollectionManager",
    ["bindListReorderDrag", "deferWhileReordering", "Router", "ProfileManager", "CollectionsStore"],
    [
      () => {},
      () => false,
      {
        navigate: async (...args) => {
          navigation = args;
        }
      },
      { getActiveProfileId: () => "guest" },
      {
        getForProfile: () => collections,
        replaceForProfile: (profile, next) => {
          assert.equal(profile, "guest");
          collections = next;
        },
        generateId: () => "fixture-id"
      }
    ]
  );
  const manager = create({ requestRender: async () => {} }),
    c = controls();
  await manager.load();
  manager.bind(c.container);
  c.handlers.get("[data-collection-add-disclosure]:toggle")({ currentTarget: { open: true } });
  c.node("[data-desktop-collection-name]").value = "Weekend";
  c.handlers.get("[data-desktop-collection-name]:input")();
  await manager.load();
  assert.match(manager.render(), /value="Weekend"/);
  c.handlers.get("[data-desktop-collection-add]:click")();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(manager.count, 1);
  assert.equal(collections[0].title, "Weekend");
  assert.deepEqual(navigation, ["collectionEdit", { collectionId: "fixture-id" }]);
  collections = [{ ...collections[0], title: "Updated in editor" }];
  assert.match(manager.render(), /Updated in editor/);
});

test("returning from a collection editor refreshes only the visible Discovery page", async () => {
  const source = await readFile(new URL("./settingsScreen.js", import.meta.url), "utf8");
  const method = source.match(/ {2}onRouteRevealed\(\) \{[\s\S]*?\n {2}\},/)[0];
  const callback = new Function("Platform", "Router", `return ({${method}}).onRouteRevealed;`)(
    { isBrowser: () => true },
    { getCurrent: () => "settingsSection" }
  );
  let count = 0;
  const screen = {
    container: { id: "settingsSection" },
    presentedSectionId: "contentDiscovery",
    render(options) {
      assert.deepEqual(options, { refreshModel: false });
      count++;
    }
  };
  callback.call(screen);
  assert.equal(count, 1);
  screen.container.id = "settings";
  callback.call(screen);
  assert.equal(count, 1);
  screen.container.id = "settingsSection";
  screen.presentedSectionId = "layout";
  callback.call(screen);
  assert.equal(count, 1);
});
