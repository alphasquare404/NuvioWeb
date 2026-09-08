import test from "node:test";
import assert from "node:assert/strict";
import { buildConfiguredAddonEntry } from "./addonRuntimeState.js";

test("a configured addon remains visible after a manifest failure", () => {
  const addon = buildConfiguredAddonEntry({
    baseUrl: "https://catalog.example",
    failed: true
  });

  assert.equal(addon.baseUrl, "https://catalog.example");
  assert.equal(addon.runtimeStatus, "unavailable");
  assert.match(addon.description, /retried when online/i);
});

test("a recovered configured addon exposes its initialized manifest", () => {
  const addon = buildConfiguredAddonEntry({
    baseUrl: "https://catalog.example",
    cached: { id: "catalog", baseUrl: "https://catalog.example", name: "Catalog" }
  });

  assert.equal(addon.runtimeStatus, "available");
  assert.equal(addon.name, "Catalog");
});
