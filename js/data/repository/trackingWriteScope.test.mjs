import assert from "node:assert/strict";
import test from "node:test";

const store = new Map();
globalThis.localStorage = {
  getItem: (key) => (store.has(key) ? store.get(key) : null),
  setItem: (key, value) => store.set(key, String(value)),
  removeItem: (key) => store.delete(key),
  clear: () => store.clear()
};

const { TraktSettingsStore, WatchProgressSource } = await import("../local/traktSettingsStore.js");
const { ownsWatchProgress } = await import("./trackingWriteScope.js");

function selectSource(source) {
  TraktSettingsStore.set({ watchProgressSource: source });
}

test("only the selected source owns playback writes", () => {
  selectSource(WatchProgressSource.SIMKL);
  assert.equal(ownsWatchProgress(WatchProgressSource.SIMKL), true);
  assert.equal(ownsWatchProgress(WatchProgressSource.TRAKT), false);
});

test("a connected but unselected provider never owns playback", () => {
  // The reported leak: watching under Nuvio Sync still scrobbled to SIMKL
  // because being signed in was treated as permission to write, so switching
  // the source afterwards showed titles SIMKL should never have received.
  selectSource(WatchProgressSource.NUVIO_SYNC);
  assert.equal(ownsWatchProgress(WatchProgressSource.SIMKL), false);
  assert.equal(ownsWatchProgress(WatchProgressSource.TRAKT), false);
});

test("Nuvio Sync owning playback does not make it a tracking provider", () => {
  selectSource(WatchProgressSource.TRAKT);
  assert.equal(ownsWatchProgress(WatchProgressSource.NUVIO_SYNC), false);
});

test("an empty provider never owns anything", () => {
  selectSource(WatchProgressSource.SIMKL);
  assert.equal(ownsWatchProgress(""), false);
  assert.equal(ownsWatchProgress(null), false);
  assert.equal(ownsWatchProgress(undefined), false);
});
