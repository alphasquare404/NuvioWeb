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

test("the stream header stays open at the top of the page", () => {
  assert.equal(shouldCollapseStreamHeader(0), false);
  assert.equal(shouldCollapseStreamHeader(12), false);
  assert.equal(shouldCollapseStreamHeader(STREAM_HEADER_COLLAPSE_AT - 1), false);
});

test("the stream header collapses once the page passes its threshold", () => {
  assert.equal(shouldCollapseStreamHeader(STREAM_HEADER_COLLAPSE_AT), true);
  assert.equal(shouldCollapseStreamHeader(400), true);
});

test("a collapsed stream header stays collapsed until the page is near the top", () => {
  assert.equal(shouldCollapseStreamHeader(STREAM_HEADER_COLLAPSE_AT - 4, true), true);
  assert.equal(shouldCollapseStreamHeader(STREAM_HEADER_EXPAND_AT, true), true);
  assert.equal(shouldCollapseStreamHeader(STREAM_HEADER_EXPAND_AT - 1, true), false);
  assert.ok(STREAM_HEADER_EXPAND_AT < STREAM_HEADER_COLLAPSE_AT);
});

test("the stream mark is the page header: no box, centred, and it keeps its place", async () => {
  const desktopCss = await readFile(desktopCssUrl, "utf8");

  // No surface behind the mark at rest, and it keeps its place while the page
  // scrolls. Matched in one rule so an older, non-sticky rule cannot satisfy it.
  assert.match(
    desktopCss,
    /\.desktop-browser #stream \.stream-route-left \{[^}]*position: sticky;[^}]*justify-content: center;[^}]*background: transparent;[^}]*box-shadow: none;[^}]*backdrop-filter: none;/
  );

  // The page scrolls, not the list, so the header has something to collapse on.
  assert.match(
    desktopCss,
    /\.desktop-browser #stream \.stream-route-list \{[^}]*height: auto;[^}]*overflow: visible;/
  );

  // The badge and the episode title were side by side; stacked, the title's old
  // left margin pushed it off centre.
  assert.match(
    desktopCss,
    /\.desktop-browser #stream \.stream-route-episode-code \+ \.stream-route-subtitle \{[^}]*display: block;[^}]*margin-left: 0;/
  );
});

test("the collapse state is driven by the screen's own scroll position", async () => {
  const source = await readFile(streamScreenUrl, "utf8");

  assert.match(source, /shell\.dataset\.streamHeaderCollapsed/);
  assert.match(source, /shouldCollapseStreamHeader\(/);
  // Removed by the mount that added it.
  assert.match(source, /cleanup\(\)\s*\{\s*this\.unbindHeaderCollapse\(\);/);
});
