import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

async function fixture(run) {
  const saved = {
    document: globalThis.document,
    settings: globalThis.__STARTUP_SETTINGS__,
    storage: globalThis.localStorage,
    width: globalThis.innerWidth,
    height: globalThis.innerHeight
  };
  globalThis.localStorage = {
    getItem: (key) =>
      key.includes("tmdbSettings") ? JSON.stringify({ enabled: true, useArtwork: true }) : null,
    setItem() {},
    removeItem() {}
  };
  globalThis.__STARTUP_SETTINGS__ = {
    browserExternalPlayer: "disabled",
    playerEngine: "native",
    loadingOverlayEnabled: true,
    showPlayerLoadingStatus: true
  };
  const nodes = [];
  const child = () => {
    const classes = new Set();
    return {
      textContent: "",
      style: { setProperty() {}, removeProperty() {} },
      naturalWidth: 0,
      complete: false,
      classList: {
        toggle(name, enabled) {
          if (enabled) classes.add(name);
          else classes.delete(name);
        },
        contains(name) {
          return classes.has(name);
        }
      }
    };
  };
  const createNode = () => ({
    textContent: "",
    style: { setProperty() {}, removeProperty() {} },
    hidden: false,
    dataset: {},
    classList: { toggle() {}, remove() {} },
    remove() {
      nodes.splice(nodes.indexOf(this), 1);
    },
    querySelector(selector) {
      return this.children[selector];
    },
    children: {
      ".player-loading-status": child(),
      ".player-loading-detail": child(),
      ".startup-probe-actions": child(),
      ".startup-probe-skip": child(),
      ".startup-probe-choose": child(),
      ".player-loading-backdrop": child(),
      ".player-loading-title": child(),
      ".player-loading-subtitle": child(),
      ".player-loading-identity": child(),
      ".player-loading-logo": child()
    }
  });
  globalThis.document = {
    createElement: createNode,
    body: {
      appendChild(node) {
        nodes.push(node);
      }
    }
  };
  const built = await build({
    entryPoints: [fileURLToPath(new URL("./startupLoadingOverlay.js", import.meta.url))],
    bundle: true,
    format: "esm",
    platform: "node",
    write: false,
    plugins: [
      {
        name: "settings",
        setup(api) {
          api.onResolve({ filter: /playerSettingsStore\.js$/ }, () => ({
            path: "settings",
            namespace: "mock"
          }));
          api.onLoad({ filter: /.*/, namespace: "mock" }, () => ({
            contents: "export const PlayerSettingsStore={get:()=>globalThis.__STARTUP_SETTINGS__}"
          }));
        }
      }
    ]
  });
  const { StartupLoadingOverlay: overlay, usesUnifiedStartup } = await import(
    "data:text/javascript;base64," + Buffer.from(built.outputFiles[0].contents).toString("base64")
  );
  try {
    await run({ overlay, nodes, settings: globalThis.__STARTUP_SETTINGS__, usesUnifiedStartup });
  } finally {
    overlay.finish();
    globalThis.document = saved.document;
    globalThis.__STARTUP_SETTINGS__ = saved.settings;
    globalThis.localStorage = saved.storage;
    globalThis.innerWidth = saved.width;
    globalThis.innerHeight = saved.height;
  }
}

test("one overlay node survives search, stream checks, opening and video loading", async () => {
  await fixture(({ overlay, nodes }) => {
    overlay.begin(
      { title: "Film <test>", backdropUrl: "https://image.test/backdrop.jpg" },
      "finding"
    );
    const original = nodes[0];
    assert.equal(original.children[".player-loading-title"].textContent, "Film <test>");
    assert.doesNotMatch(original.innerHTML, /Film <test>/);
    for (const stage of ["checking", "opening", "loading", "metadata", "frame", "restoring"]) {
      overlay.begin({ title: "Other route" }, stage);
      assert.equal(nodes.length, 1);
      assert.equal(nodes[0], original, "route transition never remounts the overlay");
    }
    assert.equal(original.children[".player-loading-status"].textContent, "Resuming playback…");
    overlay.finish();
    assert.equal(nodes.length, 0);
    assert.equal(overlay.active, false);
  });
});

