import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

let importId = 0;
const bundled = await build({
  entryPoints: [fileURLToPath(new URL("./librarySyncService.js", import.meta.url))],
  bundle: true,
  format: "esm",
  platform: "node",
  write: false,
  banner: { js: "const console = { warn() {} };" },
  plugins: [
    {
      name: "library-sync-dependencies",
      setup(api) {
        const dependencies = new Map([
          ["authManager.js", "AuthManager"],
          ["addonRepository.js", "addonRepository"],
          ["profileManager.js", "ProfileManager"],
          ["supabaseApi.js", "SupabaseApi"],
          ["syncHydrationState.js", "SyncHydrationState"]
        ]);
        api.onResolve({ filter: /\.js$/ }, (args) => {
          const name = dependencies.get(args.path.split("/").pop());
          if (name) return { path: name, namespace: "mock" };
          if (args.path.endsWith("accountLocalDataReset.js"))
            return { path: "reset", namespace: "mock" };
        });
        api.onLoad({ filter: /.*/, namespace: "mock" }, ({ path }) => ({
          contents:
            path === "reset"
              ? "export function registerAccountRuntimeResetHandler(handler) { globalThis.__addonSyncTest.reset = handler; }"
              : `export const ${path} = new Proxy({}, { get: (_, key) => globalThis.__addonSyncTest.${path}[key] });${path === "SyncHydrationState" ? 'export const SyncPullResult = { SUCCESS_WITH_DATA: "DATA", SUCCESS_EMPTY: "EMPTY", FAILED: "FAILED" };' : ""}`
        }));
      }
    }
  ]
});

