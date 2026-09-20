import assert from "node:assert/strict";
import test from "node:test";

const { parseEpisodeRuntimeMinutes } = await import("./episodeCardMetadata.js");

// The value Detail hands the Stream route for a film. Episode routes have
// always carried a runtime; films did not, which left an external player with
// no duration to measure its reported position against.
const movieRuntime = (meta) =>
  parseEpisodeRuntimeMinutes(meta?.runtimeMinutes || meta?.runtime) || null;

test("a numeric runtime is carried through", () => {
  assert.equal(movieRuntime({ runtimeMinutes: 109 }), 109);
});

test("the display string addons actually return is understood", () => {
  assert.equal(movieRuntime({ runtime: "109 min" }), 109);
  assert.equal(movieRuntime({ runtime: "1h 49m" }), 109);
  assert.equal(movieRuntime({ runtime: "2h" }), 120);
});

test("runtimeMinutes wins over the display string", () => {
  assert.equal(movieRuntime({ runtimeMinutes: 109, runtime: "0 min" }), 109);
});

test("a film with no runtime at all stays null rather than zero", () => {
  // null keeps it out of the route params instead of asserting a zero-length
  // film, which the duration fallback would treat as a real value.
  assert.equal(movieRuntime({}), null);
  assert.equal(movieRuntime({ runtime: "" }), null);
  assert.equal(movieRuntime(null), null);
});

test("an unparseable runtime does not become a bogus duration", () => {
  assert.equal(movieRuntime({ runtime: "unknown" }), null);
});
