import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const sourceUrl = new URL("./folderDetailScreen.js", import.meta.url);
const desktopCssUrl = new URL("../../../../css/desktop.css", import.meta.url);

test("the classic layout keeps its mark in a sticky header that shrinks", async () => {
  const [source, desktopCss] = await Promise.all([
    readFile(sourceUrl, "utf8"),
    readFile(desktopCssUrl, "utf8")
  ]);

  // The overlay bar belongs to the follow layout only; the classic header holds
  // the logo or title itself and collapses in place.
  const insertions = source.match(/\$\{this\.isDesktopBrowser \? compactBar : ""\}/g) || [];
  assert.equal(insertions.length, 1, "only the follow layout should add the bar");

  assert.match(source, /this\.bindCollectionHeaderCollapse\(\);/);
  assert.match(source, /const next = collapsed \? "true" : "false";/);
  assert.match(source, /header\.dataset\.collapsed = next;/);
  assert.match(source, /cleanup\(\) \{\s*this\.unbindCollectionHeaderCollapse\(\);/);

  // The stylesheet: sticky, and a collapsed state that shrinks the mark.
  assert.match(
    desktopCss,
    /\.desktop-folder-detail-shell \.folder-detail-header \{[^}]*position: sticky;[^}]*padding: calc\(env\(safe-area-inset-top, 0px\) \+ 4px\) 0 10px;/
  );
  assert.match(
    desktopCss,
    /\.folder-detail-header\[data-collapsed="true"\] \{[^}]*padding-top: calc\(env\(safe-area-inset-top, 0px\) \+ 6px\);[^}]*backdrop-filter: blur\(14px\);/
  );
  assert.match(
    desktopCss,
    /\[data-collapsed="true"\]\s*\n\s*\.folder-detail-desktop-logo \{\s*\n\s*max-height: 22px;/
  );
});

test("a collection without a logo still gets a mark: its title", async () => {
  const source = await readFile(sourceUrl, "utf8");

  assert.match(
    source,
    /const compactLogo = String\(desktopHeaderLogo \|\| heroDisplay\?\.logo \|\| ""\)\.trim\(\);/
  );
  assert.match(source, /compactLogo\s*\n?\s*\? `<img class="compact-header-mark"/);
  assert.match(source, /<span class="compact-header-title" hidden>/);
});

test("the follow layout's bar is bound once, refreshed on render, and cleaned up", async () => {
  const source = await readFile(sourceUrl, "utf8");

  assert.match(
    source,
    /if \(this\.collectionCompactHeaderBinding\) \{\s*this\.collectionCompactHeaderBinding\.refresh\(\);/
  );
  assert.match(
    source,
    /resolveBar: \(\) => container\.querySelector\("\.collection-compact-header"\)/
  );
  assert.match(source, /resolveMark: \(\) =>/);
  assert.match(
    source,
    /cleanup\(\) \{[\s\S]{0,200}?this\.collectionCompactHeaderBinding\?\.cleanup\(\);/
  );
});

test("the follow layout's mark resolver knows both layouts, logo before title", async () => {
  const source = await readFile(sourceUrl, "utf8");

  const resolver = source.match(/resolveMark: \(\) =>[\s\S]{0,900}?getScrollTop:/);
  assert.ok(resolver, "the resolver should be there");
  assert.match(resolver[0], /\.folder-follow-hero-logo:not\(\[hidden\]\)/);
  assert.match(resolver[0], /\.folder-follow-hero-title:not\(\.is-hidden\)/);
  assert.match(resolver[0], /\.folder-detail-desktop-logo/);
  assert.match(resolver[0], /\.folder-detail-desktop-heading h1/);
});
