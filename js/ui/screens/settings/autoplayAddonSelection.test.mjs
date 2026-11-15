import test from "node:test";
import assert from "node:assert/strict";
import { listAutoplayStreamAddons } from "./autoplayAddonSelection.js";
test("allowed sources keep stream and unknown add-ons in their installed order", () => {
  assert.deepEqual(
    listAutoplayStreamAddons([
      { name: "Cinemeta", resources: [{ name: "catalog" }, { name: "meta" }] },
      { displayName: "Renamed provider", name: "Original", resources: [{ name: "stream" }] },
      { name: "Subtitles", resources: [{ name: "subtitles" }] },
      { name: "Manifest unavailable" },
      { name: "Second provider", resources: [{ name: "stream" }] }
    ]),
    [
      { id: "Renamed provider", label: "Renamed provider", unknown: false },
      { id: "Manifest unavailable", label: "Manifest unavailable", unknown: true },
      { id: "Second provider", label: "Second provider", unknown: false }
    ]
  );
});
