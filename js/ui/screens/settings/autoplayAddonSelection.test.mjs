import test from "node:test";
import assert from "node:assert/strict";
import { visibleAutoplayAddonSelection } from "./autoplayAddonSelection.js";
test("addon count and editing exclude invisible stale names and duplicate selections", () => {
  const saved = ["Addon A", "Removed addon", "Addon A"];
  assert.deepEqual(
    visibleAutoplayAddonSelection(saved, [{ displayName: "Addon A", name: "manifest name" }]),
    ["Addon A"]
  );
  assert.deepEqual(visibleAutoplayAddonSelection(saved, [{ id: "Addon A", label: "Addon A" }]), [
    "Addon A"
  ]);
  assert.deepEqual(saved, ["Addon A", "Removed addon", "Addon A"]);
  assert.deepEqual(visibleAutoplayAddonSelection(["Removed addon"], [{ name: "Addon A" }]), []);
});
