import { playerStreamProbeKey } from "../../../core/streams/playerStreamPolicy.js";
import vm from "node:vm";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const playerScreenUrl = new URL("./playerScreen.js", import.meta.url);
const desktopCssUrl = new URL("../../../../css/desktop.css", import.meta.url);
const componentsCssUrl = new URL("../../../../css/components.css", import.meta.url);
const dialogUrl = new URL("../../components/nuvioDialog.js", import.meta.url);

test("browser PlayerScreen retains browser track paths without native TV playback branches", async () => {
  const source = await readFile(playerScreenUrl, "utf8");

  assert.match(source, /schedulePlaybackStallGuard/);
  assert.match(source, /getBrowserAudioTracks/);
  assert.match(source, /setBrowserAudioTrack/);
  assert.match(source, /audiotrackschanged/);
  assert.match(source, /createSubtitleObjectUrl/);
  assert.doesNotMatch(
    source,
    /\b(?:AVPlay|EngineFS|TizenEngineFsService|PalmSystem|webOS\.service|Luna|isWebOS|isTizen|setWebOsEmbedded|setAvPlay)\b/i
  );
});

test("desktop Player Back chrome follows the shared controls-visible state", async () => {
  const [source, desktopCss] = await Promise.all([
    readFile(playerScreenUrl, "utf8"),
    readFile(desktopCssUrl, "utf8")
  ]);

  assert.match(
    source,
    /const controlsVisible = Boolean\(this\.controlsVisible\) && !this\.isExternalFrameMode\(\);/
  );
  assert.match(source, /backButton\.toggleAttribute\("inert", !controlsVisible\);/);
  assert.match(source, /backButton\.setAttribute\("aria-hidden", String\(!controlsVisible\)\);/);
  assert.match(
    desktopCss,
    /#playerUiRoot:not\(\.controls-visible\) \.player-desktop-back-button\s*\{\s*opacity: 0;\s*pointer-events: none;/
  );
});

test("browser Player routes PiP through active-video capability and lifecycle events", async () => {
  const source = await readFile(playerScreenUrl, "utf8");

  assert.match(
    source,
    /getBrowserPictureInPictureCapability\(this\.getDesktopPlaybackVideo\(\), document\)/
  );
  assert.match(source, /enterpictureinpicture/);
  assert.match(source, /leavepictureinpicture/);
  assert.match(source, /webkitpresentationmodechanged/);
  assert.doesNotMatch(source, /navigator\.standalone|display-mode|isPwa|isStandalone/);
  assert.match(source, /markPictureInPictureUnavailableForActivePlayback/);
});

