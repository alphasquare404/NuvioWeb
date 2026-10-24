import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const source = readFileSync(new URL("./playerScreen.js", import.meta.url), "utf8");
function method(signature, deps = {}) {
  const start = source.indexOf("  " + signature);
  assert.ok(start >= 0, signature);
  const end = source.indexOf("\n  },", start);
  return new Function(...Object.keys(deps), "return ({" + source.slice(start, end + 5) + "});")(
    ...Object.values(deps)
  );
}
test("mouse hover previews time without seeking, touch hides the preview", () => {
  const hidden = new Set(["hidden"]);
  const preview = {
    textContent: "",
    style: {},
    classList: { toggle: (c, on) => (on ? hidden.add(c) : hidden.delete(c)) }
  };
  const shell = {
    getBoundingClientRect: () => ({ left: 10, width: 200 }),
    querySelector: () => preview
  };
  const target = { closest: () => shell };
  const ctx = {
    container: { querySelector: () => preview, contains: () => true },
    getPlaybackDurationSeconds: () => 120
  };
  const run = method("updateProgressHover(event)", {
    clamp: (x, a, b) => Math.max(a, Math.min(b, x)),
    formatTime: (x) => `${Math.floor(x / 60)}:${String(Math.floor(x % 60)).padStart(2, "0")}`
  }).updateProgressHover;
  run.call(ctx, { pointerType: "mouse", clientX: 110, target });
  assert.equal(preview.textContent, "1:00");
  assert.equal(hidden.has("hidden"), false);
  run.call(ctx, { pointerType: "touch", clientX: 110, target });
  assert.equal(hidden.has("hidden"), true);
});
test("visible controls protect misses below the timeline without blocking taps above it", () => {
  const ctx = {
    container: { contains: () => true },
    isExternalFrameMode: () => false,
    controlsVisible: true,
    uiRefs: { progressShell: { getBoundingClientRect: () => ({ top: 500 }) } }
  };
  const run = method("isDesktopVideoAreaClick(target, event = null)", {
    Environment: { isBrowser: () => true }
  }).isDesktopVideoAreaClick;
  const target = { closest: () => null };
  assert.equal(run.call(ctx, target, { clientY: 520 }), false);
  assert.equal(run.call(ctx, target, { clientY: 450 }), true);
  ctx.controlsVisible = false;
  assert.equal(run.call(ctx, target, { clientY: 520 }), true);
});
test("buffer guard defaults are 18 seconds at startup and 9 seconds during playback", () => {
  const run = method(
    "getPlaybackStallTimeoutMs({ startup = false } = {})"
  ).getPlaybackStallTimeoutMs;
  assert.equal(run({ startup: true }), 18000);
  assert.equal(run(), 9000);
});
test("a buffering timer can declare failure while the page is hidden if no pause event arrives", () => {
  let expire;
  let delay;
  let opened = 0;
  const run = method("schedulePlaybackStallGuard({ timeoutMs: timeoutOverrideMs = null } = {})", {
    setTimeout: (callback, ms) => {
      expire = callback;
      delay = ms;
      return 1;
    },
    document: { visibilityState: "hidden" },
    PlayerController: {
      getPlaybackReadyState: () => 2,
      getLastPlaybackErrorCode: () => 0,
      getLastHlsErrorDetail: () => ""
    },
    isTerminalHlsHttpStatus: () => false,
    extractPlaybackHttpStatus: () => 0
  }).schedulePlaybackStallGuard;
  const ctx = {
    clearPlaybackStallGuard() {},
    isExternalFrameMode: () => false,
    activePlaybackUrl: "https://example.test/video.mp4",
    hasPresentedPlaybackFrame: true,
    loadingVisible: true,
    getPlaybackStallTimeoutMs: () => 9000,
    getStreamCandidateByUrl: () => null,
    getCurrentStreamCandidate: () => null,
    releaseStartupAudioGate() {},
    dismissPauseOverlay() {},
    updateLoadingVisibility() {},
    updateMediaSessionPlaybackState() {},
    setControlsVisible() {},
    mediaErrorMessage: () => "Buffering",
    formatPlaybackErrorForSources: (x) => x,
    streamCandidates: [{}, {}],
    openSourcesPanel: () => opened++,
    updateUiTick() {}
  };
  run.call(ctx);
  assert.equal(delay, 9000);
  expire();
  assert.equal(opened, 1);
  assert.equal(ctx.paused, true);
});
test("pause content scales to available height without adding scroll", () => {
  const content = { style: {}, scrollHeight: 600, getBoundingClientRect: () => ({ top: 84 }) };
  const overlay = {
    querySelector: () => content,
    getBoundingClientRect: () => ({ top: 0, height: 390 })
  };
  const run = method("fitPauseOverlay()", {
    Environment: { isBrowser: () => true },
    clamp: (x, a, b) => Math.max(a, Math.min(b, x)),
    getComputedStyle: () => ({ paddingBottom: "12px" })
  }).fitPauseOverlay;
  run.call({ uiRefs: { pauseOverlay: overlay }, pauseOverlayVisible: true });
  assert.equal(content.style.transform, "scale(0.49)");
  content.scrollHeight = 100;
  run.call({ uiRefs: { pauseOverlay: overlay }, pauseOverlayVisible: true });
  assert.equal(content.style.transform, "none");
  assert.equal(content.style.top, "145px");
});
test("pause cast retains portraits and roles supplied by detail metadata", () => {
  const declaration = source.match(
    /function extractPauseOverlayCast\(data = \{\}\) \{[\s\S]*?\n\}/
  )[0];
  const run = new Function(
    "cleanDisplayText",
    "normalizeComparableText",
    "normalizeImageUrl",
    "MAX_PAUSE_OVERLAY_CAST",
    declaration + ";return extractPauseOverlayCast;"
  )(
    (v) => String(v || "").trim(),
    (v) => v.toLowerCase(),
    (v) => v,
    8
  );
  const entries = run({
    castItems: [{ name: "Actor", character: "Pilot", photo: "https://image.test/actor.jpg" }]
  });
  assert.equal(entries[0].photo, "https://image.test/actor.jpg");
  assert.equal(entries[0].character, "Pilot");
});

