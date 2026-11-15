import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const metaDetailsScreenUrl = new URL("./metaDetailsScreen.js", import.meta.url);

async function metaDetailsScreenSource() {
  return readFile(metaDetailsScreenUrl, "utf8");
}

test("movie download opens a source and subtitle dialog from Detail", async () => {
  const source = await metaDetailsScreenSource();
  const method = source.match(/async openMovieDownloadDialog\([\s\S]*?\n {2}\},/)?.[0];
  const picker = source.match(/ {2}createDownloadSourcePicker\([\s\S]*?\n {2}\},/)?.[0];
  assert.ok(method);
  assert.ok(picker);
  const stream = { id: "downloadable", addonName: "Addon" };
  let finishDiscovery;
  const discovery = new Promise((resolve) => {
    finishDiscovery = resolve;
  });
  const services = {
    Platform: { isBrowser: () => true },
    isBrowserOfflineDownloadSupported: () => true,
    resolveMovieStreamIdentity: () => ({ itemId: "movie", videoId: "video" }),
    resolvePlayableDetailType: (type) => type,
    resolveMetaImdbId: () => "tt1",
    resolveMetaTmdbId: () => "1",
    resolveMetaTvdbId: () => "2",
    parseEpisodeRuntimeMinutes: () => 100,
    t: (_key, _params, fallback) => fallback,
    createOfflineDisplaySnapshot: () => ({}),
    listOfflineDownloads: async () => [],
    createOfflineMediaId: () => "movie",
    createOfflineDownloadId: ({ stream }) => stream.id,
    streamRepository: {
      async getStreamsFromAllAddons(type, id, options) {
        assert.equal(type, "movie");
        assert.equal(id, "video");
        assert.equal(options.itemId, "movie");
        assert.equal(options.tvdbId, "2");
        options.onChunk([stream]);
        return discovery;
      }
    },
    filterFilenameStreams: (streams) => streams,
    flattenSeasonDownloadStreams: (result) => result,
    PlayerSettingsStore: { get: () => ({}) },
    canQueueBrowserOfflineDownload: ({ stream }) => stream.id === "downloadable",
    normalizeSourceForDisplay: ({ id }) => ({ accessibleLabel: id })
  };
  const methods = new Function(...Object.keys(services), "return ({" + method + picker + "})")(
    ...Object.values(services)
  );
  const detail = {
    meta: { name: "Movie", type: "movie" },
    ...methods,
    getHeroOfflineDownloadId: () => "",
    showSeasonDownloadDialog(options) {
      this.seasonDownloadDialog = {
        ...options,
        buttons: options.buttons || [],
        appendButtons(buttons) {
          this.buttons.push(...buttons);
        },
        setSubtitle(subtitle) {
          this.subtitle = subtitle;
        }
      };
    },
    closeSeasonDownloadDialog() {
      this.seasonDownloadDialog = null;
    },
    openOfflineDownloadOptions(selected, context, callbacks) {
      assert.equal(selected, stream);
      assert.equal(context.mediaId, "movie");
      callbacks.onQueued({ status: "queued" });
    }
  };
  await detail.openMovieDownloadDialog();
  assert.ok(detail.seasonDownloadDialog.buttons.some(({ label }) => label === "Choose Source"));
  assert.ok(detail.seasonDownloadDialog.buttons.some(({ label }) => label === "Automatic"));
  const pending = detail.openMovieDownloadDialog({ chooseSource: true });
  assert.deepEqual(
    detail.seasonDownloadDialog.buttons.map(({ label }) => label),
    ["downloadable"]
  );
  finishDiscovery([stream, { id: "unsupported" }]);
  await pending;
  assert.deepEqual(
    detail.seasonDownloadDialog.buttons.map(({ label }) => label),
    ["downloadable"]
  );
  detail.seasonDownloadDialog.buttons[0].onAction();
  assert.equal(detail.seasonDownloadDialog.subtitle, "Download queued.");
});

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

  const refresh = source.match(/async refreshEpisodePlaybackState\(\) \{[\s\S]*?\n {2}\},/)?.[0];
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
  const refresh = source.match(
    /async refreshCurrentLibraryMembership\(\) \{[\s\S]*?\n {2}\},/
  )?.[0];
  assert.match(refresh, /librarySnapshotHasMembership\(/);
  assert.doesNotMatch(refresh, /simkl:status:plantowatch/);
});

