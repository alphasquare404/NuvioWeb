import assert from "node:assert/strict";
import test from "node:test";
import { clearAccountLocalData, hasAccountLocalData } from "./accountLocalDataReset.js";

function storage(entries = {}) {
  const values = new Map(Object.entries(entries));
  return {
    get length() {
      return values.size;
    },
    key(index) {
      return Array.from(values.keys())[index] ?? null;
    },
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

test("account reset removes profile-colliding progress, collections, addons, and credentials", () => {
  const local = storage({
    watchProgressItems: "[]",
    collectionsState: JSON.stringify({ __profileScoped: true, version: 1, profiles: { "1": {} } }),
    debridSettings: JSON.stringify({ __profileScoped: true, version: 1, profiles: { "1": {} } }),
    installedAddonUrls: JSON.stringify({ __profileScoped: true, version: 1, profiles: { "1": [] } }),
    traktAuthState: JSON.stringify({ profiles: { "1": {} } }),
    simklAuthState: JSON.stringify({ profiles: { "1": {} } }),
    nuvioAccountOwnerMarker: "owner-marker",
    nuvio_web_installation_id: "device-identity",
    torrentSettings: JSON.stringify({ __profileScoped: true, version: 1, profiles: { "1": {} } })
  });

  clearAccountLocalData(local, storage({ homeReturnFocusState: "old" }));

  assert.equal(hasAccountLocalData(local), false);
  assert.equal(local.getItem("nuvioAccountOwnerMarker"), "owner-marker");
  assert.equal(local.getItem("nuvio_web_installation_id"), "device-identity");
  assert.notEqual(local.getItem("torrentSettings"), null);
});

test("account reset clears account-only session UI state", () => {
  const session = storage({ homeReturnFocusState: "old", deviceOnly: "keep" });
  clearAccountLocalData(storage(), session);
  assert.equal(session.getItem("homeReturnFocusState"), null);
  assert.equal(session.getItem("deviceOnly"), "keep");
});
