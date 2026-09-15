import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

async function loadStreamScreen() {
  const result = await build({
    entryPoints: [fileURLToPath(new URL("./streamScreen.js", import.meta.url))],
    bundle: true,
    format: "esm",
    platform: "node",
    write: false,
    plugins: [
      {
        name: "stream-screen-browser-mocks",
        setup(buildApi) {
          const mockPaths = new Map([
            ["router", `export const Router = { getCurrent: () => "stream", navigate: async () => {}, back: () => {} };`],
            ["player-settings", `export const PlayerSettingsStore = { get: () => globalThis.__NUVIO_TEST_PLAYER_SETTINGS__ || ({ streamReuseLastLinkEnabled: false, streamReuseLastLinkCacheHours: 24, streamAutoPlayTimeoutSeconds: 0 }) };`],
            ["stream-preferences", `export const StreamPreferencesStore = { getValid: () => null };`],
            ["addon-repository", `export const addonRepository = { getCachedInstalledAddons: () => [] };`],
            ["badge-settings", `export const StreamBadgeSettingsStore = { snapshot: () => ({ showAddonLogo: false }) };`]
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
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].contents).toString("base64")}`);
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
