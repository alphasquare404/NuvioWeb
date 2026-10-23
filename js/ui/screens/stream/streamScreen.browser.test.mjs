import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

async function loadStreamScreen(instance = "") {
  const result = await build({
    entryPoints: [fileURLToPath(new URL("./streamScreen.js", import.meta.url))],
    banner: { js: "// test instance: " + instance },
    bundle: true,
    format: "esm",
    platform: "node",
    write: false,
    plugins: [
      {
        name: "stream-screen-browser-mocks",
        setup(buildApi) {
          const mockPaths = new Map([
            [
              "router",
              `export const Router = { getCurrent: () => "stream", navigate: async () => {}, back: () => {} };`
            ],
            [
              "player-settings",
              `export const PlayerSettingsStore = { get: () => globalThis.__NUVIO_TEST_PLAYER_SETTINGS__ || ({ streamReuseLastLinkEnabled: false, streamReuseLastLinkCacheHours: 24, streamAutoPlayTimeoutSeconds: 0 }) };`
            ],
            [
              "stream-preferences",
              `export const StreamPreferencesStore = { getValid: () => null };`
            ],
            [
              "addon-repository",
              `export const addonRepository = { getCachedInstalledAddons: () => [] };`
            ],
            [
              "badge-settings",
              `export const StreamBadgeSettingsStore = { snapshot: () => globalThis.__NUVIO_TEST_BADGE_SETTINGS__ || ({ showAddonLogo: false }) };`
            ]
          ]);
          for (const [filter, path] of [
            [/router\.js$/, "router"],
            [/playerSettingsStore\.js$/, "player-settings"],
            [/streamPreferencesStore\.js$/, "stream-preferences"],
            [/addonRepository\.js$/, "addon-repository"],
            [/streamBadgeSettingsStore\.js$/, "badge-settings"]
          ]) {
            buildApi.onResolve({ filter }, () => ({ path, namespace: "test" }));
          }
          buildApi.onLoad({ filter: /.*/, namespace: "test" }, (args) => ({
            contents: mockPaths.get(args.path)
          }));
        }
      }
    ]
  });
  return import(
    `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].contents).toString("base64")}`
  );
}

test("StreamScreen mounts its browser route before loading sources", async () => {
  const { StreamScreen } = await loadStreamScreen();
  const originalDocument = globalThis.document;
  const originalRender = StreamScreen.render;
  const originalLoadStreams = StreamScreen.loadStreams;
  const container = { style: { display: "none" } };
  let rendered = 0;
  let loaded = 0;

  globalThis.document = {
    getElementById(id) {
      return id === "stream" ? container : null;
    }
  };
  StreamScreen.render = () => {
    rendered += 1;
  };
  StreamScreen.loadStreams = async () => {
    loaded += 1;
  };

  try {
    await StreamScreen.mount({ itemId: "movie-id", itemType: "movie" });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(container.style.display, "block");
    assert.equal(rendered, 1);
    assert.equal(loaded, 1);
  } finally {
    StreamScreen.render = originalRender;
    StreamScreen.loadStreams = originalLoadStreams;
    if (originalDocument) {
      globalThis.document = originalDocument;
    } else {
      delete globalThis.document;
    }
  }
});

function configureAutoPlayScreen(StreamScreen, { params = {}, streams = [], settings = {} } = {}) {
  StreamScreen.params = params;
  StreamScreen.streams = streams;
  StreamScreen.autoResumeUiActive = false;
  StreamScreen.autoPlayAttempted = false;
  StreamScreen.autoPlayCountdown = null;
  StreamScreen.autoPlaySelectionReady = true;
  StreamScreen.getFilteredStreams = () => streams;
  globalThis.__NUVIO_TEST_PLAYER_SETTINGS__ = {
    streamAutoPlayMode: "FIRST_STREAM",
    streamAutoPlaySource: "ALL_SOURCES",
    streamAutoPlaySelectedAddons: [],
    streamAutoPlaySelectedPlugins: [],
    streamAutoPlayRegex: "",
    streamAutoPlayPreferBingeGroupForNextEpisode: false,
    streamAutoPlayReuseBingeGroup: false,
    ...settings
  };
}

