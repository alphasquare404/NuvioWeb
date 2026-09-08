import test from "node:test";
import assert from "node:assert/strict";
import { createOfflineArtworkUrlPool } from "./offlineArtworkUrlPool.js";

test("fresh-session artwork resolution creates a new object URL from a durable OPFS lookup", async () => {
  const originalUrl = globalThis.URL;
  const revoked = [];
  globalThis.URL = {
    createObjectURL: (file) => `blob:fresh-session/${file.name}`,
    revokeObjectURL: (url) => revoked.push(url)
  };
  try {
    const pool = createOfflineArtworkUrlPool({
      getArtwork: async (downloadId, kind) => ({ file: { name: `${downloadId}-${kind}` } })
    });
    const url = await pool.resolve("movie-1", "poster");
    assert.equal(url, "blob:fresh-session/movie-1-poster");
    assert.equal(await pool.resolve("movie-1", "poster"), url);
    pool.releaseAll();
    assert.deepEqual(revoked, [url]);
  } finally {
    globalThis.URL = originalUrl;
  }
});

test("missing artwork resolves to a clean empty placeholder URL", async () => {
  const pool = createOfflineArtworkUrlPool({ getArtwork: async () => null });
  assert.equal(await pool.resolve("series-1", "seriesPoster"), "");
});
