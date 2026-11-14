import assert from "node:assert/strict";
import test from "node:test";

globalThis.__NUVIO_INCLUDE_TRAKT_CLIENT_SECRET__ = false;
globalThis.__NUVIO_ENV__ = { NUVIO_SUPABASE_URL: "https://sync.example.test" };
const { decodeMediaServer, encodeMediaServer, mergeMediaServers, MediaServerSyncService } =
  await import("./mediaServerSyncService.js");
const { AuthManager } = await import("../auth/authManager.js");
const { MediaConnectionsStore } = await import("../media/mediaConnections.js");
const { SupabaseApi } = await import("../../data/remote/supabase/supabaseApi.js");
const { ProfileManager } = await import("./profileManager.js");

const record = {
  id: "upstream-id",
  provider_id: "emby",
  name: "Home Server",
  address: "https://emby.example.test/path",
  remote_server_id: "server-id",
  remote_user_id: "user-id",
  user_name: "viewer",
  token: "access-token",
  libraries: [{ id: "movies", name: "Movies", kind: "movie", selected: false }],
  enabled: true,
  use_catalog_metadata: false
};

test("Emby and Jellyfin use the upstream shape and keep existing Web IDs", () => {
  const legacy = {
    id: "media:legacy",
    kind: "emby",
    url: record.address + "/emby",
    userId: record.remote_user_id
  };
  const emby = decodeMediaServer(record, [legacy]);
  assert.equal(emby.id, legacy.id);
  assert.deepEqual(emby.libraryIds, []);
  assert.deepEqual(encodeMediaServer(emby), record);
  const jellyfin = { ...record, provider_id: "jellyfin", enabled: false };
  assert.deepEqual(encodeMediaServer(decodeMediaServer(jellyfin)), jellyfin);
});

test("the first pull preserves local-only connections and merges edits by identity", () => {
  const remote = decodeMediaServer(record);
  const local = { ...remote, name: "Updated", id: "media:legacy" };
  const other = { ...local, id: "media:other", remoteServerId: "other" };
  const cloud = decodeMediaServer(record, [local]);
  const merged = mergeMediaServers([local, other], [cloud], { changed: [local.id] });
  assert.deepEqual(
    merged.map(({ id, name }) => [id, name]),
    [
      [local.id, "Updated"],
      [other.id, "Updated"]
    ]
  );
  assert.deepEqual(
    mergeMediaServers([local], [], {
      known: [JSON.stringify(["emby", "server-id", "user-id"])]
    }),
    []
  );
  assert.deepEqual(
    mergeMediaServers([], [cloud], {
      removed: [JSON.stringify(["emby", local.url, "user-id"])]
    }),
    []
  );
});

test("existing servers migrate through the official RPC, without touching Seerr", async (t) => {
  const storage = new Map();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
      removeItem: (key) => storage.delete(key)
    }
  });
  t.mock.getter(AuthManager, "isAuthenticated", () => true);
  t.mock.method(AuthManager, "isSessionCurrent", () => true);
  t.mock.method(ProfileManager, "getActiveProfileId", () => 2);
  const seerr = { url: "https://seerr.example.test", userId: 5 };
  let cloud = [record];
  const pushes = [];
  t.mock.method(SupabaseApi, "rpc", async (name, body, authenticated) => {
    assert.equal(body.p_profile_id, 2);
    assert.equal(authenticated, true);
    if (name === "sync_pull_media_servers") return [{ servers_json: cloud }];
    assert.equal(name, "sync_push_media_servers");
    assert.ok(body.p_origin_client_id);
    cloud = body.p_servers;
    pushes.push(body);
  });
  t.mock.method(globalThis, "fetch", async (url, options) => {
    const parsed = new URL(url);
    assert.equal(parsed.host, "jellyfin.example.test");
    if (parsed.pathname.endsWith("/Info/Public")) return Response.json({ Id: "jellyfin-id" });
    assert.equal(options.headers["X-Emby-Token"], "legacy-token");
    if (parsed.pathname.endsWith("/Views")) {
      return Response.json({ Items: [{ Id: "movies", Name: "Movies", CollectionType: "movies" }] });
    }
    return Response.json({ Name: "viewer" });
  });
  MediaConnectionsStore.setForProfile(
    2,
    {
      seerr,
      servers: [
        {
          id: "media:legacy",
          name: "My Jellyfin",
          kind: "jellyfin",
          url: "https://jellyfin.example.test",
          userId: "legacy-user",
          token: "legacy-token",
          libraryIds: []
        }
      ]
    },
    { silentSync: true, syncSource: "media-server-cloud" }
  );
  assert.equal(await MediaServerSyncService.sync(2), true);
  assert.equal(pushes.length, 1);
  assert.deepEqual(MediaConnectionsStore.getForProfile(2).seerr, seerr);
  assert.deepEqual(
    cloud.map(({ provider_id }) => provider_id),
    ["emby", "jellyfin"]
  );
  assert.equal(cloud[1].libraries[0].selected, false);
  assert.equal(MediaConnectionsStore.getForProfile(2).servers[1].id, "media:legacy");
  assert.equal(await MediaServerSyncService.sync(2), false);
  assert.equal(pushes.length, 1);

  const firstDevice = new Map(storage);
  storage.clear();
  assert.equal(await MediaServerSyncService.sync(2), true);
  assert.deepEqual(
    MediaConnectionsStore.getForProfile(2).servers.map(({ kind, url, libraryIds }) => ({
      kind,
      url,
      libraryIds
    })),
    [
      { kind: "emby", url: record.address + "/emby", libraryIds: [] },
      { kind: "jellyfin", url: "https://jellyfin.example.test", libraryIds: [] }
    ]
  );
  assert.equal(MediaConnectionsStore.getForProfile(2).seerr, null);

  MediaConnectionsStore.setForProfile(
    2,
    {
      servers: MediaConnectionsStore.getForProfile(2).servers.filter(({ kind }) => kind !== "emby")
    },
    { silentSync: true }
  );
  await MediaServerSyncService.sync(2);
  assert.deepEqual(
    cloud.map(({ provider_id }) => provider_id),
    ["jellyfin"]
  );
  storage.clear();
  firstDevice.forEach((value, key) => storage.set(key, value));
  assert.equal(await MediaServerSyncService.sync(2), true);
  assert.deepEqual(
    MediaConnectionsStore.getForProfile(2).servers.map(({ id }) => id),
    ["media:legacy"]
  );
  assert.deepEqual(MediaConnectionsStore.getForProfile(2).seerr, seerr);
});
