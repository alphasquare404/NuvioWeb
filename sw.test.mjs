import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("app shell precaches the local IMDb badge and Profile logo but not addon or catalog API responses", async () => {
  const source = await readFile(new URL("./sw.js", import.meta.url), "utf8");

  assert.match(source, /assets\/icons\/imdb_logo_2016\.svg/);
  assert.match(source, /assets\/brand\/app_logo_wordmark\.png/);
  assert.match(source, /if \(url\.origin !== self\.location\.origin\) return;/);
  assert.match(source, /if \(!APP_SHELL\.some\(\(entry\) => url\.pathname\.endsWith/);
  assert.doesNotMatch(source, /manifest\.json.*cache\.put|catalog.*cache\.put/i);
});

test("external playback push uses privacy-safe text and notification clicks focus only this worker scope", async () => {
  const source = await readFile(new URL("./sw.js", import.meta.url), "utf8");
  assert.match(source, /self\.addEventListener\("push"/);
  assert.match(source, /Playback updated\. Tap to return to NuvioWeb\./);
  assert.match(source, /Playback completed\. Tap to return to NuvioWeb\./);
  assert.match(source, /data: \{ type: "external-playback-return" \}/);
  assert.match(source, /self\.addEventListener\("notificationclick"/);
  assert.match(source, /self\.clients\.matchAll\(\{ type: "window", includeUncontrolled: true \}\)/);
  assert.match(source, /String\(client\.url \|\| ""\)\.startsWith\(scope\)/);
  assert.match(source, /self\.clients\.openWindow\(scope\)/);
  assert.doesNotMatch(source, /webapp:\/\//);
});

// sw.js is a classic worker script with a build-time placeholder for the locale
// list, so running it means substituting that first -- the same step
// scripts/build.mjs performs -- and standing in for the worker globals it
// closes over. Asserting on the source text would pass on a `reload` written
// anywhere in the file; this fails unless the entries actually carry it.
async function runServiceWorkerInstall() {
  const source = (await readFile(new URL("./sw.js", import.meta.url), "utf8"))
    .replace("__NUVIO_LOCALE_ASSETS__", JSON.stringify(["./res/values/strings.xml"]))
    .replaceAll("__NUVIO_APP_VERSION__", "0.0.0-test");

  const cached = [];
  const listeners = new Map();
  const workerSelf = {
    addEventListener: (type, handler) => listeners.set(type, handler),
    skipWaiting: () => {},
    clients: { claim: () => {} },
    location: { origin: "https://example.test" },
    registration: { scope: "https://example.test/" }
  };
  const cacheStub = {
    addAll: async (requests) => cached.push(...requests),
    put: async () => {},
    match: async () => null
  };
  const cachesStub = { open: async () => cacheStub };
  // Relative entries like "./" resolve against the worker URL in a browser and
  // have no base here, so the request is stood in for rather than constructed.
  class RequestStub {
    constructor(url, init = {}) {
      this.url = String(url);
      this.cache = init.cache;
    }
  }
  // The optional icon font is fetched during install behind its own try/catch.
  const fetchStub = async () => {
    throw new Error("no network in test");
  };

  new Function("self", "caches", "Request", "fetch", source)(
    workerSelf,
    cachesStub,
    RequestStub,
    fetchStub
  );

  const install = listeners.get("install");
  assert.equal(typeof install, "function", "sw.js must register an install handler");
  let pending = null;
  install({
    waitUntil: (promise) => {
      pending = promise;
    }
  });
  await pending;
  return cached;
}

test("every precached app shell entry bypasses the HTTP cache", async () => {
  const cached = await runServiceWorkerInstall();

  // Build assets are served with a seven-day lifetime, so an entry fetched
  // through the HTTP cache fills a brand-new cache with the previous build.
  assert.ok(cached.length > 20, `expected the whole app shell, got ${cached.length} entries`);
  const reusingHttpCache = cached.filter((request) => request.cache !== "reload");
  assert.deepEqual(
    // A raw string entry has no .url, and that is exactly the regression.
    reusingHttpCache.map((request) => String(request?.url ?? request)),
    [],
    "these entries could be answered by a previous build's bytes"
  );
  assert.ok(
    cached.some((request) => request.url === "./app.bundle.js"),
    "the application bundle is the entry this exists to keep current"
  );
});
