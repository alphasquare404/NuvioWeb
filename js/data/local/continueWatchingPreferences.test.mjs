import assert from "node:assert/strict";
import test from "node:test";

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear()
};

const { ContinueWatchingPreferences } = await import("./continueWatchingPreferences.js");

// Dismissing a Next Up card hides that show's next episode. Watching another
// episode of the same show is supposed to bring it back -- saveProgress calls
// removeDismissedNextUpKeysForContent for exactly that reason.
//
// The add path writes a bare contentId while the clear path only stripped
// `contentId|`-prefixed keys, so the two never matched and a dismissal lasted
// forever. Upstream fixed it by clearing both shapes.

test("dismissing a Next Up card records it", () => {
  store.clear();
  ContinueWatchingPreferences.addDismissedNextUpKey("tt9288030", "1");
  assert.deepEqual(ContinueWatchingPreferences.getDismissedNextUpKeys("1"), ["tt9288030"]);
});

test("new progress for that show clears the dismissal", () => {
  store.clear();
  ContinueWatchingPreferences.addDismissedNextUpKey("tt9288030", "1");
  ContinueWatchingPreferences.removeDismissedNextUpKeysForContent("tt9288030", "1");
  assert.deepEqual(
    ContinueWatchingPreferences.getDismissedNextUpKeys("1"),
    [],
    "a bare contentId key must be cleared, not left behind forever"
  );
});

test("composite keys are still cleared", () => {
  store.clear();
  ContinueWatchingPreferences.replaceDismissedNextUpKeys(
    ["tt9288030|1:2", "tt9288030", "tt0000001"],
    "1"
  );
  ContinueWatchingPreferences.removeDismissedNextUpKeysForContent("tt9288030", "1");
  assert.deepEqual(
    ContinueWatchingPreferences.getDismissedNextUpKeys("1"),
    ["tt0000001"],
    "both key shapes go, and an unrelated show is untouched"
  );
});

test("dismissals are scoped per profile", () => {
  store.clear();
  ContinueWatchingPreferences.addDismissedNextUpKey("tt1", "1");
  ContinueWatchingPreferences.addDismissedNextUpKey("tt1", "2");
  ContinueWatchingPreferences.removeDismissedNextUpKeysForContent("tt1", "1");
  assert.deepEqual(ContinueWatchingPreferences.getDismissedNextUpKeys("1"), []);
  assert.deepEqual(
    ContinueWatchingPreferences.getDismissedNextUpKeys("2"),
    ["tt1"],
    "another profile's dismissal is not collateral"
  );
});

test("a blank id is a no-op rather than a wildcard", () => {
  store.clear();
  ContinueWatchingPreferences.addDismissedNextUpKey("tt1", "1");
  ContinueWatchingPreferences.removeDismissedNextUpKeysForContent("", "1");
  assert.deepEqual(ContinueWatchingPreferences.getDismissedNextUpKeys("1"), ["tt1"]);
});
