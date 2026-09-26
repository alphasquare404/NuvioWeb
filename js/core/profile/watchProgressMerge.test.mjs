import assert from "node:assert/strict";
import test from "node:test";
import {
  buildWatchedAtByKey,
  furthestProgress,
  itemsByProgressKey,
  mergeProgressItems,
  normalizeProgressItems,
  preserveLocalProgressMetadata,
  progressKey,
  progressWatchedKey
} from "./watchProgressMerge.js";

// These are the rules that decide whose viewing survives when two devices touch
// the same title, and they had no coverage at all -- reaching them meant
// standing up auth, storage and the network client.

const movie = (positionMs, updatedAt, extra = {}) => ({
  contentId: "tt1375666",
  contentType: "movie",
  videoId: null,
  season: null,
  episode: null,
  positionMs,
  durationMs: 100_000,
  updatedAt,
  ...extra
});

const episode = (season, ep, positionMs, updatedAt) => ({
  contentId: "tt0903747",
  contentType: "series",
  videoId: `tt0903747:${season}:${ep}`,
  season,
  episode: ep,
  positionMs,
  durationMs: 100_000,
  updatedAt
});

const positionsOf = (items) => items.map((item) => item.positionMs);

test("an item only this device changed is kept", () => {
  const merged = mergeProgressItems(
    [movie(60_000, 500)],
    [movie(30_000, 100)],
    [movie(30_000, 100)]
  );
  assert.deepEqual(positionsOf(merged), [60_000]);
});

test("an item only the cloud changed is taken", () => {
  const merged = mergeProgressItems(
    [movie(30_000, 100)],
    [movie(80_000, 500)],
    [movie(30_000, 100)]
  );
  assert.deepEqual(positionsOf(merged), [80_000]);
});

// The scenario issue #47 describes: 30% known, this device watches to 60%
// offline, another device reaches 80% meanwhile. Both sides moved, so one has to
// give -- and it is the further position that survives, whichever device's clock
// says it wrote last.
test("when both sides moved, the further position wins either way round", () => {
  const localWroteLast = mergeProgressItems(
    [movie(60_000, 500)],
    [movie(80_000, 400)],
    [movie(30_000, 100)]
  );
  assert.deepEqual(positionsOf(localWroteLast), [80_000]);

  const remoteWroteLast = mergeProgressItems(
    [movie(60_000, 400)],
    [movie(80_000, 500)],
    [movie(30_000, 100)]
  );
  assert.deepEqual(positionsOf(remoteWroteLast), [80_000]);
});

// Two devices minutes apart on the clock used to decide this arbitrarily, and
// the losing side's viewing was erased. Position is measured the same way on
// both, so the outcome no longer depends on whose clock is right.
test("the outcome does not depend on the writing device's clock", () => {
  const withSkew = (localAt, remoteAt) =>
    positionsOf(
      mergeProgressItems([movie(60_000, localAt)], [movie(80_000, remoteAt)], [movie(30_000, 100)])
    );
  assert.deepEqual(withSkew(999_999, 200), withSkew(200, 999_999));
});

test("the further side wins regardless of which side it is", () => {
  assert.equal(furthestProgress(movie(80_000, 100), movie(60_000, 900)).positionMs, 80_000);
  assert.equal(furthestProgress(movie(10_000, 900), movie(60_000, 100)).positionMs, 60_000);
});

// Equal positions are not a conflict, so the fresher record is kept for its
// metadata rather than arbitrated on a number that matches.
test("equal positions keep the newer record", () => {
  assert.equal(furthestProgress(movie(60_000, 900), movie(60_000, 100)).updatedAt, 900);
  assert.equal(furthestProgress(movie(60_000, 100), movie(60_000, 900)).updatedAt, 900);
});

// Finishing a title removes its progress row rather than setting it to 100%, so
// "the cloud has no row" is how a completion reaches this device. Without the
// watched record to read it by, the local partial was pushed back and the
// finished film returned to Continue Watching part-watched.
const watchedNow = (key) => new Map([[key, 900]]);

test("a partial left behind before a finish elsewhere is retired", () => {
  const merged = mergeProgressItems([movie(60_000, 500)], [], [movie(30_000, 100)], {
    watchedAtByKey: watchedNow("tt1375666::::")
  });
  assert.deepEqual(merged, []);
});

// By the time a rewatch starts, the deletion the finish caused has already been
// taken in, so there is no baseline row left to have carried on from.
test("a rewatch begun after the deletion was taken in is kept", () => {
  const merged = mergeProgressItems([movie(5_000, 900)], [], [], {
    watchedAtByKey: watchedNow("tt1375666::::")
  });
  assert.deepEqual(positionsOf(merged), [5_000]);
});

