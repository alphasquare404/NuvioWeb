import test from "node:test";
import assert from "node:assert/strict";

globalThis.__NUVIO_INCLUDE_TRAKT_CLIENT_SECRET__ = false;
globalThis.__NUVIO_PLATFORM__ = "browser";

const { PlayerController } = await import("./playerController.js");
const { Platform } = await import("../../platform/index.js");

const originalVideo = PlayerController.video;
const originalPlatform = Platform.current;
const originalDashJs = globalThis.dashjs;
const originalWebapis = globalThis.webapis;

function videoWithSupport(supportedMimeTypes = []) {
  const supported = new Set(supportedMimeTypes);
  return {
    canPlayType(mimeType) {
      return supported.has(mimeType) ? "probably" : "";
    }
  };
}

test.after(() => {
  PlayerController.video = originalVideo;
  Platform.current = originalPlatform;
  globalThis.dashjs = originalDashJs;
  globalThis.webapis = originalWebapis;
  delete globalThis.__NUVIO_PLATFORM__;
});

test("browser engine selection preserves direct, HLS, DASH, and local playback paths", () => {
  PlayerController.video = videoWithSupport([
    "application/vnd.apple.mpegurl",
    "application/dash+xml"
  ]);
  globalThis.dashjs = {
    MediaPlayer() {
      return { create() {} };
    }
  };

  assert.deepEqual(
    PlayerController.getPlaybackEngineCandidates("https://media.example/video.mp4", "video/mp4"),
    ["native-file"]
  );
  assert.deepEqual(
    PlayerController.getPlaybackEngineCandidates("https://media.example/stream.m3u8", "application/vnd.apple.mpegurl"),
    ["hls.js", "native-hls"]
  );
  assert.deepEqual(
    PlayerController.getPlaybackEngineCandidates("https://media.example/stream.mpd", "application/dash+xml"),
    ["native-dash", "dash.js"]
  );
  assert.deepEqual(
    PlayerController.getPlaybackEngineCandidates("blob:https://nuvio.example/offline-copy", "video/mp4"),
    ["native-file"]
  );
});

test("TV-native engines are never selectable from the browser PlayerController", () => {
  PlayerController.video = videoWithSupport(["application/vnd.apple.mpegurl"]);
  Platform.current = { name: "tizen" };
  globalThis.webapis = { avplay: { open() {} } };

  const candidates = PlayerController.getPlaybackEngineCandidates(
    "https://media.example/stream.m3u8",
    "application/vnd.apple.mpegurl"
  );

  assert.equal(PlayerController.canUseAvPlay(), false);
  assert.equal(PlayerController.getPlatformAvplayEngineName(), "none");
  assert.equal(PlayerController.shouldPreferTvNativePipeline(), false);
  assert.equal(candidates.some((candidate) => candidate.includes("avplay")), false);
});