test("swipe preview clamps to duration and only release seeks", () => {
  const ctx = {
    getPlaybackDurationSeconds: () => 100,
    getPlaybackCurrentSeconds: () => 30,
    showBrowserPlayerGestureFeedback() {},
    resetControlsAutoHide() {},
    hideBrowserPlayerGestureFeedback() {},
    seekPlaybackSeconds: (target) => {
      ctx.committed = target;
      return true;
    }
  };
  const begin = method("beginBrowserSwipeSeek()").beginBrowserSwipeSeek;
  const move = method("updateBrowserSwipeSeek({ deltaX, width })", {
    clamp: (x, a, b) => Math.max(a, Math.min(b, x)),
    formatTime: (x) => String(x)
  }).updateBrowserSwipeSeek;
  const end = method("finishBrowserSwipeSeek({ cancelled = false } = {})").finishBrowserSwipeSeek;
  assert.equal(begin.call(ctx), true);
  move.call(ctx, { deltaX: 100, width: 100 });
  assert.equal(ctx.browserSwipeSeek.target, 100);
  assert.equal(ctx.committed, undefined);
  assert.equal(end.call(ctx), true);
  assert.equal(ctx.committed, 100);
  ctx.committed = undefined;
  begin.call(ctx);
  move.call(ctx, { deltaX: -100, width: 100 });
  assert.equal(ctx.browserSwipeSeek.target, 0);
  end.call(ctx, { cancelled: true });
  assert.equal(ctx.committed, undefined);
});
test("mute displays zero volume while preserving the underlying unmuted volume", () => {
  let muted = true;
  const ctx = {
    getDesktopVolumeState: () => ({ volume: 0.8, muted }),
    isDesktopPictureInPictureSupported: () => false,
    canOpenInExternalPlayer: () => false,
    getDesktopFullscreenCapability: () => "element"
  };
  const run = method("renderDesktopPlaybackTools()", {
    Environment: { isBrowser: () => true },
    escapeHtml: (v) => v
  }).renderDesktopPlaybackTools;
  assert.match(run.call(ctx), /value="0" data-player-desktop-volume/);
  muted = false;
  assert.match(run.call(ctx), /value="80" data-player-desktop-volume/);
});
test("fullscreen chooses actual standard or native video capability and rejects missing APIs", async () => {
  const document = { fullscreenEnabled: true };
  let video = {};
  const ctx = { container: { requestFullscreen() {} }, getDesktopPlaybackVideo: () => video };
  const caps = method("getDesktopFullscreenCapability()", {
    Environment: { isBrowser: () => true },
    document
  }).getDesktopFullscreenCapability;
  assert.equal(caps.call(ctx), "element");
  ctx.container = {};
  assert.equal(caps.call(ctx), null);
  video = { webkitEnterFullscreen() {}, webkitSupportsFullscreen: true };
  assert.equal(caps.call(ctx), "video");
  video.webkitSupportsFullscreen = false;
  assert.equal(caps.call(ctx), null);
  let entered = 0;
  const toggle = method("async toggleDesktopFullscreen()", {
    Environment: { isBrowser: () => true }
  }).toggleDesktopFullscreen;
  Object.assign(ctx, {
    isDesktopPlayerFullscreen: () => false,
    getDesktopFullscreenCapability: () => null,
    revealDesktopPlayerControls() {},
    syncDesktopPlaybackTools() {}
  });
  assert.equal(await toggle.call(ctx), false);
  ctx.getDesktopFullscreenCapability = () => "video";
  ctx.getDesktopPlaybackVideo = () => ({ webkitEnterFullscreen: () => entered++ });
  assert.equal(await toggle.call(ctx), true);
  assert.equal(entered, 1);
});
test("season dropdown changes the season and selects its first episode", () => {
  let renders = 0;
  const ctx = {
    getEpisodePanelSeasons: () => [1, 2, 3],
    getEpisodePanelEntries: () => [{ index: 10 }],
    renderEpisodePanel: () => renders++
  };
  const run = method("selectEpisodePanelSeason(season)").selectEpisodePanelSeason;
  assert.equal(run.call(ctx, 2), true);
  assert.equal(ctx.episodePanelSeason, 2);
  assert.equal(ctx.episodePanelSeasonIndex, 1);
  assert.equal(ctx.episodePanelIndex, 10);
  assert.equal(renders, 1);
  assert.equal(run.call(ctx, 7), false);
  assert.equal(renders, 1);
});

