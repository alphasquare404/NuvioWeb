import assert from "node:assert/strict";
import test from "node:test";

const { isHomeLoadGenerationCurrent } = await import("./homeLoadGeneration.js");

test("a load whose token and profile still match the live state is current", () => {
  assert.equal(
    isHomeLoadGenerationCurrent({ token: 1, currentToken: 1, profileId: "p1", currentProfileId: "p1" }),
    true
  );
});

test("a superseded token (a newer mount() began) is not current", () => {
  assert.equal(
    isHomeLoadGenerationCurrent({ token: 1, currentToken: 2, profileId: "p1", currentProfileId: "p1" }),
    false
  );
});

test("a profile switch while the load was in flight is not current, even with a matching token", () => {
  assert.equal(
    isHomeLoadGenerationCurrent({ token: 1, currentToken: 1, profileId: "p1", currentProfileId: "p2" }),
    false
  );
});

test("a still-in-flight load surviving mere navigation away from Home (unchanged token/profile) stays current", () => {
  // This is the behavior the fix relies on: cleanup() no longer bumps the
  // token just because the user left Home, so token and profile both still
  // match here even though Home was torn down and rebuilt while this load
  // was resolving.
  assert.equal(
    isHomeLoadGenerationCurrent({ token: 5, currentToken: 5, profileId: "p1", currentProfileId: "p1" }),
    true
  );
});

test("missing/undefined ids do not coerce into a false match", () => {
  assert.equal(
    isHomeLoadGenerationCurrent({ token: 1, currentToken: 1, profileId: null, currentProfileId: "" }),
    true
  );
  assert.equal(
    isHomeLoadGenerationCurrent({ token: 1, currentToken: 1, profileId: "p1", currentProfileId: null }),
    false
  );
});