// And a rewatch begun before it landed starts behind where the cloud last knew,
// where a leftover carries on past it.
test("a rewatch that starts behind the baseline is kept", () => {
  const merged = mergeProgressItems([movie(5_000, 900)], [], [movie(30_000, 100)], {
    watchedAtByKey: watchedNow("tt1375666::::")
  });
  assert.deepEqual(positionsOf(merged), [5_000]);
});

// Telling these apart used to mean comparing one device's clock against
// another's, which minutes of drift decided. Neither fact this reads is a time.
test("which device's clock is ahead changes nothing", () => {
  const retired = (localAt, watchedAtValue) =>
    mergeProgressItems([movie(60_000, localAt)], [], [movie(30_000, 100)], {
      watchedAtByKey: new Map([["tt1375666::::", watchedAtValue]])
    }).length === 0;
  assert.equal(retired(999_999, 200), true);
  assert.equal(retired(200, 999_999), true);
});

// Nothing says this title was ever finished, so there is no reason to discard
// viewing on the strength of it.
test("an unwatched title keeps its partial, as before", () => {
  const merged = mergeProgressItems([movie(60_000, 500)], [], [movie(30_000, 100)], {
    watchedAtByKey: new Map()
  });
  assert.deepEqual(positionsOf(merged), [60_000]);
  assert.deepEqual(
    positionsOf(mergeProgressItems([movie(60_000, 500)], [], [movie(30_000, 100)])),
    [60_000]
  );
});

// A watched record names an episode by season and number; a progress row names
// it by videoId. Matching on either side's own identity would never connect them.
test("an episode is matched to its watched record despite the differing identity", () => {
  const merged = mergeProgressItems(
    [episode(1, 2, 60_000, 500)],
    [],
    [episode(1, 2, 30_000, 100)],
    {
      watchedAtByKey: watchedNow("tt0903747::1::2")
    }
  );
  assert.deepEqual(merged, []);
});

test("finishing one episode does not retire another", () => {
  const merged = mergeProgressItems(
    [episode(1, 2, 60_000, 500), episode(1, 3, 40_000, 500)],
    [],
    [episode(1, 2, 30_000, 100), episode(1, 3, 10_000, 100)],
    { watchedAtByKey: watchedNow("tt0903747::1::2") }
  );
  assert.deepEqual(
    merged.map((item) => item.episode),
    [3]
  );
});

// A row the cloud still has was plainly not deleted by a completion, so the
// watched record has no say over it.
test("a title still present in the cloud is untouched by its watched record", () => {
  const merged = mergeProgressItems(
    [movie(60_000, 500)],
    [movie(80_000, 400)],
    [movie(30_000, 100)],
    {
      watchedAtByKey: watchedNow("tt1375666::::")
    }
  );
  assert.deepEqual(positionsOf(merged), [80_000]);
});

// Without a baseline there is nothing to say a row was ever deleted, so an
// absence cannot be read as an intentional removal.
test("with no baseline, both sides' rows are kept", () => {
  const merged = mergeProgressItems([movie(60_000, 500)], [], []);
  assert.deepEqual(positionsOf(merged), [60_000]);
  assert.deepEqual(positionsOf(mergeProgressItems([], [movie(80_000, 500)], [])), [80_000]);
});

test("a row neither side touched since the baseline is dropped as deleted", () => {
  assert.deepEqual(mergeProgressItems([], [], [movie(30_000, 100)]), []);
});

test("a row the cloud deleted but this device did not touch is dropped", () => {
  const merged = mergeProgressItems([movie(30_000, 100)], [], [movie(30_000, 100)]);
  assert.deepEqual(merged, []);
});

// Only the portable fields cross the network, so anything the cloud cannot carry
// has to be re-attached from the local row when the remote one wins.
test("local-only metadata survives a remote win", () => {
  const local = movie(30_000, 100, {
    title: "Inception",
    poster: "p.jpg",
    source: "simkl_playback",
    streamIdentity: "addon:abc"
  });
  const [merged] = mergeProgressItems([local], [movie(80_000, 500)], [movie(30_000, 100)]);
  assert.equal(merged.positionMs, 80_000);
  assert.equal(merged.title, "Inception");
  assert.equal(merged.poster, "p.jpg");
  assert.equal(merged.source, "simkl_playback");
  assert.equal(merged.streamIdentity, "addon:abc");
});

test("metadata is not invented when the local row has none", () => {
  assert.equal(preserveLocalProgressMetadata(movie(80_000, 500), null).title, undefined);
  assert.equal(preserveLocalProgressMetadata(null, movie(30_000, 100)), null);
});

