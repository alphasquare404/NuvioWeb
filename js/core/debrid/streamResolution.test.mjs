import assert from "node:assert/strict";
import test from "node:test";

import { resolutionFromFields, resolutionFromText } from "./streamResolution.js";

test("resolution parsing recognizes canonical stream labels with mixed casing", () => {
  assert.equal(resolutionFromText("Movie.2160p.WEB-DL"), "P2160");
  assert.equal(resolutionFromText("movie.UhD.remux"), "P2160");
  assert.equal(resolutionFromText("movie.1080P.FHD"), "P1080");
  assert.equal(resolutionFromText("movie.720p.HD"), "P720");
  assert.equal(resolutionFromText("movie.480p.SD"), "P480");
  assert.equal(resolutionFromText("movie.unknown.source"), "UNKNOWN");
});

test("parsed resolution takes priority over later title noise", () => {
  assert.equal(
    resolutionFromFields(["1080p", "WEB-DL", "", "Movie.4K.Remaster.2160p"]),
    "P1080"
  );
  assert.equal(resolutionFromFields(["", "", "", "Torrent.4K.UHD"]), "P2160");
});
