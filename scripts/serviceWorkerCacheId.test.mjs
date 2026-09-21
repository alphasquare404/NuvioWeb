import test from "node:test";
import assert from "node:assert/strict";
import { buildServiceWorkerCacheId, readAppShellEntries } from "./serviceWorkerCacheId.mjs";

const SOURCE = `const CACHE_NAME = "nuvio-app-shell-__NUVIO_APP_VERSION__";

const APP_SHELL = [
  "./",
  "./index.html",
  "./app.bundle.js",
  "./css/base.css"
];
`;

const shellOf = (files) => async (relative) =>
  Object.prototype.hasOwnProperty.call(files, relative) ? files[relative] : null;

const FILES = {
  "index.html": "<!doctype html>",
  "app.bundle.js": "console.log(1)",
  "css/base.css": "body{color:#fff}"
};

const idFor = (files, source = SOURCE, version = "0.1.2") =>
  buildServiceWorkerCacheId(source, version, shellOf(files));

test("the same build produces the same name, so an unchanged deploy keeps its cache", async () => {
  assert.equal(await idFor(FILES), await idFor({ ...FILES }));
});

test("a changed shell file produces a new name, which is what discards the old cache", async () => {
  const changed = { ...FILES, "app.bundle.js": "console.log(2)" };
  assert.notEqual(await idFor(FILES), await idFor(changed));
});

test("a changed worker itself produces a new name", async () => {
  assert.notEqual(await idFor(FILES), await idFor(FILES, `${SOURCE}\n// locale assets\n`));
});

// Without this, dropping a file from the build would leave every existing
// install serving the copy it already had.
test("a shell file that vanished still moves the name", async () => {
  const { "css/base.css": _removed, ...missing } = FILES;
  assert.notEqual(await idFor(FILES), await idFor(missing));
});

test("a file swapped for another's contents does not collide, because the path is hashed too", async () => {
  const swapped = {
    ...FILES,
    "app.bundle.js": FILES["css/base.css"],
    "css/base.css": FILES["app.bundle.js"]
  };
  assert.notEqual(await idFor(FILES), await idFor(swapped));
});

test("the app version stays a readable prefix", async () => {
  const id = await idFor(FILES, SOURCE, "9.9.9");
  assert.match(id, /^9\.9\.9-[0-9a-f]{12}$/);
  // The worker deletes old caches by this prefix, so it has to survive.
  assert.equal(`nuvio-app-shell-${id}`.startsWith("nuvio-app-shell-"), true);
});

test("the directory entry is skipped rather than read as a file", async () => {
  let asked = [];
  await buildServiceWorkerCacheId(SOURCE, "0.1.2", async (relative) => {
    asked.push(relative);
    return "x";
  });
  assert.equal(asked.includes(""), false);
  assert.deepEqual(asked, ["index.html", "app.bundle.js", "css/base.css"]);
});

test("every entry in the list is read", () => {
  assert.deepEqual(readAppShellEntries(SOURCE), [
    "./",
    "./index.html",
    "./app.bundle.js",
    "./css/base.css"
  ]);
});

// A silently wrong cache name is the exact fault this module exists to prevent,
// so an unreadable list has to stop the build rather than guess.
test("an unreadable APP_SHELL fails the build instead of guessing", () => {
  assert.throws(() => readAppShellEntries("const APP_SHELL = notAnArray;"), /APP_SHELL/);
  assert.throws(() => readAppShellEntries(""), /APP_SHELL/);
});
