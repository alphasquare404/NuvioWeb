import assert from "node:assert/strict";
import test from "node:test";
import { createMoviLoader, MOVI_CDN_ENTRY } from "./moviEngine.js";

const BASE = "https://app.test/";

test("the local copy is preferred when the build shipped one", async () => {
  const calls = [];
  const load = createMoviLoader({
    baseUrl: BASE,
    importImpl: async (specifier) => {
      calls.push(specifier);
    }
  });

  assert.deepEqual(await load(), { source: "local" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0], "https://app.test/assets/libs/movi/element.js");
});

test("a build without the local copy falls back to the CDN", async () => {
  const calls = [];
  const load = createMoviLoader({
    baseUrl: BASE,
    importImpl: async (specifier) => {
      calls.push(specifier);
      if (specifier.includes("assets/libs"))
        throw new TypeError("Failed to fetch dynamically imported module");
    }
  });

  assert.deepEqual(await load(), { source: "cdn" });
  assert.equal(calls.length, 2);
  assert.equal(calls[1], MOVI_CDN_ENTRY);
});

test("the import runs once however many players ask for it", async () => {
  let calls = 0;
  const load = createMoviLoader({
    baseUrl: BASE,
    importImpl: async () => {
      calls += 1;
    }
  });

  await Promise.all([load(), load(), load()]);
  await load();
  assert.equal(calls, 1);
});

test("a failed load can be retried, and says which entry failed last", async () => {
  let attempts = 0;
  const load = createMoviLoader({
    baseUrl: BASE,
    importImpl: async () => {
      attempts += 1;
      if (attempts <= 2) throw new TypeError("offline");
    }
  });

  await assert.rejects(load(), /movi engine could not be loaded/);
  // The cache is dropped on failure, so the next attempt reaches the network
  // again instead of the session carrying a dead promise forever.
  assert.deepEqual(await load(), { source: "local" });
  assert.equal(attempts, 3);
});
