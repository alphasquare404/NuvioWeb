import assert from "node:assert/strict";
import test from "node:test";

const { createContinueWatchingRemovalSuppression } =
  await import("./continueWatchingRemovalSuppression.js");

// A provider-backed Continue Watching row lives on SIMKL/Trakt, not locally, so
// removing it is a network round trip. Between the tap and the provider
// agreeing, the next compose would hand the row straight back.

test("a removed title is hidden immediately", () => {
  const s = createContinueWatchingRemovalSuppression();
  s.suppress("tt1");
  assert.equal(s.isSuppressed("tt1"), true);
  assert.deepEqual(
    s.filterItems([{ contentId: "tt1" }, { contentId: "tt2" }]).map((i) => i.contentId),
    ["tt2"],
    "only the removed title is withheld"
  );
});

test("suppression survives a refresh that still reports the title", () => {
  // The provider answering is not the same as the provider agreeing.
  const s = createContinueWatchingRemovalSuppression();
  s.suppress("tt1");
  s.reconcile(["tt1", "tt2"]);
  assert.equal(s.isSuppressed("tt1"), true, "a successful fetch alone must not clear it");
});

test("suppression clears once a fresh snapshot no longer contains the title", () => {
  const s = createContinueWatchingRemovalSuppression();
  s.suppress("tt1");
  const released = s.reconcile(["tt2"]);
  assert.deepEqual(released, ["tt1"]);
  assert.equal(s.isSuppressed("tt1"), false);
});

test("a definitive delete failure lets the card come back", () => {
  // Better an item the user can try again on than a removal that never happened.
  const s = createContinueWatchingRemovalSuppression();
  s.suppress("tt1");
  s.reconcile(["tt1"], { deletionFailed: true });
  assert.equal(s.isSuppressed("tt1"), false);
});

test("suppression is never a permanent tombstone", () => {
  const s = createContinueWatchingRemovalSuppression({ maxReconciles: 3 });
  s.suppress("tt1");
  s.reconcile(["tt1"]);
  s.reconcile(["tt1"]);
  assert.equal(s.isSuppressed("tt1"), true);
  s.reconcile(["tt1"]);
  assert.equal(s.isSuppressed("tt1"), false, "it gives up rather than hiding a live item forever");
});

test("suppression also expires on age", () => {
  let clock = 0;
  const s = createContinueWatchingRemovalSuppression({
    maxReconciles: 99,
    maxAgeMs: 1000,
    now: () => clock
  });
  s.suppress("tt1");
  clock = 999;
  s.reconcile(["tt1"]);
  assert.equal(s.isSuppressed("tt1"), true);
  clock = 1001;
  s.reconcile(["tt1"]);
  assert.equal(s.isSuppressed("tt1"), false);
});

test("identity is title-wide and case-insensitive, matching the removal semantic", () => {
  const s = createContinueWatchingRemovalSuppression();
  s.suppress("TT1");
  assert.equal(s.isSuppressed("tt1"), true);
  assert.equal(
    s.filterItems([{ contentId: "tt1", videoId: "tt1:1:2" }]).length,
    0,
    "every episode of a suppressed title is withheld, not just one"
  );
});

test("unrelated titles are never touched", () => {
  const s = createContinueWatchingRemovalSuppression();
  s.suppress("tt1");
  assert.equal(s.isSuppressed("tt2"), false);
  s.reconcile(["tt2"]);
  assert.equal(s.isSuppressed("tt2"), false);
});

test("a blank id is not suppressible and an empty store filters nothing", () => {
  const s = createContinueWatchingRemovalSuppression();
  assert.equal(s.suppress(""), false);
  assert.equal(s.suppress(null), false);
  const items = [{ contentId: "tt1" }];
  assert.equal(s.filterItems(items), items);
  assert.deepEqual(s.reconcile(["tt1"]), []);
});
