import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const sourceUrl = new URL("./castDetailScreen.js", import.meta.url);
const desktopCssUrl = new URL("../../../../css/desktop.css", import.meta.url);

test("the person's name is the page heading, from the first frame", async () => {
  const source = await readFile(sourceUrl, "utf8");

  assert.match(source, /<header class="person-heading" data-person-heading>/);
  assert.match(
    source,
    /<h1 class="person-heading-title">\$\{escapeHtml\(person\.name \|\| "Unknown"\)\}<\/h1>/
  );
  // No overlay bar any more: the heading itself is the mark.
  assert.doesNotMatch(source, /person-compact-header/);
});

test("the heading shrinks and is cleaned up with the mount", async () => {
  const source = await readFile(sourceUrl, "utf8");

  assert.match(source, /this\.bindPersonHeadingCollapse\(\);/);
  assert.match(source, /heading\.dataset\.collapsed = next;/);
  assert.match(source, /cleanup\(\) \{\s*this\.unbindPersonHeadingCollapse\(\);/);
});

test("the stylesheet keeps the heading centred, sticky, and bar-height when collapsed", async () => {
  const desktopCss = await readFile(desktopCssUrl, "utf8");

  assert.match(
    desktopCss,
    /\.desktop-browser #castDetail \.person-heading \{[^}]*position: sticky;[^}]*top: 0;[^}]*justify-content: center;/
  );
  assert.match(
    desktopCss,
    /\.person-heading\[data-collapsed="true"\] \{[^}]*min-height: calc\(52px \+ env\(safe-area-inset-top, 0px\)\);[^}]*backdrop-filter: blur\(14px\);/
  );
  assert.match(
    desktopCss,
    /\.person-heading\[data-collapsed="true"\] \.person-heading-title \{\s*font-size: 18px;/
  );
});

test("the biography folds to ten lines and offers a control to open it", async () => {
  const [source, desktopCss] = await Promise.all([
    readFile(sourceUrl, "utf8"),
    readFile(desktopCssUrl, "utf8")
  ]);

  assert.match(
    source,
    /const biographyIsLong = String\(person\.biography \|\| ""\)\.trim\(\)\.length > 360;/
  );
  assert.match(
    source,
    /class="cast-biography-text\$\{this\.biographyExpanded \? " is-expanded" : ""\}"/
  );
  assert.match(source, /data-action="toggleBiography"/);
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
