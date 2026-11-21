import assert from "node:assert/strict";
import test from "node:test";
import {
  buildHeroBackdropSources,
  heroImageFallbacks,
  heroTargetData,
  renderHeroTargetAttributes
} from "./heroArtworkSources.js";

test("both screens prefer the textless plate and keep a complete deduplicated fallback chain", () => {
  assert.deepEqual(
    buildHeroBackdropSources({
      textlessBackdrop: "plate",
      background: "wide",
      backdrop: "wide",
      poster: "poster"
    }),
    ["plate", "wide", "poster"]
  );
});
test("portrait failure tries this title's wide artwork before its remaining sources", () => {
  assert.deepEqual(
    heroImageFallbacks(
      { backdrop: "wide-b", backdropFallbacks: ["poster-b", "wide-b"] },
      "portrait-b"
    ),
    ["wide-b", "poster-b"]
  );
});
test("rotating A to B replaces the whole target, including absent addon fields", () => {
  const target = heroTargetData({
    id: "a",
    background: "wide-a",
    addonId: "addon-a",
    addonBaseUrl: "https://a"
  });
  Object.assign(target, heroTargetData({ id: "b", type: "tv", poster: "poster-b" }));
  assert.equal(target.itemId, "b");
  assert.equal(target.itemType, "tv");
  assert.equal(target.backdropSrc, "poster-b");
  assert.equal(target.addonId, "");
  assert.equal(target.addonBaseUrl, "");
  assert.deepEqual(
    heroImageFallbacks({ backdrop: "wide-b", backdropFallbacks: ["poster-b"] }, "wide-b"),
    ["poster-b"]
  );
});
test("initial markup carries escaped artwork and source addon context", () => {
  const attrs = renderHeroTargetAttributes(
    {
      id: "x",
      name: 'A "Title"',
      background: "wide",
      addonBaseUrl: "https://addon",
      addonId: "owner"
    },
    (s) => String(s).replaceAll('"', "&quot;")
  );
  assert.ok(attrs.includes('data-item-title="A &quot;Title&quot;"'));
  assert.ok(attrs.includes('data-backdrop-src="wide"'));
  assert.ok(attrs.includes('data-addon-base-url="https://addon"'));
  assert.ok(attrs.includes('data-addon-id="owner"'));
});
