import assert from "node:assert/strict";
import test from "node:test";
import {
  MediaConnectionsStore,
  connectMediaServer,
  findMediaServerStreams
} from "../../core/media/mediaConnections.js";

test("two Jellyfin connections with the same remote user and library IDs load separately", async (t) => {
  t.mock.method(globalThis, "fetch", async (address) => {
    const { hostname, pathname, searchParams } = new URL(address);
    if (pathname.endsWith("/AuthenticateByName")) {
      return Response.json({ User: { Id: "same-user" }, AccessToken: hostname });
    }
    if (pathname.endsWith("/Views")) {
      return Response.json({
        Items: [{ Id: "same-library", Name: "Movies", CollectionType: "movies" }]
      });
    }
    assert.equal(searchParams.get("ParentId"), "same-library");
    return Response.json({
      TotalRecordCount: 1,
      Items: [{ Id: "same-movie", Name: hostname, Type: "Movie" }]
    });
  });
  const servers = await Promise.all(
    ["one.example.test", "two.example.test"].map((hostname) =>
      connectMediaServer({
        kind: "jellyfin",
        name: hostname,
        url: `https://${hostname}`,
        username: "viewer",
        password: "fixture"
      })
    )
  );
  t.mock.method(MediaConnectionsStore, "get", () => ({ servers }));
  assert.notEqual(servers[0].id, servers[1].id);
  const addons = await mediaCatalogAddons();
  const rows = await Promise.all(
    addons.map((addon) =>
      loadMediaCatalog({
        addonBaseUrl: addon.baseUrl,
        addonId: addon.id,
        addonName: addon.name,
        catalogId: "library-same-library",
        catalogName: "Movies",
        type: "movie",
        skip: 0,
        extraArgs: {}
      })
    )
  );
  assert.deepEqual(
    rows.map((row) => row.items[0].name),
    ["one.example.test", "two.example.test"]
  );
  assert.notEqual(rows[0].items[0].id, rows[1].items[0].id);
});
import {
  mediaCatalogAddons,
  loadMediaCatalog,
  loadMediaTitle
} from "./mediaServerCatalogRepository.js";

test("selected server libraries feed Home and Search, with server-native Detail and playback IDs", async (t) => {
  const server = {
    id: "media:test:user",
    url: "https://fixture.test",
    name: "Fixture",
    userId: "user",
    token: "dummy",
    libraryIds: ["series"]
  };
  t.mock.method(MediaConnectionsStore, "get", () => ({ servers: [server] }));
  t.mock.method(globalThis, "fetch", async (url) => {
    const { pathname, searchParams } = new URL(url);
    if (pathname.endsWith("/Views"))
      return Response.json({
        Items: [
          { Id: "series", Name: "Family Shows", CollectionType: "tvshows" },
          { Id: "movies", Name: "Films", CollectionType: "movies" }
        ]
      });
    if (pathname.endsWith("/Items/show"))
      return Response.json({
        Id: "show",
        Name: "Test Show",
        Type: "Series",
        ImageTags: { Logo: "logo-tag" },
        ProviderIds: { Tvdb: "12345" }
      });
    if (pathname.endsWith("/Items/episode"))
      return Response.json({ Id: "episode", Name: "Pilot", Type: "Episode" });
    if (searchParams.get("IncludeItemTypes") === "Episode") {
      assert.equal(searchParams.get("ParentId"), "show");
      return Response.json({
        Items: [
          {
            Id: "episode",
            Name: "Pilot",
            IndexNumber: 1,
            ParentIndexNumber: 1,
            ImageTags: { Primary: "episode-tag" }
          }
        ]
      });
    }
    assert.equal(searchParams.get("ParentId"), "series");
    if (!searchParams.has("SearchTerm")) assert.equal(searchParams.get("StartIndex"), "100");
    return Response.json({
      TotalRecordCount: 102,
      Items: [{ Id: "show", Name: "Test Show", Type: "Series" }]
    });
  });

  const [home] = await mediaCatalogAddons();
  assert.deepEqual(
    home.catalogs.map((catalog) => catalog.id),
    ["resume", "library-series"]
  );
  const [search] = await mediaCatalogAddons({ search: true });
  assert.deepEqual(
    search.catalogs.map((catalog) => catalog.id),
    ["search-series"]
  );
  const params = {
    addonBaseUrl: home.baseUrl,
    addonId: home.id,
    addonName: home.name,
    type: "series"
  };
  const page = await loadMediaCatalog({
    ...params,
    catalogId: "library-series",
    skip: 100,
    extraArgs: {}
  });
  assert.equal(page.hasMore, true);
  const results = await loadMediaCatalog({
    ...params,
    catalogId: "search-series",
    skip: 0,
    extraArgs: { search: "Test" }
  });
  const detail = await loadMediaTitle(results.items[0].id);
  assert.equal(detail.name, "Test Show");
  assert.equal(detail.tvdbId, "12345");
  assert.equal(detail.logo, "https://fixture.test/Items/show/Images/Logo?tag=logo-tag");
  assert.equal(
    detail.videos[0].thumbnail,
    "https://fixture.test/Items/episode/Images/Primary?tag=episode-tag"
  );
  assert.equal(
    (await findMediaServerStreams(server, "series", detail.videos[0].id, {}))[0].Id,
    "episode"
  );
});
