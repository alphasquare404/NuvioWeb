import assert from "node:assert/strict";
import test from "node:test";
import {
  collectInstalledAddonNames,
  resolvePreferredBingeGroup
} from "./streamAutoPlaySelector.js";

const BOTH_ON = {
  streamAutoPlayPreferBingeGroupForNextEpisode: true,
  streamAutoPlayReuseBingeGroup: true
};

test("a remembered binge group guides the choice when both settings are on", () => {
  assert.equal(
    resolvePreferredBingeGroup(BOTH_ON, () => ({ bingeGroup: "addon|1080p|group" })),
    "addon|1080p|group"
  );
  assert.equal(
    resolvePreferredBingeGroup(BOTH_ON, () => ({ bingeGroup: "  padded  " })),
    "padded"
  );
});

test("either setting off means the store is not even consulted", () => {
  // The stream screen expressed this as a ternary around the lookup, so the
  // read was skipped when the answer would have been discarded. Keeping that
  // is why the entry arrives through a function rather than as a value.
  for (const settings of [
    { ...BOTH_ON, streamAutoPlayPreferBingeGroupForNextEpisode: false },
    { ...BOTH_ON, streamAutoPlayReuseBingeGroup: false },
    {}
  ]) {
    let consulted = false;
    const result = resolvePreferredBingeGroup(settings, () => {
      consulted = true;
      return { bingeGroup: "should-not-be-read" };
    });
    assert.equal(result, "");
    assert.equal(consulted, false, "the saved entry was read when it could not be used");
  }
});

test("nothing remembered is no preference, not a broken one", () => {
  // A blank preferred group switches off binge-group preference in the
  // selection rather than matching streams whose own group is empty.
  for (const entry of [null, undefined, {}, { bingeGroup: "" }, { bingeGroup: "   " }]) {
    assert.equal(
      resolvePreferredBingeGroup(BOTH_ON, () => entry),
      ""
    );
  }
  assert.equal(resolvePreferredBingeGroup(BOTH_ON), "");
});

test("an addon is matched by the name it shows a person", () => {
  // The "selected addons" source stores what the person saw in the list, so
  // displayName wins and name is only the fallback.
  assert.deepEqual(
    [
      ...collectInstalledAddonNames([
        { displayName: "Torrentio", name: "torrentio-internal" },
        { name: "Comet" }
      ])
    ],
    ["Torrentio", "Comet"]
  );
});

test("unnamed addons drop out instead of matching everything", () => {
  // An empty name would be a Set entry that no stream can match, but a
  // whitespace one could silently become a real comparison.
  assert.deepEqual(
    [
      ...collectInstalledAddonNames([
        { displayName: "  Spaced  " },
        { displayName: "   " },
        { name: "" },
        {},
        null,
        { displayName: "Spaced" }
      ])
    ],
    ["Spaced"]
  );
});

test("no installed addons is an empty set rather than a failure", () => {
  for (const value of [[], null, undefined, "not-an-array", 7, {}]) {
    assert.equal(collectInstalledAddonNames(value).size, 0, `${String(value)} should be empty`);
  }
  assert.equal(collectInstalledAddonNames().size, 0);
});
