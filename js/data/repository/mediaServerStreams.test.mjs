import assert from "node:assert/strict";
import test from "node:test";

globalThis.__NUVIO_INCLUDE_TRAKT_CLIENT_SECRET__ = false;
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: { getItem: () => null, setItem: () => {} }
});
const { MediaConnectionsStore, mediaTitleId } =
  await import("../../core/media/mediaConnections.js");
const { TmdbService } = await import("../../core/tmdb/tmdbService.js");
const { addonRepository } = await import("./addonRepository.js");
const { streamRepository } = await import("./streamRepository.js");

const server = {
  id: "media:test",
  kind: "jellyfin",
  name: "Jellyfin",
  url: "https://jellyfin.example.test",
  userId: "user",
  token: "fixture",
  libraryIds: ["broken", "shows"]
};
const show = { Id: "show", Name: "Same Name", Type: "Series", ProviderIds: { Tvdb: "789" } };
const episode = { Id: "episode", Type: "Episode", IndexNumber: 2, ParentIndexNumber: 1 };

test("stock Jellyfin finds a TVDB-only series by name and checks its exact ID", async (t) => {
  t.mock.method(MediaConnectionsStore, "get", () => ({ servers: [server] }));
  t.mock.method(addonRepository, "getInstalledAddons", async () => []);
  t.mock.method(streamRepository, "getPluginStreams", async () => []);
  t.mock.method(TmdbService, "externalIds", async () => ({ imdbId: "tt123", tvdbId: "789" }));
  t.mock.method(globalThis, "fetch", async (url) => {
    const { searchParams } = new URL(url);
    const parent = searchParams.get("ParentId");
    if (parent === "broken") return new Response(null, { status: 503 });
    if (parent === "show") {
      assert.equal(searchParams.get("ParentIndexNumber"), "1");
      return Response.json({ Items: [episode, { ...episode, Id: "other", IndexNumber: 3 }] });
    }
    assert.ok(searchParams.get("AnyProviderIdEquals")?.includes("tmdb.123"));
    assert.equal(searchParams.get("SearchTerm"), "Same Name");
    return Response.json({
      Items: [{ ...show, Id: "unrelated", ProviderIds: { Tvdb: "999" } }, show]
    });
  });
  const result = await streamRepository.getStreamsFromAllAddons("series", "tmdb:123:1:2", {
    title: "Same Name"
  });
  assert.equal(result.data.length, 1);
  assert.equal(result.data[0].streams[0].clientResolve.mediaServer.itemId, "episode");
});

test("a Jellyfin episode returns its native stream and queries add-ons with public TVDB IDs", async (t) => {
  const addon = {
    id: "addon",
    baseUrl: "https://addon.example.test",
    displayName: "TVDB add-on",
    resources: [{ name: "stream", types: ["series"], idPrefixes: ["tvdb:"] }]
  };
  t.mock.method(MediaConnectionsStore, "get", () => ({ servers: [server] }));
  t.mock.method(addonRepository, "getInstalledAddons", async () => [addon]);
  t.mock.method(streamRepository, "getPluginStreams", async () => []);
  t.mock.method(globalThis, "fetch", async (url) => {
    assert.equal(new URL(url).hostname, "jellyfin.example.test");
    return Response.json(episode);
  });
  const requested = t.mock.method(
    streamRepository,
    "getStreamsFromAddon",
    async (url, type, id) => {
      assert.equal(url, addon.baseUrl);
      assert.equal(type, "series");
      assert.equal(id, "tvdb:789:1:2");
      return { status: "success", data: [{ url: "https://cdn.example.test/episode.mp4" }] };
    }
  );
  const result = await streamRepository.getStreamsFromAllAddons(
    "series",
    mediaTitleId(server, "episode"),
    {
      itemId: mediaTitleId(server, "show"),
      tvdbId: "789",
      season: 1,
      episode: 2
    }
  );
  assert.equal(requested.mock.callCount(), 1);
  assert.deepEqual(
    result.data.map(({ addonId }) => addonId),
    [addon.id, server.id]
  );
});

test("the Jellyfin library index finds translated titles beyond the first page by TVDB", async (t) => {
  const { findMediaServerStreams } = await import("../../core/media/mediaConnections.js");
  const indexedServer = { ...server, id: "media:index", libraryIds: ["shows"] };
  const pages = [];
  t.mock.method(globalThis, "fetch", async (url) => {
    const { searchParams } = new URL(url);
    if (searchParams.get("ParentId") === "show") return Response.json({ Items: [episode] });
    if (!searchParams.has("StartIndex")) return Response.json({ Items: [] });
    const start = Number(searchParams.get("StartIndex"));
    pages.push(start);
    return Response.json({
      Items: start === 0 ? Array.from({ length: 500 }, (_, Id) => ({ Id })) : [show]
    });
  });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const result = await findMediaServerStreams(indexedServer, "series", "tvdb:789:1:2", {
      title: "Translated Name",
      tvdbId: "789"
    });
    assert.deepEqual(result, [episode]);
  }
  assert.deepEqual(pages, [0, 500]);
});
