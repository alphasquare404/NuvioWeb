import { playerLocalRect, playerLocalPoint } from "./browserPlayerOrientation.js";
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const source = readFileSync(new URL("./playerScreen.js", import.meta.url), "utf8");
function method(signature, deps = {}) {
  deps = { playerLocalRect, playerLocalPoint, ...deps };
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
test("frame preparation budget is 18 seconds and playback buffering budget is 9 seconds", () => {
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
    getComputedStyle: () => ({ paddingTop: "16px", paddingBottom: "16px" })
  }).fitPauseOverlay;
  run.call({ uiRefs: { pauseOverlay: overlay }, pauseOverlayVisible: true });
  assert.equal(content.style.transform, `scale(${358 / 600})`);
  assert.equal(content.style.top, "16px");
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
    document,
    isAppInstalled: () => false
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

test("aspect changes keep More Actions open for repeated choices", () => {
  const run = method("performControlAction(action)", {
    Environment: { isBrowser: () => true }
  }).performControlAction;
  let cycles = 0;
  const ctx = {
    moreActionsVisible: true,
    isCompactBrowserPlayerToolbar: () => true,
    renderControlButtons() {},
    cycleAspectMode: () => cycles++
  };
  for (let i = 0; i < 3; i++) {
    run.call(ctx, "aspect");
    assert.equal(ctx.moreActionsVisible, true);
    assert.equal(cycles, i + 1);
  }
});

test("outside More Actions dismisses the panel without starting video gestures", () => {
  class Element {}
  const inside = new Element();
  const outside = new Element();
  const panel = new Element();
  panel.contains = (target) => target === inside;
  let renders = 0;
  let reveals = 0;
  const ctx = {
    moreActionsVisible: true,
    isCompactBrowserPlayerToolbar: () => true,
    isExternalFrameMode: () => false,
    container: { contains: () => true },
    uiRefs: { root: { querySelector: () => panel } },
    renderControlButtons: () => renders++,
    updateModalBackdrop() {},
    revealDesktopPlayerControls: () => reveals++
  };
  const dismiss = method("dismissDesktopPlayerPanelFromPointer(target)", {
    Environment: { isBrowser: () => true },
    Element
  }).dismissDesktopPlayerPanelFromPointer;
  const videoArea = method("isDesktopVideoAreaClick(target, event = null)", {
    Environment: { isBrowser: () => true }
  }).isDesktopVideoAreaClick;
  assert.equal(videoArea.call(ctx, outside, { clientY: 100 }), false);
  assert.equal(dismiss.call(ctx, inside), false);
  assert.equal(ctx.moreActionsVisible, true);
  assert.equal(dismiss.call(ctx, outside), true);
  assert.equal(ctx.moreActionsVisible, false);
  assert.equal(renders, 1);
  assert.equal(reveals, 1);
});

test("installed PWA hides fullscreen even when the browser exposes the API", () => {
  const ctx = { container: { requestFullscreen() {} } };
  const run = method("getDesktopFullscreenCapability()", {
    Environment: { isBrowser: () => true },
    isAppInstalled: () => true
  }).getDesktopFullscreenCapability;
  assert.equal(run.call(ctx), null);
});

test("track popover height stops below Back and above the toolbar", () => {
  const dialog = { style: {}, getBoundingClientRect: () => ({ width: 360 }) };
  const ctx = {
    subtitleDialogVisible: true,
    uiRefs: {
      subtitleDialog: dialog,
      root: {
        classList: { contains: () => false },
        style: { setProperty() {} },
        getBoundingClientRect: () => ({ top: 0, left: 0, bottom: 844, width: 390 }),
        querySelector: (selector) => {
          if (selector === ".player-controls-row")
            return { getBoundingClientRect: () => ({ top: 730 }) };
          if (selector === "[data-player-desktop-back]")
            return { getBoundingClientRect: () => ({ bottom: 103 }) };
          return { getBoundingClientRect: () => ({ left: 88 }) };
        }
      }
    }
  };
  const run = method("positionTrackDialogs()", {
    Environment: { isBrowser: () => true },
    clamp: (x, low, high) => Math.max(low, Math.min(high, x))
  }).positionTrackDialogs;
  run.call(ctx);
  assert.equal(dialog.style.bottom, "124px");
  assert.equal(dialog.style.maxHeight, "607px");
  assert.equal(dialog.style.left, "18px");
});

test("native cue delay follows demuxer timing updates without accumulating its own offset", () => {
  const run = method("applySubtitleCueDelay(cue, snapshot, delayMs = 0)").applySubtitleCueDelay;
  const cue = { startTime: 2, endTime: 5 };
  const snapshot = { startTime: 2, endTime: 5, appliedStartTime: 2, appliedEndTime: 5 };
  run(cue, snapshot, 1000);
  assert.deepEqual(cue, { startTime: 3, endTime: 6 });
  run(cue, snapshot, 1000);
  assert.deepEqual(cue, { startTime: 3, endTime: 6 });
  cue.endTime = 8;
  run(cue, snapshot, 1000);
  assert.equal(cue.endTime, 9);
  run(cue, snapshot, 0);
  assert.deepEqual(cue, { startTime: 2, endTime: 8 });
});

test("read-only software volume is detected instead of drawing a fictional saved level", () => {
  const video = {
    muted: false,
    get volume() {
      return 1;
    },
    set volume(_) {}
  };
  let message = "";
  const ctx = {
    getDesktopPlaybackVideo: () => video,
    syncDesktopPlaybackTools() {},
    showAspectToast: (text) => (message = text)
  };
  const run = method("setDesktopVolume(value)", {
    clamp: (v, min, max) => Math.max(min, Math.min(max, v))
  }).setDesktopVolume;
  assert.equal(run.call(ctx, 0.35), false);
  assert.equal(ctx.desktopVolumeReadOnly, true);
  assert.match(message, /device volume/);
  assert.equal(video.muted, false);
});

test("auto-next replaces player and retains its original Back destination", async () => {
  let navigation, backAction;
  let countdowns = 0;
  const stages = [];
  const run = method("async playNextEpisode({ userInitiated = false } = {})", {
    StartupLoadingOverlay: {
      begin: (_meta, stage) => stages.push(stage),
      setBackHandler: (handler) => {
        backAction = handler;
      }
    },
    PlayerSettingsStore: {
      get: () => ({ streamAutoPlayMode: "FIRST_STREAM", autoplayNextEpisode: true })
    },
    normalizeItemType: (value) => value,
    playerStreamProbeKey: (stream) => stream.id,
    streamDirectPlaybackUrl: (stream) => stream.url,
    PlayerController: { flushCurrentProgress: async () => {}, pushProgressIfDue() {} },
    Router: {
      navigate: async (...args) => {
        navigation = args;
      }
    }
  }).playNextEpisode;
  const ctx = {
    params: {
      itemId: "silo",
      itemType: "series",
      handoffReturnRoute: "detail",
      streamRouteParams: { returnToSearchOnBack: true }
    },
    episodes: [{ id: "s2e4", season: 2, episode: 4 }],
    pauseOverlayMeta: {
      cast: [{ name: "Actor", character: "Pilot", photo: "https://image.test/actor.jpg" }]
    },
    resolveNextEpisodeInfo: () => ({ videoId: "s2e4", season: 2, episode: 4, hasAired: true }),
    resolveNextEpisodeStreamByAutoPlayPolicy: async () => ({
      streamItems: [{ id: "one", url: "https://example.test/video" }],
      selectedStream: { id: "one", url: "https://example.test/video" }
    }),
    isNextEpisodeLaunchActive: () => true,
    runNextEpisodeCountdown: async () => {
      countdowns++;
      return true;
    },
    shouldReturnToStreamOnBack: () => false,
    getPlaybackSourceContext: () => ({}),
    getPlayerStreamProbe: () => null,
    getLoadingOverlayMeta: () => ({ internalPlayer: true }),
    renderNextEpisodeCard() {},
    updateLoadingVisibility() {},
    refreshLoadingOverlayPresentation() {},
    setControlsVisible() {}
  };
  assert.equal(await run.call(ctx), true);
  assert.equal(countdowns, 1, "automatic next retains its countdown");
  assert.deepEqual(navigation[1].castItems, ctx.pauseOverlayMeta.cast);
  assert.deepEqual(stages, ["finding"]);
  assert.equal(typeof backAction, "function");
  assert.equal(navigation[1].prepareSelectedSource, true);
  assert.equal(navigation[0], "player");
  assert.equal(navigation[1].handoffReturnRoute, "detail");
  assert.equal(navigation[1].returnToStreamOnBack, false);
  assert.equal(navigation[2].replaceHistory, true);
  assert.deepEqual(navigation[1].streamRouteParams, { returnToSearchOnBack: true });
  ctx.nextEpisodeLaunching = false;
  ctx.loadingVisible = false;
  let firstCardRender;
  ctx.renderNextEpisodeCard = () => {
    firstCardRender ??= ctx.loadingVisible;
  };
  assert.equal(await run.call(ctx, { userInitiated: true }), true);
  assert.equal(countdowns, 1, "a clicked Next must not run another countdown");
  assert.equal(firstCardRender, true, "loading hides the automatic card before its first render");
  assert.deepEqual(navigation[1].castItems, ctx.pauseOverlayMeta.cast);
});

test("touch subtitle selection keeps rail position and does not paint TV focus", () => {
  const rails = [{ scrollTop: 0 }, { scrollTop: 140 }, { scrollTop: 30 }];
  const dialog = {
    classList: { toggle() {} },
    querySelector: () => null,
    querySelectorAll: () => rails,
    innerHTML: ""
  };
  const ctx = {
    uiRefs: { subtitleDialog: dialog },
    subtitleDialogVisible: true,
    subtitleLanguageRailIndex: 0,
    subtitleOptionRailIndex: 1,
    subtitleStyleRailIndex: 0,
    subtitleFocusedRail: "options",
    hasActiveSubtitlePointerScrollTransaction: () => false,
    getSubtitleLanguageRailItems: () => [{ key: "en", label: "English", count: 2, selected: true }],
    getSubtitleOptionsForLanguage: () => [
      { title: "English", selected: true },
      { title: "English Forced", selected: false }
    ],
    getSubtitleStyleControls: () => [],
    scrollSubtitleDialogIntoView() {
      throw Error("unexpected TV scroll");
    },
    scheduleSubtitleDialogScrollIntoView() {
      throw Error("unexpected delayed TV scroll");
    }
  };
  const run = method("renderSubtitleDialog()", {
    Environment: { isBrowser: () => true },
    SUBTITLE_LANGUAGE_OFF_KEY: "off",
    clamp: (v, min, max) => Math.max(min, Math.min(max, v)),
    t: (_key, _args, fallback) => fallback,
    escapeHtml: (value) => value,
    escapeAttribute: (value) => value
  }).renderSubtitleDialog;
  run.call(ctx);
  assert.doesNotMatch(dialog.innerHTML, /class="[^"]* focused/);
  assert.match(dialog.innerHTML, /selected/);
  assert.deepEqual(
    rails.map((r) => r.scrollTop),
    [0, 140, 30]
  );
});

