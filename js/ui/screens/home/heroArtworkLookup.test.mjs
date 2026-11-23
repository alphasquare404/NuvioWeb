import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./homeScreen.js", import.meta.url), "utf8");
const lookup = source.slice(
  source.indexOf("  async ensureHeroTextlessArtwork(hero) {"),
  source.indexOf("  applyHeroToDom() {")
);

function deferred() {
  let resolve;
  const promise = new Promise((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

function fixture(fetch) {
  const cache = new Map();
  const hero = { id: "tt1", type: "movie" };
  const screen = new Function(
    "heroArtworkKey",
    "isTmdbArtworkEnabled",
    "TmdbSettingsStore",
    "readHeroArtwork",
    "getEffectiveTmdbApiKey",
    "withTimeout",
    "TmdbService",
    "TmdbMetadataService",
    "rememberHeroArtwork",
    `return ({${lookup}});`
  )(
    (item) => `${item.type}:${item.id}`,
    () => true,
    { get: () => ({ language: "en" }) },
    (key) => cache.get(key),
    () => "test-only",
    (promise) => promise,
    { ensureTmdbId: async () => 1 },
    { fetchEnrichment: fetch },
    (key, artwork) => cache.set(key, artwork)
  );
  let paints = 0;
  screen.heroItem = hero;
  screen.applyHeroToDom = () => {
    paints += 1;
  };
  return { screen, cache, hero, paints: () => paints };
}

test("concurrent Home artwork requests share one lookup", async () => {
  let calls = 0;
  const result = deferred();
  const started = deferred();
  const f = fixture(() => {
    calls += 1;
    started.resolve();
    return result.promise;
  });
  const first = f.screen.ensureHeroTextlessArtwork(f.hero);
  const second = f.screen.ensureHeroTextlessArtwork(f.hero);
  await started.promise;
  assert.equal(calls, 1);
  result.resolve({ textlessPoster: "poster", textlessBackdrop: "wide" });
  await Promise.all([first, second]);
  assert.deepEqual(f.cache.get("movie:tt1"), { poster: "poster", backdrop: "wide" });
  assert.equal(f.screen.heroArtworkRequests.size, 0);
});

test("a late Home lookup cannot overwrite artwork Detail learned while it was pending", async () => {
  const result = deferred();
  const started = deferred();
  const f = fixture(() => {
    started.resolve();
    return result.promise;
  });
  const pending = f.screen.ensureHeroTextlessArtwork(f.hero);
  await started.promise;
  f.cache.set("movie:tt1", { poster: "new-poster", backdrop: "new-wide" });
  result.resolve({ textlessPoster: "old-poster", textlessBackdrop: "old-wide" });
  await pending;
  assert.deepEqual(f.cache.get("movie:tt1"), { poster: "new-poster", backdrop: "new-wide" });
  assert.equal(f.paints(), 1);
});

test("a failed lookup is retryable instead of being cached as no artwork", async () => {
  let calls = 0;
  const f = fixture(async () => {
    calls += 1;
    return null;
  });
  await f.screen.ensureHeroTextlessArtwork(f.hero);
  await f.screen.ensureHeroTextlessArtwork(f.hero);
  assert.equal(calls, 2);
  assert.equal(f.cache.size, 0);
  assert.equal(f.screen.heroArtworkRequests.size, 0);
});
