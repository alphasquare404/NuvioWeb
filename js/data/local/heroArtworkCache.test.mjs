import assert from "node:assert/strict";
import test from "node:test";

const values = new Map();
globalThis.localStorage = {
  getItem: (key) => (values.has(key) ? values.get(key) : null),
  setItem: (key, value) => values.set(key, String(value)),
  removeItem: (key) => values.delete(key),
  clear: () => values.clear()
};

const { readHeroArtwork, rememberHeroArtwork, clearHeroArtworkCache, describeHeroArtworkCache } =
  await import("./heroArtworkCache.js");

test("an answer is remembered and read back", () => {
  values.clear();
  rememberHeroArtwork("movie:tt1", { poster: "/p.jpg", backdrop: "/b.jpg" });
  assert.deepEqual(readHeroArtwork("movie:tt1"), { poster: "/p.jpg", backdrop: "/b.jpg" });
});

// "This title has no plate" is worth remembering too: without it every run
// asks again for an answer that will not change.
test("a remembered absence reads as an answer, not as silence", () => {
  values.clear();
  rememberHeroArtwork("movie:tt2", {});
  assert.deepEqual(readHeroArtwork("movie:tt2"), { poster: "", backdrop: "" });
  assert.equal(readHeroArtwork("movie:never-asked"), null);
});

test("an answer older than a fortnight is treated as unasked", () => {
  values.clear();
  rememberHeroArtwork("movie:tt3", { poster: "/p.jpg" });
  const stored = JSON.parse(values.get("heroArtworkCache"));
  stored.items["movie:tt3"].t = Date.now() - 15 * 24 * 60 * 60 * 1000;
  values.set("heroArtworkCache", JSON.stringify(stored));
  assert.equal(readHeroArtwork("movie:tt3"), null);
});

// It has to stay small on its own, because nobody is going to come and tidy it.
test("the cache keeps the most recent answers and drops the rest", () => {
  values.clear();
  for (let index = 0; index < 260; index += 1) {
    rememberHeroArtwork(`movie:tt${index}`, { poster: `/p${index}.jpg` });
  }
  const { entries } = describeHeroArtworkCache();
  assert.equal(entries, 240);
  assert.equal(readHeroArtwork("movie:tt259")?.poster, "/p259.jpg");
  assert.equal(readHeroArtwork("movie:tt0"), null);
});

test("clearing leaves nothing behind", () => {
  values.clear();
  rememberHeroArtwork("movie:tt4", { poster: "/p.jpg" });
  assert.equal(describeHeroArtworkCache().entries, 1);
  clearHeroArtworkCache();
  assert.deepEqual(describeHeroArtworkCache(), { entries: 0, bytes: 0 });
  assert.equal(readHeroArtwork("movie:tt4"), null);
});

// A cache written by a newer build must not be read as if it were this one's.
test("a cache from another version is ignored rather than trusted", () => {
  values.clear();
  values.set(
    "heroArtworkCache",
    JSON.stringify({ version: 99, items: { "movie:tt5": { p: "/p.jpg", t: Date.now() } } })
  );
  assert.equal(readHeroArtwork("movie:tt5"), null);
});
