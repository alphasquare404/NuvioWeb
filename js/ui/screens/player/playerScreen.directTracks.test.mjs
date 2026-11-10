import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
const source = readFileSync(new URL("./playerScreen.js", import.meta.url), "utf8");
function method(start, end, globals = {}) {
  const from = source.indexOf(start);
  assert.ok(from >= 0);
  const body = source.slice(from, source.indexOf(end, from)).trim().replace(/,$/, "");
  return vm.runInNewContext("({" + body + "})", globals);
}
function fixture({ pending = false, mode = "client", native = [], text = [] } = {}) {
  let resolve,
    probes = 0,
    created = 0,
    refreshes = 0,
    switched = 0;
  const probe = {
    container: "mkv",
    audioStreams: [
      { index: 0, codec: "aac", language: "fr" },
      { index: 1, codec: "aac", language: "zh" }
    ],
    playbackCapabilities: {
      relayVideo: true,
      audio: [
        { index: 0, supported: true },
        { index: 1, supported: true }
      ]
    }
  };
  const subtitles = {
    setSource(url) {
      this.url = url;
    },
    setDelay(value) {
      this.delay = value;
    }
  };
  const controller = { video: {}, getBrowserAudioTracks: () => native };
  const globals = {
    Environment: { isBrowser: () => true },
    PlayerController: controller,
    createStreamProber: () => ({
      probe: async () => {
        probes++;
        return pending
          ? new Promise((r) => {
              resolve = r;
            })
          : probe;
      }
    }),
    PROBE_ENDPOINT: "/api/probe",
    PROBE_MODE: "client",
    PROBE_CLIENT_CONCURRENCY: 2,
    REMUX_POLICY: { mode },
    assessPlaybackCapabilities() {},
    streamProbeIdentity: () => "",
    clientRemuxAssets: () => ({ assetBase: "https://app.test/assets/", version: "fixture" }),
    createEmbeddedSubtitles: () => {
      created++;
      return subtitles;
    }
  };
  const ctx = {
    activePlaybackUrl: "https://media.test/movie.mkv",
    relayTrackToken: 1,
    isCurrentSourceAdaptiveManifest: () => false,
    isCurrentSourceLikelyMkv: () => false,
    getCurrentStreamCandidate: () => ({}),
    refreshTrackDialogs() {
      refreshes++;
    },
    getTextTracks: () => text,
    getCurrentStreamRequestHeaders: () => ({ Authorization: "fixture" }),
    getPlaybackCurrentSeconds: () => 60,
    refreshSubtitleCueStyles() {},
    externalTrackNodes: [],
    subtitleDelayMs: 250,
    params: {},
    isActiveMountToken: () => true,
    getAudioTrackPreference: (entry) => entry.track,
    rememberAudioTrackSelection() {},
    playStreamByUrl: async () => {
      switched++;
    }
  };
  ctx.loadDirectSubtitleData = method(
    "  loadDirectSubtitleData({ confirmedMkv = false } = {}) {",
    "  async loadDirectTrackData() {",
    globals
  ).loadDirectSubtitleData;
  const load = method(
    "  async loadDirectTrackData() {",
    "  async switchDirectAudioTrack(",
    globals
  ).loadDirectTrackData;
  return {
    ctx,
    load,
    probe,
    controller,
    subtitles,
    globals,
    resolve: () => resolve(probe),
    counts: () => ({ probes, created, refreshes, switched })
  };
}
test("Direct discovery lists both source audios and reads MKV text without changing playback", async () => {
  const f = fixture();
  await f.load.call(f.ctx);
  assert.equal(f.ctx.directAudioTracks.length, 2);
  assert.equal(f.ctx.directAudioTracks[1].engine, "direct-source");
  assert.ok(f.ctx.directAudioTracks.every((t) => !t.selected && t.supported));
  assert.equal(f.subtitles.url, f.ctx.activePlaybackUrl);
  assert.equal(f.subtitles.delay, 0.25);
  assert.equal(f.counts().switched, 0);
  await f.load.call(f.ctx);
  assert.equal(f.counts().probes, 1);
  assert.equal(f.counts().created, 1);
});
test("native track selection remains native and is not duplicated by a second subtitle reader", async () => {
  const f = fixture({ native: [{ id: 0 }], text: [{ kind: "subtitles" }] });
  await f.load.call(f.ctx);
  assert.equal(f.ctx.directAudioTracks, undefined);
  assert.equal(f.counts().created, 0);
});
test("hoster off retains audio inventory but cannot offer a remux switch", async () => {
  const f = fixture({ mode: "off" });
  await f.load.call(f.ctx);
  assert.ok(f.ctx.directAudioTracks.every((t) => !t.supported));
  assert.equal(f.counts().created, 1);
});
test("late Direct metadata cannot attach tracks or subtitles to a changed source", async () => {
  const f = fixture({ pending: true });
  const work = f.load.call(f.ctx);
  f.ctx.activePlaybackUrl = "https://media.test/other.mkv";
  f.ctx.relayTrackToken++;
  f.resolve();
  await work;
  assert.equal(f.ctx.directAudioTracks, undefined);
  assert.equal(f.counts().created, 0);
});
test("adaptive, client-remux and offline sources do not launch Direct discovery", async () => {
  for (const kind of ["adaptive", "remux", "offline"]) {
    const f = fixture();
    if (kind === "adaptive") f.ctx.isCurrentSourceAdaptiveManifest = () => true;
    if (kind === "remux") f.controller.clientRemux = {};
    if (kind === "offline") f.ctx.activePlaybackUrl = "blob:local-file";
    await f.load.call(f.ctx);
    assert.equal(f.counts().probes, 0);
  }
});
test("background Direct probe starts after the first frame and switches once to the preferred language", async () => {
  const f = fixture({ pending: true });
  const notices = [];
  const switches = [];
  let probe;
  f.controller.playbackEngine = "native-file";
  f.ctx.applyDirectAudioPreferenceAfterStart = method(
    "  applyDirectAudioPreferenceAfterStart() {",
    "  async switchDirectAudioTrack(",
    { ...f.globals, t: (key) => key }
  ).applyDirectAudioPreferenceAfterStart;
  f.ctx.showAspectToast = (message) => notices.push(message);
  f.ctx.loadDirectTrackData = () => (probe = f.load.call(f.ctx));
  f.ctx.findRememberedAudioOption = () => null;
  f.ctx.findStartupPreferredAudioOption = () => ({
    languageLabel: "Chinese",
    entry: { supported: true, track: f.ctx.directAudioTracks[1] }
  });
  f.ctx.switchDirectAudioTrack = (entry, options) => switches.push([entry.track.index, options]);

  f.ctx.applyDirectAudioPreferenceAfterStart();
  assert.equal(f.counts().probes, 0);
  f.ctx.hasPresentedPlaybackFrame = true;
  f.ctx.applyDirectAudioPreferenceAfterStart();
  f.ctx.applyDirectAudioPreferenceAfterStart();
  assert.equal(f.counts().probes, 1);
  assert.deepEqual(notices, ["player_audio_preference_checking"]);
  assert.deepEqual(switches, []);
  f.resolve();
  await probe;
  f.ctx.applyDirectAudioPreferenceAfterStart();
  assert.equal(switches.length, 1);
  assert.equal(switches[0][0], 1);
  assert.equal(switches[0][1].automatic, true);
  assert.equal(switches[0][1].language, "Chinese");
});

