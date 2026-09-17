import assert from "node:assert/strict";
import test from "node:test";

const { shouldRefreshContinueWatchingForChange } = await import("./continueWatchingRefreshPolicy.js");

test("an authoritative upsert for the active profile triggers a refresh", () => {
  assert.equal(
    shouldRefreshContinueWatchingForChange(
      { profileId: "1", reason: "upsert", authoritative: true },
      "1"
    ),
    true
  );
});

test("an authoritative remove for the active profile triggers a refresh", () => {
  assert.equal(
    shouldRefreshContinueWatchingForChange(
      { profileId: "1", reason: "remove", authoritative: true },
      "1"
    ),
    true
  );
});

test("an authoritative write for a different (inactive) profile does not trigger a refresh", () => {
  assert.equal(
    shouldRefreshContinueWatchingForChange(
      { profileId: "2", reason: "upsert", authoritative: true },
      "1"
    ),
    false
  );
});

test("an ordinary (non-authoritative) local playback upsert does not trigger a refresh", () => {
  assert.equal(
    shouldRefreshContinueWatchingForChange(
      { profileId: "1", reason: "upsert", authoritative: false },
      "1"
    ),
    false
  );
});

test("replaceForProfile always triggers a refresh for the active profile, regardless of authoritative", () => {
  assert.equal(
    shouldRefreshContinueWatchingForChange(
      { profileId: "1", reason: "replaceForProfile", authoritative: false },
      "1"
    ),
    true
  );
});

test("replaceForProfile for an inactive profile does not trigger a refresh", () => {
  assert.equal(
    shouldRefreshContinueWatchingForChange(
      { profileId: "2", reason: "replaceForProfile" },
      "1"
    ),
    false
  );
});