test("Continue Watching movie and episode use the shared auto stream selector", async () => {
  const { StreamScreen } = await loadStreamScreen();
  const originalGetFilteredStreams = StreamScreen.getFilteredStreams;
  const originalPlayStream = StreamScreen.playStream;
  const selected = [];
  StreamScreen.playStream = async function playStream(streamId) {
    selected.push({ streamId, itemId: this.params?.itemId, videoId: this.params?.videoId || null });
  };

  try {
    configureAutoPlayScreen(StreamScreen, {
      params: { itemId: "movie-1", itemType: "movie", continueWatchingBackHome: true },
      streams: [{ id: "movie-stream", url: "https://example.com/movie.m3u8" }]
    });
    StreamScreen.maybeAutoPlayStream({ allLoaded: true });

    configureAutoPlayScreen(StreamScreen, {
      params: {
        itemId: "series-1",
        itemType: "series",
        videoId: "episode-4",
        continueWatchingBackHome: true
      },
      streams: [{ id: "episode-stream", url: "https://example.com/episode.m3u8" }]
    });
    StreamScreen.maybeAutoPlayStream({ allLoaded: true });

    assert.deepEqual(selected, [
      { streamId: "movie-stream", itemId: "movie-1", videoId: null },
      { streamId: "episode-stream", itemId: "series-1", videoId: "episode-4" }
    ]);
  } finally {
    StreamScreen.getFilteredStreams = originalGetFilteredStreams;
    StreamScreen.playStream = originalPlayStream;
    delete globalThis.__NUVIO_TEST_PLAYER_SETTINGS__;
  }
});

test("manual auto-stream mode leaves Continue Watching Stream Selection open", async () => {
  const { StreamScreen } = await loadStreamScreen();
  const originalGetFilteredStreams = StreamScreen.getFilteredStreams;
  const originalPlayStream = StreamScreen.playStream;
  let selected = false;
  StreamScreen.playStream = async () => {
    selected = true;
  };

  try {
    configureAutoPlayScreen(StreamScreen, {
      params: { itemId: "movie-1", itemType: "movie", continueWatchingBackHome: true },
      streams: [{ id: "movie-stream", url: "https://example.com/movie.m3u8" }],
      settings: { streamAutoPlayMode: "MANUAL" }
    });
    StreamScreen.maybeAutoPlayStream({ allLoaded: true });

    assert.equal(selected, false);
    assert.equal(StreamScreen.autoPlayAttempted, false);
  } finally {
    StreamScreen.getFilteredStreams = originalGetFilteredStreams;
    StreamScreen.playStream = originalPlayStream;
    delete globalThis.__NUVIO_TEST_PLAYER_SETTINGS__;
  }
});

test("no eligible auto stream keeps shared Stream Selection behavior for Continue Watching and ordinary Detail", async () => {
  const { StreamScreen } = await loadStreamScreen();
  const originalGetFilteredStreams = StreamScreen.getFilteredStreams;
  const originalPlayStream = StreamScreen.playStream;
  const selected = [];
  StreamScreen.playStream = async (streamId) => {
    selected.push(streamId);
  };

  try {
    for (const params of [
      { itemId: "movie-1", itemType: "movie", continueWatchingBackHome: true },
      { itemId: "movie-2", itemType: "movie" }
    ]) {
      configureAutoPlayScreen(StreamScreen, {
        params,
        streams: [{ id: "not-playable" }]
      });
      StreamScreen.maybeAutoPlayStream({ allLoaded: true });
      assert.equal(StreamScreen.autoPlayAttempted, true);
    }
    assert.deepEqual(selected, []);
  } finally {
    StreamScreen.getFilteredStreams = originalGetFilteredStreams;
    StreamScreen.playStream = originalPlayStream;
    delete globalThis.__NUVIO_TEST_PLAYER_SETTINGS__;
  }
});

const directProbe = { container: "mp4", videoCodec: "h264", audioCodec: "aac", audioChannels: 2 };
async function probeTestScreen(name, limit, run) {
  const saved = {
    env: globalThis.__NUVIO_ENV__,
    fetch: globalThis.fetch,
    media: globalThis.MediaSource,
    document: globalThis.document
  };
  const requests = [];
  globalThis.__NUVIO_ENV__ = {
    PROBE_ENDPOINT: "https://probe.test/probe",
    PROBE_PAGE_LIMIT: limit,
    REMUX_ENDPOINT: "/api/remux"
  };
  globalThis.MediaSource = { isTypeSupported: () => true };
  globalThis.document = {
    createElement: () => ({ canPlayType: (type) => (type.includes("matroska") ? "" : "probably") })
  };
  globalThis.fetch = async (url) => {
    requests.push(new URL(url).searchParams.get("u"));
    return { ok: true, json: async () => ({ ok: true, ...directProbe }) };
  };
  try {
    const { StreamScreen } = await loadStreamScreen(name);
    const screen = Object.assign(Object.create(StreamScreen), {
      streams: Array.from({ length: 8 }, (_, i) => ({
        id: String(i),
        url: "https://video.test/" + i + ".mp4",
        name: "H264 AAC"
      })),
      sourceChips: [],
      addonFilter: "all",
      _probeResults: new Map(),
      _probeSent: new Set(),
      _probePending: new Set(),
      _probeFailed: new Set(),
      _probeAttempts: new Map(),
      _probeCooldownUntil: new Map(),
      loadToken: 1,
      requestRender() {}
    });
    await run(screen, requests);
  } finally {
    globalThis.__NUVIO_ENV__ = saved.env;
    globalThis.fetch = saved.fetch;
    globalThis.MediaSource = saved.media;
    globalThis.document = saved.document;
    globalThis.__NUVIO_TEST_BADGE_SETTINGS__ = saved.badgeSettings;
    globalThis.__NUVIO_TEST_PLAYER_SETTINGS__ = saved.playerSettings;
  }
}

