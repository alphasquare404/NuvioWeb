import assert from "node:assert/strict";
import test from "node:test";

import { resolveDetailEnrichmentHold } from "./detailEnrichmentHold.js";

const on = { enabled: true, useArtwork: true };
const key = "mdb-key";

test("with both answers coming, the page waits for both", () => {
  assert.deepEqual(
    resolveDetailEnrichmentHold({
      tmdbSettings: on,
      tmdbApiKey: "tmdb-key",
      mdbListSettings: { enabled: true, apiKey: key },
      meta: {}
    }),
    { artwork: true, ratings: true }
  );
});

test("nothing is coming, so nothing waits", () => {
  const none = resolveDetailEnrichmentHold({
    tmdbSettings: { enabled: false },
    mdbListSettings: { enabled: false },
    meta: {}
  });
  assert.deepEqual(none, { artwork: false, ratings: false });
  // Switched on, but with no key to ask with.
  assert.deepEqual(
    resolveDetailEnrichmentHold({
      tmdbSettings: on,
      tmdbApiKey: "",
      mdbListSettings: { enabled: true, apiKey: "  " },
      meta: {}
    }),
    { artwork: false, ratings: false }
  );
});

test("artwork enrichment on but artwork left to the add-on is not waited for", () => {
  const hold = resolveDetailEnrichmentHold({
    tmdbSettings: { enabled: true, useArtwork: false },
    tmdbApiKey: "tmdb-key",
    mdbListSettings: { enabled: false },
    meta: {}
  });
  assert.equal(hold.artwork, false);
});

test("ratings already in hand are not waited for a second time", () => {
  const hold = resolveDetailEnrichmentHold({
    tmdbSettings: { enabled: false },
    mdbListSettings: { enabled: true, apiKey: key },
    meta: { mdbListRatings: { imdb: "7.4" } }
  });
  assert.equal(hold.ratings, false);
});
