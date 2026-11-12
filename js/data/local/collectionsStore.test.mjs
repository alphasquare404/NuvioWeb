import test from "node:test";
import assert from "node:assert/strict";

import { normalizeCollection } from "./collectionsStore.js";

function collectionWithSource(filters = {}) {
  return {
    id: "collection-test",
    title: "Test Collection",
    folders: [
      {
        id: "folder-test",
        title: "Folder",
        sources: [
          {
            provider: "tmdb",
            tmdbSourceType: "DISCOVER",
            title: "New Movies",
            mediaType: "MOVIE",
            sortBy: "primary_release_date.desc",
            filters
          }
        ]
      }
    ]
  };
}

function sourceFilters(collection) {
  return collection.folders[0].sources[0].filters;
}

// Regression: the first normalization wrote null bounds, the next read turned
// them into 0 because Number(null) is finite. Stored 0s then became
// vote_average.lte=0, which hides every title rated above zero, so an imported
// collection folder could open with a single card or none at all.
test("missing TMDB rating bounds stay unset across repeated normalization", () => {
  const first = sourceFilters(normalizeCollection(collectionWithSource({ withGenres: "28" })));
  assert.equal(first.voteAverageGte, null);
  assert.equal(first.voteAverageLte, null);

  const second = sourceFilters(
    normalizeCollection(
      JSON.parse(JSON.stringify(normalizeCollection(collectionWithSource({ withGenres: "28" }))))
    )
  );
  assert.equal(second.voteAverageGte, null, "a null bound must not become 0 on the next pass");
  assert.equal(second.voteAverageLte, null, "a null bound must not become 0 on the next pass");
});

test("stored zero rating bounds are repaired to unset", () => {
  const filters = sourceFilters(
    normalizeCollection(collectionWithSource({ voteAverageGte: 0, voteAverageLte: 0 }))
  );
  assert.equal(filters.voteAverageGte, null);
  assert.equal(filters.voteAverageLte, null);
});

test("real rating bounds and vote counts survive normalization", () => {
  const filters = sourceFilters(
    normalizeCollection(
      collectionWithSource({ voteAverageGte: 7.5, voteAverageLte: 9, voteCountGte: 10 })
    )
  );
  assert.equal(filters.voteAverageGte, 7.5);
  assert.equal(filters.voteAverageLte, 9);
  assert.equal(filters.voteCountGte, 10);
});

test("an unset vote count stays unset instead of becoming zero", () => {
  const filters = sourceFilters(normalizeCollection(collectionWithSource({ withGenres: "35" })));
  assert.equal(filters.voteCountGte, null);
});
