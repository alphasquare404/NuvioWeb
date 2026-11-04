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
          if (instance.startsWith("external-")) {
            buildApi.onResolve({ filter: /startupLoadingOverlay\.js$/ }, () => ({
              path: "startup",
              namespace: "external-test"
            }));
            buildApi.onLoad({ filter: /.*/, namespace: "external-test" }, () => ({
              contents:
                "export const usesUnifiedStartup = () => false; export const StartupLoadingOverlay = { begin() {}, setBackHandler() {}, finish() {}, setStage() {} };"
            }));
          }
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
              `export const StreamPreferencesStore = { getValid: () => globalThis.__NUVIO_TEST_REUSABLE_STREAM__ || null };`
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
  StreamScreen.autoPlaySelectionExpired = false;
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

test("checking and player handoff share movie identity and backdrop", async () => {
  const { StreamScreen: screen } = await loadStreamScreen("checking-presentation");
  screen.params = {
    itemId: 42,
    itemType: "movie",
    poster: "https://image.test/poster.jpg",
    textlessPoster: "https://image.test/textless.jpg",
    itemTitle: "Movie",
    logo: "https://image.test/logo.png",
    backdrop: "https://image.test/background.jpg"
  };
  assert.deepEqual(screen.getStartupOverlayMeta(), {
    itemKey: "42",
    itemType: "movie",
    posterUrl: "https://image.test/poster.jpg",
    textlessPoster: "https://image.test/textless.jpg",
    title: "Movie",
    logoUrl: "https://image.test/logo.png",
    backdropUrl: "https://image.test/background.jpg"
  });
});

test("stream deadline selects an available result and cannot restart autoplay for late results", async () => {
  const { StreamScreen } = await loadStreamScreen();
  const original = StreamScreen.playStream,
    originalFilter = StreamScreen.getFilteredStreams;
  const played = [];
  try {
    StreamScreen.playStream = async (id) => played.push(id);
    configureAutoPlayScreen(StreamScreen, {
      streams: [{ id: "a", url: "https://fixture.test/a.mp4" }]
    });
    StreamScreen.autoPlaySelectionExpired = true;
    StreamScreen.maybeAutoPlayStream({ deadlineReached: true });
    assert.deepEqual(played, ["a"]);
    configureAutoPlayScreen(StreamScreen, {
      streams: [{ id: "late", url: "https://fixture.test/late.mp4" }]
    });
    StreamScreen.autoPlaySelectionExpired = true;
    StreamScreen.maybeAutoPlayStream({ allLoaded: true });
    assert.deepEqual(played, ["a"]);
  } finally {
    StreamScreen.playStream = original;
    StreamScreen.getFilteredStreams = originalFilter;
    delete globalThis.__NUVIO_TEST_PLAYER_SETTINGS__;
  }
});
test("a prefetched stream rejected by the current filter releases Opening player", async () => {
  const { StreamScreen } = await loadStreamScreen();
  const names = [
    "applyAddonLogos",
    "buildSourceChipsFromStreams",
    "refreshOfflineDownloadMetadata",
    "scheduleDebridPreparation",
    "getFilteredStreams",
    "requestRender"
  ];
  const original = Object.fromEntries(names.map((n) => [n, StreamScreen[n]]));
  try {
    configureAutoPlayScreen(StreamScreen, {
      params: {
        autoResolvedStreams: [{ id: "a", url: "https://fixture.test/a" }],
        autoResolvedStreamId: "a"
      }
    });
    StreamScreen.autoResolvedPlaybackPending = true;
    StreamScreen.applyAddonLogos = (a) => a;
    StreamScreen.buildSourceChipsFromStreams = () => [];
    StreamScreen.refreshOfflineDownloadMetadata = () => {};
    StreamScreen.scheduleDebridPreparation = () => {};
    StreamScreen.getFilteredStreams = () => [];
    StreamScreen.requestRender = () => {};
    assert.equal(StreamScreen.adoptAutoResolvedStreams(), true);
    assert.equal(StreamScreen.autoResolvedPlaybackPending, false);
    assert.equal(StreamScreen.params.autoResolvedStreamId, null);
    assert.equal(StreamScreen.autoPlayAttempted, true);
  } finally {
    Object.assign(StreamScreen, original);
    delete globalThis.__NUVIO_TEST_PLAYER_SETTINGS__;
  }
});

test("stream page waits for the remembered source during partial discovery", async () => {
  const { StreamScreen } = await loadStreamScreen("remembered-partial");
  const early = { id: "early", name: "Early", url: "https://example.com/early" };
  configureAutoPlayScreen(StreamScreen, {
    params: { itemId: "movie" },
    streams: [early],
    settings: { streamReuseLastLinkEnabled: true }
  });
  StreamScreen.loading = true;
  let played = null;
  StreamScreen.playStream = async (id) => {
    played = id;
  };
  StreamScreen.cancelAutoPlaySelectionWait = () => {};
  globalThis.__NUVIO_TEST_REUSABLE_STREAM__ = { streamId: "remembered" };
  try {
    StreamScreen.maybeAutoPlayStream();
    assert.equal(played, null);
    assert.equal(StreamScreen.autoPlayAttempted, false);
    StreamScreen.maybeAutoPlayStream({ allLoaded: true });
    assert.equal(played, "early");
  } finally {
    delete globalThis.__NUVIO_TEST_REUSABLE_STREAM__;
  }
});

for (const scenario of ["next", "exhausted", "manual", "cancelled", "throw"]) {
  test("external autoplay handoff: " + scenario, async () => {
    const { StreamScreen } = await loadStreamScreen("external-" + scenario);
    const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, "navigator");
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: { userAgent: "iPhone" }
    });
    const calls = [];
    const navigations = [];
    const messages = [];
    try {
      configureAutoPlayScreen(StreamScreen, {
        params: { itemId: "movie", itemType: "movie", startFromBeginning: true },
        streams: [
          { id: "bad", url: "https://example.com/bad" },
          { id: "good", url: "https://example.com/good" }
        ],
        settings: { browserExternalPlayer: "lenna" }
      });
      globalThis.__NUVIO_TEST_NAVIGATE__ = (...args) => navigations.push(args);
      StreamScreen.getStartupOverlayMeta = () => ({});
      StreamScreen.requestRender = () => {};
      StreamScreen.showStreamToast = (text) => messages.push(text);
      StreamScreen.routeSelectedStream = async (selected) => {
        calls.push(selected.id);
        if (scenario === "cancelled") StreamScreen._playSelectionGeneration++;
        if (scenario === "throw" && selected.id === "bad") throw new Error("resolution failed");
        return scenario !== "exhausted" && selected.id === "good";
      };
      await StreamScreen.playStream("bad", { automatic: scenario !== "manual" });
      assert.deepEqual(
        calls,
        ["manual", "cancelled"].includes(scenario) ? ["bad"] : ["bad", "good"]
      );
      assert.deepEqual(
        navigations,
        [],
        "external selection must never navigate to internal player"
      );
      if (["manual", "exhausted"].includes(scenario)) {
        assert.match(messages.at(-1), /Choose another stream/);
        assert.equal(StreamScreen.autoResolvedPlaybackPending, false);
        assert.equal(StreamScreen._labelProbePaused, false);
      }
    } finally {
      if (navigatorDescriptor) Object.defineProperty(globalThis, "navigator", navigatorDescriptor);
      else delete globalThis.navigator;
      delete globalThis.__NUVIO_TEST_PLAYER_SETTINGS__;
      delete globalThis.__NUVIO_TEST_NAVIGATE__;
    }
  });
}