test("probe-only labels examine text-Direct rows and respect the page cap across passes", async () => {
  await probeTestScreen("bounded", 3, async (screen, requests) => {
    await screen.runUnknownProbes();
    await screen.runUnknownProbes();
    assert.equal(requests.length, 3);
    assert.equal(screen._probeResults.size, 3);
    assert.equal(screen.probesSettled(), true, "rows outside the cap must not block autoplay");
  });
});

test("zero page limit probes all eligible rows", async () => {
  await probeTestScreen("unlimited", 0, async (screen, requests) => {
    await screen.runUnknownProbes();
    assert.equal(requests.length, 8);
    assert.equal(screen.probesSettled(), true);
  });
});

test("auto-resolved handoff adopts probe evidence before selecting playback", async () => {
  await probeTestScreen("handoff", 3, async (screen) => {
    const stream = screen.streams[0];
    screen.params = {
      autoResolvedStreams: [stream],
      autoResolvedStreamId: stream.id,
      autoResolvedProbes: [[stream.url, directProbe]]
    };
    screen.applyAddonLogos = (rows) => rows;
    screen.buildSourceChipsFromStreams = () => [];
    screen.refreshOfflineDownloadMetadata = async () => {};
    screen.scheduleDebridPreparation = () => {};
    screen.restoreListAfterHandoff = () => {};
    let evidence;
    screen.playStream = async () => {
      evidence = screen._probeResults.get(stream.url);
    };
    assert.equal(screen.adoptAutoResolvedStreams(), true);
    assert.deepEqual(evidence, directProbe);
  });
});

test("a late probe answer cannot mutate a departed screen", async () => {
  await probeTestScreen("departed", 3, async (screen) => {
    let finish;
    const response = new Promise((resolve) => {
      finish = resolve;
    });
    globalThis.fetch = () => response;
    const running = screen.runUnknownProbes();
    screen.loadToken += 1;
    finish({ ok: true, json: async () => ({ ok: true, ...directProbe }) });
    await running;
    assert.equal(screen._probeResults.size, 0);
  });
});

test("probe timeout still selects an already confirmed Direct stream", async () => {
  await probeTestScreen("deadline", 3, async (screen) => {
    const stream = screen.streams[0];
    configureAutoPlayScreen(screen, {
      streams: [stream],
      settings: { showOnlyDirectStreams: true }
    });
    screen._probeOutstanding = true;
    screen._autoPlayProbeDeadline = Date.now() - 1;
    let selected = null;
    screen.playStream = async (id) => {
      selected = id;
    };
    screen.maybeAutoPlayStream({ allLoaded: true });
    assert.equal(selected, stream.id);
    delete globalThis.__NUVIO_TEST_PLAYER_SETTINGS__;
  });
});

function configureLabelScope(screen) {
  screen.streams = [
    { id: "aio-direct", addonName: "AIOStreams", url: "https://media.test/aio.mp4" },
    { id: "aio-remux", addonName: "AIOStreams", url: "https://media.test/remux.mp4" },
    { id: "other-direct", addonName: "Torrentio", url: "https://media.test/other.mp4" },
    { id: "aio-unknown", addonName: "AIOStreams", url: "https://media.test/unknown.mp4" }
  ];
  for (const stream of screen.streams.slice(0, 3)) {
    screen._probeResults.set(stream.url, {
      ...directProbe,
      container: stream.id === "aio-remux" ? "mkv" : "mp4"
    });
  }
  globalThis.__NUVIO_TEST_BADGE_SETTINGS__ = {
    showPlaybackLabels: true,
    labelAddons: ["AIOStreams"]
  };
  globalThis.__NUVIO_TEST_PLAYER_SETTINGS__ = { showOnlyDirectStreams: false };
}

