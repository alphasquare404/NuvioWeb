import assert from "node:assert/strict";
import test from "node:test";
import { buildPlayerSubtitle, formatRuntimeLabel } from "./runtimeLabel.js";

test("a runtime is said the way a person says it", () => {
  assert.equal(formatRuntimeLabel(52), "52m");
  assert.equal(formatRuntimeLabel(145), "2h 25m");
  assert.equal(formatRuntimeLabel(120), "2h");
  assert.equal(formatRuntimeLabel(0), "");
  assert.equal(formatRuntimeLabel(""), "");
  assert.equal(formatRuntimeLabel(undefined), "");
  assert.equal(formatRuntimeLabel(-5), "");
  assert.equal(formatRuntimeLabel("145"), "2h 25m");
});

test("the subtitle line carries the runtime without dangling punctuation", () => {
  assert.equal(
    buildPlayerSubtitle({ title: "The Long Goodbye", minutes: 145 }),
    "The Long Goodbye · 2h 25m"
  );
  // No episode title (a film): the runtime stands alone.
  assert.equal(buildPlayerSubtitle({ title: "", minutes: 145 }), "2h 25m");
  // No runtime: the line is exactly what it was before.
  assert.equal(buildPlayerSubtitle({ title: "Pilot" }), "Pilot");
  assert.equal(buildPlayerSubtitle({ title: "", minutes: 0 }), "");
});
