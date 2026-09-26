import assert from "node:assert/strict";
import test from "node:test";

// A PIN-protected profile opening without its PIN.
//
// The lock lived only in the answer to a network call. `pullProfileLockStates`
// returned an empty map whenever that call failed -- offline, or before the
// session was restored -- and the screen reads an empty map as "no profile has
// a PIN", so every locked profile opened without being asked for one.
//
// The PIN itself is verified server-side and always was. What went missing was
// the knowledge that a PIN existed to ask for, which is why nothing prompted.
//
// The last successful answer is now kept, so a failed pull leaves the locks
// standing. A locked profile still cannot be entered offline, because
// verification needs the server; it says so rather than letting the profile
// through.

function createLocalStorage(seed = {}) {
  const values = new Map(Object.entries(seed));
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    },
    snapshot() {
      return Object.fromEntries(values);
    }
  };
}

async function withProfileGlobals({ localStorage, authenticated, rpc }, callback) {
  const originalLocalStorage = globalThis.localStorage;
  globalThis.localStorage = localStorage;
  const { ProfileSyncService } = await import("./profileSyncService.js");
  const { AuthManager } = await import("../auth/authManager.js");
  const { SupabaseApi } = await import("../../data/remote/supabase/supabaseApi.js");
  const originalRpc = SupabaseApi.rpc;
  const authDescriptor = Object.getOwnPropertyDescriptor(AuthManager, "isAuthenticated");
  Object.defineProperty(AuthManager, "isAuthenticated", {
    configurable: true,
    get: () => authenticated
  });
  SupabaseApi.rpc = rpc;
  try {
    await callback(ProfileSyncService);
  } finally {
    SupabaseApi.rpc = originalRpc;
    if (authDescriptor) {
      Object.defineProperty(AuthManager, "isAuthenticated", authDescriptor);
    }
    globalThis.localStorage = originalLocalStorage;
  }
}

const LOCKED_ROWS = [
  { profile_index: 1, pin_enabled: false },
  { profile_index: 2, pin_enabled: true }
];

test("a successful pull is remembered", async () => {
  const localStorage = createLocalStorage();
  await withProfileGlobals(
    { localStorage, authenticated: true, rpc: async () => LOCKED_ROWS },
    async (ProfileSyncService) => {
      const states = await ProfileSyncService.pullProfileLockStates();
      assert.equal(states["2"], true);
      assert.deepEqual(ProfileSyncService.readCachedProfileLockStates(), { 1: false, 2: true });
    }
  );
});

// The reported failure: offline, the pull throws.
test("a failed pull leaves the locks standing", async () => {
  const localStorage = createLocalStorage();
  await withProfileGlobals(
    { localStorage, authenticated: true, rpc: async () => LOCKED_ROWS },
    async (ProfileSyncService) => {
      await ProfileSyncService.pullProfileLockStates();
    }
  );
  await withProfileGlobals(
    {
      localStorage,
      authenticated: true,
      rpc: async () => {
        throw new Error("offline");
      }
    },
    async (ProfileSyncService) => {
      const states = await ProfileSyncService.pullProfileLockStates();
      assert.equal(states["2"], true, "a locked profile must stay locked when the pull fails");
    }
  );
});

// The same hole, reached before the session is restored rather than by losing
// the network.
test("an unauthenticated pull leaves the locks standing", async () => {
  const localStorage = createLocalStorage({ profileLockStates: JSON.stringify({ 2: true }) });
  await withProfileGlobals(
    {
      localStorage,
      authenticated: false,
      rpc: async () => {
        throw new Error("must not be called");
      }
    },
    async (ProfileSyncService) => {
      const states = await ProfileSyncService.pullProfileLockStates();
      assert.equal(states["2"], true);
    }
  );
});

// Nothing known yet is the one case where no lock can be reported, and it is
// also the case where no profile has been locked.
test("no cache and a failed pull reports no locks", async () => {
  const localStorage = createLocalStorage();
  await withProfileGlobals(
    {
      localStorage,
      authenticated: true,
      rpc: async () => {
        throw new Error("offline");
      }
    },
    async (ProfileSyncService) => {
      assert.deepEqual(await ProfileSyncService.pullProfileLockStates(), {});
    }
  );
});

// Setting a PIN has to reach the cache too: locked and then taken offline
// before the next pull would otherwise leave the cache saying unlocked.
test("setting a PIN is remembered without waiting for a pull", async () => {
  const localStorage = createLocalStorage();
  await withProfileGlobals(
    { localStorage, authenticated: true, rpc: async () => ({}) },
    async (ProfileSyncService) => {
      assert.equal(await ProfileSyncService.setProfilePin(3, "1234"), true);
      assert.equal(ProfileSyncService.readCachedProfileLockStates()["3"], true);
    }
  );
});

test("clearing a PIN is remembered too", async () => {
  const localStorage = createLocalStorage({ profileLockStates: JSON.stringify({ 3: true }) });
  await withProfileGlobals(
    { localStorage, authenticated: true, rpc: async () => ({}) },
    async (ProfileSyncService) => {
      assert.equal(await ProfileSyncService.clearProfilePin(3, "1234"), true);
      assert.equal(ProfileSyncService.readCachedProfileLockStates()["3"], false);
    }
  );
});

// A failed write must not be recorded as a lock that is not there, or the
// profile becomes unenterable for a PIN the server never stored.
test("a PIN that failed to save is not remembered as set", async () => {
  const localStorage = createLocalStorage();
  await withProfileGlobals(
    {
      localStorage,
      authenticated: true,
      rpc: async () => {
        throw new Error("rejected");
      }
    },
    async (ProfileSyncService) => {
      assert.equal(await ProfileSyncService.setProfilePin(4, "1234"), false);
      assert.equal(ProfileSyncService.readCachedProfileLockStates()["4"], undefined);
    }
  );
});

// Profile numbers are handed out again after a delete, so a lock left behind
// would be inherited by whoever takes the number next.
test("deleting a profile forgets its lock", async () => {
  const localStorage = createLocalStorage({ profileLockStates: JSON.stringify({ 2: true }) });
  await withProfileGlobals(
    { localStorage, authenticated: true, rpc: async () => ({}) },
    async (ProfileSyncService) => {
      await ProfileSyncService.deleteProfileData(2);
      assert.equal(ProfileSyncService.readCachedProfileLockStates()["2"], undefined);
    }
  );
});

// A stored value that is not a map of locks is not a reason to throw, and not
// a reason to report locks either.
test("an unusable cache reports no locks rather than failing", async () => {
  const localStorage = createLocalStorage({ profileLockStates: "[1,2,3]" });
  await withProfileGlobals(
    {
      localStorage,
      authenticated: false,
      rpc: async () => ({})
    },
    async (ProfileSyncService) => {
      assert.deepEqual(await ProfileSyncService.pullProfileLockStates(), {});
    }
  );
});