test("zero subtitle delay does not rewrite native cue timing on every cuechange", () => {
  let writes = 0;
  const cue = {
    get startTime() {
      return 2;
    },
    get endTime() {
      return 5;
    },
    set startTime(_) {
      writes++;
    },
    set endTime(_) {
      writes++;
    }
  };
  const snapshot = { startTime: 2, endTime: 5, appliedStartTime: 2, appliedEndTime: 5 };
  method("applySubtitleCueDelay(cue, snapshot, delayMs = 0)").applySubtitleCueDelay(
    cue,
    snapshot,
    0
  );
  assert.equal(writes, 0);
});

test("touch activation through the keyboard handler does not enable keyboard focus", () => {
  const run = method("handleSubtitleDialogKey(event)", {
    SUBTITLE_LANGUAGE_OFF_KEY: "off",
    isSelectKeyCode: (code) => code === 13
  }).handleSubtitleDialogKey;
  let selected = null;
  const entry = { trackIndex: 1 };
  const ctx = {
    subtitleLanguageRailIndex: 0,
    subtitleOptionRailIndex: 0,
    subtitleStyleRailIndex: 0,
    subtitleFocusedRail: "options",
    getSubtitleLanguageRailItems: () => [{ key: "en" }],
    getSubtitleOptionsForLanguage: () => [{ entry }],
    getSubtitleStyleControls: () => [],
    applySubtitleEntry: (item) => {
      selected = item;
    }
  };
  run.call(ctx, { keyCode: 13, fromPointer: true });
  assert.equal(ctx.subtitleKeyboardNavigation, false);
  assert.equal(selected, entry);
  run.call(ctx, { keyCode: 13 });
  assert.equal(ctx.subtitleKeyboardNavigation, true);
});

test("own mute restores saved volume even if the browser resets volume while muted", () => {
  let muted = false;
  const video = {
    volume: 0.35,
    get muted() {
      return muted;
    },
    set muted(value) {
      muted = value;
      this.volume = 1;
    }
  };
  const run = method("toggleDesktopMute()", {
    clamp: (v, a, b) => Math.max(a, Math.min(b, v))
  }).toggleDesktopMute;
  const ctx = { getDesktopPlaybackVideo: () => video, syncDesktopPlaybackTools() {} };
  run.call(ctx);
  assert.equal(video.muted, true);
  assert.equal(video.volume, 1);
  run.call(ctx);
  assert.equal(video.muted, false);
  assert.equal(video.volume, 0.35);
  assert.equal(ctx.desktopMuteRestoreVolume, null);
});

test("browser cue layout remains browser-owned even when controls need subtitle lift", () => {
  const run = method("applySubtitleCueVerticalOffset(cue, snapshot, offset)", {
    Environment: { isBrowser: () => true }
  }).applySubtitleCueVerticalOffset;
  const original = {
    line: 90,
    snapToLines: false,
    position: 50,
    positionAlign: "center",
    align: "center"
  };
  const cue = new Proxy(
    { ...original },
    {
      set() {
        throw Error("native cue layout was modified");
      }
    }
  );
  run.call({}, cue, { ...original }, 5);
  assert.deepEqual(cue, original);
});

test("native metadata does not appear as Unknown subtitle and native indices are preserved", () => {
  const tracks = [
    { kind: "metadata", mode: "hidden" },
    { kind: "subtitles", language: "en", mode: "showing" }
  ];
  const run = method("getSubtitleEntries(tab = this.subtitleDialogTab)", {
    PlayerController: {},
    t: (_key, _vars, text) => text,
    formatSubtitleTrackDisplay: () => ({ label: "English", language: "en", languageKey: "en" }),
    isForcedSubtitleTrack: () => false
  }).getSubtitleEntries;
  const ctx = {
    getTextTracks: () => tracks,
    resolveBuiltInSubtitleBoundary: () => 2,
    isCurrentSourceAdaptiveManifest: () => false,
    isSubtitleOffEntrySelected: () => false,
    manifestSubtitleTracks: [],
    selectedSubtitleTrackIndex: 1
  };
  const entries = run.call(ctx, "builtIn");
  assert.equal(entries.length, 2);
  assert.equal(entries[1].trackIndex, 1);
  assert.equal(entries[1].track, tracks[1]);
  const sync = method("syncTrackState()", { PlayerController: {} }).syncTrackState;
  Object.assign(ctx, {
    getAudioTracks: () => [],
    externalTrackNodes: [],
    invalidateTrackDialogCaches() {}
  });
  sync.call(ctx);
  assert.equal(ctx.selectedSubtitleTrackIndex, 1);
  tracks[1].mode = "hidden";
  sync.call(ctx);
  assert.equal(
    ctx.selectedSubtitleTrackIndex,
    1,
    "temporary rendering refresh must not select metadata"
  );
});

