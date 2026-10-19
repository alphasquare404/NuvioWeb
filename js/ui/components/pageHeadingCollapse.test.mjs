import assert from "node:assert/strict";
import test from "node:test";

import { resolvePageHeadingProgress } from "./pageHeadingCollapse.js";

test("a page heading grows from zero to one over its scroll range", () => {
  assert.equal(resolvePageHeadingProgress(0), 0);
  assert.equal(resolvePageHeadingProgress(24), 0.25);
  assert.equal(resolvePageHeadingProgress(48), 0.5);
  assert.equal(resolvePageHeadingProgress(96), 1);
  assert.equal(resolvePageHeadingProgress(140), 1);
});

test("a page heading's progress is reversible", () => {
  assert.equal(resolvePageHeadingProgress(72), 0.75);
  assert.equal(resolvePageHeadingProgress(24), 0.25);
  assert.equal(resolvePageHeadingProgress(0), 0);
  assert.equal(resolvePageHeadingProgress(-20), 0);
});
