import test from "node:test";
import assert from "node:assert/strict";

globalThis.__NUVIO_PLATFORM__ = "browser";

const { PlayerController } = await import("./playerController.js");

const originalVideo = PlayerController.video;
const originalVideoElementListeners = PlayerController.videoElementListeners;
const originalHlsInstance = PlayerController.hlsInstance;
const originalDashInstance = PlayerController.dashInstance;
const originalPlaybackEngine = PlayerController.playbackEngine;
const originalDashJs = globalThis.dashjs;

function createBrowserPlaybackVideo(play) {
  const listeners = new Map();
  return {
    muted: false,
    defaultMuted: false,
    volume: 1,
    currentTime: 0,
    duration: 0,
    addEventListener(eventName, handler) {
      listeners.set(eventName, handler);
    },
    removeEventListener(eventName) {
      listeners.delete(eventName);
    },
    querySelectorAll() {
      return [];
    },
    removeAttribute() {},
    appendChild() {},
    dispatchEvent() {},
    pause() {},
    load() {},
    play
  };
}

async function withBrowserDocument(run) {
  const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: {
      createElement() {
        return {};
      }
    }
  });
  try {
    return await run();
  } finally {
    if (originalDescriptor) {
      Object.defineProperty(globalThis, "document", originalDescriptor);
    } else {
      delete globalThis.document;
    }
  }
}

function clearPlaybackTimer() {
  if (PlayerController.progressSaveTimer) {
    clearInterval(PlayerController.progressSaveTimer);
    PlayerController.progressSaveTimer = null;
  }
}

function videoWithSupport(supportedMimeTypes = []) {
  const supported = new Set(supportedMimeTypes);
  return {
    canPlayType(mimeType) {
      return supported.has(mimeType) ? "probably" : "";
    }
  };
}

test.after(() => {
  clearPlaybackTimer();
  PlayerController.video = originalVideo;
  PlayerController.videoElementListeners = originalVideoElementListeners;
  PlayerController.hlsInstance = originalHlsInstance;
  PlayerController.dashInstance = originalDashInstance;
  PlayerController.playbackEngine = originalPlaybackEngine;
  globalThis.dashjs = originalDashJs;
  delete globalThis.__NUVIO_PLATFORM__;
});

test("browser bindVideoElement initializes a native video element without platform globals", () => {
  const listeners = new Map();
  const video = {
    addEventListener(eventName, handler) {
      listeners.set(eventName, handler);
    },
    removeEventListener(eventName) {
      listeners.delete(eventName);
    }
  };

  assert.doesNotThrow(() => PlayerController.bindVideoElement(video));
  assert.equal(PlayerController.video, video);
  assert.equal(typeof listeners.get("ended"), "function");
  assert.equal(typeof listeners.get("error"), "function");
});

test("native-file playback calls the browser media element without TV helpers", async () => {
  let playCalls = 0;
  await withBrowserDocument(async () => {
    const video = createBrowserPlaybackVideo(() => {
      playCalls += 1;
      return Promise.resolve();
    });
    PlayerController.bindVideoElement(video);

    await assert.doesNotReject(
      PlayerController.play("https://media.example/video.mp4", {
        mediaSourceType: "video/mp4"
      })
    );

    assert.equal(playCalls, 1);
    assert.equal(PlayerController.playbackEngine, "native-file");
    assert.equal(PlayerController.isPlaying, true);
  });
  clearPlaybackTimer();
});