test("manual external playback uses a valid non-wrapping time row and responsive primary landscape actions", async () => {
  const [source, componentsCss, dialogSource] = await Promise.all([
    readFile(playerScreenUrl, "utf8"),
    readFile(componentsCssUrl, "utf8"),
    readFile(dialogUrl, "utf8")
  ]);
  assert.match(source, /validateExternalPlaybackPositionParts/);
  assert.match(source, /desktop-external-player-time-fields/);
  assert.match(source, /desktop-external-player-time-separator/);
  // This used to pin `manualDurationMs / 1000`, which sent a zero whenever the
  // runtime was never learned. applyExternalPlaybackReport reads a zero as a
  // claimed measurement and refuses the whole report, so Save wrote nothing and
  // said so only in text coloured like the caption beside it.
  assert.match(
    source,
    /durationSeconds: externalPlaybackReportDurationSeconds\(manualDurationMs\)/
  );
  assert.match(
    source,
    /markBrowserExternalPlaybackFinished\(\{\s*handoff,\s*controller: PlayerController\s*\}\)/
  );
  assert.match(source, /desktop-external-player-manual-actions/);
  assert.match(source, /desktop-external-player-manual-keep/);
  assert.match(source, /desktop-external-player-manual-set/);
  assert.match(
    source,
    /className: "desktop-external-player-primary desktop-external-player-manual-finish"/
  );
  assert.match(source, /data-nuvio-dialog-preserve-deletion/);
  assert.match(source, /event\.stopPropagation\(\);/);
  assert.match(dialogSource, /data-nuvio-dialog-preserve-deletion/);
  assert.match(
    componentsCss,
    /grid-template-columns: minmax\(0, 1fr\) auto minmax\(0, 1fr\) auto minmax\(0, 1fr\);/
  );
  assert.match(componentsCss, /grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/);
  assert.match(componentsCss, /desktop-external-player-manual-actions \{[\s\S]*?gap: 12px;/);
  assert.match(componentsCss, /width: min\(calc\(100vw - 24px\), 520px\);/);
  assert.match(
    componentsCss,
    /desktop-external-player-manual-actions \.nuvio-dialog-button \{[\s\S]*?min-width: 0;/
  );
  assert.match(
    componentsCss,
    /desktop-external-player-manual-actions \.desktop-external-player-manual-keep \{\s*grid-column: 1;/
  );
  assert.match(
    componentsCss,
    /desktop-external-player-manual-actions \.desktop-external-player-manual-set \{\s*grid-column: 2;/
  );
  assert.match(
    componentsCss,
    /desktop-external-player-manual-actions \.nuvio-dialog-button\.focused[\s\S]*?transform: none;/
  );
  assert.match(
    componentsCss,
    /nuvio-dialog-button:last-child:nth-child\(3\).*?grid-column: 1 \/ -1;/s
  );
  assert.match(
    componentsCss,
    /desktop-external-player-primary[\s\S]*?background: var\(--secondary-color, #f5f5f5\);/
  );
});

test("Player external launches bind the optional Push return subscription unless an Automation already returns the person", async () => {
  const source = await readFile(playerScreenUrl, "utf8");

  assert.match(
    source,
    /import \{ bindBrowserPushReturn \} from "\.\.\/\.\.\/components\/browserPushReturn\.js";/
  );
  // The binding is skipped for an Automation, which already brings the person
  // back, so a notification would arrive for an app they are looking at. The
  // launch stays outside the branch: nothing about the chosen way back may
  // decide whether playback starts.
  assert.match(
    source,
    /if \(returnMethod !== "automation"\) \{\s*await bindBrowserPushReturn\(\{ token: prepared\.handoff\?\.token \}\);\s*\}\s*launchBrowserExternalPlayer\(\{ href: prepared\.launch\.href \}\);/
  );
  // Choosing an Automation must never cancel the subscription: it carries
  // every other notification the app sends.
  assert.doesNotMatch(source, /disableBrowserPushReturn/);
});

test("audio boost does not capture native cross-origin media", async () => {
  const source = await readFile(playerScreenUrl, "utf8");
  const declaration = source.match(/function supportsWebAudioAmplification\(\) \{[\s\S]*?\n\}/)[0];
  const context = {
    URL,
    location: { origin: "https://nuvio.example" },
    PlayerController: { video: {} }
  };
  vm.runInNewContext(declaration, context);
  const video = context.PlayerController.video;
  video.currentSrc = "https://cdn.example/movie.mp4";
  assert.equal(context.supportsWebAudioAmplification(), false);
  video.currentSrc = "blob:https://nuvio.example/download";
  assert.equal(context.supportsWebAudioAmplification(), true);
  video.currentSrc = "/movie.mp4";
  assert.equal(context.supportsWebAudioAmplification(), true);
  video.currentSrc = "";
  assert.equal(context.supportsWebAudioAmplification(), false);
});

test("next episode First Source uses HDR preference without weakening Only Direct", async () => {
  const { selectAutoPlayStream } = await import("../../../core/streams/streamAutoPlaySelector.js");
  const { resolveHdrPreference } = await import("../../../core/streams/streamHdrPreference.js");
  const source = await readFile(playerScreenUrl, "utf8");
  const method = source.match(
    /async selectNextEpisodeStreamByAutoPlayPolicy\([\s\S]*?\n {2}\},/
  )[0];
  const run = new Function(
    "selectAutoPlayStream",
    "resolveHdrPreference",
    "nextEpisodeSelectionOptions",
    "isOnlyDirectEnabled",
    "StreamBadgeSettingsStore",
    "playerStreamProbeKey",
    `return ({${method}}).selectNextEpisodeStreamByAutoPlayPolicy;`
  )(
    selectAutoPlayStream,
    resolveHdrPreference,
    (await import("../../../core/streams/playerStreamPolicy.js")).nextEpisodeSelectionOptions,
    (await import("../../../core/streams/streamLabelPolicy.js")).isOnlyDirectEnabled,
    { snapshot: () => ({ labelAddons: ["Chosen"] }) },
    playerStreamProbeKey
  );
  const rows = [
    { id: "sdr", url: "https://cdn.test/sdr", addonName: "Chosen" },
    { id: "hdr", url: "https://cdn.test/hdr", title: "HDR", addonName: "Chosen" }
  ];
  const screen = {
    async selectDirectPlayableCandidates() {
      return rows;
    },
    _nextEpisodeProbeResults: new Map()
  };
  const settings = { streamAutoPlayMode: "FIRST_STREAM", streamAutoPlayHdrPreference: "PREFER" };
  const options = { installedAddonNames: new Set(["Chosen"]) };
  assert.equal((await run.call(screen, rows, settings, options)).id, "hdr");
  screen._nextEpisodeProbeResults = new Map([
    [rows[0].url, { colorTransfer: "smpte2084" }],
    [rows[1].url, { colorTransfer: "bt709" }]
  ]);
  assert.equal((await run.call(screen, rows, settings, options)).id, "sdr");
  assert.equal(
    (await run.call(screen, rows, { ...settings, showOnlyDirectStreams: true }, options)).id,
    "sdr"
  );
  assert.equal(
    (
      await run.call(
        screen,
        rows,
        { ...settings, streamAutoPlayHdrPreference: "AVOID", showOnlyDirectStreams: true },
        options
      )
    ).id,
    "hdr"
  );
});

test("manual client startup retry is synchronous and restricted to live startup timeouts", async () => {
  const source = await readFile(playerScreenUrl, "utf8"),
    names = ["canManuallyStartClientRemux", "retryClientRemuxFromGesture"];
  const methods = names.map((name) => {
    const match = source.match(new RegExp("  " + name + "\\(\\) \\{[\\s\\S]*?\\n {2}\\},"));
    assert.ok(match, name);
    return match[0];
  });
  const calls = [],
    runtime = { snapshot: () => ({ state: "backpressure" }) },
    controller = {
      clientRemux: runtime,
      video: { readyState: 2 },
      getLastPlaybackErrorCode: () => 0,
      setStartupPresentationAudioMuted: () => calls.push("unmute"),
      resume: () => calls.push("play")
    };
  const methodsObject = vm.runInNewContext("({" + methods.join("") + "})", {
    PlayerController: controller,
    console: { warn() {} },
    Date
  });
  const screen = {
    ...methodsObject,
    startupReadiness: { timeoutError: true },
    startupErrorMediaCode: 0,
    clearStartupError() {
      calls.push("clear");
    },
    getPlaybackCurrentSeconds: () => 91,
    releaseStartupAudioGate() {
      calls.push("gate");
    },
    applyAudioAmplification() {
      calls.push("audio-context");
    },
    schedulePlaybackStallGuard() {
      calls.push("timer");
    },
    updateLoadingVisibility() {}
  };
  assert.equal(screen.canManuallyStartClientRemux(), true);
  assert.equal(screen.retryClientRemuxFromGesture(), true);
  assert.ok(calls.indexOf("play") < calls.indexOf("timer"));
  assert.equal(controller.clientRemux, runtime);
  assert.equal(screen.startupReadiness.manualPlayAttempts, 1);
  assert.equal(screen.retryClientRemuxFromGesture(), false);
  screen.startupReadiness.timeoutError = true;
  screen.startupErrorMediaCode = 4;
  assert.equal(screen.canManuallyStartClientRemux(), false);
  screen.startupErrorMediaCode = 0;
  controller.clientRemux = null;
  assert.equal(screen.canManuallyStartClientRemux(), false);
});

async function loadPlayerMethods(names, globals) {
  const source = await readFile(playerScreenUrl, "utf8");
  const methods = names.map((name) => {
    const match = source.match(new RegExp("  " + name + "\\([^\\n]*\\n[\\s\\S]*?\\n {2}\\},"));
    assert.ok(match, name);
    return match[0];
  });
  return vm.runInNewContext("({" + methods.join("") + "})", globals);
}

test("subtitle merge collapses the same URL across providers but keeps distinct releases", async () => {
  const { createOfflineSubtitleFingerprint } =
    await import("../../../core/offline/offlineSubtitleIdentity.js");
  const screen = await loadPlayerMethods(["mergeSubtitleCandidates"], {
    createOfflineSubtitleFingerprint,
    normalizeSubtitleLanguageKey: (lang) => (lang === "eng" ? "en" : lang)
  });
  const stream = {
    id: "sidecar",
    addonName: "Stream",
    url: "https://example.test/sub?id=1",
    lang: "eng"
  };
  const addon = { id: "addon", addonName: "Subtitles", url: stream.url, lang: "en" };
  const second = { ...addon, url: "https://example.test/sub?id=2" };
  const offline = {
    ...addon,
    isOffline: true,
    url: "blob:offline",
    offlineFingerprint: createOfflineSubtitleFingerprint(addon)
  };
  assert.deepEqual(Array.from(screen.mergeSubtitleCandidates([stream], [addon, second])), [
    stream,
    second
  ]);
  const otherRelease = { ...second, id: "other-release" };
  assert.deepEqual(Array.from(screen.mergeSubtitleCandidates([offline], [addon, otherRelease])), [
    offline,
    otherRelease
  ]);
});

test("None clears all subtitle paths and late discovery cannot auto-select another track", async () => {
  const calls = [];
  const controller = {
    clientRemux: {},
    dashInstance: {},
    hlsInstance: {},
    selectClientSubtitle: (value) => calls.push(["remux", value]),
    setDashTextTrack: (value) => calls.push(["dash", value]),
    setHlsSubtitleTrack: (value) => calls.push(["hls", value]),
    setNativeTextTrack: (value) => calls.push(["native", value])
  };
  const screen = {
    ...(await loadPlayerMethods(
      ["applySubtitleEntry", "applyStartupSubtitlePreference", "isSubtitleOffEntrySelected"],
      {
        PlayerController: controller,
        clearTimeout
      }
    )),
    relayTextSubtitles: { select: (value) => calls.push(["relay", value]) },
    selectedSubtitleTrackIndex: 0,
    selectedAddonSubtitleId: "addon",
    selectedManifestSubtitleTrackId: "manifest",
    subtitleSelectionToken: 3,
    getActiveSubtitleSelectionKey: () => "addon",
    clearMountedExternalSubtitleTracks: () => calls.push(["addon"]),
    clearHtmlSubtitleOverlay: () => calls.push(["overlay"]),
    syncRotatedNativeSubtitles: () => calls.push(["rotated"]),
    resetSubtitleDelayAfterSelectionChange() {},
    invalidateTrackDialogCaches() {},
    renderControlButtons() {},
    renderSubtitleDialog() {},
    settleSubtitlePointerScrollTransaction() {}
  };
  screen.applySubtitleEntry({ id: "subtitle-off", trackIndex: -1, clientSubtitleId: null });
  assert.deepEqual(calls, [
    ["addon"],
    ["overlay"],
    ["relay", null],
    ["remux", null],
    ["dash", -1],
    ["hls", -1],
    ["native", -1],
    ["rotated"]
  ]);
  assert.equal(screen.subtitleSelectionToken, 4);
  assert.equal(screen.selectedAddonSubtitleId, null);
  assert.equal(screen.selectedManifestSubtitleTrackId, null);
  assert.equal(screen.selectedSubtitleTrackIndex, -1);
  assert.equal(screen.isSubtitleOffEntrySelected(0), true);
  screen.startupSubtitlePreferenceApplied = false;
  assert.equal(screen.applyStartupSubtitlePreference(), false);
});

test("blocked remux autoplay exposes Play and the first tap lifts mute before resuming", async () => {
  const calls = [];
  const controller = {
    video: {
      paused: true,
      readyState: 4,
      classList: { add: () => calls.push(["hideVideo"]), remove: () => calls.push(["showVideo"]) }
    },
    clientRemux: { snapshot: () => ({ state: "remuxing" }) },
    setStartupPresentationAudioMuted: (muted) => calls.push(["muted", muted]),
    resume: () => calls.push(["play"])
  };
  const screen = {
    ...(await loadPlayerMethods(
      [
        "showClientRemuxPlayAfterAutoplayBlock",
        "canManuallyStartClientRemux",
        "retryClientRemuxFromGesture",
        "togglePause",
        "finalizePendingPlaybackRestore"
      ],
      { PlayerController: controller, console: { warn() {} } }
    )),
    startupReadiness: {},
    loadingVisible: true,
    paused: false,
    isStartupErrorVisible: () => false,
    isExternalFrameMode: () => false,
    clearPlaybackStallGuard() {},
    clearLoadingCompletionTimer() {},
    releaseStartupAudioGate: ({ resume }) => calls.push(["releaseGate", resume]),
    updateLoadingVisibility() {},
    updateMediaSessionPlaybackState() {},
    setControlsVisible: (visible) => calls.push(["controls", visible]),
    renderControlButtons() {},
    clearStartupError() {},
    getPlaybackCurrentSeconds: () => 73.495,
    applyAudioAmplification: () => calls.push(["audio"]),
    schedulePlaybackStallGuard() {}
  };
  screen.showClientRemuxPlayAfterAutoplayBlock({ autoplayBlocked: true });
  assert.equal(screen.loadingVisible, false);
  assert.equal(screen.paused, true);
  screen.pendingPlaybackRestore = { paused: false };
  screen.finalizePendingPlaybackRestore();
  assert.equal(screen.paused, true);
  assert.deepEqual(calls, [["hideVideo"], ["releaseGate", false], ["controls", true]]);
  screen.togglePause();
  assert.equal(screen.startupReadiness.autoplayBlocked, false);
  assert.deepEqual(calls.slice(3), [
    ["showVideo"],
    ["releaseGate", false],
    ["muted", false],
    ["audio"],
    ["play"]
  ]);
});
