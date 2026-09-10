import assert from "node:assert/strict";
import test from "node:test";
import { shouldShowProfileSelectionAtStartup } from "./profileStartupSelectionPolicy.js";

const primaryProfile = [{ id: "1", name: "Primary" }];

test("first startup requires selecting a provisioned Primary profile", () => {
  assert.equal(
    shouldShowProfileSelectionAtStartup({
      profiles: primaryProfile,
      rememberLastProfileEnabled: false,
      hasEverSelectedProfile: false
    }),
    true
  );
});

test("remembering a profile never treats an unselected Primary as remembered", () => {
  assert.equal(
    shouldShowProfileSelectionAtStartup({
      profiles: primaryProfile,
      rememberLastProfileEnabled: true,
      hasEverSelectedProfile: false
    }),
    true
  );
});

test("a later startup preserves the existing remember-last-profile behavior", () => {
  assert.equal(
    shouldShowProfileSelectionAtStartup({
      profiles: primaryProfile,
      rememberLastProfileEnabled: false,
      hasEverSelectedProfile: true
    }),
    false
  );
  assert.equal(
    shouldShowProfileSelectionAtStartup({
      profiles: primaryProfile,
      rememberLastProfileEnabled: true,
      hasEverSelectedProfile: true
    }),
    false
  );
  assert.equal(
    shouldShowProfileSelectionAtStartup({
      profiles: [...primaryProfile, { id: "2", name: "Second profile" }],
      rememberLastProfileEnabled: false,
      hasEverSelectedProfile: true
    }),
    true
  );
});

test("PIN-protected profiles and a selection made in this session keep their existing routing", () => {
  assert.equal(
    shouldShowProfileSelectionAtStartup({
      profiles: primaryProfile,
      activeProfileHasPin: true,
      rememberLastProfileEnabled: true,
      hasEverSelectedProfile: true
    }),
    true
  );
  assert.equal(
    shouldShowProfileSelectionAtStartup({
      profiles: primaryProfile,
      activeProfileHasPin: true,
      hasSelectedProfileThisSession: true
    }),
    false
  );
});
