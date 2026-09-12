import assert from "node:assert/strict";
import test from "node:test";
import { AuthState } from "./authState.js";
import { AuthManager } from "./authManager.js";

function storage(entries = {}) {
  const values = new Map(Object.entries(entries));
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    }
  };
}

function resetAuthManager() {
  AuthManager.state = AuthState.LOADING;
  AuthManager.cachedEffectiveUserId = null;
  AuthManager.cachedEffectiveUserSourceUserId = null;
  AuthManager.refreshPromise = null;
  AuthManager.lastRefreshFailureKind = null;
  AuthManager.sessionGeneration = 0;
}

async function withAuthGlobals({ localStorage, fetch, navigator }, callback) {
  const originalLocalStorage = globalThis.localStorage;
  const originalFetch = globalThis.fetch;
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  globalThis.localStorage = localStorage;
  globalThis.fetch = fetch;
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: navigator });
  resetAuthManager();
  try {
    await callback();
  } finally {
    globalThis.localStorage = originalLocalStorage;
    globalThis.fetch = originalFetch;
    if (originalNavigator) {
      Object.defineProperty(globalThis, "navigator", originalNavigator);
    } else {
      delete globalThis.navigator;
    }
    resetAuthManager();
  }
}

test("offline bootstrap reuses the existing owner marker only after a transient owner lookup failure", async () => {
  await withAuthGlobals(
    {
      localStorage: storage({
        access_token: "header.eyJzdWIiOiJ1c2VyIn0.signature",
        nuvioAccountOwnerMarker: "owner-a"
      }),
      fetch: async () => {
        throw new TypeError("Failed to fetch");
      },
      navigator: { onLine: false }
    },
    async () => {
      await AuthManager.bootstrap();
      assert.equal(AuthManager.getAuthState(), AuthState.AUTHENTICATED);
      assert.equal(await AuthManager.getEffectiveUserId(), "owner-a");
    }
  );
});

test("offline bootstrap never substitutes the cached owner for an authorization rejection", async () => {
  await withAuthGlobals(
    {
      localStorage: storage({
        access_token: "header.eyJzdWIiOiJ1c2VyIn0.signature",
        nuvioAccountOwnerMarker: "owner-a"
      }),
      fetch: async () => new Response("forbidden", { status: 403 }),
      navigator: { onLine: false }
    },
    async () => {
      await assert.rejects(() => AuthManager.bootstrap(), /forbidden/);
      assert.notEqual(AuthManager.getAuthState(), AuthState.AUTHENTICATED);
    }
  );
});
