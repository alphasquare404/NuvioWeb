import test from "node:test";
import assert from "node:assert/strict";
import {
  DOWNLOADED_LIBRARY_TYPE_OPTIONS,
  filterDownloadedLibraryItems,
  normalizeDownloadedLibraryType
} from "./downloadedLibraryFilter.js";

test("Downloaded Library defaults unknown and legacy values to All", () => {
  assert.equal(normalizeDownloadedLibraryType(), "all");
  assert.equal(normalizeDownloadedLibraryType("legacy-series-only"), "all");
  assert.equal(normalizeDownloadedLibraryType("movies"), "movies");
  assert.deepEqual(DOWNLOADED_LIBRARY_TYPE_OPTIONS.map((option) => option.value), [
    "all",
    "movies",
    "series"
  ]);
});

test("Downloaded Library filters movies and series without changing their grouping", () => {
  const movies = [{ id: "movie" }];
  const series = [{ id: "series" }];
  assert.deepEqual(filterDownloadedLibraryItems("all", movies, series), [...movies, ...series]);
  assert.deepEqual(filterDownloadedLibraryItems("movies", movies, series), movies);
  assert.deepEqual(filterDownloadedLibraryItems("series", movies, series), series);
});
