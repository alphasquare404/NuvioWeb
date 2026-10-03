import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const metaDetailsScreenUrl = new URL("./metaDetailsScreen.js", import.meta.url);

async function metaDetailsScreenSource() {
  return readFile(metaDetailsScreenUrl, "utf8");
}

test("choosing a season redraws only what the season changes", async () => {
  // A full render restored the scroll from a value captured elsewhere -- zero --
  // so the page jumped to the top, and rebuilding the dropdown under the finger
  // that had just used it is the flash of it reappearing. The rail never did
  // either, so the dropdown should not.
  const source = await metaDetailsScreenSource();

  assert.match(
    source,
    /this\.selectedSeason = season;\s*if \(!this\.refreshSeasonSelection\(\)\) \{\s*this\.render\(this\.meta, \{ selector: "\.series-season-select-shell" \}\);/
  );
  // The three things a season owns: its label, its download action, its episodes.
  assert.match(
    source,
    /refreshSeasonSelection\(\) \{[\s\S]*?series-season-select-value[\s\S]*?series-season-download-row[\s\S]*?return this\.refreshEpisodeTrack\(\);/
  );
});

test("the season options open in the app's own menu, not the system's", async () => {
  // A native select carried them before, and the panel it opened was drawn by
  // the operating system: white, square, and unlike anything else on the page.
  const source = await metaDetailsScreenSource();

  assert.doesNotMatch(source, /<select[^>]*class="series-season-select/);
  assert.match(source, /class="library-picker-menu library-picker-menu-open"/);
  assert.match(source, /data-action="selectSeasonOption"/);
  assert.match(source, /data-action="toggleSeasonPicker"/);
});

test("the watched pass on this screen is scoped to the selected source", async () => {
  // A tick here means the source that owns the list has this episode, so the
  // rule is the one Continue Watching uses -- one function, reached from both.
  //
  // It was withdrawn once, after it emptied the page: thousands of records
  // predate the source tag, so under a provider every tick vanished, and with
  // no episode ticked a finished season stopped counting as one. Its menu could
  // then only offer to mark it watched again, which is what the report "mark
  // season as unwatched does nothing at all" was actually about. The scoping is
  // back, and the provider is given those records first.
  const source = await metaDetailsScreenSource();

  assert.match(source, /selectWatchedItemsForSource\(\s*watchedItems,/);
  // The season action follows the ticks, which is why losing them took the
  // option with it.
  assert.match(source, /seasonFullyWatched \? "markSeasonUnwatched" : "markSeasonWatched"/);
  assert.match(source, /fullyWatched \? "markSeasonUnwatched" : "markSeasonWatched"/);
});

test("Detail re-reads progress when Back uncovers it", async () => {
  // Reported as: finish an episode in an external player, come back, press Back
  // from Stream to Detail -- the card still shows the old progress, while Home
  // already moved on. Nuvio's own player hid it by navigating to Detail, which
  // mounts and reloads; a revealed layer never mounts again, and this screen
  // subscribes to nothing.
  const source = await metaDetailsScreenSource();

  assert.match(source, /onRouteRevealed\(\) \{/);
  assert.match(
    source,
    /onRouteRevealed\(\) \{[\s\S]*?this\.refreshEpisodePlaybackState\(\)[\s\S]*?updateRenderedDetailSections/
  );
  // The guard that keeps it from racing the load that is already running.
  assert.match(source, /onRouteRevealed\(\) \{[\s\S]*?this\.isLoadingDetail\) return;/);
});

test("the refresh does not rebuild from the map it just invalidated", async () => {
  // Reported twice as "mark season as unwatched is not immediate", and the
  // delay was never the problem. A tick asks the enrichment map before it asks
  // the local state, and this function invalidates that map's cache and then
  // passed the same map straight back in -- so every episode it still called
  // watched stayed watched, however fast the local write was.
  const source = await metaDetailsScreenSource();

  const refresh = source.match(/async refreshEpisodePlaybackState\(\) \{[\s\S]*?\n  \},/)?.[0];
  assert.ok(refresh, "refreshEpisodePlaybackState should be findable");
  assert.match(refresh, /detailWatchedEnrichmentService\.invalidateCache/);
  assert.match(refresh, /this\.enrichedWatchedState = null;/);
  assert.doesNotMatch(
    refresh,
    /buildEpisodeState\([^)]*this\.enrichedWatchedState/,
    "the invalidated map must not be fed back in"
  );
  // It is rebuilt rather than dropped for good: a provider can know things the
  // local rows do not.
  assert.match(refresh, /refreshWatchedEnrichmentInBackground\(\)/);
  assert.match(
    source,
    /refreshWatchedEnrichmentInBackground\(\) \{[\s\S]*?enrichSeriesWatchedState/
  );
});

test("the library button asks whether the title is in the library, not which list", async () => {
  // Simkl keeps one status per title and the Library list shows all of them.
  // This asked only about plan to watch -- the one status Nuvio itself writes --
  // so a title the person had marked watching or completed read as "not saved".
  // On a real library that was 103 of 105: the button offered to add what was
  // already there, and pressing it overwrote a real status with plan to watch.
  const source = await metaDetailsScreenSource();

  assert.match(source, /function librarySnapshotHasMembership\(/);
  assert.match(
    source,
    /librarySnapshotHasMembership[\s\S]{0,400}?LibrarySourceMode\.SIMKL[\s\S]{0,120}?Object\.values\([^)]*\)\.some\(Boolean\)/
  );
  // The icon and the press have to agree, or the button lies in a new way.
  const refresh = source.match(/async refreshCurrentLibraryMembership\(\) \{[\s\S]*?\n  \},/)?.[0];
  assert.match(refresh, /librarySnapshotHasMembership\(/);
  assert.doesNotMatch(refresh, /simkl:status:plantowatch/);
});

test("the library button turns before the provider answers", async () => {
  // Measured at 987ms on a healthy connection: a write, an activities check and
  // a full list pull all had to come back before the icon moved.
  const source = await metaDetailsScreenSource();
  const toggle = source.match(/async toggleLibraryFromHero\(\) \{[\s\S]*?\n  \},/)?.[0];
  assert.ok(toggle, "toggleLibraryFromHero should be findable");

  // The flip happens from what is on screen, before any network call.
  assert.match(toggle, /const wasSaved = this\.isSavedInLibrary === true;/);
  const flipAt = toggle.indexOf("this.isSavedInLibrary = !wasSaved;");
  const applyAt = toggle.indexOf("applyMembershipChanges");
  assert.ok(flipAt > 0 && applyAt > flipAt, "the icon turns before the write is sent");
  // And it goes back if the write is refused.
  assert.match(toggle, /catch \(error\) \{[\s\S]*?this\.isSavedInLibrary = wasSaved;/);
});
