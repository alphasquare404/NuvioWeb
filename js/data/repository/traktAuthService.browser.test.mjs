import assert from "node:assert/strict";
import test from "node:test";

const storage = new Map();
globalThis.localStorage = {
  getItem(key) { return storage.has(key) ? storage.get(key) : null; },
  setItem(key, value) { storage.set(key, String(value)); },
  removeItem(key) { storage.delete(key); },
  clear() { storage.clear(); }
};
globalThis.__NUVIO_INCLUDE_TRAKT_CLIENT_SECRET__ = false;
globalThis.__NUVIO_PLATFORM__ = "browser";
globalThis.__NUVIO_ENV__ = { TRAKT_CLIENT_ID: "browser-public-client" };

const { Platform } = await import("../../platform/index.js");
Platform.current = null;
const { TraktAuthStore } = await import("../local/traktAuthStore.js");
const { TraktAuthService } = await import("./traktAuthService.js");

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

test("browser device authorization uses only the same-origin bridge", async () => {
  storage.clear();
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (url === "/api/trakt/health") return json({ configured: true });
    if (url === "/api/trakt/device/code") {
      return json({
        device_code: "browser-device-code",
        user_code: "ABCD",
        verification_url: "https://trakt.tv/activate",
        expires_in: 600,
        interval: 5
      });
    }
    assert.fail(`Unexpected request: ${url}`);
  };
  try {
    const state = await TraktAuthService.startDeviceAuth();
    assert.equal(state.deviceCode, "browser-device-code");
    assert.deepEqual(calls.map((call) => call.url), ["/api/trakt/health", "/api/trakt/device/code"]);
    assert.equal(calls[1].options.body, undefined);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("browser polling and refresh replace rotating refresh tokens through the bridge", async () => {
  storage.clear();
  TraktAuthStore.saveDeviceFlow({
    device_code: "browser-device-code",
    user_code: "ABCD",
    verification_url: "https://trakt.tv/activate",
    expires_in: 600,
    interval: 5
  });
  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), body: options.body ? JSON.parse(options.body) : null });
    if (url === "/api/trakt/device/token") {
      return json({ access_token: "access-one", refresh_token: "refresh-one", expires_in: 3600 });
    }
    if (String(url).endsWith("/users/settings")) {
      return json({ user: { username: "tester", ids: { slug: "tester" } } });
    }
    if (url === "/api/trakt/health") return json({ configured: true });
    if (url === "/api/trakt/refresh") {
      return json({ access_token: "access-two", refresh_token: "refresh-two", expires_in: 3600 });
    }
    assert.fail(`Unexpected request: ${url}`);
  };
  try {
    const result = await TraktAuthService.pollDeviceToken();
    assert.equal(result.type, "approved");
    assert.deepEqual(calls[0], { url: "/api/trakt/device/token", body: { code: "browser-device-code" } });
    await TraktAuthService.refreshTokenIfNeeded(true);
    assert.equal(TraktAuthStore.get().accessToken, "access-two");
    assert.equal(TraktAuthStore.get().refreshToken, "refresh-two");
    assert.deepEqual(calls.find((call) => call.url === "/api/trakt/refresh")?.body, {
      refresh_token: "refresh-one"
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("browser bridge unavailability is graceful and does not expose a confidential secret", async () => {
  storage.clear();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    assert.equal(url, "/api/trakt/health");
    return json({ configured: false });
  };
  try {
    await assert.rejects(
      () => TraktAuthService.startDeviceAuth(),
      /unavailable on this server/
    );
    assert.equal(TraktAuthService.getBrowserBridgeStatus(), "unavailable");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