test("episodes of one series are reconciled independently", () => {
  const merged = mergeProgressItems(
    [episode(1, 1, 60_000, 500), episode(1, 2, 10_000, 500)],
    [episode(1, 1, 80_000, 900), episode(1, 2, 10_000, 100)],
    [episode(1, 1, 30_000, 100), episode(1, 2, 10_000, 100)]
  );
  const byEpisode = new Map(merged.map((item) => [item.episode, item.positionMs]));
  assert.equal(byEpisode.get(1), 80_000);
  assert.equal(byEpisode.get(2), 10_000);
});

test("a movie and an episode never collide on one key", () => {
  assert.notEqual(progressKey(movie(0, 0)), progressKey(episode(1, 1, 0, 0)));
  assert.equal(
    progressKey({ contentId: "tt1" }),
    progressKey({ contentId: "tt1", videoId: "main" })
  );
});

test("rows without a content id are discarded rather than keyed as empty", () => {
  assert.deepEqual(
    normalizeProgressItems([{ positionMs: 1 }, { contentId: "", positionMs: 2 }]),
    []
  );
});

test("duplicates of one key collapse to the newest", () => {
  const items = normalizeProgressItems([
    movie(10_000, 100),
    movie(90_000, 900),
    movie(50_000, 500)
  ]);
  assert.deepEqual(positionsOf(items), [90_000]);
  assert.equal(itemsByProgressKey(items).size, 1);
});

test("the result is ordered newest first", () => {
  const merged = mergeProgressItems([movie(60_000, 500), episode(1, 1, 10_000, 900)], [], []);
  assert.deepEqual(
    merged.map((item) => item.updatedAt),
    [900, 500]
  );
});

test("nothing anywhere merges to nothing", () => {
  assert.deepEqual(mergeProgressItems(), []);
  assert.deepEqual(mergeProgressItems(null, null, null), []);
});

test("the watched map is keyed so a progress row finds its own record", () => {
  const byKey = buildWatchedAtByKey([
    { contentId: "tt1375666", watchedAt: 900 },
    { contentId: "tt0903747", season: 1, episode: 2, watchedAt: 800 }
  ]);
  assert.equal(byKey.get(progressWatchedKey(movie(0, 0))), 900);
  assert.equal(byKey.get(progressWatchedKey(episode(1, 2, 0, 0))), 800);
});

// An earlier partial has to be measured against the most recent completion, or
// a title finished twice would be judged against the first time it was watched.
test("a title finished more than once keeps the latest completion", () => {
  const byKey = buildWatchedAtByKey([
    { contentId: "tt1", watchedAt: 500 },
    { contentId: "tt1", watchedAt: 900 },
    { contentId: "tt1", watchedAt: 100 }
  ]);
  assert.equal(byKey.get("tt1::::"), 900);
});

test("records with no id or no time are not treated as completions", () => {
  const byKey = buildWatchedAtByKey([
    { contentId: "", watchedAt: 900 },
    { contentId: "tt2" },
    { contentId: "tt3", watchedAt: 0 },
    null
  ]);
  assert.equal(byKey.size, 0);
});

test("nothing watched builds an empty map rather than failing", () => {
  assert.equal(buildWatchedAtByKey().size, 0);
  assert.equal(buildWatchedAtByKey(null).size, 0);
});

// Rewinding to watch something again is deliberate, and it has to stick. It was
// being settled on position instead, so the cloud's further position came
// straight back and the rewind could not be made to hold.
test("rewinding on this device survives the cloud's further position", () => {
  const merged = mergeProgressItems(
    [movie(50_000, 900)], // rewound here, just now
    [movie(70_000, 400)], // the cloud, from earlier
    [movie(70_000, 400)] // and the cloud has not moved since
  );
  assert.deepEqual(positionsOf(merged), [50_000]);
});

// The baseline is this device's claim about what the cloud holds AND what it has
// taken in. A pull that recorded it without storing its rows leaves it claiming
// a cloud the device never merged, after which every pull reads as "only I
// moved" and the device silently stops following the cloud for good.
test("a baseline that claims a cloud this device never took in is not believed", () => {
  const merged = mergeProgressItems(
    [movie(30_000, 400)], // written here, earlier
    [movie(70_000, 900)], // the cloud moved after that
    [movie(70_000, 900)] // baseline wrongly agrees with it
  );
  assert.deepEqual(positionsOf(merged), [70_000]);
});

// Which of the two it is turns on which write happened last -- not on whose
// clock is right, and not on which position is further.
test("the later write decides, in both directions", () => {
  const rewind = mergeProgressItems(
    [movie(50_000, 900)],
    [movie(70_000, 400)],
    [movie(70_000, 400)]
  );
  const behind = mergeProgressItems(
    [movie(50_000, 400)],
    [movie(70_000, 900)],
    [movie(70_000, 900)]
  );
  assert.deepEqual(positionsOf(rewind), [50_000]);
  assert.deepEqual(positionsOf(behind), [70_000]);
});

