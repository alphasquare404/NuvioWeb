import assert from "node:assert/strict";
import test from "node:test";

import { renderModernHeroMetaLine } from "./modernHomeLayout.js";

const escapeHtml = (value) => String(value ?? "");

const textOf = (html) =>
  html
    .replace(/<img[^>]*alt="([^"]*)"[^>]*>/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

test("a series puts its rating on the same line as the rest, after a dot", () => {
  const html = renderModernHeroMetaLine(
    {
      leadingMeta: ["Series", "Sci-Fi & Fantasy"],
      trailingMeta: ["2026"],
      badges: [],
      showImdb: true,
      imdbText: "8.2"
    },
    escapeHtml
  );
  assert.equal(textOf(html), "Series • Sci-Fi & Fantasy • 2026 • IMDb 8.2");
  // One line means one container: no second row to put the rating on.
  assert.equal(html.match(/<div /g).length, 1);
});

test("badges and language join the same line rather than starting another", () => {
  const html = renderModernHeroMetaLine(
    {
      leadingMeta: ["Movie", "Thriller"],
      trailingMeta: ["1h 46m", "October 9, 2026"],
      badges: ["R", "RELEASED"],
      languageText: "EN",
      showImdb: true,
      imdbText: "5.7"
    },
    escapeHtml
  );
  assert.equal(
    textOf(html),
    "Movie • Thriller • 1h 46m • October 9, 2026 • R • RELEASED • IMDb 5.7 • EN"
  );
});

test("nothing to say renders nothing, so the row can be hidden", () => {
  assert.equal(renderModernHeroMetaLine({}, escapeHtml), "");
  assert.equal(renderModernHeroMetaLine(null, escapeHtml), "");
});
