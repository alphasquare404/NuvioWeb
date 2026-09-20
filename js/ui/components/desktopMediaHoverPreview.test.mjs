import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// The hover preview is a document-level portal: it is appended to <body>, not
// into Home. That keeps it from being clipped by a catalog shelf, but it also
// means nothing about Home's own stacking protects it -- the only thing keeping
// it visible is its z-index relative to the router's layer chrome.
//
// Home is not always in document flow. Re-entering Home over a suspended screen
// draws it as a fixed layer at `1000 + depth`, and at z-index 120 the portal was
// painted *underneath* Home: it opened correctly, positioned correctly, and was
// simply invisible. Hover looked dead after switching tabs.
//
// The contract spans a CSS file and a JS file, so it is read from both rather
// than restated here. A number copied into this test would keep passing while
// the real relationship drifted.

const routerUrl = new URL("../navigation/router.js", import.meta.url);
const desktopCssUrl = new URL("../../../css/desktop.css", import.meta.url);
const componentsCssUrl = new URL("../../../css/components.css", import.meta.url);

function ruleZIndex(css, selector) {
  const start = css.indexOf(`${selector} {`);
  assert.notEqual(start, -1, `could not find the CSS rule for \`${selector}\``);
  const end = css.indexOf("}", start);
  assert.notEqual(end, -1, `unterminated CSS rule for \`${selector}\``);
  const match = css.slice(start, end).match(/z-index:\s*(\d+)/);
  assert.ok(match, `\`${selector}\` no longer declares a z-index`);
  return Number(match[1]);
}

// Every base the router paints layer chrome from. applyLayerChrome and
// normalizeLayerZIndices each own one, and either could be raised alone.
function layerZIndexBases(routerSource) {
  const bases = [...routerSource.matchAll(/"z-index",\s*String\(\s*(\d+)\s*\+/g)].map((m) =>
    Number(m[1])
  );
  assert.ok(bases.length, "router no longer sets layer z-index as `String(<base> + <depth>)`");
  return bases;
}

function maxSuspendedLayers(routerSource) {
  const match = routerSource.match(/const MAX_SUSPENDED_LAYERS\s*=\s*(\d+)/);
  assert.ok(match, "router no longer declares MAX_SUSPENDED_LAYERS");
  return Number(match[1]);
}

test("the desktop hover preview outranks every router layer the stack can paint", async () => {
  const [routerSource, desktopCss] = await Promise.all([
    readFile(routerUrl, "utf8"),
    readFile(desktopCssUrl, "utf8")
  ]);

  const previewZIndex = ruleZIndex(desktopCss, ".desktop-browser .desktop-media-hover-preview");
  const bases = layerZIndexBases(routerSource);
  // The deepest layer the router can ever paint, plus the headroom of one more
  // push, so the preview does not merely tie with the top of a full stack.
  const highestLayerZIndex = Math.max(...bases) + maxSuspendedLayers(routerSource);

  assert.ok(
    previewZIndex > highestLayerZIndex,
    `hover preview z-index ${previewZIndex} must exceed the highest router layer ` +
      `chrome (${highestLayerZIndex}); at or below it the preview opens but is painted ` +
      `behind Home whenever Home is drawn as a layer`
  );
});

test("the hover preview still yields to dialogs and modals", async () => {
  // It outranks the layer band, not everything. A dialog opened from the
  // preview -- the library destination menu is reachable from its own buttons --
  // has to cover it.
  const [desktopCss, componentsCss] = await Promise.all([
    readFile(desktopCssUrl, "utf8"),
    readFile(componentsCssUrl, "utf8")
  ]);

  const previewZIndex = ruleZIndex(desktopCss, ".desktop-browser .desktop-media-hover-preview");
  const dialogZIndex = ruleZIndex(componentsCss, ".nuvio-dialog-backdrop");

  assert.ok(
    previewZIndex < dialogZIndex,
    `hover preview z-index ${previewZIndex} must stay below the dialog backdrop (${dialogZIndex})`
  );
});

test("the preview is still a body-level portal, which is why the contract exists", async () => {
  // If it were ever re-parented into Home the invariant above would stop being
  // the thing that keeps it visible, and this file would be testing nothing.
  const source = await readFile(new URL("./desktopMediaHoverPreview.js", import.meta.url), "utf8");
  assert.match(source, /document\.body\.append\(node\)/);
});

test("hover preview never instantiates without a real pointer", async () => {
  // Touch devices must not get it: the open path is gated on a hover-capable
  // fine pointer, and bind() refuses before attaching any listener.
  const source = await readFile(new URL("./desktopMediaHoverPreview.js", import.meta.url), "utf8");
  assert.match(source, /\(hover:\s*hover\)\s*and\s*\(pointer:\s*fine\)/);
  assert.match(source, /const bind = \(container\) => \{\s*if \(!canUseHoverPreview\(\)/);
});
