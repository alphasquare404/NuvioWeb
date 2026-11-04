import test from "node:test";
import assert from "node:assert/strict";
import { paginateBrowserToolbar } from "./browserToolbar.js";
test("middle actions keep source order and remain reachable on narrow toolbars", () => {
  const actions = [
    "next",
    "subtitles",
    "audio",
    "sources",
    "episodes",
    "speed",
    "aspect",
    "external",
    "rotate"
  ];
  const pages = paginateBrowserToolbar(actions, { width: 84, step: 28 }).pages;
  const visited = [];
  for (let page = 0; page < pages; page++)
    visited.push(...paginateBrowserToolbar(actions, { width: 84, step: 28, page }).actions);
  assert.deepEqual(visited, actions);
  assert.equal(paginateBrowserToolbar(actions, { width: 1000, page: 8 }).page, 0);
  assert.equal(paginateBrowserToolbar(actions, { width: 1000 }).pages, 1);
});
test("resize clamps an unavailable page without dropping actions", () => {
  const result = paginateBrowserToolbar([1, 2, 3, 4, 5, 6], { width: 160, step: 40, page: 50 });
  assert.equal(result.page, 2);
  assert.deepEqual(result.actions, [5, 6]);
});
