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

test("Service Worker fetches runtime config from the network without precaching it", async () => {
  const serviceWorker = await readFile(new URL("../sw.js", import.meta.url), "utf8");

  assert.doesNotMatch(serviceWorker, /"\.\/nuvio\.env\.js"/);
  assert.match(
    serviceWorker,
    /url\.pathname === "\/nuvio\.env\.js"\) \{\s*event\.respondWith\(fetch\(request\)\);\s*return;/
  );
});
