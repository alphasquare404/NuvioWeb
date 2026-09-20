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

test("repeated snapshots that still report the title never clear suppression", () => {
  // A reconcile budget used to release here. Coming back because we asked often
  // enough is a removal undoing itself with no provider fact behind it.
  const s = createContinueWatchingRemovalSuppression();
  s.suppress("tt1");
  for (let attempt = 0; attempt < 50; attempt += 1) {
    assert.deepEqual(s.reconcile(["tt1", "tt2"]), [], `reconcile ${attempt} released nothing`);
  }
  assert.equal(s.isSuppressed("tt1"), true, "only the provider decides, however long it takes");
});

test("the passage of time alone never clears suppression", () => {
  // There is no clock to inject any more, and the old age limit is gone: the
  // factory takes no expiry knobs, so passing them cannot reintroduce one.
  const s = createContinueWatchingRemovalSuppression({ maxReconciles: 1, maxAgeMs: 1 });
  s.suppress("tt1");
  const startedAt = Date.now();
  while (Date.now() - startedAt < 5) {
    // Let real wall-clock time pass, with no reconcile to drive a transition.
  }
  assert.equal(s.isSuppressed("tt1"), true, "elapsed time is not evidence about the provider");
  s.reconcile(["tt1"]);
  assert.equal(s.isSuppressed("tt1"), true, "and it is still not evidence after a refresh");
});

test("only the two authoritative outcomes end a suppression", () => {
  const confirmed = createContinueWatchingRemovalSuppression();
  confirmed.suppress("tt1");
  confirmed.reconcile(["tt9"]);
  assert.equal(confirmed.isSuppressed("tt1"), false, "provider no longer reports it");

  const failed = createContinueWatchingRemovalSuppression();
  failed.suppress("tt1");
  failed.reconcile(["tt1"], { deletionFailed: true });
  assert.equal(failed.isSuppressed("tt1"), false, "delete failed and the provider still has it");
});

test("suppression is in-memory only and never persisted", () => {
  // A tombstone on disk would outlive the session and hide a title the provider
  // still has, with nothing left to reconcile it against.
  const writes = [];
  const previous = globalThis.localStorage;
  globalThis.localStorage = {
    getItem: () => null,
    setItem: (key, value) => writes.push([key, value]),
    removeItem: (key) => writes.push([key, null])
  };
  try {
    const s = createContinueWatchingRemovalSuppression();
    s.scopeTo("profile-a:simkl");
    s.suppress("tt1");
    s.reconcile(["tt1"]);
    assert.deepEqual(writes, [], "nothing is written to storage");
    assert.equal(
      createContinueWatchingRemovalSuppression().isSuppressed("tt1"),
      false,
      "a fresh instance starts empty, so a reload shows the provider's truth"
    );
  } finally {
    if (previous === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = previous;
  }
});

test("changing profile or provider drops suppressions as lifecycle cleanup", () => {
  // Not expiry: a suppression is a claim about one provider account, so it is
  // meaningless against another and must not hide that account's card.
  const s = createContinueWatchingRemovalSuppression();
  assert.equal(s.scopeTo("profile-a:simkl"), true, "first scope is adopted");
  s.suppress("tt1");
  assert.equal(s.scopeTo("profile-a:simkl"), false, "the same scope changes nothing");
  assert.equal(s.isSuppressed("tt1"), true);
  assert.equal(s.scopeTo("profile-b:simkl"), true, "switching profile is a new scope");
  assert.equal(s.isSuppressed("tt1"), false, "the other profile's card is not withheld");
  s.suppress("tt2");
  s.scopeTo("profile-b:trakt");
  assert.equal(s.isSuppressed("tt2"), false, "switching provider drops it too");
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