test("loading status toggle hides stage and relay text without hiding the overlay", async () => {
  await fixture(({ overlay, nodes, settings }) => {
    overlay.begin({ title: "Film" });
    settings.showPlayerLoadingStatus = false;
    overlay.setRelayText("Preparing remuxing");
    overlay.setStage("checking");
    assert.equal(nodes.length, 1);
    assert.equal(nodes[0].children[".player-loading-status"].textContent, "");
    settings.showPlayerLoadingStatus = true;
    overlay.setRelayText("");
    assert.equal(nodes[0].children[".player-loading-status"].textContent, "Preparing video…");
  });
});

test("disabled overlay, external player and Movi do not start a unified overlay", async () => {
  await fixture(({ overlay, nodes, settings, usesUnifiedStartup }) => {
    settings.loadingOverlayEnabled = false;
    assert.equal(overlay.begin({}), false);
    assert.equal(nodes.length, 0);
    settings.loadingOverlayEnabled = true;
    settings.browserExternalPlayer = "lenna";
    assert.equal(usesUnifiedStartup(), false);
    assert.equal(overlay.begin({}), false);
    settings.browserExternalPlayer = "disabled";
    settings.playerEngine = "movi";
    assert.equal(overlay.begin({}), false);
    assert.equal(nodes.length, 0);
  });
});

test("native video events update status without timers advancing through invented stages", async () => {
  const source = await readFile(
    new URL("../screens/player/playerScreen.js", import.meta.url),
    "utf8"
  );
  const method = source.match(/ {2}bindVideoEvents\(\) \{[\s\S]*?\n {2}\},/)?.[0];
  assert.ok(method);
  const handlers = new Map();
  const stages = [];
  const video = {
    readyState: 0,
    addEventListener(name, handler) {
      handlers.set(name, [...(handlers.get(name) || []), handler]);
    }
  };
  const bind = new Function(
    "PlayerController",
    "StartupLoadingOverlay",
    "Environment",
    "PlaybackLoadingTrace",
    "return ({" + method + "}).bindVideoEvents"
  )(
    { video },
    {
      setStage(stage) {
        stages.push(stage);
      }
    },
    { isBrowser: () => true },
    { stage() {} }
  );
  const screen = new Proxy(
    {
      videoListeners: [],
      hasPresentedPlaybackFrame: false,
      pendingPlaybackRestore: null,
      paused: false
    },
    {
      get(target, key) {
        return key in target ? target[key] : () => {};
      }
    }
  );
  bind.call(screen);
  const emit = (name) => handlers.get(name).forEach((handler) => handler());
  emit("loadstart");
  emit("progress");
  video.readyState = 1;
  emit("loadedmetadata");
  screen.pendingPlaybackRestore = { timeSeconds: 60 };
  emit("loadeddata");
  assert.deepEqual(stages, ["loading", "metadata", "frame", "restoring"]);
  screen.hasPresentedPlaybackFrame = true;
  emit("loadstart");
  assert.equal(stages.length, 4, "normal playback does not restart startup captions");
});

test("manual selection releases the attempt overlay before opening the stream list", async () => {
  const source = await readFile(
    new URL("../screens/detail/metaDetailsScreen.js", import.meta.url),
    "utf8"
  );
  const method = source.match(
    / {2}async openStreamRoute\(params, options\) \{[\s\S]*?\n {2}\},/
  )?.[0];
  assert.ok(method);
  for (const manualMode of [true, false]) {
    let finished = 0;
    let navigated = 0;
    const open = new Function(
      "PlayerSettingsStore",
      "isAutoPlayEffectivelyEnabled",
      "StartupLoadingOverlay",
      "Router",
      "return ({" + method + "}).openStreamRoute"
    )(
      { get: () => ({}) },
      () => !manualMode,
      {
        finish() {
          finished++;
        }
      },
      {
        navigate(route) {
          assert.equal(route, "stream");
          navigated++;
        }
      }
    );
    await open.call({}, { manualSelection: !manualMode });
    assert.equal(finished, 1);
    assert.equal(navigated, 1);
  }
});

