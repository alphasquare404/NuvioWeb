import assert from "node:assert/strict";
import test from "node:test";
import { isTmdbArtworkEnabled } from "./tmdbArtworkGate.js";

test("artwork needs both the master switch and the artwork toggle", () => {
  assert.equal(isTmdbArtworkEnabled({ enabled: true, useArtwork: true }), true);
});

test("artwork is refused when the master switch is off, whatever artwork says", () => {
  assert.equal(isTmdbArtworkEnabled({ enabled: false, useArtwork: true }), false);
});

test("artwork is refused when its own toggle is off, whatever the master switch says", () => {
  assert.equal(isTmdbArtworkEnabled({ enabled: true, useArtwork: false }), false);
});

test("artwork is refused when both are off, and when there are no settings at all", () => {
  assert.equal(isTmdbArtworkEnabled({ enabled: false, useArtwork: false }), false);
  assert.equal(isTmdbArtworkEnabled(null), false);
  assert.equal(isTmdbArtworkEnabled(undefined), false);
  assert.equal(isTmdbArtworkEnabled({}), false);
});
