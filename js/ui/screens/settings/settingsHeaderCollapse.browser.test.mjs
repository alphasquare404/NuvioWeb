import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const settingsScreenUrl = new URL("./settingsScreen.js", import.meta.url);
const desktopCssUrl = new URL("../../../../css/desktop.css", import.meta.url);

test("the page heading collapses from a scroll listener that belongs to the mount", async () => {
  const source = await readFile(settingsScreenUrl, "utf8");

  // The state is one attribute on the shell; the stylesheet does the animation.
  assert.match(source, /shell\.dataset\.settingsHeaderCollapsed/);
  // The page scrolls inside its own screen element in this layout, so scroll
  // events are caught in the capture phase on the document.
  assert.match(source, /addEventListener\?\.\("scroll", onScroll,\s*\{\s*capture: true/);
  // Nothing survives the mount it was bound in.
  assert.match(source, /cleanup\(\)\s*\{[\s\S]{0,120}this\.unbindHeaderCollapse\(\)/);
});

test("the heading is sticky below the navigation, tinted rather than opaque", async () => {
  const desktopCss = await readFile(desktopCssUrl, "utf8");

  assert.match(
    desktopCss,
    /\.settings-shell\[data-settings-nav-mode\] \.settings-nav-index-header,[\s\S]{0,200}?position: sticky;/
  );
  assert.match(
    desktopCss,
    /data-settings-header-collapsed="true"[\s\S]{0,200}?\.settings-title \{\s*font-size: 18px;/
  );
  // A solid fill is a coloured box on a themed page. The bar paints nothing
  // and blurs what is under it; the line appears only once it holds content.
  const headerRule = desktopCss.match(
    /\.settings-shell\[data-settings-nav-mode\] \.settings-nav-index-header,\s*\n[\s\S]{0,900}?\n\}/
  );
  assert.ok(headerRule, "the sticky heading rule should be there");
  assert.match(headerRule[0], /background: transparent;/);
  assert.match(headerRule[0], /backdrop-filter: blur\(18px\) saturate\(140%\);/);
  assert.match(headerRule[0], /border-bottom: 1px solid transparent;/);
  assert.doesNotMatch(headerRule[0], /background: var\(--bg-color\);/);
});