test("late logo metadata replaces text on the same overlay only after its image loads", async () => {
  await fixture(({ overlay, nodes }) => {
    overlay.begin({ itemKey: "moana", title: "Moana" });
    const node = nodes[0];
    const logo = node.children[".player-loading-logo"];
    const identity = node.children[".player-loading-identity"];
    overlay.setStage("checking");
    overlay.updateMetadata({ itemKey: "moana", logoUrl: "https://image.test/moana.png" });
    assert.equal(nodes[0], node);
    assert.equal(logo.src, "https://image.test/moana.png");
    assert.equal(identity.classList.contains("has-logo"), false, "text stays until image is ready");
    logo.naturalWidth = 420;
    logo.onload();
    assert.equal(identity.classList.contains("has-logo"), true);
    assert.equal(logo.classList.contains("hidden"), false);
    assert.equal(node.children[".player-loading-status"].textContent, "Preparing video…");
    logo.onerror();
    assert.equal(
      identity.classList.contains("has-logo"),
      false,
      "failed image falls back to current title"
    );
    assert.equal(node.children[".player-loading-title"].textContent, "Moana");
  });
});

test("artwork and late image events from another title cannot leak into the new overlay", async () => {
  await fixture(({ overlay, nodes }) => {
    overlay.begin({
      itemKey: "obsession",
      title: "Obsession",
      logoUrl: "https://image.test/obsession.png"
    });
    const oldImage = nodes[0].children[".player-loading-logo"];
    const oldLoad = oldImage.onload;
    overlay.begin({
      itemKey: "moana",
      title: "Moana",
      backdropUrl: "https://image.test/moana.jpg"
    });
    assert.equal(nodes.length, 1);
    const current = nodes[0];
    overlay.updateMetadata({
      itemKey: "obsession",
      title: "Obsession",
      logoUrl: "https://image.test/obsession.png"
    });
    oldImage.naturalWidth = 420;
    oldLoad();
    assert.equal(current.children[".player-loading-title"].textContent, "Moana");
    assert.equal(current.children[".player-loading-logo"].src, undefined);
    assert.equal(
      current.children[".player-loading-identity"].classList.contains("has-logo"),
      false
    );
  });
});

test("Detail trusts only metadata loaded for its current route parameters", async () => {
  const source = await readFile(
    new URL("../screens/detail/metaDetailsScreen.js", import.meta.url),
    "utf8"
  );
  const method = source.match(/ {2}getStartupOverlayMeta\(\) \{[\s\S]*?\n {2}\},/)?.[0];
  const get = new Function("return ({" + method + "}).getStartupOverlayMeta")();
  const previous = { itemId: "obsession" };
  const current = { itemId: "moana", fallbackTitle: "Moana", backdrop: "moana.jpg" };
  const screen = {
    params: current,
    overlayMetaParams: previous,
    meta: { name: "Obsession", logo: "obsession.png", background: "obsession.jpg" }
  };
  assert.deepEqual(get.call(screen), {
    itemKey: "moana",
    itemType: undefined,
    posterUrl: "",
    textlessPoster: "",
    title: "Moana",
    logoUrl: "",
    backdropUrl: "moana.jpg"
  });
  screen.overlayMetaParams = current;
  screen.meta = { name: "Moana", logo: "moana.png" };
  assert.equal(get.call(screen).logoUrl, "moana.png");
});