test("already-default and manual audio choices avoid automatic remux", async () => {
  const f = fixture();
  f.controller.playbackEngine = "native-file";
  f.ctx.hasPresentedPlaybackFrame = true;
  f.ctx.showAspectToast = () => {};
  f.ctx.applyDirectAudioPreferenceAfterStart = method(
    "  applyDirectAudioPreferenceAfterStart() {",
    "  async switchDirectAudioTrack(",
    f.globals
  ).applyDirectAudioPreferenceAfterStart;
  f.ctx.findRememberedAudioOption = () => null;
  f.ctx.findStartupPreferredAudioOption = () => ({
    entry: { supported: true, track: f.ctx.directAudioTracks[0] }
  });
  f.ctx.switchDirectAudioTrack = () => assert.fail("default track must keep Direct");
  await f.load.call(f.ctx);
  assert.equal(f.ctx.directAudioPreferenceState.attempted, true);
  const manual = method("  applyAudioTrack(index,", "  renderAudioDialog() {").applyAudioTrack;
  f.ctx.getAudioEntries = () => [{ track: { engine: "direct-default" } }];
  f.ctx.directAudioSwitching = { automatic: true, started: false };
  manual.call(f.ctx, 0, { rememberSelection: true });
  assert.equal(f.ctx.directAudioSwitching, null);
  assert.equal(f.ctx.directAudioPreferenceState.attempted, true);
});

