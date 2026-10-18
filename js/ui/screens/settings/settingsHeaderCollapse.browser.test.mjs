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

test("the heading keeps its place in every placement", async () => {
  const desktopCss = await readFile(desktopCssUrl, "utf8");

  // One variable carries how far the page's padding holds the heading in, so
  // the bar can be pulled back out to the edges at every width.
  assert.match(desktopCss, /--settings-header-bleed: 48px;/);
  assert.match(desktopCss, /--settings-header-bleed: 16px;/);
  assert.match(desktopCss, /margin-inline: calc\(-1 \* var\(--settings-header-bleed\)\);/);
  assert.match(desktopCss, /padding-inline: var\(--settings-header-bleed\);/);

  // The heading holds the top of the page whichever navigation is in force.
  // With the bar at the top it used to be left alone, but a heading that scrolls
  // away under a floating pill reads worse than one that pins beneath it.
  assert.match(
    desktopCss,
    /html:not\(\[data-nav-placement="top"\]\)[\s\S]{0,320}?position: sticky;/
  );
  assert.match(desktopCss, /html\[data-nav-placement="top"\][\s\S]{0,400}?position: sticky;/);
});

test("nothing is painted until the heading has content to hold back", async () => {
  const desktopCss = await readFile(desktopCssUrl, "utf8");

  const headerRule = desktopCss.match(
    /\.settings-shell\[data-settings-nav-mode\] \.settings-nav-index-header,\s*\n[\s\S]{0,900}?\n\}/
  );
  assert.ok(headerRule, "the heading rule should be there");
  // At rest the heading is the top of the page: no fill, no blur, no line.
  assert.match(headerRule[0], /background: transparent;/);
  assert.match(headerRule[0], /border-bottom: 1px solid transparent;/);
  assert.doesNotMatch(headerRule[0], /backdrop-filter/);
  assert.doesNotMatch(headerRule[0], /background: var\(--bg-color\);/);

  // Once collapsed the bar becomes the floating navigation's own glass: the same
  // blur, the same translucent fill, the same shadow. At rest none of it exists.
  assert.match(
    desktopCss,
    /data-settings-header-collapsed="true"[\s\S]{0,700}?backdrop-filter: blur\(2px\) saturate\(150%\);/
  );
  assert.match(
    desktopCss,
    /data-settings-header-collapsed="true"[\s\S]{0,700}?background: rgba\(18, 18, 20, 0\.46\);/
  );
  assert.match(
    desktopCss,
    /data-settings-header-collapsed="true"[\s\S]{0,700}?box-shadow: 0 10px 30px rgba\(0, 0, 0, 0\.26\);/
  );
  // And the title only shrinks where the bar exists at all.
  assert.match(
    desktopCss,
    /html:not\(\[data-nav-placement="top"\]\)[\s\S]{0,320}?\.settings-title \{\s*font-size: 18px;/
  );
});

test("a long section title stays on one line on a narrow screen", async () => {
  const desktopCss = await readFile(desktopCssUrl, "utf8");

  // "Content & Discovery" folded into two lines at the page title's size; the
  // narrow heading is sized to sit on one line between Back and the rail.
  assert.match(
    desktopCss,
    /\.settings-shell \.settings-content-header \.settings-title \{\s*font-size: clamp\(20px, 5\.4vw, 26px\);/
  );
  assert.match(
    desktopCss,
    /\.settings-shell \.settings-content-header \{\s*padding-inline: calc\(var\(--settings-header-bleed\) \+ 24px\);/
  );
});
