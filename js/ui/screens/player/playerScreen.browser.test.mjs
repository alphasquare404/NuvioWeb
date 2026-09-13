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

  assert.match(source, /const controlsVisible = Boolean\(this\.controlsVisible\) && !this\.isExternalFrameMode\(\);/);
  assert.match(source, /backButton\.toggleAttribute\("inert", !controlsVisible\);/);
  assert.match(source, /backButton\.setAttribute\("aria-hidden", String\(!controlsVisible\)\);/);
  assert.match(
    desktopCss,
    /#playerUiRoot:not\(\.controls-visible\) \.player-desktop-back-button\s*\{\s*opacity: 0;\s*pointer-events: none;/
  );
});

test("browser Player routes PiP through active-video capability and lifecycle events", async () => {
  const source = await readFile(playerScreenUrl, "utf8");

  assert.match(source, /getBrowserPictureInPictureCapability\(this\.getDesktopPlaybackVideo\(\), document\)/);
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
  assert.match(source, /durationSeconds: manualDurationMs \/ 1000/);
  assert.match(source, /markBrowserExternalPlaybackFinished\(\{ handoff, controller: PlayerController \}\)/);
  assert.match(source, /desktop-external-player-manual-actions/);
  assert.match(source, /desktop-external-player-manual-keep/);
  assert.match(source, /desktop-external-player-manual-set/);
  assert.match(source, /className: "desktop-external-player-primary desktop-external-player-manual-finish"/);
  assert.match(source, /data-nuvio-dialog-preserve-deletion/);
  assert.match(source, /event\.stopPropagation\(\);/);
  assert.match(dialogSource, /data-nuvio-dialog-preserve-deletion/);
  assert.match(componentsCss, /grid-template-columns: minmax\(0, 1fr\) auto minmax\(0, 1fr\) auto minmax\(0, 1fr\);/);
  assert.match(componentsCss, /grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/);
  assert.match(componentsCss, /desktop-external-player-manual-actions \{[\s\S]*?gap: 12px;/);
  assert.match(componentsCss, /width: min\(calc\(100vw - 24px\), 520px\);/);
  assert.match(componentsCss, /desktop-external-player-manual-actions \.nuvio-dialog-button \{[\s\S]*?min-width: 0;/);
  assert.match(componentsCss, /desktop-external-player-manual-actions \.desktop-external-player-manual-keep \{\s*grid-column: 1;/);
  assert.match(componentsCss, /desktop-external-player-manual-actions \.desktop-external-player-manual-set \{\s*grid-column: 2;/);
  assert.match(componentsCss, /desktop-external-player-manual-actions \.nuvio-dialog-button\.focused[\s\S]*?transform: none;/);
  assert.match(componentsCss, /nuvio-dialog-button:last-child:nth-child\(3\).*?grid-column: 1 \/ -1;/s);
  assert.match(componentsCss, /desktop-external-player-primary[\s\S]*?background: var\(--secondary-color, #f5f5f5\);/);
});

test("Player external launches bind the optional Push return subscription before handoff", async () => {
  const source = await readFile(playerScreenUrl, "utf8");

  assert.match(source, /import \{ bindBrowserPushReturn \} from "\.\.\/\.\.\/components\/browserPushReturn\.js";/);
  assert.match(source, /await bindBrowserPushReturn\(\{ token: prepared\.handoff\?\.token \}\);\s*launchBrowserExternalPlayer\(\{ href: prepared\.launch\.href \}\);/);
});
