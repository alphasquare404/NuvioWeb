import assert from "node:assert/strict";
import test from "node:test";
import {
  readSettingsRouteSection,
  SETTINGS_ROUTE,
  SETTINGS_SECTION_ROUTE
} from "./settingsRoutes.js";

test("the index route shows no section", () => {
  assert.equal(readSettingsRouteSection(SETTINGS_ROUTE, {}), null);
  assert.equal(readSettingsRouteSection(SETTINGS_ROUTE, { section: "appearance" }), null);
});

test("the section route carries the section it was opened for", () => {
  assert.equal(
    readSettingsRouteSection(SETTINGS_SECTION_ROUTE, { section: "playback" }),
    "playback"
  );
  assert.equal(
    readSettingsRouteSection(SETTINGS_SECTION_ROUTE, { section: "appearance" }),
    "appearance"
  );
});

test("a section route without a usable section falls back to the index", () => {
  assert.equal(readSettingsRouteSection(SETTINGS_SECTION_ROUTE, {}), null);
  assert.equal(readSettingsRouteSection(SETTINGS_SECTION_ROUTE, { section: "" }), null);
  assert.equal(readSettingsRouteSection(SETTINGS_SECTION_ROUTE, { section: "   " }), null);
  assert.equal(readSettingsRouteSection(SETTINGS_SECTION_ROUTE, null), null);
});

test("an unknown route name is never treated as a section", () => {
  assert.equal(readSettingsRouteSection("home", { section: "appearance" }), null);
  assert.equal(readSettingsRouteSection(null, { section: "appearance" }), null);
});
