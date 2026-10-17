import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const sourceUrl = new URL("./discoverScreen.js", import.meta.url);

test("the Discover heading comes from the translations, not a string in the markup", async () => {
  const source = await readFile(sourceUrl, "utf8");

  assert.match(source, /<h2 class="seeall-title">\$\{escapeHtml\(t\("discover_title"/);
  // The word itself must not be written into the template.
  assert.doesNotMatch(source, /<h2 class="seeall-title">Discover<\/h2>/);
});
