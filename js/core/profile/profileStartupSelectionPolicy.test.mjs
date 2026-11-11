import assert from "node:assert/strict";
import test from "node:test";
import { getProfileStartupAction } from "./profileStartupSelectionPolicy.js";

const primaryProfile = [{ id: "1", name: "Primary" }];

test("first startup requires selecting a provisioned Primary profile", () => {
  assert.equal(
    getProfileStartupAction({
      profiles: primaryProfile,
      rememberLastProfileEnabled: false,
      hasEverSelectedProfile: false
    }),
    "select"
  );
});

test("remembering a profile never treats an unselected Primary as remembered", () => {
  assert.equal(
    getProfileStartupAction({
      profiles: primaryProfile,
      rememberLastProfileEnabled: true,
      hasEverSelectedProfile: false
    }),
    "select"
  );
});

test("a later startup preserves the existing remember-last-profile behavior", () => {
  assert.equal(
    getProfileStartupAction({
      profiles: primaryProfile,
      rememberLastProfileEnabled: false,
      hasEverSelectedProfile: true
    }),
    "enter"
  );
  assert.equal(
    getProfileStartupAction({
      profiles: primaryProfile,
      rememberLastProfileEnabled: true,
      hasEverSelectedProfile: true
    }),
    "enter"
  );
  assert.equal(
    getProfileStartupAction({
      profiles: [...primaryProfile, { id: "2", name: "Second profile" }],
      rememberLastProfileEnabled: false,
      hasEverSelectedProfile: true
    }),
    "select"
  );
});

test("remembered PIN-protected profiles prompt for a PIN on startup", () => {
  assert.equal(
    getProfileStartupAction({
      profiles: primaryProfile,
      activeProfileHasPin: true,
      rememberLastProfileEnabled: true,
      hasEverSelectedProfile: true
    }),
    "unlock"
  );
  assert.equal(
    getProfileStartupAction({
      profiles: primaryProfile,
      activeProfileHasPin: true,
      hasSelectedProfileThisSession: true
    }),
    "enter"
  );
});
