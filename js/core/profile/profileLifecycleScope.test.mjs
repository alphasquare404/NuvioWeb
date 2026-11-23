import assert from "node:assert/strict";
import test from "node:test";

// Regression tests for the watch-state audit's lifecycle findings:
// F14 (a deleted profile's data is inherited by its slot),
// F16 (a pending credential pull repopulates an old account),
// F19 (a Trakt refresh writes to whichever profile is active when it lands).

function createStorage() {
  const values = new Map();
  return {
    get length() {
      return values.size;
    },
    key: (index) => Array.from(values.keys())[index] ?? null,
    getItem: (key) => (values.has(key) ? values.get(key) : null),
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
    clear: () => values.clear()
  };
}

globalThis.localStorage = createStorage();
globalThis.__NUVIO_ENV__ = { TRAKT_CLIENT_ID: "audit-fake-client-id" };
globalThis.fetch = async () => {
  throw new Error("audit: network disabled");
};

const { LocalStore } = await import("../storage/localStore.js");
const { AuthManager } = await import("../auth/authManager.js");
const { AuthState } = await import("../auth/authState.js");
const { ProfileManager } = await import("./profileManager.js");
const { SupabaseApi } = await import("../../data/remote/supabase/supabaseApi.js");
const { WatchedItemsStore } = await import("../../data/local/watchedItemsStore.js");
const { WatchProgressStore } = await import("../../data/local/watchProgressStore.js");
const { TraktAuthStore } = await import("../../data/local/traktAuthStore.js");
const { TraktCredentialSyncService } = await import("./traktCredentialSyncService.js");
const { TraktAuthService } = await import("../../data/repository/traktAuthService.js");

function reset() {
  localStorage.clear();
  LocalStore.set("activeProfileId", "1");
  AuthManager.setState(AuthState.AUTHENTICATED);
}

test("F14: deleting a profile purges the history its slot would inherit", async () => {
  reset();
  LocalStore.set("profiles", [
    { id: "1", name: "Primary" },
    { id: "2", name: "Old" }
  ]);
  WatchedItemsStore.upsert({ contentId: "old-person-history", watchedAt: 1_000 }, "2");
  WatchedItemsStore.upsert({ contentId: "primary-history", watchedAt: 1_000 }, "1");
  WatchProgressStore.upsert(
    {
      contentId: "old-person-progress",
      contentType: "movie",
      positionMs: 1_000,
      durationMs: 100_000,
      updatedAt: 1_000
    },
    "2"
  );
  LocalStore.set("watchedItemsSyncState", {
    1: { lastSuccessfulPushAt: 1_000 },
    2: { lastSuccessfulPushAt: 2_000 }
  });
  TraktAuthStore.saveToken({ access_token: "old-token", refresh_token: "old-refresh" }, "2");

  assert.equal(await ProfileManager.deleteProfile("2"), true);

  assert.equal(WatchedItemsStore.listForProfile("2").length, 0);
  assert.equal(WatchProgressStore.listForProfile("2").length, 0);
  assert.equal(LocalStore.get("watchedItemsSyncState")["2"], undefined);
  assert.equal(TraktAuthStore.get("2").accessToken, null);
  // The surviving profile is untouched.
  assert.equal(WatchedItemsStore.listForProfile("1")[0].contentId, "primary-history");

  // The slot is reusable, and the new profile starts empty.
  assert.equal(await ProfileManager.createProfile({ name: "New person" }), true);
  assert.ok((await ProfileManager.getProfiles()).some((profile) => profile.id === "2"));
  assert.equal(WatchedItemsStore.listForProfile("2").length, 0);
});

test("F16: a credential pull does not repopulate after the account session changes", async () => {
  reset();
  let release;
  let entered;
  const enteredPromise = new Promise((resolve) => {
    entered = resolve;
  });
  SupabaseApi.rpc = async () => {
    entered();
    return new Promise((resolve) => {
      release = resolve;
    });
  };

  const pending = TraktCredentialSyncService.pullFromRemote("1");
  await enteredPromise;
  // A sign-out or an account switch bumps the generation while the request is
  // still in flight.
  AuthManager.sessionGeneration += 1;
  release([
    {
      provider: "trakt",
      credential_json: { access_token: "old-account-token", refresh_token: "old-account-refresh" }
    }
  ]);

  assert.equal(await pending, false);
  assert.equal(TraktAuthStore.get("1").accessToken, null);
});

test("F19: a Trakt refresh writes to the profile that started it", async () => {
  reset();
  const originalPush = TraktCredentialSyncService.pushCurrentToRemote;
  TraktCredentialSyncService.pushCurrentToRemote = async () => true;
  TraktAuthStore.saveToken(
    { access_token: "A-expired", refresh_token: "A-refresh", created_at: 1, expires_in: 10 },
    "1"
  );
  TraktAuthStore.saveToken({ access_token: "B-valid", refresh_token: "B-refresh" }, "2");
  let release;
  let entered;
  const started = new Promise((resolve) => {
    entered = resolve;
  });
  const reply = (payload) => ({ ok: true, text: async () => JSON.stringify(payload) });
  globalThis.fetch = async (url, init) => {
    if (url === "/api/trakt/health") return reply({ configured: true });
    if (url === "/api/trakt/refresh") {
      assert.equal(JSON.parse(init.body).refresh_token, "A-refresh");
      entered();
      return new Promise((resolve) => {
        release = resolve;
      });
    }
    if (String(url).endsWith("/users/settings")) {
      return reply({ user: { username: "Account A" } });
    }
    throw new Error(`Unexpected request ${url}`);
  };

  try {
    const pending = TraktAuthService.refreshTokenIfNeeded(true);
    await started;
    await ProfileManager.setActiveProfile("2");
    release(reply({ access_token: "A-new", refresh_token: "A-new-refresh" }));

    assert.equal(await pending, true);
    assert.equal(TraktAuthStore.get("1").accessToken, "A-new");
    assert.equal(TraktAuthStore.get("2").accessToken, "B-valid");
  } finally {
    TraktCredentialSyncService.pushCurrentToRemote = originalPush;
    globalThis.fetch = async () => {
      throw new Error("audit: network disabled");
    };
  }
});