test("ordinary local progress against an unchanged cloud is kept", () => {
  const merged = mergeProgressItems(
    [movie(60_000, 500)],
    [movie(30_000, 100)],
    [movie(30_000, 100)]
  );
  assert.deepEqual(positionsOf(merged), [60_000]);
});

test("local metadata survives the cloud winning here too", () => {
  const local = movie(30_000, 400, { title: "Inception", streamIdentity: "addon:abc" });
  const [merged] = mergeProgressItems([local], [movie(70_000, 900)], [movie(70_000, 900)]);
  assert.equal(merged.positionMs, 70_000);
  assert.equal(merged.title, "Inception");
  assert.equal(merged.streamIdentity, "addon:abc");
});

// An episode finished on this device coming back a moment later.
//
// Reported on iPad: finish an episode in an external player, return to Home,
// and Continue Watching moves to the next episode and then reverts. Other
// devices show the next episode; a pull-to-refresh on the iPad settles it.
//
// The device log caught it. A completion removed the row locally, the watched
// sync then failed with an HTTP 429 rate limit, and 1.7 seconds later a pull
// wrote the finished episode back:
//
//   [Store] replaceForProfile n=8  (tt1355642 gone -- the completion)
//   [CW] refresh-final s=1 e=11    (correct: the next episode)
//   [Supabase] 429  Watched items sync push failed
//   [Store] replaceForProfile n=9  tt1355642:s1e10:645000  (back again)
//   [CW] refresh-final s=1 e=10    (reverted)
//
// A completion deletes the row and the cloud learns of it from this device's
// next push. Until that push lands -- delayed here by the rate limit -- the
// cloud still holds the row, and the pull restored it because the remote row
// no longer matched the baseline. It need not differ in anything that matters:
// `updatedAt` moves when another device rewrites the row, and is stamped with
// the current time whenever the cloud sends no timestamp this device can read.

const EPISODE = {
  contentId: "tt1355642",
  contentType: "series",
  videoId: "tt1355642:1:10",
  season: 1,
  episode: 10,
  positionMs: 645_000,
  durationMs: 1_420_000
};

test("a finished episode is not restored by a newer timestamp alone", () => {
  const baseline = [{ ...EPISODE, updatedAt: 1_790_000_000_000 }];
  // The same row, the same position, a later stamp.
  const remote = [{ ...EPISODE, updatedAt: 1_790_000_900_000 }];
  const merged = mergeProgressItems([], remote, baseline);
  assert.equal(merged.length, 0, "the completion must stand until the cloud is told");
});

// The exact case from the log: the cloud sent no readable timestamp, so the
// pull stamped the row with its own clock and it differed on every pull.
test("a row restamped by every pull does not undo a completion", () => {
  const baseline = [{ ...EPISODE, updatedAt: Date.now() - 60_000 }];
  const remote = [{ ...EPISODE, updatedAt: Date.now() }];
  assert.equal(mergeProgressItems([], remote, baseline).length, 0);
});

// The cloud genuinely knowing more still wins: another device watched further
// into the same episode, which is not a completion this device should erase.
test("a cloud row that really moved is still restored", () => {
  const baseline = [{ ...EPISODE, updatedAt: 1_790_000_000_000 }];
  const remote = [{ ...EPISODE, positionMs: 900_000, updatedAt: 1_790_000_900_000 }];
  const merged = mergeProgressItems([], remote, baseline);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].positionMs, 900_000);
});

// With no baseline there is nothing to say the row was ever taken in, so it is
// news rather than a completion -- a fresh install is the ordinary case.
test("a row with no baseline is still taken in", () => {
  const merged = mergeProgressItems([], [{ ...EPISODE, updatedAt: 1_790_000_000_000 }], []);
  assert.equal(merged.length, 1);
});

// Moving to another episode is a content change, not a timestamp one.
test("a different episode from the cloud is restored", () => {
  const baseline = [{ ...EPISODE, updatedAt: 1_790_000_000_000 }];
  const remote = [
    {
      ...EPISODE,
      videoId: "tt1355642:1:11",
      episode: 11,
      positionMs: 0,
      updatedAt: 1_790_000_900_000
    }
  ];
  assert.equal(mergeProgressItems([], remote, baseline).length, 1);
});

// The decision is reported rather than inferred, the way the retire decision
// beside it already is.
test("the restore decision says why", () => {
  const seen = [];
  mergeProgressItems(
    [],
    [{ ...EPISODE, updatedAt: 1_790_000_900_000 }],
    [{ ...EPISODE, updatedAt: 1_790_000_000_000 }],
    { onRestoreDecision: (decision) => seen.push(decision) }
  );
  assert.equal(seen.length, 1);
  assert.equal(seen[0].restore, false);
  assert.equal(seen[0].hadBaseline, true);
  assert.equal(seen[0].remoteChanged, false);
});
