import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { buildRuntimeEnvScript, normalizeEnvProperties } from "./envProperties.mjs";

test("runtime env output includes only configured public integration values", () => {
  const script = buildRuntimeEnvScript({
    PREMIUMIZE_CLIENT_ID: "public-premiumize-client",
    SIMKL_CLIENT_ID: "public-simkl-client",
    TRAKT_CLIENT_ID: "public-trakt-client",
    TRAKT_CLIENT_SECRET: "server-secret",
    TRAKT_REDIRECT_URI: "server-only-redirect",
    ARBITRARY_CONTAINER_VALUE: "must-not-appear"
  });

  assert.match(script, /PREMIUMIZE_CLIENT_ID/);
  assert.match(script, /SIMKL_CLIENT_ID/);
  assert.match(script, /TRAKT_CLIENT_ID/);
  assert.doesNotMatch(script, /TRAKT_CLIENT_SECRET|TRAKT_REDIRECT_URI|ARBITRARY_CONTAINER_VALUE/);
});

test("missing optional public integration values are empty and do not block runtime config", () => {
  const env = normalizeEnvProperties({});

  assert.equal(env.PREMIUMIZE_CLIENT_ID, "");
  assert.equal(env.SIMKL_CLIENT_ID, "");
  assert.equal(env.TRAKT_CLIENT_ID, "");
  assert.equal(env.SIMKL_APP_NAME, "nuvio");
});

test("container runtime allowlist includes Premiumize but excludes Trakt server configuration", async () => {
  const entrypoint = await readFile(
    new URL("../docker/nginx-entrypoint.d/40-nuvio-env.sh", import.meta.url),
    "utf8"
  );

  assert.match(entrypoint, /write_value PREMIUMIZE_CLIENT_ID/);
  assert.match(entrypoint, /write_value SIMKL_CLIENT_ID/);
  assert.match(entrypoint, /write_value TRAKT_CLIENT_ID/);
  assert.doesNotMatch(entrypoint, /write_value TRAKT_CLIENT_SECRET|write_value TRAKT_REDIRECT_URI/);
});

test("Service Worker asks the network for runtime config before anything else", async () => {
  const serviceWorker = await readFile(new URL("../sw.js", import.meta.url), "utf8");

  // Never installed into the app shell: a redeployed container writes a new
  // nuvio.env.js, and a copy precached at install would keep pointing the app
  // at the backend the previous deployment used.
  assert.doesNotMatch(serviceWorker, /"\.\/nuvio\.env\.js"/);

  const handler = serviceWorker.slice(serviceWorker.indexOf('url.pathname === "/nuvio.env.js"'));
  const block = handler.slice(0, handler.indexOf('request.mode === "navigate"'));
  // The network is asked first and its answer always wins, so the running
  // container's values are what the page gets.
  assert.match(block, /fetch\(request\)/);
  assert.ok(
    block.indexOf("fetch(request)") < block.indexOf("caches.match"),
    "the network must be tried before any stored copy"
  );
});

// A failed fetch is not "no configuration", it is offline. Letting the script
// fail left every config value empty, and an empty SUPABASE_URL turns each
// cloud call into a relative URL that whatever served the page answers with a
// 404 -- for the rest of that page's life, with no way back.
test("Service Worker falls back to the last runtime config when offline", async () => {
  const serviceWorker = await readFile(new URL("../sw.js", import.meta.url), "utf8");

  const handler = serviceWorker.slice(serviceWorker.indexOf('url.pathname === "/nuvio.env.js"'));
  const block = handler.slice(0, handler.indexOf('request.mode === "navigate"'));
  assert.match(block, /\.catch\(/, "a failed fetch must be handled, not left to fail");
  assert.match(block, /caches\.match\(request/);
  assert.match(block, /cache\.put\(request/, "each successful fetch refreshes the stored copy");
});

// The empty-config state has to be visible, because on the wire it is
// indistinguishable from a backend that is down.
test("an unloaded runtime config announces itself", async () => {
  const config = await readFile(new URL("../js/config.js", import.meta.url), "utf8");

  assert.match(config, /__NUVIO_ENV__/);
  assert.match(config, /console\.warn/);
});

// nuvio.env.js is a separate request, served no-store, and it can simply not
// execute: offline at the wrong moment, a cache miss, or an insecure origin
// where no service worker can stand in for it. Every config value then read as
// empty, and an empty SUPABASE_URL turns each cloud call into a relative path
// the page's own host answers with a 404 -- for the life of that page, with no
// way back, and looking exactly like a backend that is down.
test("the bundle carries the configuration it was built with", async () => {
  const bundle = await readFile(new URL("../dist/app.bundle.js", import.meta.url), "utf8");

  assert.doesNotMatch(
    bundle,
    /__NUVIO_BUILD_ENV__/,
    "the placeholder must be substituted at build time, not shipped"
  );
  assert.match(
    bundle,
    /NUVIO_SUPABASE_URL\s*:\s*"https?:\/\/[^"]+"/,
    "a real backend URL must survive into the bundle"
  );
});

// Baking the configuration in widened what ships inside app.bundle.js, so the
// allowlist that kept server-only values out of nuvio.env.js has to hold for
// the bundle too -- it is served to every browser just the same.
test("no server-only secret reaches the bundle", async () => {
  const bundle = await readFile(new URL("../dist/app.bundle.js", import.meta.url), "utf8");

  ["TRAKT_CLIENT_SECRET", "TRAKT_REDIRECT_URI", "NUVIO_WEB_PUSH_PRIVATE_KEY"].forEach((key) => {
    assert.doesNotMatch(bundle, new RegExp(key), `${key} must never be built into the bundle`);
  });
});

test("the runtime file still overrides what was built in", async () => {
  const config = await readFile(new URL("../js/config.js", import.meta.url), "utf8");

  // Read in this order: the runtime file wins outright whenever it loaded, so a
  // redeployed container keeps overriding the built-in values.
  assert.match(config, /globalThis\.__NUVIO_ENV__\s*\|\|\s*buildEnv/);
});
