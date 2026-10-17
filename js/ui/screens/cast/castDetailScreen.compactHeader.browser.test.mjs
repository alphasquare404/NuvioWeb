import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const sourceUrl = new URL("./castDetailScreen.js", import.meta.url);
const desktopCssUrl = new URL("../../../../css/desktop.css", import.meta.url);

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

test("the biography folds to ten lines and offers a control to open it", async () => {
  const [source, desktopCss] = await Promise.all([
    readFile(sourceUrl, "utf8"),
    readFile(desktopCssUrl, "utf8")
  ]);

  // Only long biographies get the control.
  assert.match(
    source,
    /const biographyIsLong = String\(person\.biography \|\| ""\)\.trim\(\)\.length > 360;/
  );
  assert.match(
    source,
    /class="cast-biography-text\$\{this\.biographyExpanded \? " is-expanded" : ""\}"/
  );
  assert.match(source, /data-action="toggleBiography"/);
  // Toggling swaps a class instead of re-rendering the page.
  assert.match(source, /text\.classList\.toggle\("is-expanded", this\.biographyExpanded\);/);

  assert.match(
    desktopCss,
    /\.desktop-browser #castDetail \.cast-biography-text \{[^}]*-webkit-line-clamp: 10;/
  );
  assert.match(
    desktopCss,
    /\.desktop-browser #castDetail \.cast-biography-text\.is-expanded \{[^}]*-webkit-line-clamp: unset;/
  );
});

test("a credit rail ends at the page gutter, not at the screen edge", async () => {
  const desktopCss = await readFile(desktopCssUrl, "utf8");

  // WebKit does not paint a scrolling element's right padding at the end of the
  // scroll, so the space travels with the cards as a spacer instead.
  assert.match(
    desktopCss,
    /\.desktop-browser #castDetail \.cast-credit-track::after \{\s*content: "";\s*flex: 0 0 2px;/
  );
  assert.match(
    desktopCss,
    /@media \(max-width: 700px\) \{\s*\.desktop-browser #castDetail \.cast-credit-track::after \{\s*flex-basis: var\(--browser-page-gutter\);/
  );
});
