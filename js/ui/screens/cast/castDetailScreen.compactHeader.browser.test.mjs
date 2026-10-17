import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const sourceUrl = new URL("./castDetailScreen.js", import.meta.url);

test("the cast page carries the person's name in the compact header", async () => {
  const source = await readFile(sourceUrl, "utf8");

  // A person has no logo, so the mark is the name itself.
  assert.match(source, /<div class="compact-header person-compact-header" data-visible="false"/);
  assert.match(
    source,
    /<span class="compact-header-title">\$\{escapeHtml\(person\.name \|\| "Unknown"\)\}<\/span>/
  );
});

test("the bar follows the profile heading, and is cleaned up with the mount", async () => {
  const source = await readFile(sourceUrl, "utf8");

  assert.match(source, /this\.bindPersonCompactHeader\(\);/);
  assert.match(source, /resolveBar: \(\) => container\.querySelector\("\.person-compact-header"\)/);
  assert.match(
    source,
    /resolveMark: \(\) => container\.querySelector\("\.browser-person-detail-profile h1"\)/
  );
  assert.match(
    source,
    /getScrollTop: \(\) => Number\(getBrowserVerticalScrollOwner\(container\)\?\.scrollTop \|\| 0\)/
  );
  assert.match(source, /cleanup\(\) \{\s*this\.personCompactHeaderBinding\?\.cleanup\(\);/);
});
