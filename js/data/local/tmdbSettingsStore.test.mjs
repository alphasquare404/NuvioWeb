import assert from "node:assert/strict";
import test from "node:test";

const values = new Map();
globalThis.localStorage = {
  getItem: (key) => values.get(key) || null,
  setItem: (key, value) => values.set(key, String(value)),
  removeItem: (key) => values.delete(key),
  clear: () => values.clear()
};

const { normalizeTmdbSettings } = await import("./tmdbSettingsStore.js");

test("a deployment key enables TMDB without a user switch", () => {
  assert.equal(normalizeTmdbSettings({}, { hasDeploymentKey: true }).enabled, true);
});

test("an explicit off choice survives the deployment default", () => {
  assert.equal(
    normalizeTmdbSettings({ enabled: false }, { hasDeploymentKey: true }).enabled,
    false
  );
});

test("an explicit on choice is kept", () => {
  assert.equal(normalizeTmdbSettings({ enabled: true }, { hasDeploymentKey: false }).enabled, true);
});

test("without a deployment key TMDB still starts disabled", () => {
  assert.equal(normalizeTmdbSettings({}, { hasDeploymentKey: false }).enabled, false);
});
