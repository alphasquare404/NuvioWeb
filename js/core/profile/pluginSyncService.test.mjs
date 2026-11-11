import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const dependencies = {
  authManager: "AuthManager",
  supabaseApi: "SupabaseApi",
  pluginRuntime: "PluginRuntime",
  pluginStore: "PluginStore",
  profileManager: "ProfileManager",
  syncHydrationState: "SyncHydrationState"
};

const result = await build({
  entryPoints: [fileURLToPath(new URL("./pluginSyncService.js", import.meta.url))],
  bundle: true,
  format: "esm",
  platform: "node",
  write: false,
  plugins: [
    {
      name: "plugin-sync-fixture",
      setup(builder) {
        builder.onResolve(
          {
            filter:
              /(?:authManager|supabaseApi|pluginRuntime|pluginStore|profileManager|syncHydrationState)\.js$/
          },
          ({ path }) => ({
            path: path.split("/").at(-1).slice(0, -3),
            namespace: "plugin-sync-fixture"
          })
        );
        builder.onLoad({ filter: /.*/, namespace: "plugin-sync-fixture" }, ({ path }) => ({
          contents:
            "export const " +
            dependencies[path] +
            " = new Proxy({}, { get: (_, key) => globalThis.pluginSyncFixture." +
            dependencies[path] +
            "[key] });" +
            (path === "syncHydrationState"
              ? 'export const SyncPullResult = { FAILED: "failed", SUCCESS_EMPTY: "empty", SUCCESS_WITH_DATA: "data" };'
              : "")
        }));
      }
    }
  ]
});

const { PluginSyncService } = await import(
  "data:text/javascript;base64," + Buffer.from(result.outputFiles[0].contents).toString("base64")
);

function repository(name) {
  return {
    id: name,
    name,
    url: "https://plugins.example/" + name + "/manifest.json",
    enabled: true,
    type: "NUVIO_JS"
  };
}

const remoteRow = (repo) => ({
  name: repo.name,
  url: repo.url,
  enabled: true,
  repo_type: repo.type
});

function fixture(repositories = [], syncedRepositoryUrls = []) {
  const state = {
    repositories,
    syncedRepositoryUrls,
    legacySources: [
      {
        id: "legacy",
        name: "Legacy",
        urlTemplate: "https://stream.example/{tmdbId}",
        enabled: true
      }
    ],
    scrapers: repositories.map((repo) => ({ id: repo.id + "-scraper", repositoryId: repo.id }))
  };
  const cloud = { rows: [], overviewCount: 0, writes: [] };
  globalThis.pluginSyncFixture = {
    AuthManager: { isAuthenticated: true, getEffectiveUserId: async () => "owner" },
    ProfileManager: { getActiveProfileId: () => "1" },
    PluginStore: {
      get: () => structuredClone(state),
      replace: (next) => Object.assign(state, structuredClone(next)),
      canEdit: () => true
    },
    PluginRuntime: {
      listSources: () => state.legacySources,
      saveSources: (sources) => {
        state.legacySources = sources;
      }
    },
    SyncHydrationState: {
      capture: async () => ({ profileId: "1" }),
      isCurrent: async () => true,
      beginPull: async () => true,
      completePull: async () => true,
      allowsAutomaticPush: async () => true
    },
    SupabaseApi: {
      select: async () => cloud.rows,
      rpc: async (name, args) => {
        if (name === "get_sync_overview") {
          return { profiles: { 1: { id: 1 } }, plugins: { 1: cloud.overviewCount } };
        }
        assert.equal(name, "sync_push_plugins");
        cloud.writes.push(args.p_plugins);
      }
    }
  };
  return { state, cloud };
}

test("a cloud deletion removes the previously synced repository and its scrapers", async () => {
  const deleted = repository("deleted");
  const kept = repository("kept");
  const local = repository("local");
  const { state, cloud } = fixture([deleted, kept, local], [deleted.url, kept.url]);
  cloud.rows = [remoteRow(kept)];
  assert.equal((await PluginSyncService.pull()).result, "data");
  assert.deepEqual(
    state.repositories.map((repo) => repo.id),
    ["kept", "local"]
  );
  assert.deepEqual(
    state.scrapers.map((scraper) => scraper.repositoryId),
    ["kept", "local"]
  );
  assert.equal(state.legacySources.length, 1);
});

test("the last remote repository is removed only after the cloud confirms an empty profile", async () => {
  const last = repository("last");
  const local = repository("local");
  const { state, cloud } = fixture([last, local], [last.url]);
  cloud.overviewCount = 1;
  assert.equal((await PluginSyncService.pull()).result, "failed");
  assert.deepEqual(
    state.repositories.map((repo) => repo.id),
    ["last", "local"]
  );
  cloud.overviewCount = 0;
  assert.equal((await PluginSyncService.pull()).result, "empty");
  assert.deepEqual(
    state.repositories.map((repo) => repo.id),
    ["local"]
  );
  assert.deepEqual(state.syncedRepositoryUrls, []);
});

test("a local edit survives pull while an unrelated cloud deletion stays deleted on push", async () => {
  const deleted = repository("deleted");
  const edited = repository("edited");
  const { state, cloud } = fixture([deleted, edited], [deleted.url, edited.url]);
  const before = PluginSyncService.snapshot();
  state.repositories[1].enabled = false;
  PluginSyncService.recordLocalMutation("1", before, PluginSyncService.snapshot());
  cloud.rows = [remoteRow(edited)];
  assert.equal(await PluginSyncService.push({ automatic: true }), true);
  assert.deepEqual(
    state.repositories.map((repo) => repo.id),
    ["edited"]
  );
  assert.deepEqual(
    cloud.writes[0].filter((row) => row.repo_type).map((row) => [row.name, row.enabled]),
    [["edited", false]]
  );
  assert.equal(PluginSyncService.hasPendingLocalMutation("1"), false);
});

test("a queued local removal is not re-added by an older cloud snapshot", async () => {
  const deleted = repository("deleted");
  const { state, cloud } = fixture([deleted], [deleted.url]);
  const before = PluginSyncService.snapshot();
  state.repositories = [];
  PluginSyncService.recordLocalMutation("1", before, PluginSyncService.snapshot());
  cloud.rows = [remoteRow(deleted)];
  await PluginSyncService.pull();
  assert.deepEqual(state.repositories, []);
  assert.equal(PluginSyncService.hasPendingLocalMutation("1"), true);
  assert.equal(await PluginSyncService.push({ automatic: true }), true);
  assert.ok(!cloud.writes[0].some((row) => row.url === deleted.url));
});

test("an invalid remote payload cannot erase a previously synced repository", async () => {
  const repo = repository("kept");
  const { state, cloud } = fixture([repo], [repo.url]);
  cloud.rows = [{ name: "invalid" }];
  assert.equal((await PluginSyncService.pull()).result, "failed");
  assert.deepEqual(state.repositories, [repo]);
});