test("a pending native repaint cannot reenable the previously selected subtitle", () => {
  const callbacks = [];
  const run = method("refreshSubtitleTrackRendering()", {
    requestAnimationFrame: (fn) => callbacks.push(fn)
  }).refreshSubtitleTrackRendering;
  const track = { mode: "showing" };
  const ctx = { subtitleSelectionToken: 1, getSubtitleCueTrackList: () => [track] };
  run.call(ctx);
  assert.equal(track.mode, "hidden");
  ctx.subtitleSelectionToken = 2;
  track.mode = "disabled";
  callbacks.shift()();
  assert.equal(track.mode, "disabled");
  track.mode = "showing";
  run.call(ctx);
  callbacks.shift()();
  assert.equal(track.mode, "showing");
});

test("addon identity cannot also appear as selected Built in after a boundary race", () => {
  const native = { kind: "subtitles", language: "en", mode: "disabled" };
  const mounted = { kind: "subtitles", language: "en", mode: "showing" };
  const tracks = [native, mounted];
  const subtitle = { id: "aio-en", url: "https://subtitles.test/en.vtt", lang: "en" };
  const selectionId = (track) => JSON.stringify([track.id, track.url, track.lang]);
  const ctx = {
    getTextTracks: () => tracks,
    resolveBuiltInSubtitleBoundary: () => 2,
    externalTrackNodes: [{ track: mounted }],
    subtitles: [subtitle],
    isCurrentSourceAdaptiveManifest: () => false,
    isSubtitleOffEntrySelected: () => false,
    manifestSubtitleTracks: [],
    selectedSubtitleTrackIndex: 1,
    selectedAddonSubtitleId: selectionId(subtitle)
  };
  const run = method("getSubtitleEntries(tab = this.subtitleDialogTab)", {
    PlayerController: {},
    addonSubtitleSelectionId: selectionId,
    t: (_k, _v, text) => text,
    formatSubtitleTrackDisplay: () => ({ label: "English", language: "en", languageKey: "en" }),
    isForcedSubtitleTrack: () => false,
    isForcedAddonSubtitle: () => false
  }).getSubtitleEntries;
  const builtin = run.call(ctx, "builtIn");
  const addon = run.call(ctx, "addons");
  assert.equal(
    builtin.some((e) => e.track === mounted),
    false,
    "mounted addon is never Built in even if the numeric boundary is stale"
  );
  assert.equal([...builtin, ...addon].filter((e) => e.selected).length, 1);
  assert.equal(addon[0].selected, true);
});

test("addon selection suppresses a stale selected adaptive builtin track", () => {
  const ctx = {
    getTextTracks: () => [],
    resolveBuiltInSubtitleBoundary: () => 0,
    externalTrackNodes: [],
    isCurrentSourceAdaptiveManifest: () => false,
    isSubtitleOffEntrySelected: () => false,
    selectedAddonSubtitleId: "aio-en"
  };
  const run = method("getSubtitleEntries(tab = this.subtitleDialogTab)", {
    PlayerController: {
      getHlsSubtitleTracks: () => [{ lang: "en" }],
      getSelectedHlsSubtitleTrackIndex: () => 0
    },
    t: (_k, _v, text) => text,
    formatSubtitleTrackDisplay: () => ({ label: "English", language: "en", languageKey: "en" }),
    isForcedSubtitleTrack: () => false
  }).getSubtitleEntries;
  assert.equal(
    run.call(ctx, "builtIn").some((e) => e.selected),
    false
  );
});

test("a delayed volume rejection hides an unsupported slider; an accepted write keeps it", () => {
  const frames = [];
  const run = method("confirmDesktopVolumeWrite(video, volume)", {
    requestAnimationFrame: (fn) => frames.push(fn)
  }).confirmDesktopVolumeWrite;
  const video = { volume: 0.35 };
  let synced = 0;
  const ctx = {
    desktopVolumeReadOnly: false,
    getDesktopPlaybackVideo: () => video,
    showAspectToast() {},
    syncDesktopPlaybackTools: () => synced++
  };
  run.call(ctx, video, 0.35);
  frames.shift()();
  assert.equal(ctx.desktopVolumeReadOnly, false);
  run.call(ctx, video, 0.35);
  video.volume = 1;
  frames.shift()();
  assert.equal(ctx.desktopVolumeReadOnly, true);
  assert.equal(synced, 1);
});

test("a newer volume request cancels checking the older request", () => {
  const frames = [];
  const run = method("confirmDesktopVolumeWrite(video, volume)", {
    requestAnimationFrame: (fn) => frames.push(fn)
  }).confirmDesktopVolumeWrite;
  const video = { volume: 0.35 };
  const ctx = {
    desktopVolumeReadOnly: false,
    getDesktopPlaybackVideo: () => video,
    showAspectToast() {
      throw Error("stale volume write");
    },
    syncDesktopPlaybackTools() {}
  };
  run.call(ctx, video, 0.35);
  video.volume = 0.6;
  run.call(ctx, video, 0.6);
  frames.forEach((fn) => fn());
  assert.equal(ctx.desktopVolumeReadOnly, false);
});

test("native tracks remain listed when Safari appends them after an addon", () => {
  const addon = { kind: "subtitles", mode: "showing" },
    builtin = { kind: "subtitles", mode: "disabled" };
  const run = method("getSubtitleEntries(tab = this.subtitleDialogTab)", {
    PlayerController: {},
    t: (_k, _v, text) => text,
    formatSubtitleTrackDisplay: () => ({ label: "English" }),
    isForcedSubtitleTrack: () => false
  }).getSubtitleEntries;
  const ctx = {
    getTextTracks: () => [addon, builtin],
    resolveBuiltInSubtitleBoundary: () => 0,
    externalTrackNodes: [{ track: addon }],
    isCurrentSourceAdaptiveManifest: () => false,
    isSubtitleOffEntrySelected: () => false,
    selectedAddonSubtitleId: "aio",
    manifestSubtitleTracks: []
  };
  const entries = run.call(ctx, "builtIn");
  assert.equal(entries.length, 2);
  assert.equal(entries[1].track, builtin);
  assert.equal(entries[1].trackIndex, 1);
  assert.equal(entries[1].selected, false);
});

test("native subtitle lift moves its container only when the seekbar overlaps the video", () => {
  let offset;
  const video = {
    style: { setProperty: (_k, v) => (offset = v) },
    getBoundingClientRect: () => ({ bottom: 500, height: 300 })
  };
  let progressTop = 480;
  const ctx = {
    controlsVisible: true,
    getDesktopPlaybackVideo: () => video,
    uiRefs: { progressShell: { getBoundingClientRect: () => ({ top: progressTop }) } },
    subtitleStyleSettings: { fontSize: 100 }
  };
  const run = method("updateBrowserNativeSubtitleOffset()", {
    Environment: { isBrowser: () => true },
    splitSubtitleVerticalOffset: () => ({ lineOffset: 0, residualOffset: 0 })
  }).updateBrowserNativeSubtitleOffset;
  run.call(ctx);
  assert.equal(offset, "-32px");
  progressTop = 600;
  run.call(ctx);
  assert.equal(offset, "0px");
  progressTop = 480;
  ctx.controlsVisible = false;
  run.call(ctx);
  assert.equal(offset, "0px");
});

test("read-only volume is detected before playback without assuming an iPhone user agent", () => {
  const run = method("detectDesktopSoftwareVolume()").detectDesktopSoftwareVolume;
  const readonly = {
    paused: true,
    muted: false,
    get volume() {
      return 1;
    },
    set volume(_) {}
  };
  const ctx = { getDesktopPlaybackVideo: () => readonly };
  run.call(ctx);
  assert.equal(ctx.desktopVolumeReadOnly, true);
  const writable = { paused: true, muted: false, volume: 0.35 };
  ctx.getDesktopPlaybackVideo = () => writable;
  run.call(ctx);
  assert.equal(ctx.desktopVolumeReadOnly, false);
  assert.equal(writable.volume, 0.35);
  assert.equal(writable.muted, false);
});

