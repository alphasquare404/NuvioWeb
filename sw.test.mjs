import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("app shell precaches the local IMDb badge and Profile logo but not addon or catalog API responses", async () => {
  const source = await readFile(new URL("./sw.js", import.meta.url), "utf8");

  assert.match(source, /assets\/icons\/imdb_logo_2016\.svg/);
  assert.match(source, /assets\/brand\/app_logo_wordmark\.png/);
  assert.match(source, /if \(url\.origin !== self\.location\.origin\) return;/);
  assert.match(source, /if \(!APP_SHELL\.some\(\(entry\) => url\.pathname\.endsWith/);
  assert.doesNotMatch(source, /manifest\.json.*cache\.put|catalog.*cache\.put/i);
});
