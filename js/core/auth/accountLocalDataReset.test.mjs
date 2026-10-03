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
  // Torrent settings used to be kept, as a device preference rather than an
  // account one. Two of their three switches decide whether this machine
  // uploads, so keeping them handed the next person to sign in a stranger's
  // upload setting without telling them -- and carried the previous account's
  // profile ids across with it.
  assert.equal(local.getItem("torrentSettings"), null);
});

// What stays is only what identifies the device, never anything a person chose.
test("sign-out leaves nothing that belonged to the account", () => {
  const local = storage({
    torrentSettings: JSON.stringify({
      __profileScoped: true,
      version: 1,
      profiles: { "1": { p2pEnabled: true, enableUpload: true }, "4": { p2pEnabled: false } }
    }),
    profileLockStates: JSON.stringify({ "1": false, "4": true }),
    nuvio_web_installation_id: "device-identity"
  });

  clearAccountLocalData(local, storage());

  assert.equal(local.getItem("torrentSettings"), null, "no upload setting is inherited");
  assert.equal(local.getItem("nuvio_web_installation_id"), "device-identity");
});

test("account reset clears account-only session UI state", () => {
  const session = storage({ homeReturnFocusState: "old", deviceOnly: "keep" });
  clearAccountLocalData(storage(), session);
  assert.equal(session.getItem("homeReturnFocusState"), null);
  assert.equal(session.getItem("deviceOnly"), "keep");
});
