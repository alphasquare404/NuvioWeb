import test from "node:test";
import assert from "node:assert/strict";
import {
  calculatePersonAge,
  normalizePersonCredits,
  sortPersonCreditsByLatest,
  sortPersonCreditsByPopularity
} from "./tmdbPersonCreditUtils.js";

test("normalizes combined credits and deduplicates a title across crew jobs", () => {
  const credits = normalizePersonCredits({
    cast: [{ id: 1, media_type: "movie", title: "Actor title", character: "Lead", popularity: 4 }],
    crew: [
      { id: 2, media_type: "tv", name: "Crew show", job: "Director", popularity: 3 },
      { id: 2, media_type: "tv", name: "Crew show", job: "Writer", popularity: 3 }
    ]
  });
  assert.equal(credits.length, 2);
  assert.deepEqual(credits.find((credit) => credit.tmdbId === "2").roles.sort(), ["Director", "Writer"]);
});

test("person credit ranking keeps popular and released latest semantics", () => {
  const credits = normalizePersonCredits({
    cast: [
      { id: 1, media_type: "movie", title: "Older", popularity: 99, release_date: "2023-01-01" },
      { id: 2, media_type: "tv", name: "Newer", popularity: 10, first_air_date: "2024-06-01" },
      { id: 3, media_type: "movie", title: "Future", popularity: 20, release_date: "2026-01-01" },
      { id: 4, media_type: "movie", title: "Undated", popularity: 1 }
    ]
  });
  assert.equal(sortPersonCreditsByPopularity(credits)[0].tmdbId, "1");
  assert.deepEqual(
    sortPersonCreditsByLatest(credits, "2025-01-01").map((credit) => credit.tmdbId),
    ["2", "1"]
  );
});

test("calculates age without invalid or future values", () => {
  assert.equal(calculatePersonAge("1980-06-15", "", new Date("2025-06-14")), 44);
  assert.equal(calculatePersonAge("1980-06-15", "", new Date("2025-06-15")), 45);
  assert.equal(calculatePersonAge("", "", new Date("2025-01-01")), null);
});
