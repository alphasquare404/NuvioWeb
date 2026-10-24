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
    `return ({${method}}).selectNextEpisodeStreamByAutoPlayPolicy;`
  )(selectAutoPlayStream, resolveHdrPreference);
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

test("next episode probes an eligible HDR candidate before applying its cap", async () => {
  const { filterAutoPlaySourceStreams } =
    await import("../../../core/streams/streamAutoPlaySelector.js");
  const { applyHdrPreference, resolveHdrPreference } =
    await import("../../../core/streams/streamHdrPreference.js");
  const { classifyPlayback } = await import("../../../core/player/playbackMethod.js");
  const source = await readFile(playerScreenUrl, "utf8");
  const method = source.match(/async selectDirectPlayableCandidates\([\s\S]*?\n {2}\},/)[0];
  const probes = [];
  let assessments = 0;
  const { allowsPlayerStreamLabel } = await import("../../../core/streams/playerStreamPolicy.js");
  const dependencies = {
    allowsPlayerStreamLabel,
    StreamBadgeSettingsStore: { snapshot: () => ({ labelAddons: ["Chosen"] }) },
    filterAutoPlaySourceStreams,
    applyHdrPreference,
    resolveHdrPreference,
    classifyPlayback,
    getDeviceCapabilities: () => ({ h264: true, aac: true, containers: { mkv: false } }),
    PROBE_ENDPOINT: "/api/probe",
    streamProbeIdentity: (s) => s.id,
    assessPlaybackCapabilities: () => {
      assessments++;
      return {
        engine: "native",
        video: true,
        container: true,
        audio: [{ index: 0, supported: true }]
      };
    },
    createStreamProber: (options) => ({
      enabled: true,
      async probe(url) {
        probes.push(url);
        const raw = {
          container: "mkv",
          videoCodec: "h264",
          audioCodec: "aac",
          colorTransfer: "smpte2084"
        };
        return { ...raw, playbackCapabilities: await options.assess(raw) };
      }
    })
  };
  const run = new Function(
    "deps",
    `const {${Object.keys(dependencies).join(",")}}=deps;return ({${method}}).selectDirectPlayableCandidates;`
  )(dependencies);
  const rows = Array.from({ length: 22 }, (_, i) => ({
    id: String(i),
    addonName: "Chosen",
    url: "https://cdn.test/" + i
  }));
  rows[21].title = "HDR";
  rows.unshift({
    id: "forbidden",
    addonName: "Other",
    title: "HDR",
    url: "https://other.test/HDR"
  });
  const savedEnv = globalThis.__NUVIO_ENV__;
  globalThis.__NUVIO_ENV__ = { PROBE_PAGE_LIMIT: 1 };
  try {
    const result = await run.call(
      {},
      rows,
      {
        streamAutoPlayMode: "FIRST_STREAM",
        streamAutoPlayHdrPreference: "PREFER",
        streamAutoPlaySelectedAddons: ["Chosen"]
      },
      { installedAddonNames: new Set(["Chosen", "Other"]) }
    );
    assert.deepEqual(probes, ["https://cdn.test/21"]);
    assert.deepEqual(
      result.map((s) => s.id),
      ["21"]
    );
    assert.equal(assessments, 1);
    // Manual auto-next searches all source addons, but Only Direct still owns label scope.
    probes.length = 0;
    const manual = await run.call(
      {},
      rows,
      { streamAutoPlayMode: "MANUAL" },
      { installedAddonNames: new Set(["Chosen", "Other"]) }
    );
    assert.deepEqual(probes, ["https://cdn.test/0"]);
    assert.deepEqual(
      manual.map((s) => s.id),
      ["0"]
    );
  } finally {
    globalThis.__NUVIO_ENV__ = savedEnv;
  }
});
