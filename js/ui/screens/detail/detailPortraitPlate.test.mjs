import assert from "node:assert/strict";
import test from "node:test";
import { detailArtworkKey, resolveDetailPortraitBackdrop } from "./detailPortraitPlate.js";

const META = { id: "tt0111161", type: "movie", name: "A Title" };
const REMEMBERED = { poster: "https://image.tmdb.org/t/p/w500/remembered.jpg" };

function readRemembered() {
  return REMEMBERED;
}

test("a remembered plate is refused when the Artwork toggle is off", () => {
  const plate = resolveDetailPortraitBackdrop(META, {
    settings: { enabled: true, useArtwork: false },
    readRemembered
  });

  assert.equal(plate, "");
});

test("a remembered plate is refused when TMDB enrichment is off entirely", () => {
  const plate = resolveDetailPortraitBackdrop(META, {
    settings: { enabled: false, useArtwork: true },
    readRemembered
  });

  assert.equal(plate, "");
});

test("a remembered plate is painted while both switches are on", () => {
  const plate = resolveDetailPortraitBackdrop(META, {
    settings: { enabled: true, useArtwork: true },
    readRemembered
  });

  assert.match(plate, /^https:\/\/image\.tmdb\.org\/t\/p\/w\d+/);
});

test("the enrichment's own plate wins over the remembered one", () => {
  let reads = 0;
  const plate = resolveDetailPortraitBackdrop(
    { ...META, textlessPoster: "https://image.tmdb.org/t/p/w500/fresh.jpg" },
    {
      settings: { enabled: true, useArtwork: true },
      readRemembered: () => {
        reads += 1;
        return REMEMBERED;
      }
    }
  );

  assert.match(plate, /fresh\.jpg/);
  assert.equal(reads, 0);
});

test("no remembered plate means no plate, not a broken image", () => {
  const plate = resolveDetailPortraitBackdrop(META, {
    settings: { enabled: true, useArtwork: true },
    readRemembered: () => null
  });

  assert.equal(plate, "");
});

test("the cache key is the same shape Home uses: type and id", () => {
  assert.equal(detailArtworkKey(META), "movie:tt0111161");
  assert.equal(detailArtworkKey({ id: "tt0903747", type: "series" }), "series:tt0903747");
  assert.equal(detailArtworkKey({}), "");
});
