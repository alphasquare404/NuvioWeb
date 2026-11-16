import assert from "node:assert/strict";
import test from "node:test";

const { serverLibraryGroups } = await import("./libraryController.js");

const SERVER = {
  id: "media:jellyfin:https://jelly.example.test:user-1",
  name: "Jellyfin",
  kind: "jellyfin",
  url: "https://jelly.example.test",
  userId: "user-1",
  token: "token-1",
  libraryIds: ["movies"]
};

const LIBRARIES = [
  { id: "movies", name: "Movies", kind: "movie" },
  { id: "shows", name: "TV Shows", kind: "series" },
  { id: "boxsets", name: "Collections", kind: "collection" }
];

test("server libraries keep the whole connection while loading", async () => {
  let received = null;
  const groups = await serverLibraryGroups([SERVER], async (server) => {
    received = server;
    return LIBRARIES;
  });
  assert.equal(received.url, SERVER.url);
  assert.equal(received.token, SERVER.token);
  assert.deepEqual(received.libraryIds, ["movies"]);
  assert.deepEqual(
    groups[0].libraries.map(({ id }) => id),
    ["movies"]
  );
});

test("no saved selection means every usable library is offered", async () => {
  const groups = await serverLibraryGroups(
    [{ ...SERVER, libraryIds: undefined }],
    async () => LIBRARIES
  );
  assert.deepEqual(
    groups[0].libraries.map(({ id }) => id),
    ["movies", "shows"]
  );
});

test("a server whose libraries cannot be read still returns the connection", async () => {
  const groups = await serverLibraryGroups([SERVER], async () => {
    throw new Error("unreachable");
  });
  assert.equal(groups[0].id, SERVER.id);
  assert.deepEqual(groups[0].libraries, []);
});

test("an empty library list is not an error", async () => {
  const groups = await serverLibraryGroups([SERVER], async () => []);
  assert.deepEqual(groups[0].libraries, []);
});
