import assert from "node:assert/strict";
import test from "node:test";
import { mergeProgressItems } from "./watchProgressMerge.js";

// A cloud pull must not erase a write that landed while it was in flight.
//
// Reported flow: watch a title in an external player, come back, press Back to
// Home. The new position showed for a second and then reverted. The device log
// named both writes:
//
//   [Store] upsert auth=true  pos=1088000 upd=1790398198196
//   [Store] replaceForProfile pos=238000  upd=1790370928303
//
// The cloud row was 7.5 hours older and still won. The pull read the local list
// before its network call, the external report landed 2.4 seconds later during
// the round trip, and the merge compared that stale copy against an equally old
// cloud row. Nothing looked changed, so replaceAll wrote the old position back.
// The second attempt stuck because no pull was in flight.
//
// The fix reads local again after the network. These tests pin the merge rule
// that fix depends on: a newer local row survives a pull that brings nothing
// new, whether or not the cloud has heard about it yet.

const KEY = { contentId: "tt1355642", videoId: "tt1355642" };

function progress(positionMs, updatedAt) {
  return { ...KEY, positionMs, durationMs: 1_407_840, updatedAt };
}

// The cloud row and the baseline are the same: the cloud has not moved.
const CLOUD = progress(238_000, 1_790_370_928_303);
const EXTERNAL = progress(1_088_000, 1_790_398_198_196);

test("a local position written during the pull survives the merge", () => {
  const merged = mergeProgressItems([EXTERNAL], [CLOUD], [CLOUD]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].positionMs, 1_088_000);
});

// The exact failure: merging the stale copy instead loses the write. This is
// what the old code did, and it is why re-reading local is the fix.
test("merging a stale local copy is what lost the position", () => {
  const merged = mergeProgressItems([CLOUD], [CLOUD], [CLOUD]);
  assert.equal(merged[0].positionMs, 238_000);
});

// A rewind is deliberate and must also survive, or the fix would only protect
// progress that moves forward.
test("a deliberate rewind written during the pull also survives", () => {
  const rewind = progress(120_000, 1_790_398_198_196);
  const merged = mergeProgressItems([rewind], [CLOUD], [CLOUD]);
  assert.equal(merged[0].positionMs, 120_000);
});

// The cloud still wins when it is the side that actually moved, or the device
// would stop following other devices.
test("a cloud row that really moved still wins", () => {
  const movedCloud = progress(900_000, 1_790_400_000_000);
  const merged = mergeProgressItems([CLOUD], [movedCloud], [CLOUD]);
  assert.equal(merged[0].positionMs, 900_000);
});

// A title the cloud has never seen must not be dropped by a pull.
test("a local-only row is not dropped by a pull", () => {
  const merged = mergeProgressItems([EXTERNAL], [], []);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].positionMs, 1_088_000);
});
