import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import {
  PLAYBACK_SETTINGS_GROUPS,
  activePlaybackSettingsGroup,
  togglePlaybackSettingsGroup,
  subtitleSettingsPreviewStyle,
  SETTINGS_STREAM_PREVIEW_SOURCES,
  settingsStreamPreviewSources
} from "./playbackSettingsPresentation.js";

test("compact Playback opens one topic and allows closing it", () => {
  const initial = { general: true, audio: false, stream: true };
  const audio = togglePlaybackSettingsGroup(initial, "audio");
  assert.deepEqual(
    PLAYBACK_SETTINGS_GROUPS.filter((id) => audio[id]),
    ["audio"]
  );
  assert.equal(audio.stream, true);
  assert.equal(initial.general, true);
  assert.equal(activePlaybackSettingsGroup(togglePlaybackSettingsGroup(audio, "audio")), null);
});

test("wide Playback always has a selected topic and cannot close its selected tab", () => {
  assert.equal(activePlaybackSettingsGroup({}, true), "general");
  const audio = togglePlaybackSettingsGroup({}, "audio", true);
  assert.equal(
    activePlaybackSettingsGroup(togglePlaybackSettingsGroup(audio, "audio", true), true),
    "audio"
  );
});

test("old persisted multi-open state resolves consistently and unknown actions preserve it", () => {
  const old = { audio: true, subtitles: true, stream: true };
  assert.equal(activePlaybackSettingsGroup(old), "audio");
  assert.deepEqual(togglePlaybackSettingsGroup(old, "missing"), old);
  assert.deepEqual(
    PLAYBACK_SETTINGS_GROUPS.filter((id) => togglePlaybackSettingsGroup(old, "subtitles")[id]),
    ["subtitles"]
  );
});

test("subtitle preview follows saved appearance and constrains unsafe CSS values", () => {
  assert.deepEqual(
    subtitleSettingsPreviewStyle({
      fontSize: 150,
      verticalOffset: 10,
      bold: true,
      textColor: "#abcdef",
      backgroundColor: "#12345678",
      outlineEnabled: true,
      outlineColor: "#010203"
    }),
    {
      size: 30,
      bottom: 35,
      weight: 700,
      color: "#abcdef",
      background: "#12345678",
      outline: "#010203"
    }
  );
  const invalid = subtitleSettingsPreviewStyle({
    fontSize: Infinity,
    verticalOffset: 999,
    textColor: "red;display:none",
    backgroundColor: "url(https://example.com)",
    outlineEnabled: false
  });
  assert.equal(invalid.size, 24);
  assert.equal(invalid.bottom, 75);
  assert.equal(invalid.color, "#FFFFFF");
  assert.equal(invalid.background, "#00000000");
  assert.equal(invalid.outline, "transparent");
});

test("stream preview is display-only and has no fetchable media source", () => {
  assert.equal(SETTINGS_STREAM_PREVIEW_SOURCES.length, 5);
  assert.deepEqual(
    SETTINGS_STREAM_PREVIEW_SOURCES.map((source) => source.previewMethod),
    ["direct", "remux", "audio-transcode", "transcode", "unknown"]
  );
  for (const source of SETTINGS_STREAM_PREVIEW_SOURCES) {
    assert.ok(source.behaviorHints.filename);
    assert.equal(source.url, undefined);
    assert.equal(source.externalUrl, undefined);
    assert.equal(source.infoHash, undefined);
  }
});

test("Playback summary translations use the application's interpolation format", async () => {
  for (const locale of ["values", "values-id"]) {
    const xml = await readFile(
      new URL(`../../../../res/${locale}/strings.xml`, import.meta.url),
      "utf8"
    );
    assert.match(xml, /name="settings_summary_player">[^<]*\{\{loading\}\}[^<]*\{\{clock\}\}/);
    assert.match(xml, /name="settings_summary_next">[^<]*\{\{state\}\}/);
  }
});

test("illustrative preview follows the display filter without changing device classification", () => {
  assert.deepEqual(
    settingsStreamPreviewSources().map((source) => source.previewMethod),
    ["direct", "remux", "audio-transcode", "transcode", "unknown"]
  );
  assert.deepEqual(
    settingsStreamPreviewSources({ filenameStreamFilter: ["direct"] }).map(
      (source) => source.previewMethod
    ),
    ["direct"]
  );
  assert.deepEqual(
    settingsStreamPreviewSources({ filenameStreamDisplayMode: "DIRECT_REMUX" }).map(
      (source) => source.previewMethod
    ),
    ["direct", "remux"]
  );
});