test("showing controls updates native container offset without rewriting native cue layout", () => {
  let updates = 0;
  const ctx = {
    controlsVisible: true,
    uiRefs: { root: { classList: { toggle() {} }, querySelector: () => null } },
    isExternalFrameMode: () => false,
    updateBrowserNativeSubtitleOffset: () => updates++,
    syncPlayerActionOverlayOffset() {}
  };
  const run = method("syncPlayerOverlayLayoutState()").syncPlayerOverlayLayoutState;
  run.call(ctx);
  ctx.controlsVisible = false;
  run.call(ctx);
  assert.equal(updates, 2);
});

test("native subtitle diagnostics are opt-in, bounded, and omit subtitle content and media URLs", () => {
  const sent = [];
  const flag = { __NUVIO_SUBTITLE_DEBUG__: false };
  const run = method("reportNativeSubtitleLayout(track)", {
    Environment: { isBrowser: () => true },
    globalThis: flag,
    fetch: (_url, options) => {
      sent.push(JSON.parse(options.body));
      return Promise.resolve();
    }
  }).reportNativeSubtitleLayout;
  const cue = {
    text: "private dialogue",
    startTime: 1,
    endTime: 2,
    line: "auto",
    position: 50,
    align: "center"
  };
  const track = {
    activeCues: [cue],
    language: "en",
    kind: "subtitles",
    mode: "showing",
    label: "private label"
  };
  const video = {
    src: "https://secret.example/signed",
    getBoundingClientRect: () => ({ x: 0, y: 0, width: 844, height: 390 })
  };
  const ctx = {
    getSubtitleCueArray: (items) => items || [],
    getDesktopPlaybackVideo: () => video,
    getTextTracks: () => [track],
    externalTrackNodes: []
  };
  run.call(ctx, track);
  assert.equal(sent.length, 0);
  flag.__NUVIO_SUBTITLE_DEBUG__ = true;
  for (let i = 0; i < 10; i++) {
    ctx.subtitleSelectionToken = i;
    run.call(ctx, track);
    run.call(ctx, track);
  }
  assert.equal(sent.length, 6);
  const serialized = JSON.stringify(sent);
  assert.equal(serialized.includes("private"), false);
  assert.equal(serialized.includes("secret.example"), false);
  assert.equal(JSON.parse(sent[0].stack).cues[0].position, 50);
});

test("Safari forced-kind tracks from the device report remain in Built in after addon selection", () => {
  const native = [
    { kind: "subtitles", language: "en", mode: "disabled" },
    { kind: "forced", language: "en", mode: "disabled" },
    { kind: "subtitles", language: "en", mode: "disabled" },
    { kind: "forced", language: "en", mode: "disabled" }
  ];
  const addon = { kind: "subtitles", language: "en", mode: "showing" };
  const run = method("getSubtitleEntries(tab = this.subtitleDialogTab)", {
    PlayerController: {},
    t: (_k, _v, text) => text,
    formatSubtitleTrackDisplay: () => ({ label: "English" }),
    isForcedSubtitleTrack: (track) => track.kind === "forced"
  }).getSubtitleEntries;
  const ctx = {
    getTextTracks: () => [addon, ...native],
    externalTrackNodes: [{ track: addon }],
    isCurrentSourceAdaptiveManifest: () => false,
    isSubtitleOffEntrySelected: () => false,
    selectedAddonSubtitleId: "aio",
    manifestSubtitleTracks: []
  };
  const entries = run.call(ctx, "builtIn").filter((entry) => entry.track);
  assert.equal(entries.length, 4);
  assert.equal(entries.filter((entry) => entry.isForced).length, 2);
  assert.deepEqual(
    entries.map((entry) => entry.trackIndex),
    [1, 2, 3, 4]
  );
  assert.equal(
    entries.some((entry) => entry.selected),
    false
  );
});

test("browser native subtitle layout applies to every title and excludes addon tracks and metadata", () => {
  const run = method("isBrowserNativeSubtitleTrack(track)", {
    Environment: { isBrowser: () => true }
  }).isBrowserNativeSubtitleTrack;
  const track = { kind: "subtitles" };
  const ctx = { params: { videoId: "any-other-movie" }, externalTrackNodes: [] };
  assert.equal(run.call(ctx, track), true);
  ctx.params.videoId = "another-show:7:2";
  assert.equal(run.call(ctx, track), true);
  ctx.externalTrackNodes.push({ track });
  assert.equal(run.call(ctx, track), false);
  ctx.externalTrackNodes = [];
  assert.equal(run.call(ctx, { kind: "metadata" }), false);
  const tvRun = method("isBrowserNativeSubtitleTrack(track)", {
    Environment: { isBrowser: () => false }
  }).isBrowserNativeSubtitleTrack;
  assert.equal(tvRun.call(ctx, track), false);
});

test("native centering changes active cue layout without touching timing and tolerates readonly fields", () => {
  const run = method("applyBrowserNativeSubtitleLayout(track)").applyBrowserNativeSubtitleLayout;
  const cue = {
    snapToLines: false,
    line: "auto",
    lineAlign: "start",
    position: "auto",
    positionAlign: "auto",
    align: "center"
  };
  for (const key of ["startTime", "endTime"])
    Object.defineProperty(cue, key, {
      get: () => (key === "startTime" ? 19.186 : 3269.69),
      set: () => {
        throw Error("timing must not be written");
      }
    });
  Object.defineProperty(cue, "lineAlign", {
    get: () => "start",
    set: () => {
      throw Error("readonly");
    }
  });
  const ctx = { isBrowserNativeSubtitleTrack: () => true, getSubtitleCueArray: (x) => x || [] };
  assert.equal(run.call(ctx, { activeCues: [cue] }), true);
  assert.equal(cue.position, 50);
  assert.equal(cue.positionAlign, "center");
  assert.equal(cue.line, 95);
  assert.equal(cue.snapToLines, false);
  assert.equal(cue.endTime, 3269.69);
  ctx.isBrowserNativeSubtitleTrack = () => false;
  cue.position = "auto";
  assert.equal(run.call(ctx, { activeCues: [cue] }), false);
  assert.equal(cue.position, "auto");
});

test("native subtitle presentation bypasses native cue timing writes in the style refresh pipeline", () => {
  const run = method("syncSubtitleCueStylesForTrack(track)", {
    normalizeSubtitleVerticalOffset: (x) => x || 0
  }).syncSubtitleCueStylesForTrack;
  let timingWrites = 0;
  const cue = {};
  const ctx = {
    applyBrowserNativeSubtitleLayout: () => true,
    sanitizeSubtitleCuesForTrack: () => false,
    getSubtitleCueArray: (x) => x || [],
    getSubtitleCueSnapshot: () => ({}),
    applySubtitleCueDelay: () => timingWrites++,
    applySubtitleCueVerticalOffset() {}
  };
  run.call(ctx, { cues: [cue], activeCues: [cue] });
  assert.equal(timingWrites, 0);
  ctx.applyBrowserNativeSubtitleLayout = () => false;
  run.call(ctx, { cues: [cue], activeCues: [cue] });
  assert.equal(timingWrites, 1);
});

