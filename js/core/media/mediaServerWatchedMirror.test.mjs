import assert from "node:assert/strict";
import test from "node:test";

const values = new Map();
globalThis.localStorage = {
  getItem: (key) => values.get(key) || null,
  setItem: (key, value) => values.set(key, String(value)),
  removeItem: (key) => values.delete(key),
  clear: () => values.clear()
};

const { MediaConnectionsStore, mediaTitleId } = await import("./mediaConnections.js");
const { mirrorWatchedToServers } = await import("./mediaServerWatchedMirror.js");

function server(overrides = {}) {
  return {
    id: "media:jellyfin:https://jelly.example.test:user-1",
    kind: "jellyfin",
    name: "Jellyfin",
    url: "https://jelly.example.test",
    userId: "user-1",
    token: "token",
    enabled: true,
    ...overrides
  };
}

function useServers(servers) {
  MediaConnectionsStore.setForProfile(1, { servers }, { silentSync: true });
}

function captureFetch(calls) {
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), method: options.method || "GET" });
    return new Response(null, { status: 204 });
  };
}

test("marking a server title watched writes PlayedItems on the server", async () => {
  values.clear();
  const jellyfin = server();
  useServers([jellyfin]);
  const calls = [];
  captureFetch(calls);
  const contentId = mediaTitleId(jellyfin, "movie-1");
  const result = await mirrorWatchedToServers(
    { contentId, contentType: "movie", title: "Movie" },
    true
  );
  assert.equal(result.marked, 1);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, "POST");
  assert.match(calls[0].url, /\/Users\/user-1\/PlayedItems\/movie-1$/);
});

test("un-watching removes the played mark", async () => {
  values.clear();
  const jellyfin = server();
  useServers([jellyfin]);
  const calls = [];
  captureFetch(calls);
  await mirrorWatchedToServers(
    { contentId: mediaTitleId(jellyfin, "movie-1"), contentType: "movie" },
    false
  );
  assert.equal(calls[0].method, "DELETE");
});

test("a disabled server is not written to", async () => {
  values.clear();
  useServers([server({ enabled: false })]);
  const calls = [];
  captureFetch(calls);
  const result = await mirrorWatchedToServers(
    { contentId: mediaTitleId(server(), "movie-1"), contentType: "movie" },
    true
  );
  assert.equal(calls.length, 0);
  assert.equal(result.skipped, true);
});

test("add-on identities only mirror through catalog-metadata servers", async () => {
  values.clear();
  useServers([server({ useCatalogMetadata: false })]);
  const calls = [];
  captureFetch(calls);
  await mirrorWatchedToServers(
    { contentId: "tt1234567", contentType: "movie", imdbId: "tt1234567" },
    true
  );
  assert.equal(calls.length, 0);
});
