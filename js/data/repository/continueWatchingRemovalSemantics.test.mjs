import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// Removing a card from Continue Watching is allowed to clear that title's
// playback progress. It is never allowed to un-watch anything: watched/history
// records live behind different endpoints and must stay untouched.
//
// These are source-level contracts rather than live API calls, because the
// invariant worth protecting is "this code path cannot reach the history
// endpoints", and that is exactly what a reader needs to be able to trust.

const repoUrl = new URL("./watchProgressRepository.js", import.meta.url);
const simklUrl = new URL("./simklSyncService.js", import.meta.url);
const traktUrl = new URL("./traktAuthService.js", import.meta.url);

function sliceFunction(source, startMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `could not find ${startMarker}`);
  // Far enough to cover the whole body, short enough not to swallow the file.
  return source.slice(start, start + 2600);
}

test("SIMKL removal deletes playback sessions and never touches history", async () => {
  const source = await readFile(simklUrl, "utf8");
  const body = sliceFunction(source, "async removePlaybackForContent(");
  assert.match(body, /\/sync\/playback\/\$\{sessionId\}/, "deletes the playback session by id");
  assert.match(body, /method: "DELETE"/);
  assert.doesNotMatch(body, /sync\/history/, "must never reach SIMKL history");
  assert.doesNotMatch(body, /add-to-list/);
});

test("SIMKL removal uses the session id we already store", async () => {
  const source = await readFile(simklUrl, "utf8");
  assert.match(
    source,
    /simklPlaybackId: session\.id/,
    "the playback session id is retained when projecting"
  );
  const body = sliceFunction(source, "async removePlaybackForContent(");
  assert.match(body, /Number\(session\?\.id\)/, "removal resolves ids from the stored sessions");
});

test("Trakt removal deletes playback entries and never touches history", async () => {
  const source = await readFile(traktUrl, "utf8");
  const body = sliceFunction(source, "async removePlaybackEntries(");
  assert.match(body, /\/sync\/playback\/\$\{id\}/);
  assert.match(body, /method: "DELETE"/);
  assert.doesNotMatch(body, /sync\/history/, "must never reach Trakt history");
});

test("the Trakt playback entry id is preserved end to end", async () => {
  // Dropping it anywhere in the chain makes provider removal impossible.
  const trakt = await readFile(traktUrl, "utf8");
  const repo = await readFile(repoUrl, "utf8");
  assert.match(trakt, /traktPlaybackId: entry\.id/, "kept when normalizing the playback item");
  assert.match(repo, /traktPlaybackId: playbackItem\.traktPlaybackId/, "kept on the composed item");
  assert.match(
    repo,
    /removeTraktPlaybackForContent[\s\S]{0,900}traktPlaybackId/,
    "and read back when removing"
  );
});

test("removal is title-wide and leaves watched history alone", async () => {
  const repo = await readFile(repoUrl, "utf8");
  const body = sliceFunction(repo, "async removeContinueWatchingTitle(");
  assert.match(
    body,
    /this\.removeProgress\(normalizedContentId\)/,
    "no videoId: every episode of the title goes, not only the card used"
  );
  assert.doesNotMatch(body, /watchedItemsRepository/, "never unmarks watched items");
  assert.doesNotMatch(body, /unmark|removeWatched/, "never removes history records");
});

test("a provider-backed removal suppresses the title while it settles", async () => {
  const repo = await readFile(repoUrl, "utf8");
  const body = sliceFunction(repo, "async removeContinueWatchingTitle(");
  assert.match(body, /continueWatchingRemovalSuppression\.suppress\(/);
  assert.match(
    body,
    /result\.deleted === 0 && result\.failed > 0[\s\S]{0,140}release\(/,
    "a failed delete releases the suppression instead of hiding a live item"
  );
});

test("the composed list reconciles suppression against the playback rows", async () => {
  const repo = await readFile(repoUrl, "utf8");
  assert.match(
    repo,
    /continueWatchingRemovalSuppression\.reconcile\(\s*\(snapshot\.playbackItems/,
    "reconciles against playback rows, not history rows"
  );
  assert.match(repo, /continueWatchingRemovalSuppression\.filterItems\(/);
});