test("unified startup omits the runtime subtitle while retaining logo and loading status", async () => {
  await fixture(({ overlay, nodes }) => {
    overlay.begin({ title: "Film", subtitle: "2h 37m" });
    assert.doesNotMatch(nodes[0].innerHTML, /player-loading-subtitle/);
    assert.match(nodes[0].innerHTML, /player-loading-logo/);
    assert.match(nodes[0].innerHTML, /player-loading-status/);
  });
});

test("Back remains actionable throughout finding, metadata, remux preparation, restore and first frame", async () => {
  await fixture(({ overlay, nodes }) => {
    for (const stage of ["finding", "opening", "metadata", "loading", "restoring", "frame"]) {
      let exits = 0;
      overlay.begin({ title: "Film" }, stage);
      overlay.setBackHandler(() => exits++);
      assert.match(nodes[0].innerHTML, /startup-loading-back/);
      overlay.setRelayText("Preparing remuxing");
      overlay.back();
      assert.equal(exits, 1);
      assert.equal(nodes.length, 0);
    }
  });
});

test("actual internal playback uses unified loading despite the saved external default", async () => {
  await fixture(({ overlay, nodes, settings, usesUnifiedStartup }) => {
    settings.browserExternalPlayer = "lenna";
    assert.equal(usesUnifiedStartup(), false);
    assert.equal(overlay.begin({ internalPlayer: true, title: "Offline title" }, "loading"), true);
    assert.equal(nodes.length, 1);
    assert.equal(nodes[0].children[".player-loading-status"].textContent, "Preparing video…");
  });
});

test("preparation aliases share one honest phase while known processing is a separate detail", async () => {
  await fixture(({ overlay, nodes }) => {
    overlay.begin({ title: "Film" }, "loading");
    const status = nodes[0].children[".player-loading-status"];
    for (const stage of ["checking", "opening", "loading", "metadata"]) {
      overlay.setStage(stage);
      assert.equal(status.textContent, "Preparing video…");
    }
    overlay.setRelayText("Preparing remux");
    assert.equal(status.textContent, "Preparing video…");
    assert.equal(nodes[0].children[".player-loading-detail"].textContent, "Preparing remux");
    overlay.setStage("frame");
    assert.equal(status.textContent, "Starting playback…");
    assert.equal(nodes[0].children[".player-loading-detail"].textContent, "");
    assert.doesNotMatch(nodes[0].innerHTML, />‹ Back/);
    assert.match(nodes[0].innerHTML, /assets\/icons\/ic_player_back\.svg/);
  });
});

test("a selected probe has a distinct status until a playback route starts", async () => {
  await fixture(({ overlay, nodes }) => {
    overlay.begin({ title: "Film" }, "opening");
    const status = nodes[0].children[".player-loading-status"];
    overlay.setPlaybackAttempt({ route: "direct" });
    overlay.setStage("probing");
    assert.equal(status.textContent, "Checking stream metadata…");
    overlay.setStage("opening");
    overlay.setPlaybackAttempt({ route: "remux" });
    assert.equal(status.textContent, "Preparing remux playback…");
  });
});

test("probe timeout appears alongside the fallback route and yields to later failures", async () => {
  await fixture(({ overlay, nodes }) => {
    overlay.begin({ title: "Film" }, "probing");
    const { children } = nodes[0];
    const detail = children[".player-loading-detail"];
    overlay.setStage("loading");
    overlay.setPlaybackAttempt({ route: "direct", failedRoute: "probe" });
    assert.equal(children[".player-loading-status"].textContent, "Opening directly…");
    assert.equal(detail.textContent, "Probe timed out. Trying another method.");
    overlay.setPlaybackAttempt({ route: "remux", failedRoute: "direct" });
    assert.equal(detail.textContent, "Direct playback did not start. Trying another method.");
    overlay.setPlaybackAttempt({ route: "", failedRoute: "" });
    assert.equal(detail.textContent, "");
  });
});

