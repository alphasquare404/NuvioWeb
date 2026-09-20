import assert from "node:assert/strict";
import test from "node:test";

const store = new Map();
globalThis.localStorage = {
  getItem: (key) => (store.has(key) ? store.get(key) : null),
  setItem: (key, value) => store.set(key, String(value)),
  removeItem: (key) => store.delete(key),
  clear: () => store.clear()
};

const { WatchProgressSource } = await import("../local/traktSettingsStore.js");
const { watchProgressOwner, isWatchProgressFromOtherSource } =
  await import("./watchProgressProvenance.js");

test("playback recorded while a provider owned progress belongs to that provider", () => {
  assert.equal(watchProgressOwner({ source: "simkl_local" }), WatchProgressSource.SIMKL);
  assert.equal(watchProgressOwner({ source: "trakt_local" }), WatchProgressSource.TRAKT);
});

test("a provider's own records belong to it too", () => {
  assert.equal(watchProgressOwner({ source: "simkl_playback" }), WatchProgressSource.SIMKL);
  assert.equal(watchProgressOwner({ source: "simkl_history" }), WatchProgressSource.SIMKL);
  assert.equal(watchProgressOwner({ source: "trakt_history" }), WatchProgressSource.TRAKT);
});

test("Nuvio Sync's own playback belongs to no provider", () => {
  assert.equal(watchProgressOwner({ source: "nuvio_sync" }), "");
  assert.equal(watchProgressOwner({ source: "local" }), "");
  assert.equal(watchProgressOwner({}), "");
});

test("a row recorded under SIMKL is foreign to Nuvio Sync", () => {
  // The reported leak, in the direction the user asked to be sure about:
  // watching while SIMKL owned progress must not resurface under Nuvio Sync.
  assert.equal(
    isWatchProgressFromOtherSource({ source: "simkl_local" }, WatchProgressSource.NUVIO_SYNC),
    true
  );
});

test("a row recorded under Nuvio Sync is foreign to SIMKL", () => {
  assert.equal(
    isWatchProgressFromOtherSource({ source: "nuvio_sync" }, WatchProgressSource.SIMKL),
    false,
    "an untagged-equivalent row is not claimed by a provider"
  );
  assert.equal(
    isWatchProgressFromOtherSource({ source: "trakt_local" }, WatchProgressSource.SIMKL),
    true
  );
});

test("a row stays with its own source", () => {
  assert.equal(
    isWatchProgressFromOtherSource({ source: "simkl_playback" }, WatchProgressSource.SIMKL),
    false
  );
});

test("an untagged row is never treated as foreign", () => {
  // Rows that predate the tag, or that came from another device through a cloud
  // with no column for it, must not vanish from a list they have always been in.
  assert.equal(
    isWatchProgressFromOtherSource({ source: "local" }, WatchProgressSource.SIMKL),
    false
  );
  assert.equal(isWatchProgressFromOtherSource({}, WatchProgressSource.NUVIO_SYNC), false);
});

test("only Nuvio Sync's own playback belongs in Nuvio's cloud", async () => {
  const { isNuvioSyncOwnedProgress } = await import("./watchProgressProvenance.js");
  // The cross-client half of the leak: the PWA and the official app read the
  // cloud, not this device's tag, so a provider's record must never be pushed.
  assert.equal(isNuvioSyncOwnedProgress({ source: "nuvio_sync" }), true);
  assert.equal(isNuvioSyncOwnedProgress({ source: "local" }), true, "untagged rows still sync");
  assert.equal(isNuvioSyncOwnedProgress({ source: "simkl_local" }), false);
  assert.equal(isNuvioSyncOwnedProgress({ source: "simkl_playback" }), false);
  assert.equal(isNuvioSyncOwnedProgress({ source: "trakt_local" }), false);
  assert.equal(isNuvioSyncOwnedProgress({}), true);
});