test("unmute retains the actual nonzero volume after an external mute, despite stale last volume", () => {
  const video = { volume: 0.35, muted: true };
  const ctx = {
    desktopLastAudibleVolume: 1,
    getDesktopPlaybackVideo: () => video,
    syncDesktopPlaybackTools() {}
  };
  const run = method("toggleDesktopMute()", {
    clamp: (x, a, b) => Math.max(a, Math.min(b, x))
  }).toggleDesktopMute;
  run.call(ctx);
  assert.equal(video.muted, false);
  assert.equal(video.volume, 0.35);
  run.call(ctx);
  assert.equal(video.muted, true);
  assert.equal(ctx.desktopLastAudibleVolume, 0.35);
  video.volume = 0;
  run.call(ctx);
  assert.equal(video.volume, 0.35);
  assert.equal(video.muted, false);
});

test("episode source dropdown filters the existing list and rejects unavailable addons", () => {
  let renders = 0,
    focuses = 0;
  const streams = [{ addonName: "AIOStreams" }, { addonName: "Torrentio" }];
  const ctx = {
    getEpisodePanelStreamFilters: () => ["all", "AIOStreams", "Torrentio"],
    renderEpisodePanel: () => renders++,
    uiRefs: { root: { querySelector: () => ({ focus: () => focuses++ }) } },
    episodePanelStreams: streams,
    filterPlayerStreamList: (s) => s
  };
  const select = method("selectEpisodePanelSource(source)").selectEpisodePanelSource;
  const filtered = method("getFilteredEpisodePanelStreams()").getFilteredEpisodePanelStreams;
  assert.equal(select.call(ctx, "AIOStreams"), true);
  assert.deepEqual(filtered.call(ctx), [streams[0]]);
  assert.equal(focuses, 1);
  assert.equal(select.call(ctx, "unknown"), false);
  assert.equal(renders, 1);
  select.call(ctx, "all");
  assert.deepEqual(filtered.call(ctx), streams);
});

test("drawer identity uses the current episode at root and selected episode for nested streams", () => {
  const ctx = {
    params: { itemType: "series" },
    pauseOverlayMeta: { title: "Silo", logoUrl: "logo.png", episodeTitle: "Solo" },
    episodes: [],
    resolvePauseOverlayEpisodeEntry: () => ({ season: 2, episode: 3, title: "Solo" })
  };
  const run = method("getPlayerDrawerIdentity(episode = null)", {
    normalizeItemType: (v) => v
  }).getPlayerDrawerIdentity;
  assert.deepEqual(run.call(ctx), { title: "Silo", logo: "logo.png", subtitle: "S2 E3 • Solo" });
  assert.equal(
    run.call(ctx, { season: 2, episode: 4, title: "The Harmonium" }).subtitle,
    "S2 E4 • The Harmonium"
  );
});

test("movie drawer subtitle uses genre and year rather than episode or runtime", () => {
  const ctx = {
    params: { itemType: "movie", playerGenres: ["Drama", "Adventure"] },
    pauseOverlayMeta: { title: "Film", releaseYear: "2026" }
  };
  const run = method("getPlayerDrawerIdentity(episode = null)", {
    normalizeItemType: (v) => v
  }).getPlayerDrawerIdentity;
  assert.equal(run.call(ctx).subtitle, "Drama, Adventure • 2026");
});

test("More Actions buttons, icons and panel padding bypass video gestures above the timeline", () => {
  const run = method("isDesktopVideoAreaClick(target, event = null)", {
    Environment: { isBrowser: () => true }
  }).isDesktopVideoAreaClick;
  const panel = {};
  const ctx = {
    container: { contains: () => true },
    isExternalFrameMode: () => false,
    controlsVisible: true,
    uiRefs: { progressShell: { getBoundingClientRect: () => ({ top: 726 }) } }
  };
  for (const kind of ["mute button", "speed text", "aspect icon", "empty panel padding"]) {
    const target = {
      closest: (selector) =>
        selector.split(", ").includes(".player-mobile-more-panel") ? panel : null
    };
    assert.equal(run.call(ctx, target, { clientY: 670 }), false, kind);
    ctx.controlsVisible = false;
    assert.equal(run.call(ctx, target, { clientY: 670 }), false, kind + " after controls hide");
    ctx.controlsVisible = true;
  }
  assert.equal(
    run.call(ctx, { closest: () => null }, { clientY: 400 }),
    true,
    "video still accepts gestures"
  );
});
