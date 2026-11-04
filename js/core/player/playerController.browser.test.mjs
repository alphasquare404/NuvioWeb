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
      assert.ok(
        warnings.some(
          ([label, error]) => label === "Playback start rejected" && error === rejection
        )
      );
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
    PlayerController.getPlaybackEngineCandidates(
      "https://media.example/stream.m3u8",
      "application/vnd.apple.mpegurl"
    ),
    ["hls.js", "native-hls"]
  );
  assert.deepEqual(
    PlayerController.getPlaybackEngineCandidates(
      "https://media.example/stream.mpd",
      "application/dash+xml"
    ),
    ["native-dash", "dash.js"]
  );
  assert.deepEqual(
    PlayerController.getPlaybackEngineCandidates(
      "blob:https://nuvio.example/offline-copy",
      "video/mp4"
    ),
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
  assert.equal(
    candidates.some((candidate) => candidate.includes("avplay")),
    false
  );
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

test("native subtitle switching leaves timed metadata enabled and uses original indices", () => {
  const oldVideo = PlayerController.video;
  const metadata = { kind: "metadata", mode: "hidden" };
  const english = { kind: "subtitles", mode: "disabled" };
  const french = { kind: "captions", mode: "showing" };
  PlayerController.video = { textTracks: [metadata, english, french] };
  try {
    assert.equal(PlayerController.setNativeTextTrack(1), true);
    assert.equal(metadata.mode, "hidden");
    assert.equal(english.mode, "showing");
    assert.equal(french.mode, "disabled");
    PlayerController.setNativeTextTrack(-1);
    assert.equal(metadata.mode, "hidden");
    assert.equal(english.mode, "disabled");
  } finally {
    PlayerController.video = oldVideo;
  }
});

test("Safari forced-kind subtitle is selectable without disabling metadata", () => {
  const old = PlayerController.video;
  const metadata = { kind: "metadata", mode: "hidden" },
    standard = { kind: "subtitles", mode: "showing" },
    forced = { kind: "forced", mode: "disabled" };
  PlayerController.video = { textTracks: [metadata, standard, forced] };
  try {
    assert.equal(PlayerController.setNativeTextTrack(2), true);
    assert.equal(forced.mode, "showing");
    assert.equal(standard.mode, "disabled");
    assert.equal(metadata.mode, "hidden");
  } finally {
    PlayerController.video = old;
  }
});

test("client controller seeks through adapter, preserves logical timeline and suppresses restore completion", async () => {
  const old = { video: PlayerController.video, clientRemux: PlayerController.clientRemux };
  let seeks = [],
    state = {
      position: 45,
      duration: 600,
      restoring: true,
      audioIndex: 1,
      audioTracks: [{ supported: false }, { supported: true }]
    };
  try {
    PlayerController.video = { currentTime: 0, duration: NaN, ended: true };
    PlayerController.clientRemux = {
      snapshot: () => state,
      seek: async (t) => seeks.push(t),
      selectAudio: async () => true
    };
    assert.equal(PlayerController.getCurrentTimeSeconds(), 45);
    assert.equal(PlayerController.getDurationSeconds(), 600);
    assert.equal(PlayerController.isPlaybackEnded(), false);
    assert.equal(PlayerController.seekToSeconds(300), true);
    assert.deepEqual(seeks, [300]);
    assert.equal(PlayerController.video.currentTime, 0);
    assert.equal(PlayerController.setBrowserAudioTrack(0), false);
    assert.equal(PlayerController.getBrowserAudioTracks()[1].selected, true);
    assert.equal(
      await PlayerController.flushProgress(445000, 600000, false, { itemId: "restore-test" }),
      false
    );
    state.restoring = false;
    assert.equal(PlayerController.isPlaybackEnded(), true);
  } finally {
    Object.assign(PlayerController, old);
  }
});
test("controller disposal awaits worker/cache cleanup without retaining the adapter", async () => {
  const old = PlayerController.clientRemux;
  let release,
    finished = false;
  const deferred = new Promise((r) => (release = r));
  PlayerController.clientRemux = {
    dispose: async () => {
      await deferred;
      finished = true;
    }
  };
  try {
    const cleanup = PlayerController.disposeClientRemux();
    assert.equal(PlayerController.clientRemux, null);
    assert.equal(finished, false);
    release();
    await cleanup;
    assert.equal(finished, true);
  } finally {
    PlayerController.clientRemux = old;
  }
});

test("client route offers no native/adaptive engine fallback", () => {
  const old = PlayerController.clientRemux;
  try {
    PlayerController.clientRemux = {};
    assert.equal(PlayerController.getAlternativePlaybackEngine("https://cdn.test/file.mkv"), null);
    assert.ok(
      PlayerController.getAttemptedPlaybackEngines("https://cdn.test/file.mkv") instanceof Set
    );
  } finally {
    PlayerController.clientRemux = old;
  }
});

test("client startup diagnostics retain bounded playback facts and exclude source data", () => {
  const previous = { clientRemux: PlayerController.clientRemux, video: PlayerController.video };
  try {
    PlayerController.video = { paused: true, readyState: 2 };
    PlayerController.clientRemux = {
      snapshot: () => ({
        state: "backpressure",
        backpressureReason: "managed",
        restoring: false,
        position: 0,
        duration: 120,
        targetSourceBytes: 1024,
        sourceUrl: "https://private.test/token",
        reason: "https://private.test/token",
        audioTracks: [{ label: "private" }]
      })
    };
    const text = PlayerController.getClientRemuxStartupDiagnostic(),
      facts = JSON.parse(text);
    assert.equal(facts.state, "backpressure");
    assert.equal(facts.readyState, 2);
    assert.equal(facts.paused, true);
    assert.equal(text.includes("private"), false);
    assert.equal("sourceUrl" in facts, false);
  } finally {
    Object.assign(PlayerController, previous);
  }
});

test("client remux diagnostics use the available Safari frame counter and report startup coverage", () => {
  const video = PlayerController.video,
    runtime = PlayerController.clientRemux;
  try {
    PlayerController.clientRemux = {
      snapshot: () => ({
        startupPhase: "buffering-startup",
        startupBufferedAheadSeconds: 0.35,
        startupRequiredAheadSeconds: 4
      })
    };
    PlayerController.video = { getVideoPlaybackQuality: () => ({ totalVideoFrames: 92 }) };
    const facts = JSON.parse(PlayerController.getClientRemuxStartupDiagnostic());
    assert.equal(facts.decodedFrames, 92);
    assert.equal(facts.startupRequiredAheadSeconds, 4);
    assert.equal(facts.startupBufferedAheadSeconds, 0.35);
    assert.equal(facts.startupPhase, "buffering-startup");
    PlayerController.video = {};
    assert.equal(
      JSON.parse(PlayerController.getClientRemuxStartupDiagnostic()).decodedFrames,
      null
    );
    PlayerController.video = { webkitDecodedFrameCount: 8 };
    assert.equal(JSON.parse(PlayerController.getClientRemuxStartupDiagnostic()).decodedFrames, 8);
  } finally {
    PlayerController.video = video;
    PlayerController.clientRemux = runtime;
  }
});

test("server HLS duration uses source facts before ENDLIST and cannot leak into another URL", () => {
  const controller = {
    clientRemux: null,
    currentPlaybackUrl: "/relay-a",
    video: { duration: Infinity },
    lastKnownDurationSeconds: 0
  };
  const setHint = PlayerController.setSourceDurationHint;
  assert.equal(typeof setHint, "function");
  setHint.call(controller, "/relay-a", 3119.104);
  assert.equal(PlayerController.getDurationSeconds.call(controller), 3119.104);
  controller.video.duration = 12;
  assert.equal(PlayerController.getDurationSeconds.call(controller), 3119.104);
  setHint.call(controller, "/relay-a", NaN);
  assert.equal(PlayerController.getDurationSeconds.call(controller), 3119.104);
  controller.currentPlaybackUrl = "/relay-b";
  controller.video.duration = Infinity;
  controller.lastKnownDurationSeconds = 0;
  assert.equal(PlayerController.getDurationSeconds.call(controller), 0);
});

test("relative HLS with a nested MKV source loads the HLS engine libraries", () => {
  assert.equal(
    PlayerController.guessMediaMimeType(
      "/api/transcode/hls/index.m3u8?u=https%3A%2F%2Fcdn.test%2Fmovie.mkv&v=copy&a=copy&audios=0%2C1"
    ),
    "application/vnd.apple.mpegurl"
  );
});
