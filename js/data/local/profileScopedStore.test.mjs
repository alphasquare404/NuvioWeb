import assert from "node:assert/strict";
import { test } from "node:test";

const storage = new Map();
globalThis.localStorage = {
  getItem(key) {
    return storage.has(key) ? storage.get(key) : null;
  },
  setItem(key, value) {
    storage.set(key, String(value));
  },
  removeItem(key) {
    storage.delete(key);
  },
  clear() {
    storage.clear();
  }
};
globalThis.__NUVIO_INCLUDE_TRAKT_CLIENT_SECRET__ = false;

const { createProfileScopedStore } = await import("./profileScopedStore.js");

test("profile-scoped stores notify silent effective changes once and clean up listeners", () => {
  const store = createProfileScopedStore({
    key: "profileScopedStoreListenerTest",
    seedFromPrimary: false,
    normalize(value = {}) {
      return { showUnairedNextUp: value.showUnairedNextUp !== false };
    }
  });
  const changes = [];
  const unsubscribe = store.subscribe((change) => changes.push(change));

  store.setForProfile("listener-test", { showUnairedNextUp: false }, { silentSync: true });
  store.setForProfile("listener-test", { showUnairedNextUp: false }, { silentSync: true });

  assert.equal(changes.length, 1);
  assert.equal(changes[0].profileId, "listener-test");
  assert.equal(changes[0].previousValue.showUnairedNextUp, true);
  assert.equal(changes[0].value.showUnairedNextUp, false);
  assert.equal(changes[0].silentSync, true);

  unsubscribe();
  store.setForProfile("listener-test", { showUnairedNextUp: true }, { silentSync: true });
  assert.equal(changes.length, 1);
});