const initial = ["https://a.invalid", "https://b.invalid"];
const snapshot = (urls, extra = {}) => ({ urls: [...urls], names: {}, enabled: {}, ...extra });
const failure = (status) => Object.assign(new Error(`HTTP ${status}`), { status });
function deferred() {
  let resolve;
  const promise = new Promise((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

async function client() {
  let local = snapshot(initial);
  let remote = snapshot(initial);
  let activeProfile = "1";
  let userId = "owner";
  const calls = [];
  const published = [];
  const deps = {
    AuthManager: { isAuthenticated: true, getEffectiveUserId: async () => userId },
    ProfileManager: { getActiveProfileId: () => activeProfile, getProfiles: async () => [] },
    addonRepository: {
      canonicalizeUrl: (url) => url,
      getInstalledAddonUrls: () => [...local.urls],
      getSyncSnapshot: () => structuredClone(local),
      isAddonEnabled: (url) => local.enabled[url] !== false,
      getAddonDisplayNameOverride: (url) => local.names[url] || "",
      getAddonDisplayNameOverrides: () => ({ ...local.names }),
      setAddonDisplayNameOverrides: (entries) => {
        local.names = Object.fromEntries(entries.map((e) => [e.url, e.name]));
        return true;
      },
      setAddonEnabledStates: (entries) => {
        local.enabled = Object.fromEntries(entries.map((e) => [e.url, e.enabled]));
        return true;
      },
      setAddonOrder: async (urls) => {
        local.urls = [...urls];
        published.push([...urls]);
        return true;
      },
      notifyAddonsChanged: () => {}
    },
    SupabaseApi: {
      select: async (table, query) => {
        calls.push({ method: "select", table, query });
        return remote.urls.map((url) => ({
          url,
          name: remote.names[url],
          enabled: remote.enabled[url] !== false
        }));
      },
      rpc: async (name, body) => {
        calls.push({ method: "rpc", name, body });
        remote = snapshot(body.p_addons.map((e) => e.url));
      },
      delete: async () => {
        calls.push({ method: "delete" });
        remote = snapshot([]);
      },
      upsert: async () => {
        calls.push({ method: "upsert" });
        throw failure(503);
      }
    },
    SyncHydrationState: {
      capture: async (profileId) => ({ profileId, activeProfileId: activeProfile, userId }),
      isCurrent: async (context) =>
        context?.activeProfileId === activeProfile && context?.userId === userId,
      beginPull: async () => true,
      completePull: async () => true,
      allowsAutomaticPush: async () => true
    }
  };
  globalThis.__addonSyncTest = deps;
  const { LibrarySyncService: service } = await import(
    `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].contents).toString("base64")}#${++importId}`
  );
  return {
    service,
    deps,
    calls,
    published,
    local: () => structuredClone(local),
    remote: () => structuredClone(remote),
    setRemote: (value) => {
      remote = value;
    },
    setProfile: (value) => {
      activeProfile = value;
    },
    setUser: (value) => {
      userId = value;
    },
    edit(value) {
      const before = local;
      local = value;
      service.markLocalMutation(null, { before, after: value });
    }
  };
}

for (const status of [404, 500]) {
  test(`failed replacement RPC (${status}) cannot delete remote addons or discard pending edits`, async () => {
    const c = await client();
    c.edit(snapshot(initial, { enabled: { [initial[1]]: false } }));
    c.deps.SupabaseApi.rpc = async () => {
      throw failure(status);
    };
    assert.equal(await c.service.push(), false);
    assert.deepEqual(c.remote().urls, initial);
    assert.equal(c.local().enabled[initial[1]], false);
    assert.equal(c.service.hasPendingLocalMutation(), true);
    assert.equal(
      c.calls.some((call) => ["delete", "upsert"].includes(call.method)),
      false
    );
    await c.service.pull();
    assert.deepEqual(c.local().urls, initial);
    assert.equal(c.local().enabled[initial[1]], false);
  });
}

for (const status of [401, 403, 500, 503]) {
  test(`read failure ${status} preserves local addons without consulting a legacy source`, async () => {
    const c = await client();
    const reads = [];
    c.deps.SupabaseApi.select = async (table) => {
      reads.push(table);
      if (table === "addons") throw failure(status);
      return [];
    };
    assert.equal((await c.service.pull()).result, "FAILED");
    assert.deepEqual(reads, ["addons"]);
    assert.deepEqual(c.local().urls, initial);
    assert.deepEqual(c.published, []);
  });
}

test("a successful empty read is applied but never automatically written back", async () => {
  const c = await client();
  c.setRemote(snapshot([]));
  assert.equal((await c.service.pull()).result, "EMPTY");
  assert.deepEqual(c.local().urls, []);
  await c.service.push({ automatic: true });
  assert.equal(
    c.calls.some((call) => call.method === "rpc"),
    false
  );
});

test("explicitly removing the final addon still saves an empty replacement", async () => {
  const c = await client();
  c.edit(snapshot([]));
  assert.equal(await c.service.push({ automatic: true }), true);
  assert.deepEqual(c.calls.find((call) => call.method === "rpc").body.p_addons, []);
  assert.deepEqual(c.remote().urls, []);
  assert.equal(c.service.hasPendingLocalMutation(), false);
});

test("pending additions, removals, names, enabled states and order merge before one publication", async () => {
  const c = await client();
  c.edit(
    snapshot(["https://c.invalid", initial[0]], {
      names: { [initial[0]]: "My name" },
      enabled: { [initial[0]]: false }
    })
  );
  c.setRemote(snapshot([...initial, "https://d.invalid"]));
  await c.service.pull();
  assert.deepEqual(c.published, [["https://c.invalid", initial[0], "https://d.invalid"]]);
  assert.equal(c.local().names[initial[0]], "My name");
  assert.equal(c.local().enabled[initial[0]], false);
});

test("a new edit during an in-flight save is not acknowledged by the older save", async () => {
  const c = await client();
  const sent = deferred();
  const response = deferred();
  c.edit(snapshot([initial[0]]));
  c.deps.SupabaseApi.rpc = async () => {
    sent.resolve();
    await response.promise;
  };
  const saving = c.service.push();
  await sent.promise;
  c.edit(snapshot([]));
  response.resolve();
  assert.equal(await saving, true);
  assert.equal(c.service.hasPendingLocalMutation(), true);
  assert.deepEqual(c.local().urls, []);
});

test("a pull started before a completed save cannot restore its stale server snapshot", async () => {
  const c = await client();
  const reading = deferred();
  const response = deferred();
  c.deps.SupabaseApi.select = async () => {
    reading.resolve();
    return response.promise;
  };
  const pulling = c.service.pull();
  await reading.promise;
  c.edit(snapshot([initial[0]]));
  await c.service.push();
  response.resolve(initial.map((url) => ({ url })));
  assert.equal((await pulling).result, "FAILED");
  assert.deepEqual(c.local().urls, [initial[0]]);
  assert.deepEqual(c.published, []);
});

test("only missing schema resources permit the legacy read/RPC chain", async () => {
  const c = await client();
  const reads = [];
  c.deps.SupabaseApi.select = async (table) => {
    reads.push(table);
    throw failure(404);
  };
  c.deps.SupabaseApi.rpc = async (name) => {
    reads.push(name);
    return [{ base_url: initial[0] }];
  };
  assert.equal((await c.service.pull()).result, "DATA");
  assert.deepEqual(reads, ["addons", "tv_addons", "sync_pull_addons"]);
  assert.deepEqual(c.local().urls, [initial[0]]);
});

for (const rows of [null, {}, [{ name: "missing URL" }]]) {
  test(`malformed remote data cannot be interpreted as an empty list: ${JSON.stringify(rows)}`, async () => {
    const c = await client();
    c.deps.SupabaseApi.select = async () => rows;
    assert.equal((await c.service.pull()).result, "FAILED");
    assert.deepEqual(c.local().urls, initial);
  });
}

test("a response for a profile or account that is no longer active cannot update local addons", async () => {
  for (const switchContext of [(c) => c.setProfile("2"), (c) => c.setUser("other")]) {
    const c = await client();
    const reading = deferred();
    const response = deferred();
    c.deps.SupabaseApi.select = async () => {
      reading.resolve();
      return response.promise;
    };
    const pulling = c.service.pull();
    await reading.promise;
    switchContext(c);
    response.resolve([]);
    assert.equal((await pulling).result, "FAILED");
    assert.deepEqual(c.published, []);
  }
});
