import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("the list pages share one collapsing-heading binding", async () => {
  const [library, search, discover] = await Promise.all([
    read("../screens/library/libraryScreen.js"),
    read("../screens/search/searchScreen.js"),
    read("../screens/search/discoverScreen.js")
  ]);

  for (const [name, source, selector] of [
    ["Library", library, ".library-page-header"],
    ["Search", search, ".search-page-heading"],
    ["Discover", discover, ".discover-header"]
  ]) {
    assert.match(
      source,
      /import \{ bindCollapsingHeader \} from "\.\.\/\.\.\/navigation\/compactHeader\.js";/,
      `${name} should import the shared binding`
    );
    assert.match(
      source,
      new RegExp(
        `resolveHeader: \\(\\) => container\\.querySelector\\("${selector.replace(/[.]/g, "\\.")}"\\)`
      ),
      `${name} should resolve its own heading`
    );
    assert.match(
      source,
      /this\.pageHeadingCollapseBinding\?\.cleanup\(\);/,
      `${name} should clean up`
    );
  }
});

test("the pages whose headers used to vanish while loading draw them first", async () => {
  const [library, search] = await Promise.all([
    read("../screens/library/libraryScreen.js"),
    read("../screens/search/searchScreen.js")
  ]);

  const libraryLoading = library.match(/renderLoading\(\) \{[\s\S]*?\n {2}\},/);
  assert.ok(libraryLoading, "Library renderLoading should be found");
  assert.match(libraryLoading[0], /<header class="library-page-header">/);

  const searchLoading = search.match(/renderLoading\(\) \{[\s\S]*?\n {2}\},/);
  assert.ok(searchLoading, "Search renderLoading should be found");
  assert.match(searchLoading[0], /<h1 class="search-page-heading">/);
});

test("the stylesheet gives every list heading the same bar shape", async () => {
  const css = await read("../../../css/desktop.css");

  assert.match(
    css,
    /\.desktop-browser \.library-shell\.desktop-navigation-enabled \.library-page-header,\s*\n\s*\.desktop-browser \.search-screen-shell\.desktop-navigation-enabled \.search-page-heading,\s*\n\s*\.desktop-browser \.discover-shell\.desktop-navigation-enabled \.discover-header \{\s*\n\s*position: sticky;\s*\n\s*top: 0;/
  );

  for (const selector of ["library-page-header", "search-page-heading", "discover-header"]) {
    const rule = new RegExp(
      `\\.${selector}\\[data-collapsed="true"\\][\\s\\S]{0,400}?backdrop-filter: blur\\(14px\\);`
    );
    assert.match(css, rule, `${selector} should get the blurred bar`);
  }

  // Search's heading is the <h1> itself.
  assert.match(
    css,
    /\.search-screen-shell\.desktop-navigation-enabled\s*\n\s*\.search-page-heading\[data-collapsed="true"\] \{\s*\n\s*font-size: 18px;/
  );
});
