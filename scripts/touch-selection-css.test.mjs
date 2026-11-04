import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import postcss from "postcss";
import autoprefixer from "autoprefixer";
import cssnano from "cssnano";
import { browserCompatibilityPolicy } from "./browserCompatibilityPolicy.mjs";

test("built media card rules retain Safari protection without disabling page or sheet selection", async () => {
  const source = await readFile(new URL("../css/desktop.css", import.meta.url), "utf8");
  const root = postcss.parse(source);
  const cards = [
    "library-grid-card",
    "search-result-card",
    "seeall-card",
    "discover-card",
    "cast-credit-card",
    "movie-cast-card",
    "series-episode-card",
    "detail-trailer-card",
    "detail-morelike-card",
    "stream-route-card"
  ];
  const rules = [];
  root.walkRules((rule) => {
    if (rule.selectors.includes(".desktop-browser .library-grid-card *")) {
      rules.push(rule.clone());
      assert.equal(rule.parent.type, "root");
      assert.deepEqual(
        new Set(rule.selectors),
        new Set(
          cards.flatMap((card) => [`.desktop-browser .${card}`, `.desktop-browser .${card} *`])
        ),
        "only cards and their contents are protected"
      );
    }
    assert.ok(!rule.selector.includes("html.desktop-browser body"), "no page-wide selection ban");
    if (rule.selector.includes("nuvio-action-sheet") && !rule.selector.includes("img")) {
      assert.ok(
        !rule.nodes.some(
          (n) => n.type === "decl" && /user-select$/.test(n.prop) && n.value === "none"
        ),
        "sheet text keeps normal selection"
      );
    }
  });
  assert.equal(rules.length, 1);
  const result = await postcss([
    autoprefixer({
      overrideBrowserslist: [`Chrome ${browserCompatibilityPolicy.chromiumVersion}`],
      grid: "autoplace"
    }),
    cssnano()
  ]).process(postcss.root({ nodes: rules }), { from: undefined });
  const built = postcss.parse(result.css);
  for (const card of cards) {
    const selector = `.desktop-browser .${card} *`;
    let protectedRule = false;
    built.walkRules((rule) => {
      if (!rule.selectors.includes(selector)) return;
      const values = Object.fromEntries(
        rule.nodes.filter((n) => n.type === "decl").map((n) => [n.prop, n.value])
      );
      assert.equal(values["-webkit-user-select"], "none");
      assert.equal(values["user-select"], "none");
      assert.equal(values["-webkit-touch-callout"], "none");
      protectedRule = true;
    });
    assert.equal(protectedRule, true);
  }
});
