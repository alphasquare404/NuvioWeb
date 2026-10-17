import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const sourceUrl = new URL("./folderDetailScreen.js", import.meta.url);

test("both collection layouts carry the compact bar", async () => {
  const source = await readFile(sourceUrl, "utf8");

  // The classic header layout and the "follow" hero layout.
  const insertions = source.match(/\$\{this\.isDesktopBrowser \? compactBar : ""\}/g) || [];
  assert.equal(insertions.length, 2, "the bar should be in both layout branches");
});

test("a collection without a logo gets its title in the bar", async () => {
  const source = await readFile(sourceUrl, "utf8");

  // Logo first, title as the fallback, and a logo that fails to load hands over
  // to the title rather than leaving an empty bar.
  assert.match(
    source,
    /const compactLogo = String\(desktopHeaderLogo \|\| heroDisplay\?\.logo \|\| ""\)\.trim\(\);/
  );
  assert.match(source, /compactLogo\s*\n?\s*\? `<img class="compact-header-mark"/);
  assert.match(source, /<span class="compact-header-title" hidden>/);
  assert.match(
    source,
    /<span class="compact-header-title">\$\{escapeHtml\(compactTitle\)\}<\/span>`/
  );
});

test("the bar is bound once, refreshed on every render, and cleaned up", async () => {
  const source = await readFile(sourceUrl, "utf8");

  assert.match(source, /this\.bindCollectionCompactHeader\(\);/);
  assert.match(
    source,
    /if \(this\.collectionCompactHeaderBinding\) \{\s*this\.collectionCompactHeaderBinding\.refresh\(\);/
  );
  assert.match(source, /cleanup\(\) \{\s*this\.collectionCompactHeaderBinding\?\.cleanup\(\);/);
  // The mark is resolved on each tick, so a re-render cannot leave the bar
  // watching nodes that are no longer in the document.
  assert.match(
    source,
    /resolveBar: \(\) => container\.querySelector\("\.collection-compact-header"\)/
  );
  assert.match(source, /resolveMark: \(\) =>/);
});

test("the mark resolver knows both layouts, logo before title", async () => {
  const source = await readFile(sourceUrl, "utf8");

  const resolver = source.match(/resolveMark: \(\) =>[\s\S]{0,900}?getScrollTop:/);
  assert.ok(resolver, "the resolver should be there");
  assert.match(resolver[0], /\.folder-follow-hero-logo:not\(\[hidden\]\)/);
  assert.match(resolver[0], /\.folder-follow-hero-title:not\(\.is-hidden\)/);
  assert.match(resolver[0], /\.folder-detail-desktop-logo/);
  assert.match(resolver[0], /\.folder-detail-desktop-heading h1/);
});
