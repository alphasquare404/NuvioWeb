import test from "node:test";
import assert from "node:assert/strict";
import { selectMdbListRatings } from "./mdbListRepository.js";

// Shapes taken from a real response for tt1375666, captured on a device while
// investigating #46. MDBList answers with every source in one array, and two of
// them are named differently from this app's own provider keys.
const INCEPTION = {
  ratings: [
    { source: "imdb", value: 8.8, score: 88, votes: 2000000 },
    { source: "metacritic", value: 74, score: 74 },
    { source: "metacriticuser", value: 8.5, score: 85 },
    { source: "trakt", value: 87, score: 87 },
    { source: "tomatoes", value: 86, score: 86 },
    { source: "popcorn", value: 91, score: 91 },
    { source: "tmdb", value: 83, score: 83 },
    { source: "letterboxd", value: 4.2, score: 84 },
    { source: "rogerebert", value: 2, score: 40 },
    { source: "myanimelist", value: null, score: null }
  ]
};

const provider = (key) => ({ key });
const ALL = [
  "trakt",
  "imdb",
  "tmdb",
  "letterboxd",
  "tomatoes",
  "audience",
  "metacritic",
  "mal"
].map(provider);

test("each rating is read on its own source's scale, not the normalised score", () => {
  const ratings = selectMdbListRatings(INCEPTION, ALL);
  // The two sources where the two fields disagree: reading `score` instead
  // would silently put both on a 0-100 scale and change what is on screen.
  assert.equal(ratings.imdb, 8.8);
  assert.equal(ratings.letterboxd, 4.2);
});

test("audience comes from MDBList's 'popcorn', which the provider key does not match", () => {
  assert.equal(selectMdbListRatings(INCEPTION, ALL).audience, 91);
});

test("the remaining sources map straight across", () => {
  const ratings = selectMdbListRatings(INCEPTION, ALL);
  assert.deepEqual(
    {
      trakt: ratings.trakt,
      tmdb: ratings.tmdb,
      tomatoes: ratings.tomatoes,
      metacritic: ratings.metacritic
    },
    { trakt: 87, tmdb: 83, tomatoes: 86, metacritic: 74 }
  );
});

test("a source the payload reports as null is not turned into 0", () => {
  const ratings = selectMdbListRatings(
    { ratings: [{ source: "tmdb", value: null, score: null }] },
    ALL
  );
  assert.equal(ratings.tmdb, null);
});

test("a provider the viewer disabled stays null even when the payload carries it", () => {
  const ratings = selectMdbListRatings(INCEPTION, [provider("imdb")]);
  assert.equal(ratings.imdb, 8.8);
  assert.equal(ratings.trakt, null);
  assert.equal(ratings.tomatoes, null);
});

test("a source MDBList did not return is null, not undefined", () => {
  const ratings = selectMdbListRatings({ ratings: [{ source: "imdb", value: 7 }] }, ALL);
  assert.equal(ratings.letterboxd, null);
  assert.equal(Object.values(ratings).filter((value) => value === undefined).length, 0);
});

test("sources this app does not show are ignored rather than mapped by accident", () => {
  const ratings = selectMdbListRatings(INCEPTION, ALL);
  // metacriticuser and rogerebert are in the payload; neither may leak into a
  // field, and metacritic must not pick up metacriticuser's 8.5.
  assert.equal(ratings.metacritic, 74);
  assert.equal(Object.keys(ratings).length, 7);
});

test("an empty or malformed payload yields all-null rather than throwing", () => {
  for (const payload of [null, undefined, {}, { ratings: null }, { ratings: [{}] }]) {
    const ratings = selectMdbListRatings(payload, ALL);
    assert.equal(
      Object.values(ratings).every((value) => value === null),
      true,
      `expected all-null for ${JSON.stringify(payload)}`
    );
  }
});