test("an interactive probe keeps its controls reachable when regular loading is disabled", async () => {
  await fixture(({ overlay, nodes, settings }) => {
    settings.loadingOverlayEnabled = false;
    const actions = [];
    const close = overlay.setProbeActions({
      onSkip: () => actions.push("skip"),
      onChooseStream: () => actions.push("choose")
    });
    assert.equal(overlay.begin({ internalPlayer: true, title: "Film" }, "probing"), true);
    const { children } = nodes[0];
    assert.equal(children[".startup-probe-actions"].hidden, false);
    overlay.setStage("loading");
    assert.equal(children[".player-loading-status"].textContent, "Checking stream metadata…");
    children[".startup-probe-skip"].onclick();
    children[".startup-probe-choose"].onclick();
    assert.deepEqual(actions, ["skip", "choose"]);
    close();
    assert.equal(overlay.active, false);
    assert.equal(overlay.probing, false);
  });
});

test("loading artwork follows presentation orientation with the same textless poster resolver as Detail", async () => {
  await fixture(({ overlay, nodes }) => {
    globalThis.innerWidth = 390;
    globalThis.innerHeight = 844;
    overlay.begin({
      title: "Film",
      itemKey: "film",
      itemType: "movie",
      posterUrl: "poster.jpg",
      textlessPoster: "textless.jpg",
      backdropUrl: "backdrop.jpg"
    });
    const image = nodes[0].children[".player-loading-backdrop"];
    assert.equal(image.style.backgroundImage, 'url("textless.jpg")');
    globalThis.innerWidth = 844;
    globalThis.innerHeight = 390;
    overlay.refreshArtwork();
    assert.equal(image.style.backgroundImage, 'url("backdrop.jpg")');
  });
});

test("loading distinguishes source attempts from method fallbacks and clears them on exit", async () => {
  await fixture(({ overlay, nodes }) => {
    overlay.begin({ title: "Film" }, "opening");
    overlay.setPlaybackAttempt({ sourceNumber: 1, route: "remux" });
    const status = nodes[0].children[".player-loading-status"];
    const detail = nodes[0].children[".player-loading-detail"];
    assert.equal(status.textContent, "Stream 1 · Preparing remux playback…");
    overlay.setStage("metadata");
    assert.equal(status.textContent, "Stream 1 · Preparing remux playback…");
    overlay.setPlaybackAttempt({ route: "direct", failedRoute: "remux" });
    assert.equal(status.textContent, "Stream 1 · Opening directly…");
    assert.match(detail.textContent, /Remux playback did not start/);
    overlay.setPlaybackAttempt({ sourceNumber: 2, route: "remux", failedRoute: "" });
    assert.equal(status.textContent, "Stream 2 · Preparing remux playback…");
    assert.equal(detail.textContent, "Stream 1 could not play. Trying the next stream.");
    overlay.setStage("frame");
    assert.equal(status.textContent, "Stream 2 · Starting playback…");
    overlay.finish();
    overlay.begin({ title: "Another film" }, "opening");
    assert.equal(nodes[0].children[".player-loading-status"].textContent, "Preparing video…");
    assert.equal(nodes[0].children[".player-loading-detail"].textContent, "");
  });
});

test("attempt details respect the loading-status setting and allow only known methods", async () => {
  await fixture(({ overlay, nodes, settings }) => {
    overlay.begin({ title: "Film" }, "loading");
    overlay.setPlaybackAttempt({ sourceNumber: 2, route: "audio-transcode" });
    const status = nodes[0].children[".player-loading-status"];
    const detail = nodes[0].children[".player-loading-detail"];
    assert.equal(status.textContent, "Stream 2 · Converting audio…");
    settings.showPlayerLoadingStatus = false;
    overlay.setStage("loading");
    assert.equal(status.textContent, "");
    assert.equal(detail.textContent, "");
    assert.equal(detail.classList.contains("hidden"), true);
    settings.showPlayerLoadingStatus = true;
    overlay.setPlaybackAttempt({ sourceNumber: "secret", route: "secret", failedRoute: "secret" });
    assert.equal(status.textContent, "Preparing video…");
    assert.equal(detail.textContent, "");
  });
});