test("automatic audio transition announces the switch and restores Direct on startup failure", async () => {
  const f = fixture();
  await f.load.call(f.ctx);
  const calls = [];
  const notices = [];
  Object.assign(
    f.ctx,
    method("  async switchDirectAudioTrack(", "  clearRelayTrackData() {", {
      prepareUnverifiedRemux: async () => ({
        url: "https://relay.test/audio",
        plan: { route: "server" }
      }),
      t: (key) => key
    })
  );
  f.ctx.showAspectToast = (message) => notices.push(message);
  f.ctx.playStreamByUrl = async (url, options) => {
    f.ctx.activePlaybackUrl = url;
    calls.push({ url, options });
  };
  const original = f.ctx.activePlaybackUrl;
  await f.ctx.switchDirectAudioTrack(
    { supported: true, track: { index: 1 } },
    { automatic: true, language: "Chinese" }
  );
  assert.deepEqual(notices, ["player_audio_preference_switching"]);
  assert.equal(calls[0].options.rememberRequestedAudio, false);
  assert.equal(calls[0].options.preservePlaybackState, true);
  assert.equal(await f.ctx.restoreDefaultAfterAutomaticAudioFailure(), true);
  assert.equal(calls[1].url, original);
  assert.equal(calls[1].options.preservePendingRestore, true);
  assert.equal(f.ctx.params.playbackPlan, null);
  assert.equal(notices[1], "player_audio_preference_default");
  assert.equal(await f.ctx.restoreDefaultAfterAutomaticAudioFailure(), false);
});

test("Direct audio selection reuses copy remux and preserves playback position/state", async () => {
  const f = fixture();
  await f.load.call(f.ctx);
  let prepared, played;
  const fn = method("  async switchDirectAudioTrack(", "  clearRelayTrackData() {", {
    prepareUnverifiedRemux: async (url, options) => {
      prepared = { url, options };
      return { url, plan: { route: "client", sourceUrl: url, audioIndex: options.audioIndex } };
    },
    t: (_, __, fallback) => fallback
  }).switchDirectAudioTrack;
  f.ctx.playStreamByUrl = async (url, options) => {
    played = { url, options };
  };
  await fn.call(f.ctx, { supported: true, track: { index: 1 } });
  assert.equal(prepared.options.audioIndex, 1);
  assert.equal(f.ctx.params.playbackPlan.audioIndex, 1);
  assert.equal(played.options.requestedAudioIndex, 1);
  assert.equal(played.options.preservePlaybackState, true);
  assert.equal(played.options.resetSilentAudioState, false);
});
test("a late remux preparation cannot replace a different source", async () => {
  const f = fixture();
  await f.load.call(f.ctx);
  let finish;
  const fn = method("  async switchDirectAudioTrack(", "  clearRelayTrackData() {", {
    prepareUnverifiedRemux: () =>
      new Promise((r) => {
        finish = r;
      }),
    t: (_, __, fallback) => fallback
  }).switchDirectAudioTrack;
  const work = fn.call(f.ctx, { supported: true, track: { index: 1 } });
  f.ctx.activePlaybackUrl = "https://media.test/new.mkv";
  finish({ url: "https://app.test/copy.m3u8", plan: null });
  await work;
  assert.equal(f.counts().switched, 0);
});
test("passive remux status preserves pause timer and visible overlay; playback cancels it", () => {
  let now = 0,
    next = 0;
  const timers = new Map();
  let eligible = true;
  const schedule = method(
    "  schedulePauseOverlay({ restart = false } = {}) {",
    "  syncPauseOverlayState() {",
    {
      setTimeout: (fn, delay) => {
        timers.set(++next, { fn, at: now + delay });
        return next;
      }
    }
  ).schedulePauseOverlay;
  const ctx = {
    pauseOverlayVisible: false,
    pauseOverlayTimer: null,
    pauseOverlayDelayMs: 5000,
    canShowPauseOverlay: () => eligible,
    renderPauseOverlay() {},
    clearPauseOverlayTimer() {
      timers.delete(this.pauseOverlayTimer);
      this.pauseOverlayTimer = null;
    }
  };
  schedule.call(ctx);
  const first = ctx.pauseOverlayTimer;
  now = 2000;
  schedule.call(ctx);
  now = 4000;
  schedule.call(ctx);
  assert.equal(ctx.pauseOverlayTimer, first);
  now = 5000;
  timers.get(first).fn();
  timers.delete(first);
  assert.equal(ctx.pauseOverlayVisible, true);
  now = 6000;
  schedule.call(ctx);
  assert.equal(ctx.pauseOverlayVisible, true);
  eligible = false;
  schedule.call(ctx);
  assert.equal(ctx.pauseOverlayVisible, false);
  assert.equal(ctx.pauseOverlayTimer, null);
});

