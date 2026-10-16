import assert from "node:assert/strict";
import test from "node:test";

const values = new Map();
globalThis.localStorage = {
  getItem: (key) => (values.has(key) ? values.get(key) : null),
  setItem: (key, value) => values.set(key, String(value)),
  removeItem: (key) => values.delete(key),
  clear: () => values.clear()
};

const { selectTextlessImagePath } = await import("./tmdbMetadataService.js");

// TMDB marks artwork with the language printed on it. No language means no
// title across the picture, which is the whole point for a hero that draws its
// own logo on top.
test("only an image with no language is eligible", () => {
  assert.equal(
    selectTextlessImagePath([
      { file_path: "/english.jpg", iso_639_1: "en", vote_average: 9 },
      { file_path: "/plate.jpg", iso_639_1: null, vote_average: 1 }
    ]),
    "/plate.jpg"
  );
  assert.equal(
    selectTextlessImagePath([
      { file_path: "/blank-language.jpg", iso_639_1: "  ", vote_average: 2 }
    ]),
    "/blank-language.jpg"
  );
});

test("votes decide, and size only breaks a tie", () => {
  assert.equal(
    selectTextlessImagePath([
      { file_path: "/huge.jpg", iso_639_1: null, vote_average: 3, width: 4000 },
      { file_path: "/loved.jpg", iso_639_1: null, vote_average: 8, width: 1000 }
    ]),
    "/loved.jpg"
  );
  assert.equal(
    selectTextlessImagePath([
      { file_path: "/small.jpg", iso_639_1: null, vote_average: 5, width: 500 },
      { file_path: "/large.jpg", iso_639_1: null, vote_average: 5, width: 2000 }
    ]),
    "/large.jpg"
  );
});

// Most titles have no plate at all. Saying so lets the hero fall back to the
// artwork it has always used instead of showing nothing.
test("nothing usable reads as nothing, not as a broken path", () => {
  assert.equal(selectTextlessImagePath([]), null);
  assert.equal(selectTextlessImagePath(null), null);
  assert.equal(selectTextlessImagePath([{ file_path: "/en.jpg", iso_639_1: "en" }]), null);
  assert.equal(selectTextlessImagePath([{ iso_639_1: null, vote_average: 9 }]), null);
});