test("rotated native subtitle overlay follows current cues, settings and local video bounds in both rotation directions", () => {
  const run = method("syncRotatedNativeSubtitles()", {
    Environment: { isBrowser: () => true }
  }).syncRotatedNativeSubtitles;
  const classes = new Map();
  const node = {
    firstElementChild: { textContent: "", style: {} },
    style: {},
    classList: { toggle: (k, v) => classes.set(k, v) },
    setAttribute() {}
  };
  let nativeOffset = "0px";
  const videoClasses = new Map();
  const video = {
    classList: { toggle: (k, v) => videoClasses.set(k, v) },
    style: { getPropertyValue: () => nativeOffset },
    getBoundingClientRect: () => ({
      left: 49,
      right: 365,
      top: 0,
      bottom: 754,
      width: 316,
      height: 754
    })
  };
  const track = { mode: "showing", activeCues: [{ text: "first dialogue" }] };
  const ctx = {
    getDesktopPlaybackVideo: () => video,
    uiRefs: { nativeSubtitles: node },
    browserOrientation: { rotated: true, rotation: 90, width: 754, height: 414 },
    getTextTracks: () => [track],
    isBrowserNativeSubtitleTrack: () => true,
    getSubtitleCueArray: (x) => x || [],
    parseSubtitleCueText: (x) => x,
    subtitleStyleSettings: { fontSize: 120 }
  };
  for (const rotation of [90, -90]) {
    ctx.browserOrientation.rotation = rotation;
    run.call(ctx);
    assert.equal(node.style.left, "0px");
    assert.equal(node.style.top, "49px");
    assert.equal(node.style.width, "754px");
    assert.equal(node.style.height, "316px");
    assert.ok(Math.abs(parseFloat(node.firstElementChild.style.bottom) - 15.8) < 0.001);
    assert.equal(node.firstElementChild.textContent, "first dialogue");
  }
  nativeOffset = "-53px";
  track.activeCues = [{ text: "next dialogue" }];
  run.call(ctx);
  assert.equal(node.firstElementChild.textContent, "next dialogue");
  assert.ok(Math.abs(parseFloat(node.firstElementChild.style.bottom) - 68.8) < 0.001);
  ctx.subtitleStyleSettings.fontSize = 160;
  run.call(ctx);
  assert.ok(parseFloat(node.style.fontSize) > 20);
  track.activeCues = [];
  run.call(ctx);
  assert.equal(node.firstElementChild.textContent, "");
  assert.equal(videoClasses.get("player-native-subtitles-mirrored"), true);
  for (const condition of ["portrait", "fullscreen", "addon", "off", "unsupportedTrack"]) {
    ctx.browserOrientation.rotated = condition !== "portrait";
    video.webkitDisplayingFullscreen = condition === "fullscreen";
    ctx.selectedAddonSubtitleId = condition === "addon" ? "addon-id" : null;
    track.mode = condition === "off" ? "disabled" : "showing";
    ctx.isBrowserNativeSubtitleTrack = () => condition !== "unsupportedTrack";
    run.call(ctx);
    assert.equal(videoClasses.get("player-native-subtitles-mirrored"), false, condition);
    assert.equal(classes.get("hidden"), true, condition);
    assert.equal(node.firstElementChild.textContent, "", condition);
  }
});

test("manual subtitle menu separates native forced-only choices from full tracks without changing raw selection options", () => {
  const run = method("getSubtitleMenuOptionItems()", {
    Environment: { isBrowser: () => true },
    normalizeTrackLanguageCode: (value) => (value === "eng" ? "en" : value || "")
  }).getSubtitleMenuOptionItems;
  const normal = (id, language = "en") => ({
    id,
    sourceType: "internal",
    isForced: false,
    entry: { track: { kind: "subtitles", language } }
  });
  const forced = (id, language = "en") => ({
    id,
    sourceType: "internal",
    isForced: true,
    entry: { track: { kind: "forced", language } }
  });
  const full = normal("full"),
    sdh = normal("sdh"),
    f1 = forced("f1"),
    f2 = forced("f2", "eng");
  const raw = Object.freeze([full, f1, sdh, f2]);
  const ctx = { collectSubtitleOptionItems: () => raw };
  assert.deepEqual(run.call(ctx), [full, sdh]);
  assert.equal(ctx.collectSubtitleOptionItems(), raw);
  assert.equal(raw.length, 4);
  f1.selected = true;
  assert.deepEqual(run.call(ctx), [full, f1, sdh]);
  f1.selected = false;
  const standalone = forced("only-forced", "ja"),
    unknown = forced("unknown", "");
  const explicitForced = normal("named-forced");
  explicitForced.isForced = true;
  const addon = { ...forced("addon"), sourceType: "addon" };
  const hls = {
    id: "hls",
    sourceType: "internal",
    isForced: true,
    entry: { track: { forced: true }, hlsSubtitleTrackIndex: 1 }
  };
  ctx.collectSubtitleOptionItems = () => [
    full,
    f1,
    standalone,
    unknown,
    explicitForced,
    addon,
    hls
  ];
  assert.deepEqual(run.call(ctx), [full, standalone, unknown, explicitForced, addon, hls]);
  const tvRun = method("getSubtitleMenuOptionItems()", {
    Environment: { isBrowser: () => false }
  }).getSubtitleMenuOptionItems;
  assert.deepEqual(tvRun.call(ctx), ctx.collectSubtitleOptionItems());
});

test("subtitle cards use the manual list while startup still receives all native choices", () => {
  const raw = ["subtitles", "forced", "subtitles", "forced"].map((kind, index) => ({
    id: String(index),
    title: "English",
    secondary: "",
    languageKey: "en",
    sourceType: "internal",
    isForced: kind === "forced",
    entry: { track: { kind, language: "en" }, trackIndex: index }
  }));
  const ctx = {
    collectSubtitleOptionItems: () => raw,
    trackDialogCache: { subtitleOptionsByLanguage: new Map() }
  };
  ctx.getSubtitleMenuOptionItems = method("getSubtitleMenuOptionItems()", {
    Environment: { isBrowser: () => true },
    normalizeTrackLanguageCode: (x) => x
  }).getSubtitleMenuOptionItems;
  const cards = method(
    "getSubtitleOptionsForLanguage(languageKey = this.getSelectedSubtitleLanguageKey())",
    {
      SUBTITLE_LANGUAGE_OFF_KEY: "off",
      I18n: { getLocale: () => "en" }
    }
  ).getSubtitleOptionsForLanguage.call(ctx, "en");
  assert.deepEqual(
    cards.map((x) => x.entry.trackIndex),
    [0, 2]
  );
  assert.equal(ctx.collectSubtitleOptionItems().filter((x) => x.isForced).length, 2);
});

test("general native subtitle presentation preserves requested delay and restores it to zero", () => {
  const cue = { startTime: 10, endTime: 12 };
  const snapshot = { startTime: 10, endTime: 12, appliedStartTime: 10, appliedEndTime: 12 };
  const ctx = {
    applyBrowserNativeSubtitleLayout: () => true,
    sanitizeSubtitleCuesForTrack: () => false,
    getSubtitleCueArray: (x) => x || [],
    getSubtitleCueSnapshot: () => snapshot,
    applySubtitleCueVerticalOffset() {},
    subtitleDelayMs: 2000
  };
  ctx.applySubtitleCueDelay = method(
    "applySubtitleCueDelay(cue, snapshot, delayMs = 0)"
  ).applySubtitleCueDelay;
  const run = method("syncSubtitleCueStylesForTrack(track)", {
    normalizeSubtitleVerticalOffset: (x) => x || 0
  }).syncSubtitleCueStylesForTrack;
  const track = { cues: [cue], activeCues: [cue] };
  run.call(ctx, track);
  assert.equal(cue.startTime, 12);
  assert.equal(cue.endTime, 14);
  ctx.subtitleDelayMs = 0;
  run.call(ctx, track);
  assert.equal(cue.startTime, 10);
  assert.equal(cue.endTime, 12);
  cue.endTime = 15;
  run.call(ctx, track);
  assert.equal(cue.endTime, 15);
});

