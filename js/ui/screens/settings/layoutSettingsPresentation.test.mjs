import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import {
  activeLayoutSettingsGroup,
  toggleLayoutSettingsGroup,
  layoutDepthValue,
  layoutPreviewDepth
} from "./layoutSettingsPresentation.js";

test("Layout topics are exclusive while nested Home catalog state survives", () => {
  const initial = { navStyle: true, homeCatalogs: true };
  const selected = toggleLayoutSettingsGroup(initial, "homeContent");
  assert.equal(selected.navStyle, false);
  assert.equal(selected.homeContent, true);
  assert.equal(selected.homeCatalogs, true);
  assert.equal(activeLayoutSettingsGroup(toggleLayoutSettingsGroup(selected, "homeContent")), null);
  assert.equal(activeLayoutSettingsGroup({}, true), "navStyle");
  assert.equal(toggleLayoutSettingsGroup({}, "navStyle", true).navStyle, true);
  assert.deepEqual(toggleLayoutSettingsGroup(initial, "invalid"), initial);
});

test("Depth previews use bounded strengths and respect the Posters surface", () => {
  assert.equal(layoutDepthValue("unknown", 90), null);
  assert.equal(layoutDepthValue("cardDepthEdgeStrength", Infinity), 28);
  assert.equal(layoutDepthValue("cardDepthEdgeStrength", -4), 0);
  assert.equal(layoutDepthValue("cardDepthSheenStrength", 150), 100);
  assert.deepEqual(
    layoutPreviewDepth({
      cardDepthEnabled: true,
      cardDepthPostersEnabled: false,
      cardDepthEdgeStrength: 40,
      cardDepthSheenStrength: 20,
      cardDepthEdgeCoverage: 100
    }),
    { enabled: false, edge: 0.4, sheen: 0.2, coverage: 30 }
  );
});

test("Dragging previews without persisting; release commits only the permitted field", async () => {
  const source = await readFile(new URL("./settingsScreen.js", import.meta.url), "utf8");
  const start = source.indexOf("  handleLayoutRangeInput(event) {");
  const end = source.indexOf("  renderLayoutLivePreview(", start);
  const writes = [],
    styles = {},
    output = { textContent: "" };
  const handlers = new Function(
    "layoutDepthValue",
    "layoutPreviewDepth",
    "Router",
    "LayoutPreferences",
    `return {${source.slice(start, end)}}`
  )(
    layoutDepthValue,
    layoutPreviewDepth,
    { getCurrent: () => "settingsSection" },
    { set: (v) => writes.push(v) }
  );
  const input = {
    matches: () => true,
    dataset: { layoutRange: "cardDepthEdgeStrength", focusKey: "layout:cardDepthEdge" },
    value: "67"
  };
  let renders = 0;
  const view = {
    ...handlers,
    model: { layout: {} },
    container: {
      id: "settingsSection",
      contains: (e) => e === input,
      querySelector: () => output,
      querySelectorAll: () => [{ style: { setProperty: (k, v) => (styles[k] = v) } }]
    },
    render: async () => renders++
  };
  view.handleLayoutRangeInput({ target: input });
  assert.equal(view.layoutRangeInteraction, true);
  assert.equal(output.textContent, "67%");
  assert.equal(styles["--preview-edge"], 0.67);
  assert.deepEqual(writes, []);
  await view.handleLayoutRangeChange({ target: input });
  assert.deepEqual(writes, [{ cardDepthEdgeStrength: 67 }]);
  assert.equal(view.layoutRangeInteraction, false);
  assert.equal(renders, 1);
  view.handleLayoutRangeInput({ target: input });
  view.handleLayoutRangeCancel({ target: input });
  assert.equal(renders, 2);
  assert.equal(writes.length, 1);
  input.dataset.layoutRange = "browserNavigationStyle";
  await view.handleLayoutRangeChange({ target: input });
  assert.equal(writes.length, 1);
  view.container.id = "suspended";
  input.dataset.layoutRange = "cardDepthEdgeStrength";
  view.handleLayoutRangeInput({ target: input });
  assert.equal(view.layoutRangeInteraction, false);
});
