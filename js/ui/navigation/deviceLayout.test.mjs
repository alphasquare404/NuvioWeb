import assert from "node:assert/strict";
import test from "node:test";

const { resolveLayout } = await import("./deviceLayout.js");

// A tablet with the bar at the bottom or the rail asked for the touch shell.
// The wide breakpoint must not take that answer back at 1024, where an iPad in
// portrait or landscape would otherwise jump to the desktop layout.
test("a tablet with the bar at the bottom keeps the touch layout at any width", () => {
  for (const width of [393, 834, 1024, 1194, 1366]) {
    assert.equal(
      resolveLayout({ width, deviceClass: "tablet", navPlacement: "bottom" }),
      "mobile",
      `tablet bottom at ${width}px`
    );
  }
});

test("a tablet with the side rail keeps the touch layout at any width", () => {
  for (const width of [393, 834, 1024, 1194, 1366]) {
    assert.equal(
      resolveLayout({ width, deviceClass: "tablet", navPlacement: "sidebar" }),
      "mobile",
      `tablet rail at ${width}px`
    );
  }
});

test("a tablet with the top bar still follows the width", () => {
  assert.equal(
    resolveLayout({ width: 834, deviceClass: "tablet", navPlacement: "top" }),
    "desktop"
  );
  assert.equal(
    resolveLayout({ width: 1024, deviceClass: "tablet", navPlacement: "top" }),
    "desktop"
  );
});

test("phones and desktops keep their existing answers", () => {
  assert.equal(
    resolveLayout({ width: 393, deviceClass: "phone", navPlacement: "bottom" }),
    "mobile"
  );
  assert.equal(resolveLayout({ width: 393, deviceClass: "phone", navPlacement: "top" }), "desktop");
  assert.equal(
    resolveLayout({ width: 800, deviceClass: "desktop", navPlacement: "bottom" }),
    "desktop"
  );
  assert.equal(
    resolveLayout({ width: 1440, deviceClass: "desktop", navPlacement: "bottom" }),
    "desktop"
  );
  assert.equal(
    resolveLayout({ width: 600, deviceClass: "desktop", navPlacement: "bottom" }),
    "mobile"
  );
});