test("label addon preferences keep all sources visible while Only Direct is off", async () => {
  await probeTestScreen("all-sources-labels", 0, async (screen) => {
    configureLabelScope(screen);
    for (const labels of [true, false]) {
      globalThis.__NUVIO_TEST_BADGE_SETTINGS__.showPlaybackLabels = labels;
      assert.deepEqual(
        screen
          .getFilteredStreams()
          .map((s) => s.id)
          .sort(),
        screen.streams.map((s) => s.id).sort()
      );
      assert.deepEqual(
        screen.getFilteredStreams("Torrentio").map((s) => s.id),
        ["other-direct"]
      );
    }
  });
});

test("Only Direct scopes results to label addons and updates an existing filter cache", async () => {
  await probeTestScreen("direct-label-scope", 0, async (screen) => {
    configureLabelScope(screen);
    assert.equal(screen.getFilteredStreams().length, 4);
    globalThis.__NUVIO_TEST_PLAYER_SETTINGS__.showOnlyDirectStreams = true;
    assert.deepEqual(
      screen.getFilteredStreams().map((s) => s.id),
      ["aio-direct"]
    );
    globalThis.__NUVIO_TEST_BADGE_SETTINGS__.showPlaybackLabels = false;
    assert.deepEqual(
      screen.getFilteredStreams().map((s) => s.id),
      ["aio-direct"]
    );
    globalThis.__NUVIO_TEST_BADGE_SETTINGS__.labelAddons = [];
    assert.deepEqual(
      screen.getFilteredStreams().map((s) => s.id),
      ["aio-direct", "other-direct"]
    );
    globalThis.__NUVIO_TEST_PLAYER_SETTINGS__.showOnlyDirectStreams = false;
    assert.equal(screen.getFilteredStreams().length, 4);
  });
});

test("page probing applies label addon scope before spending its cap", async () => {
  await probeTestScreen("probe-label-scope", 1, async (screen, requests) => {
    screen.streams = screen.streams.map((s, i) => ({
      ...s,
      addonName: i < 6 ? "Torrentio" : "AIOStreams"
    }));
    globalThis.__NUVIO_TEST_BADGE_SETTINGS__ = {
      showPlaybackLabels: true,
      labelAddons: ["AIOStreams"]
    };
    await screen.runUnknownProbes();
    assert.deepEqual(requests, [screen.streams[6].url]);
    assert.equal(screen.probesSettled(), true);
    assert.equal(
      screen.getFilteredStreams().length,
      8,
      "unlabelled addons stay in the manual list"
    );
  });
});

test("late labels cannot autoplay or resume after Finding stream has finished", async () => {
  const { StreamScreen: screen } = await loadStreamScreen("selection-finished");
  const saved = globalThis.__NUVIO_TEST_PLAYER_SETTINGS__;
  try {
    configureAutoPlayScreen(screen, {
      params: { autoSelectionFinished: true, resumePositionMs: 120000 },
      streams: [{ id: "late-direct", url: "https://media.test/late.mp4" }]
    });
    let plays = 0;
    screen.playStream = async () => {
      plays++;
    };
    screen.autoResumeAttempted = false;
    screen.maybeAutoResumeStream({ allLoaded: true });
    screen.maybeAutoPlayStream({ allLoaded: true });
    assert.equal(plays, 0);
    assert.equal(screen.autoResumeAttempted, true);
  } finally {
    globalThis.__NUVIO_TEST_PLAYER_SETTINGS__ = saved;
  }
});

test("filename container hints do not exclude an otherwise eligible probe", async () => {
  await probeTestScreen("probe-file-facts", 1, async (screen) => {
    screen.streams = screen.streams.map((stream) => ({
      ...stream,
      name: "Addon claims movie.mkv"
    }));
    const candidates = screen.getProbeCandidates();
    assert.equal(candidates.length, 1);
    assert.equal(candidates[0].id, screen.streams[0].id);
  });
});

test("source preparation uses the MKV capability verdict even when remux is configured", async () => {
  await probeTestScreen("remux-verdict", 0, async (screen) => {
    const source = { url: "https://media.test/source.mkv", name: "H264 AAC" };
    const relayCalls = [];
    screen.remuxPlaylistUrl = async (url) => {
      relayCalls.push(url);
      return "/api/remux/hls/test/index.m3u8";
    };
    screen.isPlayableHlsPlaylist = async () => true;
    for (const containerSupported of [true, false]) {
      screen._probeResults.set(source.url, {
        ...directProbe,
        container: "mkv",
        playbackCapabilities: {
          engine: "native",
          video: true,
          container: containerSupported,
          audio: [{ index: 0, supported: true }],
          relayVideo: true
        }
      });
      const prepared = await screen.resolvePlayerSource(source);
      assert.equal(prepared, containerSupported ? source.url : "/api/remux/hls/test/index.m3u8");
      assert.equal(relayCalls.length, containerSupported ? 0 : 1);
    }
  });
});