test("MKV subtitle reading begins before a pending audio probe finishes", async () => {
  const f = fixture({ pending: true });
  f.ctx.isCurrentSourceLikelyMkv = () => true;
  const work = f.load.call(f.ctx);
  assert.equal(f.counts().created, 1);
  assert.equal(f.subtitles.url, f.ctx.activePlaybackUrl);
  f.resolve();
  await work;
  assert.equal(f.counts().created, 1);
});

test("Direct MKV subtitle initialization does not require an audio probe", () => {
  const f = fixture();
  f.ctx.isCurrentSourceLikelyMkv = () => true;
  f.ctx.loadDirectSubtitleData();
  assert.equal(f.counts().probes, 0);
  assert.equal(f.counts().created, 1);
});

test("manual audio is remembered using the runtime track identity after remux", () => {
  const refresh = method(
    "  refreshTrackDialogs() {",
    "  invalidateTrackDialogCaches() {"
  ).refreshTrackDialogs;
  const selected = { selected: true, track: { engine: "client-remux", id: "3", index: 1 } };
  let remembered;
  const ctx = {
    pendingDirectAudioSelection: { url: "https://media.test/movie.mp4", index: 1 },
    activePlaybackUrl: "https://media.test/movie.mp4",
    startupTrackPreferenceReady: false,
    invalidateTrackDialogCaches() {},
    syncTrackState() {},
    getAudioEntries: () => [selected],
    getAudioTrackPreference: (entry) => ({ trackId: entry.track.id }),
    rememberAudioTrackSelection(value) {
      remembered = value;
    },
    getStartupAudioTrackSetSignature: () => "fixture",
    ensureSupportedAudioTrackSelected() {},
    refreshSubtitleCueStyles() {},
    renderControlButtons() {}
  };
  refresh.call(ctx);
  assert.equal(remembered.trackId, "3");
  assert.equal(ctx.pendingDirectAudioSelection, null);
});

test("Direct audio menu marks the browser default without inventing the selected source track", () => {
  let tracks = [];
  const list = method("  getAudioEntries() {", "  ensureSupportedAudioTrackSelected() {", {
    PlayerController: { getBrowserAudioTracks: () => tracks },
    formatAudioTrackDisplay: (track) => ({ label: track.id, secondary: "" }),
    getAudioTrackSupportState: () => ({ supported: true }),
    t: (_, __, fallback) => fallback
  }).getAudioEntries;
  const ctx = {
    trackDialogCache: {},
    directAudioTracks: [
      { id: "source-0", index: 0, engine: "direct-source", selected: false },
      { id: "source-1", index: 1, engine: "direct-source", selected: false }
    ]
  };
  const direct = list.call(ctx);
  assert.equal(direct.length, 3);
  assert.equal(direct.filter((entry) => entry.selected).length, 1);
  assert.equal(direct[0].track.engine, "direct-default");
  assert.equal(direct[2].track.index, 1);
  tracks = [
    { id: "runtime-0", index: 0, engine: "client-remux", selected: false },
    { id: "runtime-1", index: 1, engine: "client-remux", selected: true }
  ];
  ctx.trackDialogCache = {};
  const remux = list.call(ctx);
  assert.equal(remux.length, 2);
  assert.equal(
    remux.some((entry) => entry.track.engine === "direct-default"),
    false
  );
  assert.equal(remux.find((entry) => entry.selected).track.index, 1);
});

test("choosing the already active Direct default does not restart or change preferences", () => {
  const apply = method("  applyAudioTrack(index,", "  renderAudioDialog() {").applyAudioTrack;
  const ctx = {
    getAudioEntries: () => [{ track: { engine: "direct-default" } }],
    startupAudioFallbackApplied: true,
    failedAutomaticAudioFallbackEntryId: "retained"
  };
  apply.call(ctx, 0, { rememberSelection: true });
  assert.equal(ctx.startupAudioFallbackApplied, true);
  assert.equal(ctx.failedAutomaticAudioFallbackEntryId, "retained");
});
