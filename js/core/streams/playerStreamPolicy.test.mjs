import test from "node:test";
import assert from "node:assert/strict";
import {
  filterPlayerStreams,
  playerStreamProbeCandidates,
  playerStreamCheckCandidates,
  playerStreamProbeKey
} from "./playerStreamPolicy.js";
const rows = [
  { id: "a", addonName: "A", url: "https://media.test/a" },
  { id: "b", addonName: "B", url: "https://media.test/b" }
];
test("retired compatibility preferences cannot hide streams or submit list probes", () => {
  for (const mode of ["client", "server"])
    for (const streamDisplayMode of ["ALL", "DIRECT", "DIRECT_REMUX"]) {
      const options = {
        mode,
        settings: { streamDisplayMode, streamCompatibilityFilter: "LIKELY_DIRECT" },
        labels: {
          compatibilityCheckEnabled: true,
          showPlaybackLabels: true,
          labelAddons: ["A"],
          filenameAllAddons: true,
          playbackLabelSource: "FILE_NAME"
        }
      };
      assert.deepEqual(filterPlayerStreams(rows, options), rows);
      assert.deepEqual(playerStreamProbeCandidates(rows, options), []);
      assert.deepEqual(playerStreamCheckCandidates(rows, options), []);
    }
});
test("selected source identity distinguishes files and reuses signed URL replacements", () => {
  const a = { infoHash: "a".repeat(40), fileIdx: 0, url: "https://media.test/a" };
  assert.equal(
    playerStreamProbeKey(a),
    playerStreamProbeKey({ ...a, url: "https://media.test/refreshed" })
  );
  assert.notEqual(playerStreamProbeKey(a), playerStreamProbeKey({ ...a, fileIdx: 1 }));
  assert.notEqual(
    playerStreamProbeKey({ infoHash: a.infoHash, url: rows[0].url }),
    playerStreamProbeKey({ infoHash: a.infoHash, url: rows[1].url })
  );
});
