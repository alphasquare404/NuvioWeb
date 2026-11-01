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
              `export const Router = { getCurrent: () => "stream", navigate: async (...args) => globalThis.__NUVIO_TEST_NAVIGATE__?.(...args), back: () => {} };`
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

const directProbe = {
  container: "mp4",
  videoCodec: "h264",
  codecString: "avc1.640028",
  audioCodec: "aac",
  audioChannels: 2,
  audioStreams: [{ index: 0, codec: "aac", profile: "LC", channels: 2, sampleRate: 48000 }]
};
async function probeTestScreen(name, limit, run, mode = "server", concurrency = 1) {
  const saved = {
    env: globalThis.__NUVIO_ENV__,
    badgeSettings: globalThis.__NUVIO_TEST_BADGE_SETTINGS__,
    playerSettings: globalThis.__NUVIO_TEST_PLAYER_SETTINGS__,
    fetch: globalThis.fetch,
    media: globalThis.MediaSource,
    document: globalThis.document
  };
  const requests = [];
  globalThis.__NUVIO_TEST_BADGE_SETTINGS__ = {
    showPlaybackLabels: true,
    labelAddons: ["TestAddon"],
    clientLabelLimit: 10
  };
  globalThis.__NUVIO_ENV__ = {
    PROBE_ENDPOINT: "https://probe.test/probe",
    PROBE_MODE: mode,
    PROBE_CLIENT_CONCURRENCY: concurrency,
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
        name: "H264 AAC",
        addonName: "TestAddon"
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

test("client stream labels submit one row at a time in source order", async () => {
  const originalWorker = globalThis.Worker;
  const visited = [];
  let peakPending = 0;
  try {
    globalThis.Worker = class {
      terminate() {}
      postMessage(message) {
        queueMicrotask(() =>
          this.onmessage({
            data: { id: message.id, type: "result", result: directProbe }
          })
        );
      }
    };
    await probeTestScreen(
      "client-serial",
      0,
      async (screen) => {
        globalThis.document.baseURI = "https://app.test/";
        globalThis.fetch = async (url, options) => {
          visited.push(url);
          assert.equal(options.credentials, "omit");
          return new Response(new Uint8Array(262144), {
            status: 206,
            headers: { "Content-Range": "bytes 0-262143/2097152" }
          });
        };
        screen.requestRender = () => {
          peakPending = Math.max(peakPending, screen._probePending.size);
        };
        assert.equal(await screen.resolveUnknownRows(), 0);
        await screen.runUnknownProbes();
        assert.deepEqual(
          visited,
          screen.streams.map((stream) => stream.url)
        );
        assert.equal(peakPending, 1, "no queued row should spend its timeout waiting for another");
        assert.equal(screen._probeResults.size, 8);
      },
      "client"
    );
  } finally {
    if (originalWorker === undefined) delete globalThis.Worker;
    else globalThis.Worker = originalWorker;
  }
});

test("client startup publishes one result before two workers start further rows in order", async () => {
  const originalWorker = globalThis.Worker;
  const finishes = [],
    visited = [];
  try {
    globalThis.Worker = class {
      terminate() {}
      postMessage(message) {
        finishes.push(() =>
          this.onmessage({ data: { id: message.id, type: "result", result: directProbe } })
        );
      }
    };
    await probeTestScreen(
      "client-two",
      0,
      async (screen) => {
        screen.streams = screen.streams.slice(0, 3);
        globalThis.document.baseURI = "https://app.test/";
        globalThis.fetch = async (url) => {
          visited.push(url);
          return new Response(new Uint8Array(262144), {
            status: 206,
            headers: { "Content-Range": "bytes 0-262143/2097152" }
          });
        };
        const running = screen.runUnknownProbes();
        await new Promise((resolve) => setImmediate(resolve));
        assert.deepEqual(visited, [screen.streams[0].url]);
        assert.equal(finishes.length, 1);
        finishes[0]();
        await new Promise((resolve) => setImmediate(resolve));
        assert.equal(screen._probeResults.has(screen.streams[0].url), true);
        assert.deepEqual(
          visited,
          screen.streams.map((stream) => stream.url)
        );
        assert.equal(finishes.length, 3, "two jobs may run once the first label is ready");
        finishes[2]();
        await new Promise((resolve) => setImmediate(resolve));
        assert.equal(screen._probeResults.has(screen.streams[2].url), true);
        assert.equal(screen._probePending.has(screen.streams[1].url), true);
        finishes[1]();
        await running;
        assert.equal(screen._probeResults.size, 3);
      },
      "client",
      2
    );
  } finally {
    if (originalWorker === undefined) delete globalThis.Worker;
    else globalThis.Worker = originalWorker;
  }
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
    assert.equal(screen.getFilteredStreams().length, 4);
    globalThis.__NUVIO_TEST_BADGE_SETTINGS__.labelAddons = [];
    assert.equal(screen.getFilteredStreams().length, 4);
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

test("an unprobed source cannot request remux from the filename or addon codec text", async () => {
  await probeTestScreen("unprobed-remux", 0, async (screen) => {
    const source = { url: "https://media.test/unknown.mkv", name: "H264 AAC" };
    let conversions = 0;
    screen.remuxPlaylistUrl = async () => {
      conversions++;
      return "/api/remux/hls/guess/index.m3u8";
    };
    screen.isPlayableHlsPlaylist = async () => true;
    assert.equal(await screen.resolvePlayerSource(source), source.url);
    assert.equal(conversions, 0);
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

test("client background labels wait until addon/cache loading completes", async () => {
  await probeTestScreen(
    "source-load-priority",
    1,
    async (screen) => {
      let preparations = 0,
        probes = 0;
      screen.loading = true;
      screen.resolveUnknownRows = async () => {
        preparations++;
      };
      screen.runUnknownProbes = async () => {
        probes++;
      };
      screen.maybeAutoPlayStream = () => {};
      screen.scheduleUnknownProbes();
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(preparations, 0);
      assert.equal(probes, 0);
      assert.equal(
        screen.getFilteredStreams().length,
        8,
        "cards stay visible without probe results"
      );
      screen.loading = false;
      screen.scheduleUnknownProbes();
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(preparations, 1);
      assert.equal(probes, 1);
    },
    "client"
  );
});

test("Direct-only and auto-selection can still probe while addon loading continues", async () => {
  await probeTestScreen(
    "selection-load-priority",
    1,
    async (screen) => {
      let probes = 0;
      screen.loading = true;
      screen.resolveUnknownRows = async () => {};
      screen.runUnknownProbes = async () => {
        probes++;
      };
      screen.maybeAutoPlayStream = () => {};
      for (const settings of [
        { showOnlyDirectStreams: true },
        { streamAutoPlayMode: "FIRST_STREAM" }
      ]) {
        globalThis.__NUVIO_TEST_PLAYER_SETTINGS__ = settings;
        screen.scheduleUnknownProbes();
        await new Promise((resolve) => setImmediate(resolve));
      }
      assert.equal(probes, 2);
    },
    "client"
  );
});

test("Choose addon state does not submit probe work even with Only Direct enabled", async () => {
  await probeTestScreen("choose-no-labels", 0, async (screen, requests) => {
    globalThis.__NUVIO_TEST_BADGE_SETTINGS__ = { showPlaybackLabels: true, labelAddons: [] };
    globalThis.__NUVIO_TEST_PLAYER_SETTINGS__ = { showOnlyDirectStreams: true };
    await screen.runUnknownProbes();
    assert.deepEqual(screen.getProbeCandidates(), []);
    assert.deepEqual(requests, []);
    assert.equal(screen.probesSettled(), true);
  });
});

test("client candidate count is bounded by its selected limit with no unlimited fallback", async () => {
  await probeTestScreen(
    "client-label-limits",
    0,
    async (screen) => {
      for (const count of [3, 5, 8, 10]) {
        screen.streams = Array.from({ length: 15 }, (_, i) => ({
          id: String(i),
          addonName: "TestAddon",
          url: "https://video.test/" + i
        }));
        globalThis.__NUVIO_TEST_BADGE_SETTINGS__.clientLabelLimit = count;
        assert.equal(screen.getProbeCandidates().length, count);
        assert.deepEqual(screen.getProbeCandidates(), screen.streams.slice(0, count));
      }
      globalThis.__NUVIO_TEST_BADGE_SETTINGS__.labelAddons = [];
      assert.equal(screen.getProbeCandidates().length, 0);
    },
    "client"
  );
});

test("text filtering is independent of labels and rejects candidates before the probe cap", async () => {
  await probeTestScreen("text-before-probe", 1, async (screen, requests) => {
    screen.streams = screen.streams.map((s, i) => ({
      ...s,
      name: i === 5 ? "Film.H264.AAC.mp4" : "1080p"
    }));
    globalThis.__NUVIO_TEST_PLAYER_SETTINGS__ = {
      streamCompatibilityFilter: "LIKELY_DIRECT",
      showOnlyDirectStreams: false
    };
    assert.deepEqual(
      screen.getProbeCandidates().map((s) => s.id),
      ["5"]
    );
    await screen.runUnknownProbes();
    assert.deepEqual(requests, [screen.streams[5].url]);
    globalThis.__NUVIO_TEST_BADGE_SETTINGS__.showPlaybackLabels = false;
    assert.deepEqual(
      screen.getFilteredStreams().map((s) => s.id),
      ["5"]
    );
    assert.deepEqual(screen.getProbeCandidates(), []);
    globalThis.__NUVIO_TEST_PLAYER_SETTINGS__.streamCompatibilityFilter = "OFF";
    assert.equal(
      screen.getFilteredStreams().length,
      8,
      "changing filter invalidates the list cache"
    );
  });
});

test("stream page and player spend their cap on the same unique files, sharing duplicate labels", async () => {
  const { playerStreamProbeCandidates } =
    await import("../../../core/streams/playerStreamPolicy.js");
  await probeTestScreen("unique-file-budget", 3, async (screen, requests) => {
    const make = (id, hash, addon) => ({
      id,
      infoHash: hash.repeat(40),
      fileIdx: 0,
      addonName: addon,
      url: "https://video.test/" + id + ".mp4",
      name: "Film.H264.AAC.mp4"
    });
    screen.streams = [
      make("a-first", "a", "TestAddon"),
      make("a-copy", "a", "Other"),
      make("b", "b", "TestAddon"),
      make("c", "c", "TestAddon")
    ];
    const labels = {
      showPlaybackLabels: true,
      labelAddons: ["TestAddon", "Other"],
      clientLabelLimit: 3
    };
    globalThis.__NUVIO_TEST_BADGE_SETTINGS__ = labels;
    globalThis.__NUVIO_TEST_PLAYER_SETTINGS__ = { showOnlyDirectStreams: true };
    const expected = playerStreamProbeCandidates(screen.streams, {
      settings: globalThis.__NUVIO_TEST_PLAYER_SETTINGS__,
      labels,
      mode: "client",
      limit: 3
    }).map((s) => s.id);
    assert.deepEqual(
      screen.getProbeCandidates().map((s) => s.id),
      expected
    );
    assert.deepEqual(expected, ["a-first", "b", "c"]);
    await screen.runUnknownProbes();
    assert.equal(requests.length, 3);
    assert.equal(
      screen.getStreamProbe(screen.streams[0]),
      screen.getStreamProbe(screen.streams[1])
    );
    assert.equal(
      screen.getFilteredStreams().length,
      4,
      "both addon cards can share one verified file result"
    );
    assert.equal(screen.probesSettled(), true);
  });
});

test("filename mode labels without submitting any probe and Only Direct follows the estimate", async () => {
  await probeTestScreen(
    "filename-no-probe",
    3,
    async (screen, requests) => {
      screen.streams = screen.streams.map((s, i) => ({
        ...s,
        name: i < 2 ? "Film.H264.AAC.mp4" : "Film.HEVC.AC3.mkv"
      }));
      globalThis.__NUVIO_TEST_BADGE_SETTINGS__.playbackLabelSource = "FILE_NAME";
      globalThis.__NUVIO_TEST_PLAYER_SETTINGS__ = { showOnlyDirectStreams: true };
      assert.deepEqual(screen.getProbeCandidates(), []);
      await screen.runUnknownProbes();
      assert.deepEqual(requests, []);
      // This fixture's browser supports HEVC/AC3 but not MKV, so those rows estimate Remux.
      assert.deepEqual(
        screen.getFilteredStreams().map((s) => s.id),
        ["0", "1"]
      );
      globalThis.__NUVIO_TEST_BADGE_SETTINGS__.showPlaybackLabels = false;
      assert.equal(screen.getFilteredStreams().length, 8);
    },
    "client"
  );
});

test("explicit remux policies block copy relays including saved relay URLs, while device-supported direct remains unchanged", async () => {
  const saved = { env: globalThis.__NUVIO_ENV__, fetch: globalThis.fetch };
  try {
    for (const mode of ["client", "off", "invalid"]) {
      globalThis.__NUVIO_ENV__ = {
        REMUX_MODE: mode,
        REMUX_ENDPOINT: "/api/remux",
        TRANSCODE_ENDPOINT: "/api/transcode"
      };
      const { StreamScreen: screen } = await loadStreamScreen("remux-policy-" + mode);
      let requests = 0,
        copyCalls = 0;
      globalThis.fetch = async () => {
        requests++;
        throw Error("unexpected media request");
      };
      screen.getStreamProbe = () => ({
        ...directProbe,
        container: "mkv",
        playbackCapabilities: {
          video: true,
          container: false,
          audio: [{ index: 0, supported: true }],
          relayVideo: true
        }
      });
      const original = screen.remuxPlaylistUrl;
      assert.equal(await original.call(screen, "https://media.test/private.mkv"), "");
      screen.remuxPlaylistUrl = async () => {
        copyCalls++;
        return "/api/transcode/hls/test/index.m3u8";
      };
      for (const url of [
        "https://media.test/private.mkv",
        "/api/remux?u=https%3A%2F%2Fmedia.test%2Fprivate.mkv",
        "/api/transcode/hls/index.m3u8?u=https%3A%2F%2Fmedia.test%2Fprivate.mkv&v=copy&a=copy"
      ]) {
        if (mode === "client")
          assert.equal(await screen.resolvePlayerSource({ url }), "https://media.test/private.mkv");
        else
          await assert.rejects(screen.resolvePlayerSource({ url }), {
            code: "REMUX_ROUTE_UNAVAILABLE"
          });
      }
      screen.getStreamProbe = () => ({
        ...directProbe,
        container: "mkv",
        playbackCapabilities: {
          video: true,
          container: true,
          audio: [{ index: 0, supported: true }],
          relayVideo: true
        }
      });
      assert.equal(
        await screen.resolvePlayerSource({ url: "https://media.test/direct.mkv" }),
        "https://media.test/direct.mkv"
      );
      screen.getStreamProbe = () => null;
      const audioUrl =
        "/api/transcode/hls/index.m3u8?u=https%3A%2F%2Fmedia.test%2Fmovie.mkv&v=copy&a=aac";
      assert.equal(await screen.resolvePlayerSource({ url: audioUrl }), audioUrl);
      assert.equal(copyCalls, 0);
      assert.equal(requests, 0);
    }
  } finally {
    globalThis.__NUVIO_ENV__ = saved.env;
    globalThis.fetch = saved.fetch;
  }
});

test("unavailable remux is reported on stream selection before player navigation", async () => {
  const saved = globalThis.__NUVIO_ENV__;
  try {
    globalThis.__NUVIO_ENV__ = { REMUX_MODE: "server" };
    const { StreamScreen: screen } = await loadStreamScreen("remux-policy-toast"),
      source = { id: "selected", url: "https://media.test/movie.mkv" },
      messages = [];
    Object.assign(screen, {
      params: { startFromBeginning: true },
      streams: [source],
      getFilteredStreams: () => [source],
      cancelAutoPlayCountdown() {},
      cancelAutoPlaySelectionWait() {},
      showStreamToast(message) {
        messages.push(message);
      },
      getStreamProbe: () => ({
        ...directProbe,
        container: "mkv",
        playbackCapabilities: {
          video: true,
          container: false,
          audio: [{ index: 0, supported: true }],
          relayVideo: true
        }
      })
    });
    await screen.playStream("selected", { skipExternalRoute: true });
    assert.equal(messages.length, 1);
    assert.match(messages[0], /Server remux is unavailable/);
  } finally {
    globalThis.__NUVIO_ENV__ = saved;
  }
});

test("explicit server mode uses the existing HLS copy relay", async () => {
  const saved = globalThis.__NUVIO_ENV__;
  try {
    globalThis.__NUVIO_ENV__ = {
      REMUX_MODE: "server",
      REMUX_ENDPOINT: "/api/remux",
      TRANSCODE_ENDPOINT: "/api/transcode"
    };
    const { StreamScreen: screen } = await loadStreamScreen("explicit-server-existing-relay");
    screen.getStreamProbe = () => ({
      ...directProbe,
      container: "mkv",
      playbackCapabilities: {
        video: true,
        container: false,
        audio: [{ index: 0, supported: true }],
        relayVideo: true
      }
    });
    screen.remuxPlaylistUrl = async () => "/api/transcode/hls/index.m3u8?u=fixture&v=copy&a=copy";
    screen.isPlayableHlsPlaylist = async () => true;
    assert.match(
      await screen.resolvePlayerSource({ url: "https://media.test/movie.mkv" }),
      /^\/api\/transcode\/hls\//
    );
  } finally {
    globalThis.__NUVIO_ENV__ = saved;
  }
});

test("selecting a stream cancels background probes before checking only that selection", async () => {
  const saved = { env: globalThis.__NUVIO_ENV__, fetch: globalThis.fetch };
  let backgroundSignal,
    selectedRequests = 0;
  try {
    globalThis.__NUVIO_ENV__ = { PROBE_MODE: "server", PROBE_ENDPOINT: "https://probe.test/probe" };
    const background = {
      id: "a",
      url: "https://media.test/background.mp4",
      addonName: "TestAddon"
    };
    const selected = { id: "b", url: "https://media.test/selected.mp4", addonName: "TestAddon" };
    globalThis.fetch = async (url, { signal }) => {
      if (new URL(url).searchParams.get("u") === background.url) {
        backgroundSignal = signal;
        return new Promise((_, reject) =>
          signal.addEventListener("abort", () => reject(Error("aborted")), { once: true })
        );
      }
      selectedRequests++;
      return { ok: true, json: async () => ({ ok: true, ...directProbe }) };
    };
    const { StreamScreen: base } = await loadStreamScreen("selection-cancels-background");
    let resolved = false;
    const screen = Object.assign(Object.create(base), {
      streams: [background, selected],
      params: { startFromBeginning: true },
      loadToken: 1,
      _probeResults: new Map(),
      _probeSent: new Set(),
      _probePending: new Set(),
      _probeFailed: new Set(),
      _probeAttempts: new Map(),
      _probeCooldownUntil: new Map(),
      getProbeCandidates: () => [background, selected],
      getFilteredStreams: () => [background, selected],
      requestRender() {},
      cancelAutoPlayCountdown() {},
      cancelAutoPlaySelectionWait() {},
      getStreamProbe(stream) {
        return this._probeResults.get(stream.url);
      },
      resolvePlayerSource() {
        resolved = true;
        throw Error("selection-proved");
      }
    });
    const work = screen.runUnknownProbes();
    await new Promise((resolve) => setImmediate(resolve));
    await assert.rejects(screen.playStream("b", { skipExternalRoute: true }), /selection-proved/);
    await work;
    assert.equal(backgroundSignal.aborted, true);
    assert.equal(selectedRequests, 1);
    assert.equal(resolved, true);
    assert.equal(screen._probeAttempts.size, 0, "cancellation is not a labeling failure");
  } finally {
    globalThis.__NUVIO_ENV__ = saved.env;
    globalThis.fetch = saved.fetch;
  }
});

test("failed labeling retries after fifteen seconds and stops after the second failure", async (t) => {
  const { StreamScreen: base } = await loadStreamScreen("fifteen-second-retry");
  let retries = 0;
  const screen = Object.assign(Object.create(base), {
    _probeFailed: new Set(),
    _probeAttempts: new Map(),
    _probeCooldownUntil: new Map(),
    scheduleUnknownProbes() {
      retries++;
    }
  });
  t.mock.timers.enable({ apis: ["Date", "setTimeout"] });
  screen.markProbeFailure("fixture");
  assert.equal(screen.canProbeRow("fixture"), false);
  t.mock.timers.tick(14999);
  assert.equal(retries, 0);
  t.mock.timers.tick(1);
  assert.equal(retries, 1);
  assert.equal(screen.canProbeRow("fixture"), true);
  screen.markProbeFailure("fixture");
  t.mock.timers.tick(15000);
  assert.equal(screen.canProbeRow("fixture"), false);
  assert.equal(retries, 1);
});

test("ready HLS delivery skips file probing on selection", async () => {
  const saved = { env: globalThis.__NUVIO_ENV__, fetch: globalThis.fetch };
  try {
    globalThis.__NUVIO_ENV__ = { PROBE_MODE: "server", PROBE_ENDPOINT: "https://probe.test/probe" };
    globalThis.fetch = () => {
      throw Error("HLS must not be file-probed");
    };
    const { StreamScreen: base } = await loadStreamScreen("ready-hls-no-file-probe");
    const stream = { id: "hls", url: "https://media.test/movie.m3u8" };
    const screen = Object.assign(Object.create(base), {
      streams: [stream],
      params: { startFromBeginning: true },
      getFilteredStreams: () => [stream],
      getStreamProbe: () => null,
      cancelAutoPlayCountdown() {},
      cancelAutoPlaySelectionWait() {},
      resolvePlayerSource() {
        throw Error("ready-delivery-proved");
      }
    });
    await assert.rejects(
      screen.playStream("hls", { skipExternalRoute: true }),
      /ready-delivery-proved/
    );
  } finally {
    globalThis.__NUVIO_ENV__ = saved.env;
    globalThis.fetch = saved.fetch;
  }
});

test("checking and player handoff share movie identity and backdrop", async () => {
  const { StreamScreen: screen } = await loadStreamScreen("checking-presentation");
  screen.params = {
    itemId: 42,
    itemTitle: "Movie",
    logo: "https://image.test/logo.png",
    backdrop: "https://image.test/background.jpg"
  };
  assert.deepEqual(screen.getStartupOverlayMeta(), {
    itemKey: "42",
    title: "Movie",
    logoUrl: "https://image.test/logo.png",
    backdropUrl: "https://image.test/background.jpg"
  });
});

test("a failed metadata check still opens the player, while a known failure is not probed again", async () => {
  const saved = {
    env: globalThis.__NUVIO_ENV__,
    fetch: globalThis.fetch,
    nav: globalThis.__NUVIO_TEST_NAVIGATE__,
    labels: globalThis.__NUVIO_TEST_BADGE_SETTINGS__
  };
  let requests = 0,
    navigation;
  try {
    globalThis.__NUVIO_ENV__ = { PROBE_MODE: "server", PROBE_ENDPOINT: "https://probe.test/probe" };
    globalThis.__NUVIO_TEST_BADGE_SETTINGS__ = {
      playbackLabelSource: "FILE_METADATA",
      metadataFilenameFallback: true
    };
    globalThis.__NUVIO_TEST_NAVIGATE__ = (route, params) => {
      navigation = { route, params };
    };
    globalThis.fetch = async () => {
      requests++;
      return { ok: false, status: 502, json: async () => ({ error: "probe-unreadable" }) };
    };
    const { StreamScreen: base } = await loadStreamScreen("probe-failure-still-play");
    const stream = {
      id: "selected",
      url: "https://media.test/movie.mp4",
      name: "Movie.H264.AAC.mp4"
    };
    const screen = Object.assign(Object.create(base), {
      streams: [stream],
      params: { startFromBeginning: true, itemTitle: "Movie" },
      _probeResults: new Map(),
      _probeFailed: new Set(),
      getFilteredStreams: () => [stream],
      getStreamProbe: () => null,
      cancelAutoPlayCountdown() {},
      cancelAutoPlaySelectionWait() {},
      getStreamRequestHeaders: () => ({}),
      showStreamToast() {
        throw Error("failed metadata must not block play");
      }
    });
    await screen.playStream("selected", { skipExternalRoute: true });
    assert.equal(navigation.route, "player");
    assert.equal(navigation.params.streamUrl, stream.url);
    assert.equal(navigation.params.unverifiedPlayback.route, "direct");
    assert.equal(requests, 1);
    await screen.playStream("selected", { skipExternalRoute: true });
    assert.equal(requests, 1, "pressing Play again does not repeat a known failed probe");
  } finally {
    globalThis.__NUVIO_ENV__ = saved.env;
    globalThis.fetch = saved.fetch;
    globalThis.__NUVIO_TEST_NAVIGATE__ = saved.nav;
    globalThis.__NUVIO_TEST_BADGE_SETTINGS__ = saved.labels;
  }
});

test("enabled probing alone does not leave idle or failed cards Checking forever", async () => {
  await probeTestScreen("checking-is-owned-work", 3, async (screen) => {
    screen.scheduleUnknownProbes = () => {};
    screen.isCardActionFocused = () => false;
    screen.renderOfflineDownloadActions = () => "";
    const stream = screen.streams[0];
    let html = screen.renderStreamCard(stream, 0);
    assert.doesNotMatch(html, /Checking/);
    assert.match(html, />Waiting…</);
    screen._probePending.add(stream.url);
    html = screen.renderStreamCard(stream, 0);
    assert.match(html, /Checking/);
    screen._probePending.delete(stream.url);
    screen._probeFailed.add(stream.url);
    html = screen.renderStreamCard(stream, 0);
    assert.doesNotMatch(html, /Checking/);
    assert.match(html, />Unknown</);
  });
});
