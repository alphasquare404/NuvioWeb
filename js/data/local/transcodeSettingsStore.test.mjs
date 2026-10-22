import assert from "node:assert/strict";
import { test } from "node:test";

const storage = new Map();
globalThis.localStorage = {
  getItem(key) {
    return storage.has(key) ? storage.get(key) : null;
  },
  setItem(key, value) {
    storage.set(key, String(value));
  },
  removeItem(key) {
    storage.delete(key);
  },
  clear() {
    storage.clear();
  }
};
globalThis.__NUVIO_INCLUDE_TRAKT_CLIENT_SECRET__ = false;

const { TranscodeSettingsStore, normalizeTranscodeSettings, TRANSCODE_SETTINGS_KEY } =
  await import("./transcodeSettingsStore.js");

const PENDING_KEY = "profileSettingsSyncPendingProfiles";

test("the token is per profile and trimmed", () => {
  storage.clear();
  TranscodeSettingsStore.setForProfile("one", { token: "  first-secret  " });
  TranscodeSettingsStore.setForProfile("two", { token: "second-secret" });

  assert.equal(TranscodeSettingsStore.getForProfile("one").token, "first-secret");
  assert.equal(TranscodeSettingsStore.getForProfile("two").token, "second-secret");
  // A profile that never set one does not inherit another profile's token: the
  // secret is about a server, and guessing it would be guessing on someone's behalf.
  assert.equal(TranscodeSettingsStore.getForProfile("three").token, "");
});

test("clearing leaves an empty token rather than a missing field", () => {
  storage.clear();
  TranscodeSettingsStore.setForProfile("one", { token: "secret" });
  TranscodeSettingsStore.setForProfile("one", { token: "" });
  assert.deepEqual(TranscodeSettingsStore.getForProfile("one"), { token: "" });
  assert.equal(normalizeTranscodeSettings({}).token, "");
  assert.equal(normalizeTranscodeSettings(null).token, "");
});

test("a server secret is never queued for cloud sync", () => {
  // The settings stores this app syncs write this key when a change is pending.
  // A transcode token must never appear there: it belongs to one deployment, and
  // the cloud blob outlives the deployment and reaches other devices.
  storage.clear();
  TranscodeSettingsStore.setForProfile("one", { token: "secret" });
  assert.equal(storage.has(PENDING_KEY), false);

  const envelope = JSON.parse(storage.get(TRANSCODE_SETTINGS_KEY));
  assert.equal(envelope.__profileScoped, true);
  assert.equal(envelope.profiles.one.token, "secret");
});