test("startup timing diagnostics are opt-in, bounded, preserve media state and omit private URLs", () => {
  const flag = { __NUVIO_PLAYBACK_STARTUP_DEBUG__: false, navigator: { standalone: true } };
  const listeners = new Map(),
    sent = [];
  let now = 1000;
  const video = {
    readyState: 0,
    networkState: 2,
    currentTime: 15,
    paused: true,
    addEventListener: (name, callback) => listeners.set(name, callback),
    removeEventListener: (name) => listeners.delete(name)
  };
  const deps = {
    globalThis: flag,
    isAppInstalled: () => true,
    Date: class extends Date {
      static now() {
        return now;
      }
    },
    fetch: (_url, options) => {
      sent.push(JSON.parse(options.body));
      return Promise.resolve();
    }
  };
  const start = method("startPlaybackStartupDiagnostics()", deps).startPlaybackStartupDiagnostics;
  const report = method(
    "reportPlaybackStartupDiagnostics(reason)",
    deps
  ).reportPlaybackStartupDiagnostics;
  const ctx = { getDesktopPlaybackVideo: () => video, reportPlaybackStartupDiagnostics: report };
  start.call(ctx, "https://source.example/private-token/file.mp4");
  assert.equal(listeners.size, 0);
  flag.__NUVIO_PLAYBACK_STARTUP_DEBUG__ = true;
  start.call(ctx, "https://source.example/private-token/file.mp4");
  assert.equal(listeners.size, 9);
  now += 18000;
  report.call(ctx, "startup-stall");
  assert.equal(sent.length, 1);
  assert.equal(JSON.parse(sent[0].stack).elapsedMs, 18000);
  assert.equal(JSON.parse(sent[0].stack).standalone, true);
  now += 5000;
  video.readyState = 1;
  listeners.get("loadedmetadata")({ type: "loadedmetadata" });
  assert.equal(sent.length, 2);
  assert.equal(JSON.parse(sent[1].stack).elapsedMs, 23000);
  for (let i = 0; i < 40; i++) listeners.get("progress")({ type: "progress" });
  assert.equal(
    ctx.playbackStartupDiagnostic.events.filter((e) => e.event === "progress").length,
    1
  );
  for (let i = 0; i < 10; i++) report.call(ctx, "bounded-" + i);
  assert.equal(sent.length, 5);
  assert.equal(JSON.stringify(sent).includes("private-token"), false);
  assert.equal(JSON.stringify(sent).includes("file.mp4"), false);
  assert.equal(video.currentTime, 15);
  assert.equal(video.paused, true);
  const cleanup = ctx.playbackStartupDiagnosticCleanup;
  cleanup();
  assert.equal(listeners.size, 0);
  start.call(ctx, "https://other.example/secret");
  assert.equal(ctx.playbackStartupDiagnostic.events.length, 0);
  now += 90001;
  listeners.get("waiting")({ type: "waiting" });
  assert.equal(listeners.size, 0);
});

test("startup metadata has its own absolute deadline and the observed 27.7 second load receives a fresh frame budget", () => {
  let now = 0;
  const clock = { now: () => now };
  const timeout = method("getPlaybackStallTimeoutMs({ startup = false } = {})", {
    Date: clock
  }).getPlaybackStallTimeoutMs;
  const video = { readyState: 0 };
  const controller = { video, getLastPlaybackErrorCode: () => 0 };
  const note = method("noteStartupReadiness(video)", {
    Date: clock,
    PlayerController: controller
  }).noteStartupReadiness;
  let schedules = 0;
  const ctx = {
    activePlaybackUrl: "https://cdn.test/film.mp4",
    startupReadiness: { url: "https://cdn.test/film.mp4", video, startedAt: 0, metadataAt: null },
    isStartupErrorVisible: () => false,
    schedulePlaybackStallGuard: () => schedules++
  };
  assert.equal(timeout.call(ctx, { startup: true }), 60000);
  now = 18074;
  assert.equal(timeout.call(ctx, { startup: true }), 41926);
  now = 27704;
  video.readyState = 1;
  note.call(ctx, video);
  assert.equal(timeout.call(ctx, { startup: true }), 18000);
  now = 29515;
  video.readyState = 3;
  note.call(ctx, video);
  assert.equal(ctx.startupReadiness.metadataAt, 27704);
  assert.equal(timeout.call(ctx, { startup: true }), 16189);
  assert.equal(schedules, 2);
  now = 45704;
  assert.equal(timeout.call(ctx, { startup: true }), 1);
  assert.equal(timeout.call(ctx), 9000);
  ctx.startupReadiness = { url: ctx.activePlaybackUrl, video, startedAt: 0, metadataAt: null };
  now = 60001;
  assert.equal(timeout.call(ctx, { startup: true }), 1);
});

test("a late ready event recovers only the same source's synthetic timeout, not media failures or stale sessions", () => {
  let now = 65000,
    mediaError = 0,
    visible = true;
  const video = { readyState: 1 },
    otherVideo = { readyState: 1 };
  const controller = { video, getLastPlaybackErrorCode: () => mediaError };
  const run = method("noteStartupReadiness(video)", {
    Date: { now: () => now },
    PlayerController: controller
  }).noteStartupReadiness;
  let recovered = 0,
    gate = 0,
    scheduled = 0;
  const url = "https://cdn.test/film.mp4";
  const ctx = {
    activePlaybackUrl: url,
    startupReadiness: {
      url,
      video,
      startedAt: 0,
      metadataAt: null,
      timeoutError: true,
      allowPlayback: false
    },
    isStartupErrorVisible: () => visible,
    clearStartupError: () => {
      visible = false;
      recovered++;
    },
    failedPlaybackUrls: new Set([url]),
    failedPlaybackStreamIds: new Set(["source-a"]),
    getCurrentStreamCandidate: () => ({ id: "source-a" }),
    enableStartupAudioGate: () => gate++,
    updateLoadingVisibility() {},
    schedulePlaybackStallGuard: () => scheduled++
  };
  run.call(ctx, otherVideo);
  assert.equal(recovered, 0);
  ctx.activePlaybackUrl = "https://cdn.test/other.mp4";
  run.call(ctx, video);
  assert.equal(recovered, 0);
  ctx.activePlaybackUrl = url;
  mediaError = 4;
  run.call(ctx, video);
  assert.equal(recovered, 0);
  mediaError = 0;
  ctx.startupReadiness.timeoutError = false;
  run.call(ctx, video);
  assert.equal(recovered, 0);
  ctx.startupReadiness.timeoutError = true;
  run.call(ctx, video);
  assert.equal(recovered, 1);
  assert.equal(gate, 1);
  assert.equal(scheduled, 1);
  assert.equal(ctx.loadingVisible, true);
  assert.equal(ctx.failedPlaybackUrls.has(url), false);
  assert.equal(ctx.failedPlaybackStreamIds.has("source-a"), false);
  assert.equal(ctx.startupReadiness.metadataAt, 65000);
  now = 66000;
  video.readyState = 3;
  run.call(ctx, video);
  assert.equal(recovered, 1);
  assert.equal(ctx.startupReadiness.metadataAt, 65000);
});

test("a pending startup timer cannot fail a newer source or media session", () => {
  let expire,
    failed = 0;
  const video = { readyState: 0 };
  const ctx = {
    activePlaybackUrl: "https://cdn.test/a.mp4",
    startupReadiness: { video },
    loadingVisible: true,
    clearPlaybackStallGuard() {},
    isExternalFrameMode: () => false,
    getPlaybackStallTimeoutMs: () => 60000,
    markPlaybackSourceFailed: () => failed++
  };
  const run = method("schedulePlaybackStallGuard({ timeoutMs: timeoutOverrideMs = null } = {})", {
    setTimeout: (callback) => {
      expire = callback;
      return 1;
    }
  }).schedulePlaybackStallGuard;
  run.call(ctx);
  ctx.activePlaybackUrl = "https://cdn.test/b.mp4";
  expire();
  assert.equal(failed, 0);
  ctx.activePlaybackUrl = "https://cdn.test/a.mp4";
  ctx.startupReadiness = { video };
  expire();
  assert.equal(failed, 0);
});