test("the library button turns before the provider answers", async () => {
  // Measured at 987ms on a healthy connection: a write, an activities check and
  // a full list pull all had to come back before the icon moved.
  const source = await metaDetailsScreenSource();
  const toggle = source.match(/async toggleLibraryFromHero\(\) \{[\s\S]*?\n {2}\},/)?.[0];
  assert.ok(toggle, "toggleLibraryFromHero should be findable");

  // The flip happens from what is on screen, before any network call.
  assert.match(toggle, /const wasSaved = this\.isSavedInLibrary === true;/);
  const flipAt = toggle.indexOf("this.isSavedInLibrary = !wasSaved;");
  const applyAt = toggle.indexOf("applyMembershipChanges");
  assert.ok(flipAt > 0 && applyAt > flipAt, "the icon turns before the write is sent");
  // And it goes back if the write is refused.
  assert.match(toggle, /catch \(error\) \{[\s\S]*?this\.isSavedInLibrary = wasSaved;/);
});

test("Back releases the autoplay handoff before refreshing preserved Detail", async () => {
  const source = await metaDetailsScreenSource();
  const method = (name) => {
    const match = source.match(new RegExp(name + "\\(\\) \\{[\\s\\S]*?\\n {2}\\},"));
    assert.ok(match, name + " exists");
    return new Function(
      "setBrowserMediaTitle",
      "StartupLoadingOverlay",
      "return ({" + match[0] + "})." + name
    )(() => {}, { finish() {} });
  };
  let renders = 0;
  const screen = {
    meta: { name: "Spider-Man" },
    container: {},
    isLoadingDetail: true,
    routeHandoffPending: true,
    renderedRouteHandoffMarkup: "Finding a stream",
    releaseRouteHandoff: method("releaseRouteHandoff"),
    render() {
      renders += 1;
    }
  };
  method("onRouteRevealed").call(screen);
  assert.equal(screen.routeHandoffPending, false);
  assert.equal(screen.renderedRouteHandoffMarkup, null);
  assert.equal(renders, 1);
});

test("Continue Watching prepares before showing a real add-on search", async () => {
  const source = await metaDetailsScreenSource();
  const method = source.match(/renderRouteHandoff\(stage = "checking"\) \{[\s\S]*?\n {2}\},/)?.[0];
  assert.ok(method);
  const stages = [];
  const overlay = {
    active: false,
    begin(_metadata, stage) {
      this.active = true;
      stages.push(stage);
    },
    updateMetadata() {},
    setStage(stage) {
      stages.push(stage);
    }
  };
  const run = new Function(
    "Platform",
    "usesUnifiedStartup",
    "isAutoPlayEffectivelyEnabled",
    "PlayerSettingsStore",
    "StartupLoadingOverlay",
    "return ({" + method + "}).renderRouteHandoff"
  )(
    { isBrowser: () => true },
    () => true,
    () => true,
    { get: () => ({}) },
    overlay
  );
  const screen = { container: {}, params: {}, getStartupOverlayMeta: () => ({}) };
  run.call(screen);
  run.call(screen, "finding");
  assert.deepEqual(stages, ["checking", "finding"]);

  const open = source.match(/async openStreamRoute\(params, options\) \{[\s\S]*?\n {2}\},/)?.[0];
  assert.ok(open);
  const saved = {
    streamId: "old",
    resumeIdentity: "file:episode",
    candidate: { id: "old", url: "https://media.example/old" }
  };
  const next = new Function(
    "PlayerSettingsStore",
    "isAutoPlayEffectivelyEnabled",
    "reusableStreamPreference",
    "collectInstalledAddonNames",
    "addonRepository",
    "Platform",
    "reusablePlaybackUrl",
    "autoPlayCandidates",
    "nextEpisodeSelectionOptions",
    "StartupLoadingOverlay",
    "Router",
    "resolveAutoPlayStream",
    "return ({" + open + "}).openStreamRoute"
  )(
    { get: () => ({ browserExternalPlayer: "lenna" }) },
    () => true,
    () => saved,
    () => new Set(),
    { getCachedInstalledAddons: () => [] },
    { isBrowser: () => true },
    (url) => url,
    (candidates) => candidates,
    () => ({}),
    overlay,
    { navigate: (_route, params) => params },
    () => assert.fail("Cached link must be handed off before discovery")
  );
  const params = await next.call(screen, {
    itemId: "tt1",
    videoId: "tt1:1:2",
    resumePositionMs: 140000
  });
  assert.equal(params.autoResolvedStreamId, "old");
  assert.equal(params.resumePositionMs, 140000);
  assert.equal(stages.at(-1), "reopening");
});
