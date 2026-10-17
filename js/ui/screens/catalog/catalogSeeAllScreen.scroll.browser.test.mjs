import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const sourceUrl = new URL("./catalogSeeAllScreen.js", import.meta.url);
const desktopCssUrl = new URL("../../../../css/desktop.css", import.meta.url);

test("the shell is not treated as the page's scroller", async () => {
  const source = await readFile(sourceUrl, "utf8");

  // The browser scrolls the screen, not the shell: reading shell.scrollTop was
  // always zero, so the saved position, the focus scroll and the next page all
  // did nothing.
  assert.match(source, /resolveScrollOwner\(\) \{/);
  assert.match(source, /getBrowserVerticalScrollOwner\?\.\(this\.container\)/);
  assert.doesNotMatch(source, /querySelector\("\.seeall-shell"\)\?\.scrollTop/);
  assert.match(source, /const owner = this\.resolveScrollOwner\(\);/);
  assert.match(source, /setContainerScrollTop\(owner/);
});

test("scrolling is followed through the document, whoever owns it", async () => {
  const source = await readFile(sourceUrl, "utf8");

  assert.match(
    source,
    /globalThis\.document\?\.addEventListener\?\.\("scroll", onScroll, \{\s*capture: true,\s*passive: true\s*\}\)/
  );
  assert.match(source, /this\.shouldAutoLoadMoreFromScroll\(owner\)/);
  assert.match(source, /unbindShellEvents\(\) \{/);
  assert.match(source, /cleanup\(\) \{[\s\S]{0,200}?this\.unbindShellEvents\(\);/);
});

test("the heading joins the shared collapsing-heading contract", async () => {
  const [source, desktopCss] = await Promise.all([
    readFile(sourceUrl, "utf8"),
    readFile(desktopCssUrl, "utf8")
  ]);

  assert.match(
    source,
    /bindCollapsingHeader\(\{\s*resolveHeader: \(\) => container\.querySelector\("\.seeall-header"\)/
  );
  assert.match(source, /this\.bindPageHeadingCollapse\(\);/);

  assert.match(
    desktopCss,
    /\.desktop-browser #catalogSeeAll \.seeall-header \{[^}]*position: sticky;[^}]*top: 0;[^}]*z-index: 8;/
  );
  assert.match(
    desktopCss,
    /\.desktop-browser #catalogSeeAll \.seeall-header\[data-collapsed="true"\] \{[^}]*backdrop-filter: blur\(14px\);/
  );
  // The separator follows the cards, and the shell lets go of its legacy
  // overflow so the heading can actually stick.
  assert.match(
    desktopCss,
    /\.desktop-browser #catalogSeeAll \.seeall-header::after \{[^}]*left: var\(--seeall-gutter\);[^}]*right: var\(--seeall-gutter\);/
  );
  assert.match(
    desktopCss,
    /\.desktop-browser #catalogSeeAll \.seeall-shell \{\s*overflow: visible;/
  );
});
