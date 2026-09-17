import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

function dependencyModule(name) {
  return `export const ${name} = new Proxy({}, { get: (_, key) => globalThis.__startupSyncDeps__.${name}?.[key] });`;
}

async function loadStartupSyncService() {
  const result = await build({
    entryPoints: [fileURLToPath(new URL("./startupSyncService.js", import.meta.url))],
    bundle: true,
    format: "esm",
    platform: "node",
    write: false,
    plugins: [
      {
        name: "startup-sync-mocks",
        setup(buildApi) {
          const modules = new Map([
            ["auth", dependencyModule("AuthManager")],
            ["addons", dependencyModule("addonRepository")],
            ["profiles", dependencyModule("ProfileManager")],
            ["profile-sync", dependencyModule("ProfileSyncService")],
            ["library", dependencyModule("LibrarySyncService")],
            ["progress", dependencyModule("WatchProgressSyncService")],
            ["saved-library", dependencyModule("SavedLibrarySyncService")],
            ["watched", dependencyModule("WatchedItemsSyncService")],
            ["plugins", dependencyModule("PluginSyncService")],
            ["profile-settings", dependencyModule("ProfileSettingsSyncService")],
            ["trakt", dependencyModule("TraktCredentialSyncService")],
            ["simkl-credentials", dependencyModule("SimklCredentialSyncService")],
            ["provider", dependencyModule("ProviderCredentialSyncService")],
            ["simkl", dependencyModule("SimklSyncService")],
            ["collections", dependencyModule("CollectionSyncService")],
            ["home-catalog", dependencyModule("HomeCatalogSettingsSyncService")],
            ["theme", dependencyModule("ThemeManager")],
            ["i18n", dependencyModule("I18n")],
            ["hydration", `export const SyncPullResult = { SUCCESS_WITH_DATA: "SUCCESS_WITH_DATA", SUCCESS_EMPTY: "SUCCESS_EMPTY", FAILED: "FAILED" }; export const SyncHydrationState = new Proxy({}, { get: (_, key) => globalThis.__startupSyncDeps__.SyncHydrationState?.[key] });`]
          ]);
          for (const [filter, path] of [
            [/authManager\.js$/, "auth"],
            [/addonRepository\.js$/, "addons"],
            [/profileManager\.js$/, "profiles"],
            [/profileSyncService\.js$/, "profile-sync"],
            [/librarySyncService\.js$/, "library"],
            [/watchProgressSyncService\.js$/, "progress"],
            [/savedLibrarySyncService\.js$/, "saved-library"],
            [/watchedItemsSyncService\.js$/, "watched"],
            [/pluginSyncService\.js$/, "plugins"],
            [/profileSettingsSyncService\.js$/, "profile-settings"],
            [/traktCredentialSyncService\.js$/, "trakt"],
            [/simklCredentialSyncService\.js$/, "simkl-credentials"],
            [/providerCredentialSyncService\.js$/, "provider"],
            [/simklSyncService\.js$/, "simkl"],
            [/collectionSyncService\.js$/, "collections"],
            [/homeCatalogSettingsSyncService\.js$/, "home-catalog"],
            [/themeManager\.js$/, "theme"],
            [/i18n\/index\.js$/, "i18n"],
            [/syncHydrationState\.js$/, "hydration"]
          ]) {
            buildApi.onResolve({ filter }, () => ({ path, namespace: "test" }));
          }
          buildApi.onLoad({ filter: /.*/, namespace: "test" }, (args) => ({
            contents: modules.get(args.path)
          }));
        }
      }
    ]
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].contents).toString("base64")}`);
}

function deferred() {
  let resolve = null;
  const promise = new Promise((next) => { resolve = next; });
  return { promise, resolve };
}

function installDependencies({ activeProfileId = "1" } = {}) {
  const calls = [];
  globalThis.__startupSyncDeps__ = {
    AuthManager: { isAuthenticated: true, getEffectiveUserId: async () => "user-1" },
    addonRepository: { onInstalledAddonsChanged: () => () => {} },
    ProfileManager: { getActiveProfileId: () => activeProfileId, getProfiles: async () => [] },
    ProfileSyncService: { pull: async () => [] },
    LibrarySyncService: {
      pull: async () => ({ result: "SUCCESS_EMPTY" }),
      push: async () => true,
      hasPendingLocalMutation: () => false
    },
    WatchProgressSyncService: { pull: async () => [] },
    SavedLibrarySyncService: { pull: async () => [] },
    WatchedItemsSyncService: { pull: async () => [] },
    PluginSyncService: {
      pull: async () => ({ result: "SUCCESS_EMPTY" }),
      push: async () => true,
      hasPendingLocalMutation: () => false
    },
    ProfileSettingsSyncService: { pull: async () => false },
    TraktCredentialSyncService: { pullFromRemote: async () => true },
    SimklCredentialSyncService: { pullFromRemote: async () => true },
    ProviderCredentialSyncService: { syncFromRemote: async () => true },
    SimklSyncService: { refresh: async () => true },
    CollectionSyncService: {
      pull: async () => ({ result: "SUCCESS_EMPTY" }),
      push: async () => true,
      triggerPush: () => {},
      hasPendingLocalMutation: () => false
    },
    HomeCatalogSettingsSyncService: { pull: async () => false },
    ThemeManager: { apply: () => { calls.push("theme-apply"); } },
    I18n: {
      init: async () => { calls.push("i18n-init"); },
      apply: () => { calls.push("i18n-apply"); }
    },
    SyncHydrationState: {
      capture: async (profileId) => ({ profileId: String(profileId), activeProfileId, generation: 1 }),
      isCurrent: async (context) => context.activeProfileId === activeProfileId,
      invalidate: () => {},
      beginPull: async () => true,
      completePull: async () => true,
      get: () => "hydrated",
      allowsAutomaticPush: async () => true
    }
  };
  return { calls, setActiveProfile: (value) => { activeProfileId = String(value); } };
}

test("critical Home hydration waits only for profile settings, catalog settings, and addons", async () => {
  const { calls } = installDependencies();
  const settings = deferred();
  const catalog = deferred();
  const addons = deferred();
  globalThis.__startupSyncDeps__.ProfileSettingsSyncService.pull = () => settings.promise;
  globalThis.__startupSyncDeps__.HomeCatalogSettingsSyncService.pull = () => catalog.promise;
  globalThis.__startupSyncDeps__.LibrarySyncService.pull = () => addons.promise;
  const { StartupSyncService } = await loadStartupSyncService();
  const hydration = StartupSyncService.hydrateCriticalHome("1");
  await Promise.resolve();
  assert.deepEqual(calls, []);
  settings.resolve(true);
  catalog.resolve(true);
  addons.resolve({ result: "SUCCESS_WITH_DATA" });
  const result = await hydration;
  assert.equal(result.current, true);
  assert.deepEqual(calls, ["i18n-init", "theme-apply", "i18n-apply"]);
});

test("slow SIMKL background work does not delay Collections or other independent domains", async () => {
  installDependencies();
  const simklCredentials = deferred();
  const started = [];
  globalThis.__startupSyncDeps__.SimklCredentialSyncService.pullFromRemote = () => simklCredentials.promise;
  globalThis.__startupSyncDeps__.CollectionSyncService.pull = async () => {
    started.push("collections");
    return { result: "SUCCESS_EMPTY" };
  };
  globalThis.__startupSyncDeps__.SavedLibrarySyncService.pull = async () => {
    started.push("saved-library");
    return [];
  };
  const { StartupSyncService } = await loadStartupSyncService();
  const sync = StartupSyncService.syncPull({
    includeProfileScoped: true,
    criticalHydration: {
      profileId: "1",
      current: true,
      addons: { result: "SUCCESS_EMPTY" }
    }
  });
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(started.sort(), ["collections", "saved-library"]);
  simklCredentials.resolve(true);
  await sync;
});

test("a stale profile activation cannot apply its critical Home settings after a profile switch", async () => {
  const { calls, setActiveProfile } = installDependencies({ activeProfileId: "1" });
  const settings = deferred();
  const catalog = deferred();
  const addons = deferred();
  globalThis.__startupSyncDeps__.ProfileSettingsSyncService.pull = () => settings.promise;
  globalThis.__startupSyncDeps__.HomeCatalogSettingsSyncService.pull = () => catalog.promise;
  globalThis.__startupSyncDeps__.LibrarySyncService.pull = () => addons.promise;
  const { StartupSyncService } = await loadStartupSyncService();

  const hydration = StartupSyncService.hydrateCriticalHome("1");
  setActiveProfile("2");
  settings.resolve(true);
  catalog.resolve(true);
  addons.resolve({ result: "SUCCESS_WITH_DATA" });

  const result = await hydration;
  assert.equal(result.current, false);
  assert.deepEqual(calls, []);
});