test("browser native-file play rejections use the normal rejection path", async () => {
  const rejection = new Error("NotAllowedError");
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...args) => warnings.push(args);
  try {
    await withBrowserDocument(async () => {
      const video = createBrowserPlaybackVideo(() => Promise.reject(rejection));
      PlayerController.bindVideoElement(video);

      await assert.doesNotReject(
        PlayerController.play("https://media.example/rejected.mp4", {
          mediaSourceType: "video/mp4"
        })
      );
      await new Promise((resolve) => setTimeout(resolve, 0));

      assert.equal(PlayerController.isPlaying, false);
      assert.ok(warnings.some(([label, error]) => label === "Playback start rejected" && error === rejection));
    });
  } finally {
    console.warn = originalWarn;
    clearPlaybackTimer();
  }
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

test("native-TV engines are absent from the browser PlayerController", () => {
  PlayerController.video = videoWithSupport(["application/vnd.apple.mpegurl"]);

  const candidates = PlayerController.getPlaybackEngineCandidates(
    "https://media.example/stream.m3u8",
    "application/vnd.apple.mpegurl"
  );

  assert.equal("canUseAvPlay" in PlayerController, false);
  assert.equal("getPlatformAvplayEngineName" in PlayerController, false);
  assert.equal("shouldPreferTvNativePipeline" in PlayerController, false);
  assert.equal(candidates.some((candidate) => candidate.includes("avplay")), false);
});

test("browser HLS audio tracks are discovered and switched through hls.js", () => {
  let startLoadCalls = 0;
  const hls = {
    audioTracks: [
      { id: "ja", name: "Japanese", lang: "ja" },
      { id: "en", name: "English", lang: "en" }
    ],
    audioTrack: 0,
    nextAudioTrack: -1,
    startLoad() {
      startLoadCalls += 1;
    }
  };
  PlayerController.video = { dispatchEvent() {} };
  PlayerController.hlsInstance = hls;
  PlayerController.dashInstance = null;
  PlayerController.playbackEngine = "hls.js";

  assert.deepEqual(
    PlayerController.getBrowserAudioTracks().map(({ label, language, selected, engine }) => ({
      label,
      language,
      selected,
      engine
    })),
    [
      { label: "Japanese", language: "ja", selected: true, engine: "hls.js" },
      { label: "English", language: "en", selected: false, engine: "hls.js" }
    ]
  );
  assert.equal(PlayerController.setBrowserAudioTrack(1), true);
  assert.equal(hls.audioTrack, 1);
  assert.equal(hls.nextAudioTrack, 1);
  assert.equal(startLoadCalls, 1);
  assert.equal(PlayerController.getBrowserAudioTracks()[1].selected, true);
});

test("browser DASH audio tracks are discovered and switched through dash.js", () => {
  const tracks = [
    { id: "audio-ja", lang: "ja", labels: [{ text: "Japanese" }] },
    { id: "audio-en", lang: "en", labels: [{ text: "English" }] }
  ];
  let current = tracks[0];
  let selectedTrack = null;
  PlayerController.video = { currentTime: 120, dispatchEvent() {} };
  PlayerController.hlsInstance = null;
  PlayerController.dashInstance = {
    getTracksFor(type) {
      return type === "audio" ? tracks : [];
    },
    getCurrentTrackFor(type) {
      return type === "audio" ? current : null;
    },
    setCurrentTrack(track) {
      selectedTrack = track;
      current = track;
    }
  };
  PlayerController.playbackEngine = "dash.js";

  assert.equal(PlayerController.getBrowserAudioTracks()[0].selected, true);
  assert.equal(PlayerController.setBrowserAudioTrack(1), true);
  assert.equal(selectedTrack, tracks[1]);
  assert.equal(PlayerController.getBrowserAudioTracks()[1].selected, true);
  assert.equal(PlayerController.video.currentTime, 119.999);
});

test("browser native audioTracks are feature-detected and switched without TV APIs", () => {
  const tracks = [
    { id: "ja", label: "Japanese", language: "ja", enabled: true },
    { id: "en", label: "English", language: "en", enabled: false }
  ];
  PlayerController.video = { audioTracks: tracks, dispatchEvent() {} };
  PlayerController.hlsInstance = null;
  PlayerController.dashInstance = null;
  PlayerController.playbackEngine = "native-file";

  assert.equal(PlayerController.getBrowserAudioTracks().length, 2);
  assert.equal(PlayerController.setBrowserAudioTrack(1), true);
  assert.equal(tracks[0].enabled, false);
  assert.equal(tracks[1].enabled, true);
  assert.equal(PlayerController.getBrowserAudioTracks()[1].selected, true);
});

test("browser native playback without audioTracks exposes no fake selectable tracks", () => {
  PlayerController.video = { dispatchEvent() {} };
  PlayerController.hlsInstance = null;
  PlayerController.dashInstance = null;
  PlayerController.playbackEngine = "native-file";

  assert.deepEqual(PlayerController.getBrowserAudioTracks(), []);
  assert.equal(PlayerController.setBrowserAudioTrack(0), false);
});

test("changing the adaptive playback source clears browser audio tracks", () => {
  PlayerController.video = { dispatchEvent() {} };
  PlayerController.hlsInstance = {
    audioTracks: [{ id: "ja", name: "Japanese", lang: "ja" }],
    audioTrack: 0,
    destroy() {}
  };
  PlayerController.dashInstance = null;
  PlayerController.playbackEngine = "hls.js";

  assert.equal(PlayerController.getBrowserAudioTracks().length, 1);
  PlayerController.teardownAdaptiveInstances();
  assert.deepEqual(PlayerController.getBrowserAudioTracks(), []);
});
