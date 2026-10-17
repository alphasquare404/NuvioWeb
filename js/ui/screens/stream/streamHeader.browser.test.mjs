import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const desktopCssUrl = new URL("../../../../css/desktop.css", import.meta.url);

test("the stream mark is a header box above the sources, not a column beside them", async () => {
  const desktopCss = await readFile(desktopCssUrl, "utf8");

  // One column, two rows: the mark on top, the sources filling what is left.
  assert.match(
    desktopCss,
    /\.desktop-browser #stream \.stream-route-content \{\s*grid-template-columns: minmax\(0, 1fr\);\s*grid-template-rows: auto minmax\(0, 1fr\);\s*align-items: stretch;/
  );

  // The mark sits in a surface of its own, the same one the sources panel uses,
  // and is centred inside it.
  assert.match(
    desktopCss,
    /\.desktop-browser #stream \.stream-route-left \{[^}]*justify-content: center;[^}]*border-radius: 22px;[^}]*background: rgb\(var\(--bg-elevated-rgb\) \/ 0\.22\);[^}]*backdrop-filter: blur\(2px\);/
  );

  // A smaller mark than the hero's, and the episode code as a badge.
  assert.match(
    desktopCss,
    /\.desktop-browser #stream \.stream-route-logo \{\s*width: auto;\s*max-width: min\(70%, 460px\);\s*max-height: 64px;/
  );
  assert.match(
    desktopCss,
    /\.desktop-browser #stream \.stream-route-episode-code \{[\s\S]{0,400}?border-radius: 999px;/
  );
});
