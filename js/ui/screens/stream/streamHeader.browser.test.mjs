import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  STREAM_HEADER_COLLAPSE_AT,
  STREAM_HEADER_EXPAND_AT,
  shouldCollapseStreamHeader
} from "./streamHeaderCollapse.js";

const desktopCssUrl = new URL("../../../../css/desktop.css", import.meta.url);
const streamScreenUrl = new URL("./streamScreen.js", import.meta.url);

test("the header keeps the mark only once the mark's own block is out of view", () => {
  // The caller passes the block's height, so the small mark never appears while
  // the large one is still on screen.
  assert.equal(shouldCollapseStreamHeader(40, false, { collapseAt: 120 }), false);
  assert.equal(shouldCollapseStreamHeader(120, false, { collapseAt: 120 }), true);
  // Coming back up, it is handed back near the top, not at the threshold.
  assert.equal(shouldCollapseStreamHeader(60, true, { collapseAt: 120 }), true);
  assert.equal(shouldCollapseStreamHeader(STREAM_HEADER_EXPAND_AT, true), true);
  assert.equal(shouldCollapseStreamHeader(STREAM_HEADER_EXPAND_AT - 1, true), false);
});

test("a missing or impossible scroll position reads as the top of the page", () => {
  assert.equal(shouldCollapseStreamHeader(undefined), false);
  assert.equal(shouldCollapseStreamHeader(Number.NaN), false);
  assert.equal(shouldCollapseStreamHeader(-4), false);
  assert.equal(shouldCollapseStreamHeader(STREAM_HEADER_COLLAPSE_AT), true);
});

test("the heading is an empty bar at rest, with the mark as page content under it", async () => {
  const desktopCss = await readFile(desktopCssUrl, "utf8");

  assert.match(
    desktopCss,
    /\.desktop-browser #stream \.stream-route-heading \{[^}]*position: sticky;[^}]*height: 52px;[^}]*background: transparent;[^}]*backdrop-filter: none;/
  );
  // Empty until the mark has been scrolled past.
  assert.match(
    desktopCss,
    /\.desktop-browser #stream \.stream-route-heading-logo,\s*\n\s*\.desktop-browser #stream \.stream-route-heading-title \{\s*\n\s*display: none;/
  );
  // The mark itself is content, not a box.
  assert.match(
    desktopCss,
    /\.desktop-browser #stream \.stream-route-left \{[^}]*position: static;[^}]*background: transparent;[^}]*backdrop-filter: none;/
  );
});

test("the blur appears only on the collapsed heading", async () => {
  const desktopCss = await readFile(desktopCssUrl, "utf8");

  assert.match(
    desktopCss,
    /data-stream-header-collapsed="true"\]\s*\n\s*\.stream-route-heading \{[^}]*backdrop-filter: blur\(14px\);/
  );
  assert.match(
    desktopCss,
    /data-stream-header-collapsed="true"\]\s*\n\s*\.stream-route-heading-logo,/
  );
  // Nothing blurs the page itself.
  assert.match(desktopCss, /\.stream-route-panel-shell \{\s*\n\s*backdrop-filter: none;/);
});

test("the header holds the mark by watching the screen's own scroll position", async () => {
  const source = await readFile(streamScreenUrl, "utf8");

  assert.match(source, /shell\.dataset\.streamHeaderCollapsed/);
  assert.match(source, /\.stream-route-left/);
  assert.match(source, /shouldCollapseStreamHeader\(/);
  assert.match(source, /cleanup\(\)\s*\{\s*this\.unbindHeaderCollapse\(\);/);
});