test("the real startup guard allows metadata at 27.7 seconds, but an unresponsive source still times out at 60 seconds", () => {
  let now = 0,
    nextId = 0,
    failures = 0,
    errorVisible = false;
  const tasks = new Map(),
    video = { readyState: 0 };
  const controller = {
    video,
    getPlaybackReadyState: () => video.readyState,
    getLastPlaybackErrorCode: () => 0,
    getLastHlsErrorDetail: () => ""
  };
  const deps = {
    Date: { now: () => now },
    PlayerController: controller,
    setTimeout: (callback, delay) => {
      const id = ++nextId;
      tasks.set(id, { callback, at: now + delay });
      return id;
    },
    isTerminalHlsHttpStatus: () => false,
    extractPlaybackHttpStatus: () => 0
  };
  const advanceTo = (time) => {
    now = time;
    for (const [id, task] of [...tasks]) {
      if (task.at <= now) {
        tasks.delete(id);
        task.callback();
      }
    }
  };
  const url = "https://cdn.test/film.mp4";
  const ctx = {
    activePlaybackUrl: url,
    startupReadiness: { url, video, startedAt: 0, metadataAt: null },
    loadingVisible: true,
    clearPlaybackStallGuard() {
      tasks.delete(this.playbackStallTimer);
    },
    isExternalFrameMode: () => false,
    markPlaybackPresentedAfterAdvance: () => false,
    getStreamCandidateByUrl: () => null,
    getCurrentStreamCandidate: () => null,
    releaseStartupAudioGate() {},
    markPlaybackSourceFailed: () => failures++,
    getStartupErrorMessage: () => "Timeout",
    showStartupError: () => {
      errorVisible = true;
    },
    isStartupErrorVisible: () => errorVisible
  };
  ctx.getPlaybackStallTimeoutMs = method(
    "getPlaybackStallTimeoutMs({ startup = false } = {})",
    deps
  ).getPlaybackStallTimeoutMs;
  ctx.schedulePlaybackStallGuard = method(
    "schedulePlaybackStallGuard({ timeoutMs: timeoutOverrideMs = null } = {})",
    deps
  ).schedulePlaybackStallGuard;
  ctx.noteStartupReadiness = method("noteStartupReadiness(video)", deps).noteStartupReadiness;
  ctx.schedulePlaybackStallGuard();
  assert.equal([...tasks.values()][0].at, 60000);
  advanceTo(18074);
  assert.equal(failures, 0);
  assert.equal(errorVisible, false);
  advanceTo(27704);
  video.readyState = 1;
  ctx.noteStartupReadiness(video);
  assert.equal([...tasks.values()][0].at, 45704);
  advanceTo(29515);
  video.readyState = 3;
  ctx.noteStartupReadiness(video);
  assert.equal([...tasks.values()][0].at, 45704);
  ctx.hasPresentedPlaybackFrame = true;
  ctx.clearPlaybackStallGuard();
  advanceTo(60000);
  assert.equal(failures, 0);
  now = 0;
  video.readyState = 0;
  ctx.hasPresentedPlaybackFrame = false;
  ctx.startupReadiness = { url, video, startedAt: 0, metadataAt: null };
  ctx.schedulePlaybackStallGuard();
  advanceTo(60000);
  assert.equal(failures, 1);
  assert.equal(errorVisible, true);
});

test("unverified Direct has a 13 second absolute startup deadline; verified playback keeps its budget", () => {
  let now = 1000;
  const timeout = method("getPlaybackStallTimeoutMs({ startup = false } = {})", {
    Date: { now: () => now },
    REMUX_POLICY: { mode: "client" }
  }).getPlaybackStallTimeoutMs;
  const ctx = {
    activePlaybackUrl: "https://cdn.test/file",
    startupReadiness: { startedAt: 1000, metadataAt: null },
    params: {
      unverifiedPlayback: { route: "direct", mediaUrl: "https://cdn.test/file", remuxTried: false }
    }
  };
  assert.equal(timeout.call(ctx, { startup: true }), 13000);
  now = 5000;
  assert.equal(timeout.call(ctx, { startup: true }), 9000);
  ctx.startupReadiness.metadataAt = 4000;
  assert.equal(timeout.call(ctx, { startup: true }), 9000);
  now = 16001;
  assert.equal(timeout.call(ctx, { startup: true }), 1);
  ctx.params.unverifiedPlayback.remuxTried = true;
  assert.equal(timeout.call(ctx, { startup: true }), 5999);
});

test("startup guard automatically hands an unverified Direct stall to fallback before showing error", async () => {
  let expire,
    received = null;
  const run = method("schedulePlaybackStallGuard({ timeoutMs: timeoutOverrideMs = null } = {})", {
    setTimeout: (callback) => {
      expire = callback;
      return 1;
    },
    PlayerController: {
      getPlaybackReadyState: () => 0,
      getLastPlaybackErrorCode: () => 0,
      getLastHlsErrorDetail: () => ""
    },
    extractPlaybackHttpStatus: () => 0
  }).schedulePlaybackStallGuard;
  const ctx = {
    activePlaybackUrl: "https://cdn.test/source",
    loadingVisible: true,
    hasPresentedPlaybackFrame: false,
    startupReadiness: { metadataAt: null },
    params: { unverifiedPlayback: { route: "direct" } },
    clearPlaybackStallGuard() {},
    isExternalFrameMode: () => false,
    getPlaybackStallTimeoutMs: () => 15000,
    getStreamCandidateByUrl: () => ({}),
    markPlaybackPresentedAfterAdvance: () => false,
    async tryUnverifiedRemuxAfterFailure(failure) {
      received = failure;
      return true;
    },
    showStartupError() {
      assert.fail("must not show an error before automatic fallback");
    }
  };
  run.call(ctx);
  await expire();
  assert.equal(received.startupStall, true);
  assert.equal(received.mediaErrorCode, 0);
});

test("audio transitions and seeks show a light indicator instead of the startup splash", () => {
  const startup = method("isStartupLoadingVisible()").isStartupLoadingVisible;
  const buffering = method("isBufferingSpinnerVisible()").isBufferingSpinnerVisible;
  let external = false,
    error = false;
  const ctx = {
    loadingVisible: true,
    hasPresentedPlaybackFrame: false,
    isExternalFrameMode: () => external,
    isStartupErrorVisible: () => error,
    isStartupLoadingVisible: startup
  };
  assert.equal(startup.call(ctx), true);
  assert.equal(buffering.call(ctx), false);
  ctx.playbackTransitionLightweight = true;
  assert.equal(startup.call(ctx), false);
  assert.equal(buffering.call(ctx), true);
  external = true;
  assert.equal(buffering.call(ctx), false);
  external = false;
  error = true;
  assert.equal(buffering.call(ctx), false);
  error = false;
  ctx.playbackTransitionLightweight = false;
  ctx.hasPresentedPlaybackFrame = true;
  ctx.seekLoading = true;
  assert.equal(startup.call(ctx), false);
  assert.equal(buffering.call(ctx), true);
});

test("background player updates do not dismiss loading while the next episode source is being found", () => {
  const stages = [];
  let finished = 0;
  const update = method("updateLoadingVisibility()", {
    Environment: { isBrowser: () => true },
    usesUnifiedStartup: () => true,
    PlaybackLoadingTrace: { begin() {}, sample() {} },
    PlayerController: {},
    StartupLoadingOverlay: {
      begin: (_, stage) => stages.push(stage),
      setBackHandler() {},
      finish() {
        finished++;
      }
    }
  }).updateLoadingVisibility;
  const ctx = {
    params: { itemId: "series" },
    getPlaybackCurrentSeconds: () => 0,
    nextEpisodeLaunching: true,
    nextEpisodeCardSearching: true,
    loadingVisible: false,
    isExternalFrameMode: () => false,
    isStartupLoadingVisible: () => false,
    isStartupErrorVisible: () => false,
    getLoadingOverlayMeta: () => ({}),
    isStartupGateReleaseReady: () => false,
    clearBufferingSpinnerTimer() {}
  };
  update.call(ctx);
  update.call(ctx);
  assert.deepEqual(stages, ["finding", "finding"]);
  assert.equal(finished, 0);
  ctx.nextEpisodeCardSearching = false;
  ctx.loadingVisible = true;
  update.call(ctx);
  assert.equal(stages.at(-1), "opening");
  ctx.nextEpisodeLaunching = false;
  update.call(ctx);
  assert.equal(finished, 1);
});

