import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { normalizeAccentColor, accentTextColor } from "./accentColor.js";
import { ThemeColors } from "../../ui/theme/themeColors.js";

test("Custom colors accept hex only and normalize short/uppercase values", () => {
  assert.equal(normalizeAccentColor("#AbC"), "#aabbcc");
  assert.equal(normalizeAccentColor(" 12ABef "), "#12abef");
  for (const value of ["red", "#abcd", "#12345678", "var(--accent)", "url(x)", ";color:red", null])
    assert.equal(normalizeAccentColor(value), null);
});
test("Custom accents choose the higher-contrast black or white text and preserve preset palettes", () => {
  assert.equal(accentTextColor("#ffffff"), "#000000");
  assert.equal(accentTextColor("#000000"), "#ffffff");
  const original = { ...ThemeColors.getPalette("OCEAN") };
  assert.equal(ThemeColors.getPalette("CUSTOM", "#ffcc00")["--secondary-color"], "#ffcc00");
  assert.equal(ThemeColors.getPalette("CUSTOM", "#ffcc00")["--on-secondary"], "#000000");
  assert.equal(ThemeColors.getPalette("CUSTOM", "#000000")["--on-secondary"], "#ffffff");
  assert.deepEqual(ThemeColors.getPalette("OCEAN"), original);
  assert.notEqual(ThemeColors.getPalette("CUSTOM", "#000000")["--focus-color"], "#000000");
});
test("Theme normalization keeps custom colors even when they match a preset and retains the last custom color", async () => {
  const source = (
    await readFile(new URL("../../data/local/themeStore.js", import.meta.url), "utf8")
  )
    .replace(/^import[^;]+;\s*/gm, "")
    .replaceAll("export ", "");
  const normalize = new Function(
    "normalizeAccentColor",
    "createProfileScopedStore",
    source + "\nreturn normalizeTheme;"
  )(normalizeAccentColor, () => ({}));
  const custom = normalize({ themeName: "CUSTOM", accentColor: "#42a5f5" });
  assert.equal(custom.themeName, "CUSTOM");
  assert.equal(custom.accentColor, "#42a5f5");
  assert.equal(custom.customAccentColor, "#42a5f5");
  const preset = normalize({ ...custom, themeName: "OCEAN", accentColor: "#1e88e5" });
  assert.equal(preset.accentColor, "#1e88e5");
  assert.equal(preset.customAccentColor, "#42a5f5");
  assert.equal(normalize({ themeName: "CUSTOM", accentColor: "bad color" }).accentColor, "#1e88e5");
  assert.equal(normalize({ accentColor: "#ff4d4f" }).themeName, "CRIMSON");
  assert.equal(normalize({}).themeName, "WHITE");
});
