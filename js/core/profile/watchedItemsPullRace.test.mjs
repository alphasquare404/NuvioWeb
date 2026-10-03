import assert from "node:assert/strict";
import test from "node:test";
import { mergeWatchedItems } from "./watchedItemsSyncService.js";

// The same race the progress pull already guards against, on the half that
// decides what counts as watched -- which is what Next Up is built from.
//
// Reported flow: close Nuvio, open it again, finish an episode in an external
// player, return from the callback page. Continue Watching advanced to the
// next episode and then went back to the episode that had just been watched,
// keeping its old progress. A pull-to-refresh fixed it, and another device had
// the right answer all along.
//
// Returning to the foreground starts a pull. The pull read the local watched
// list before its network call; the external report landed during the round
// trip; the merge ran against that stale copy and replaceAll wrote the watched
// set from before the episode finished back over the completion. The progress
// merge then saw no watched record to retire the partial by, so the old
// position came back with it.
//
// The fix reads local again after the network. These tests pin the merge rules
// that fix depends on.

const EPISODE = { contentId: "tt7908628", contentType: "series", season: 1, episode: 7 };
const OLDER = { ...EPISODE, watchedAt: 1_790_370_928_303 };
const COMPLETION = { ...EPISODE, watchedAt: 1_790_398_198_196 };
const PUSHED_AT = 1_790_380_000_000;
// A real pull brings back thousands of rows; one unrelated record is enough to
// get past the "cloud returned nothing" short circuit and reach the merge.
const CLOUD_HAS_SOMETHING = [{ contentId: "tt0111161", contentType: "movie", watchedAt: 1_000 }];

test("a completion written during the pull survives the merge", () => {
  const merged = mergeWatchedItems([COMPLETION], CLOUD_HAS_SOMETHING, PUSHED_AT);
  assert.equal(
    merged.some((item) => item.watchedAt === COMPLETION.watchedAt),
    true
  );
});

// The exact failure: merging the list captured before the network loses it,
// because the completion is in neither side.
test("merging a stale local copy is what lost the completion", () => {
  const merged = mergeWatchedItems([], CLOUD_HAS_SOMETHING, PUSHED_AT);
  assert.equal(
    merged.some((item) => item.contentId === EPISODE.contentId),
    false
  );
});

// A device that has never pushed has told the cloud nothing, so an absent
// cloud record cannot mean "deleted elsewhere". Skipping the local pass there
// dropped the completion itself.
test("with no successful push on record, local watched state is kept", () => {
  const merged = mergeWatchedItems(
    [COMPLETION],
    [{ ...EPISODE, contentId: "tt0111161", season: null, episode: null, watchedAt: 1 }],
    0
  );
  assert.equal(
    merged.some((item) => item.watchedAt === COMPLETION.watchedAt),
    true
  );
});

// Unwatching on another device still has to reach this one, or the fix would
// make watched state one-way.
test("a record the cloud dropped after this device pushed it is removed", () => {
  const merged = mergeWatchedItems(
    [OLDER],
    [{ contentId: "other", contentType: "movie", watchedAt: 2 }],
    PUSHED_AT
  );
  assert.equal(
    merged.some((item) => item.contentId === EPISODE.contentId),
    false
  );
});

// The cloud still wins where it is the side that moved.
test("a newer cloud record wins over an older local one", () => {
  const merged = mergeWatchedItems([OLDER], [COMPLETION], PUSHED_AT);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].watchedAt, COMPLETION.watchedAt);
});

// The device log that settled it. Finishing S1E12 advanced Next Up to S1E13,
// and 2.2 seconds later a pull replaced 2131 watched records with 2130:
//
//   [CW] refresh(external-return) -> tt32550889 S1E13 next
//   [CW] watched replaceAll 2131 -> 2130
//   [CW] refresh(store:replaceForProfile) -> tt32550889 S1E12 next
//
// Re-reading local was not enough. The completion WAS in the second read; the
// merge threw it away. A push succeeded during the round trip and moved the
// last-successful-push mark past the completion's own timestamp, so the rule
// "older than the last push means the cloud was told and has since dropped it"
// condemned a record the cloud had simply not been asked about yet -- the rows
// in hand were fetched before that push.
//
// The mark now describes the fetch, not the moment the merge happens to run.
test("a completion is not deleted by a push that succeeded during the pull", () => {
  const completionAt = 1_790_398_198_196;
  const completion = { ...EPISODE, watchedAt: completionAt };
  const pushedDuringTheRoundTrip = completionAt + 1_200;
  const pushedBeforeTheFetch = completionAt - 60_000;

  // What used to happen: judged against a mark set after the completion.
  const lost = mergeWatchedItems([completion], CLOUD_HAS_SOMETHING, pushedDuringTheRoundTrip);
  assert.equal(
    lost.some((item) => item.watchedAt === completionAt),
    false
  );

  // What happens now: judged against the mark as it was when the rows were
  // fetched, which is the only thing the fetched rows can be compared to.
  const kept = mergeWatchedItems([completion], CLOUD_HAS_SOMETHING, pushedBeforeTheFetch);
  assert.equal(
    kept.some((item) => item.watchedAt === completionAt),
    true
  );
});