test("header Back, Next and center buttons never enter video gesture handling", () => {
  const run = method("isDesktopVideoAreaClick(target, event = null)", {
    Environment: { isBrowser: () => true }
  }).isDesktopVideoAreaClick;
  const ctx = {
    container: { contains: () => true },
    isExternalFrameMode: () => false,
    controlsVisible: true,
    uiRefs: { progressShell: null }
  };
  for (const selector of [
    "[data-player-desktop-back]",
    ".nv-top",
    ".nv-center",
    ".player-control-btn[data-action]"
  ]) {
    const target = {
      closest: (selectors) => (selectors.split(", ").includes(selector) ? {} : null)
    };
    assert.equal(run.call(ctx, target, { clientY: 20 }), false, selector);
  }
  assert.equal(run.call(ctx, { closest: () => null }, { clientY: 150 }), true);
});

test("seekbar retains the latest requested target until the real frame reaches it", () => {
  const display = method(
    "getDisplayedPlaybackSeconds(current = this.getPlaybackCurrentSeconds())"
  ).getDisplayedPlaybackSeconds;
  const ctx = { seekLoading: true, seekLoadingTargetSeconds: 90 };
  assert.equal(display.call(ctx, 15), 90);
  ctx.seekLoadingTargetSeconds = 0;
  assert.equal(display.call(ctx, 15), 0);
  ctx.seekLoadingTargetSeconds = 120;
  assert.equal(display.call(ctx, 15), 120);
  let clears = 0;
  const ready = method("completeSeekLoadingIfReady()", {
    PlayerController: { isClientRemuxRestoring: () => false }
  }).completeSeekLoadingIfReady;
  Object.assign(ctx, {
    isStartupLoadingVisible: () => false,
    isPlaybackFrameReady: () => true,
    getPlaybackCurrentSeconds: () => 15,
    clearSeekLoading: () => ++clears
  });
  assert.equal(ready.call(ctx), false);
  assert.equal(clears, 0);
  ctx.getPlaybackCurrentSeconds = () => 120;
  ready.call(ctx);
  assert.equal(clears, 1);
  ctx.seekLoading = false;
  assert.equal(display.call(ctx, 121), 121);
});
test("a playback error prevents a delayed pause screen from reopening", () => {
  const canShow = method("canShowPauseOverlay()", {
    PlayerSettingsStore: { get: () => ({ pauseOverlayEnabled: true }) }
  }).canShowPauseOverlay;
  const ctx = {
    paused: true,
    isExternalFrameMode: () => false,
    isStartupErrorVisible: () => true,
    seekPreviewSeconds: null,
    isDialogOpen: () => false,
    isNextEpisodeCardVisible: () => false
  };
  assert.equal(canShow.call(ctx), false);
  ctx.isStartupErrorVisible = () => false;
  assert.equal(canShow.call(ctx), true);
});

test("manual episode switching carries cast photos and roles to the next player", async () => {
  let navigation;
  const run = method(
    "async playEpisodeFromPanel(selectedStream = null, { automatic = false, complete } = {})",
    {
      PlayerController: { flushCurrentProgress: async () => {}, pushProgressIfDue() {} },
      Router: { navigate: async (_route, params) => (navigation = params) },
      streamDirectPlaybackUrl: (stream) => stream.url
    }
  ).playEpisodeFromPanel;
  const stream = { id: "source", url: "https://media.test/episode" };
  const cast = [{ name: "Actor", photo: "https://image.test/actor.jpg", character: "Pilot" }];
  const ctx = {
    params: { itemId: "series", itemType: "series" },
    episodes: [{ id: "e2", season: 1, episode: 2 }],
    episodePanelIndex: 0,
    pauseOverlayMeta: { cast },
    getFilteredEpisodePanelStreams: () => [stream],
    getPlaybackSourceContext: () => ({}),
    shouldReturnToStreamOnBack: () => false
  };
  await run.call(ctx, stream);
  assert.deepEqual(navigation.castItems, cast);
});

test("dismissing an already-cleared pause screen still repairs its DOM visibility", () => {
  const dismiss = method(
    "dismissPauseOverlay({ revealControls = false, focus = false } = {})"
  ).dismissPauseOverlay;
  let renders = 0,
    clears = 0;
  const ctx = {
    pauseOverlayVisible: false,
    clearPauseOverlayTimer: () => clears++,
    renderPauseOverlay: () => renders++
  };
  dismiss.call(ctx);
  assert.equal(renders, 1);
  assert.equal(clears, 1);
  dismiss.call(ctx);
  assert.equal(renders, 2);
});
test("visible controls restore the header mask across repeated pause and error transitions", () => {
  const sync = method("syncPlayerOverlayLayoutState()").syncPlayerOverlayLayoutState;
  const rootClasses = new Set(["pause-screen-visible"]),
    overlayClasses = new Set(["pause-overlay-active"]);
  const classes = (set) => ({ toggle: (name, on) => (on ? set.add(name) : set.delete(name)) });
  const ctx = {
    controlsVisible: true,
    pauseOverlayVisible: false,
    loadingVisible: false,
    uiRefs: {
      root: { classList: classes(rootClasses), querySelector: () => null },
      controlsOverlay: { classList: classes(overlayClasses) }
    },
    isExternalFrameMode: () => false,
    isStartupErrorVisible: () => false,
    updateBrowserNativeSubtitleOffset() {},
    syncPlayerActionOverlayOffset() {}
  };
  for (let i = 0; i < 3; i++) {
    ctx.pauseOverlayVisible = true;
    sync.call(ctx);
    assert.equal(overlayClasses.has("pause-overlay-active"), true);
    ctx.pauseOverlayVisible = false;
    sync.call(ctx);
    assert.equal(rootClasses.has("pause-screen-visible"), false);
    assert.equal(overlayClasses.has("pause-overlay-active"), false);
    assert.equal(rootClasses.has("controls-visible"), true);
  }
  ctx.pauseOverlayVisible = true;
  ctx.isStartupErrorVisible = () => true;
  sync.call(ctx);
  assert.equal(overlayClasses.has("pause-overlay-active"), false);
});

test("episode drawer selects an autoplay match and keeps manual selection in the drawer", async () => {
  const stream = { id: "eligible" };
  let mode = "FIRST_STREAM";
  const launches = [];
  const run = method(
    "async openEpisodeStreamsView({ forceReload = true, automatic = false } = {})",
    {
      PlayerSettingsStore: { get: () => ({ streamAutoPlayMode: mode }) },
      isAutoPlayEffectivelyEnabled: (settings) => settings.streamAutoPlayMode !== "MANUAL",
      normalizeItemType: (type) => type
    }
  ).openEpisodeStreamsView;
  const ctx = {
    episodes: [{ id: "e2", season: 1, episode: 2 }],
    episodePanelIndex: 0,
    episodePanelVisible: true,
    renderEpisodePanel() {},
    getStreamCacheKey: (id) => id,
    getPlayableStreamsForVideo: async () => [stream],
    resolveNextEpisodeStreamByAutoPlayPolicy: async () => ({
      streamItems: [stream],
      selectedStream: stream,
      complete: false
    }),
    playEpisodeFromPanel: async (...args) => launches.push(args)
  };
  await run.call(ctx, { automatic: true });
  assert.equal(launches.length, 1);
  assert.equal(launches[0][0], stream);
  assert.equal(launches[0][1].automatic, true);
  assert.equal(launches[0][1].complete, false);

  mode = "MANUAL";
  await run.call(ctx, { automatic: true });
  assert.equal(launches.length, 1);
  assert.equal(ctx.episodePanelStreams[0], stream);
  assert.equal(ctx.episodePanelMode, "streams");

  mode = "FIRST_STREAM";
  ctx.resolveNextEpisodeStreamByAutoPlayPolicy = async () => {
    ctx.episodePanelStreamLoadToken++;
    return { streamItems: [stream], selectedStream: stream };
  };
  await run.call(ctx, { automatic: true });
  assert.equal(launches.length, 1);
});
