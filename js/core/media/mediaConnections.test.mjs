import assert from "node:assert/strict";
import test from "node:test";
import {
  connectMediaServer,
  connectSeerr,
  findMediaServerStreams,
  listSeerrRequests,
  mediaServerPlaybackUrl,
  requestSeerrMedia
} from "./mediaConnections.js";

test("Seerr request rows resolve movie and series titles by type and reuse duplicate lookups", async (t) => {
  const fetch = t.mock.method(globalThis, "fetch", async (url) => {
    const { pathname } = new URL(url);
    switch (pathname) {
      case "/api/v1/auth/me":
        return Response.json({ id: 7 });
      case "/api/v1/user/7/requests":
        return Response.json({
          results: [
            { id: 1, type: "movie", media: { tmdbId: 10 } },
            { id: 2, type: "tv", media: { tmdbId: 10 } },
            { id: 3, type: "movie", media: { tmdbId: 10 } },
            { id: 4, type: "movie", media: { tmdbId: 11 } }
          ]
        });
      case "/api/v1/movie/10":
        return Response.json({ title: "Fixture Movie" });
      case "/api/v1/tv/10":
        return Response.json({ name: "Fixture Series" });
      default:
        return new Response(null, { status: 404 });
    }
  });
  const rows = await listSeerrRequests({ url: "https://requests.example.test", userId: 7 });
  assert.deepEqual(
    rows.map(({ title }) => title),
    ["Fixture Movie", "Fixture Series", "Fixture Movie", ""]
  );
  assert.equal(fetch.mock.callCount(), 5);
});

test("Emby login, catalog matching and playback preserve the configured base path", async (t) => {
  const fetch = t.mock.method(globalThis, "fetch", async (url, options) => {
    const { pathname, searchParams } = new URL(url);
    assert.equal(options.redirect, "error");
    if (pathname.endsWith("/AuthenticateByName")) {
      assert.equal(pathname, "/home/emby/Users/AuthenticateByName");
      assert.deepEqual(JSON.parse(options.body), { Username: "guest", Pw: "pass" });
      return Response.json({ User: { Id: "viewer" }, AccessToken: "fixture" });
    }
    assert.equal(options.headers["X-Emby-Token"], "fixture");
    assert.equal(searchParams.get("AnyProviderIdEquals"), "imdb.tt12345");
    return Response.json({
      Items: [
        { Id: "other", ProviderIds: { Imdb: "tt98765" } },
        { Id: "movie", ProviderIds: { Imdb: "tt12345" } }
      ]
    });
  });
  const server = await connectMediaServer({
    kind: "emby",
    name: "",
    url: "https://media.example.test/home",
    username: "guest",
    password: "pass"
  });
  assert.deepEqual(
    (await findMediaServerStreams(server, "movie", "tt12345", {})).map((row) => row.Id),
    ["movie"]
  );
  assert.equal(
    new URL(mediaServerPlaybackUrl(server, "movie")).pathname,
    "/home/emby/Videos/movie/stream"
  );
  assert.equal(fetch.mock.callCount(), 2);
});

test("Seerr uses the browser session and refuses to submit as a different account", async (t) => {
  let currentId = 7;
  let submissions = 0;
  t.mock.method(globalThis, "fetch", async (url, options) => {
    assert.equal(options.credentials, "include");
    assert.equal(options.headers["X-Api-Key"], undefined);
    if (url.endsWith("/request")) {
      submissions++;
      assert.deepEqual(JSON.parse(options.body), { mediaType: "tv", mediaId: 123, seasons: "all" });
    }
    return Response.json({ id: currentId });
  });
  const connection = await connectSeerr({
    url: "https://requests.example.test",
    username: "viewer@example.test",
    password: "pass"
  });
  await requestSeerrMedia(connection, "tv", 123, "all");
  currentId = 8;
  await assert.rejects(requestSeerrMedia(connection, "tv", 123, "all"), /again/);
  assert.equal(submissions, 1);
});

test("Seerr Jellyfin sign-in posts a username to Seerr and checks the resulting session", async (t) => {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    calls.push([url, options]);
    return Response.json({ id: 7, displayName: "Viewer" });
  });
  const connection = await connectSeerr({
    url: "https://requests.example.test",
    method: "jellyfin",
    username: " Viewer ",
    password: "fixture"
  });
  assert.deepEqual(connection, { url: "https://requests.example.test", userId: 7, name: "Viewer" });
  assert.deepEqual(
    calls.map(([url]) => url),
    [
      "https://requests.example.test/api/v1/auth/jellyfin",
      "https://requests.example.test/api/v1/auth/me"
    ]
  );
  assert.deepEqual(JSON.parse(calls[0][1].body), { username: "Viewer", password: "fixture" });
  assert.ok(calls.every(([, options]) => options.credentials === "include"));
});
