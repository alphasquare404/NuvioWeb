import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const bundle = await build({
  entryPoints: [fileURLToPath(new URL("./homeScreen.js", import.meta.url))],
  bundle: true,
  format: "esm",
  platform: "node",
  write: false,
  plugins: [
    {
      name: "isolate-home-router",
      setup(buildApi) {
        buildApi.onResolve({ filter: /navigation\/router\.js$/ }, () => ({
          path: "router",
          namespace: "test"
        }));
        buildApi.onLoad({ filter: /.*/, namespace: "test" }, () => ({
          contents: "export const Router = {};"
        }));
      }
    }
  ]
});
const { HomeScreen } = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].contents).toString("base64")}`
);

// The image surface the hydration pass touches: attributes, dataset, loading,
// a client-space rect, and whether the node is still in the document.
function makeImage({ rect, src = null, deferred = null }) {
  const attributes = new Map();
  if (src) attributes.set("src", src);
  if (deferred) attributes.set("data-src", deferred);
  const image = new globalThis.HTMLImageElement();
  Object.assign(image, {
    isConnected: true,
    loading: "",
    rect,
    dataset: deferred ? { src: deferred } : {},
    getAttribute: (name) => attributes.get(name) ?? null,
    setAttribute: (name, value) => {
      attributes.set(name, value);
      if (name === "data-src") image.dataset.src = value;
    },
    removeAttribute: (name) => {
      attributes.delete(name);
      if (name === "data-src") delete image.dataset.src;
    },
    getBoundingClientRect: () => image.rect
  });
  // A real <img> keeps its `src` property and its attribute in step; the app
  // hydrates through the property.
  Object.defineProperty(image, "src", {
    get: () => attributes.get("src") ?? "",
    set: (value) => {
      attributes.set("src", String(value));
    }
  });
  return image;
}

function makeRow(rect, images) {
  const row = new globalThis.HTMLElement();
  Object.assign(row, {
    isConnected: true,
    rect,
    getBoundingClientRect: () => row.rect,
    closest: () => row
  });
  images.forEach((image) => {
    image.closest = (selector) => (selector.includes("home-row") ? row : null);
  });
  return row;
}

test("a painted row the viewer scrolled past hands its bitmaps back, and only that row", (t) => {
  const originalImage = globalThis.HTMLImageElement;
  const originalElement = globalThis.HTMLElement;
  const originalWidth = globalThis.innerWidth;
  const originalHeight = globalThis.innerHeight;
  globalThis.HTMLImageElement = class {};
  globalThis.HTMLElement = class {};
  globalThis.innerWidth = 390;
  globalThis.innerHeight = 847;
  t.after(() => {
    globalThis.HTMLImageElement = originalImage;
    globalThis.HTMLElement = originalElement;
    globalThis.innerWidth = originalWidth;
    globalThis.innerHeight = originalHeight;
  });

  // 35 000px above the viewport: painted, and pure memory now.
  const scrolledAway = makeImage({
    rect: { top: -35200, bottom: -35000, left: 0, right: 200 },
    src: "https://image.tmdb.org/t/p/w500/away.jpg"
  });
  // On screen, still deferred: this is the row the viewer is looking at.
  const onScreen = makeImage({
    rect: { top: 120, bottom: 420, left: 16, right: 216 },
    deferred: "https://image.tmdb.org/t/p/w500/near.jpg"
  });
  // On screen and already painted: it must keep its bitmap.
  const onScreenPainted = makeImage({
    rect: { top: 120, bottom: 420, left: 240, right: 440 },
    src: "https://image.tmdb.org/t/p/w500/near-painted.jpg"
  });
  // On screen, but two rail-widths to the right: not worth decoding yet.
  const offToTheSide = makeImage({
    rect: { top: 120, bottom: 420, left: 2100, right: 2300 },
    deferred: "https://image.tmdb.org/t/p/w500/side.jpg"
  });
  // Just below the fold -- the row the viewer scrolls into next. It has to
  // preload, or every row past the first screen sits blank until it is already
  // on screen.
  const nextScreen = makeImage({
    rect: { top: 1000, bottom: 1300, left: 16, right: 216 },
    deferred: "https://image.tmdb.org/t/p/w500/next.jpg"
  });
  // Far below the viewport: never painted, so there is nothing to release.
  const farBelow = makeImage({
    rect: { top: 6000, bottom: 6300, left: 0, right: 200 },
    deferred: "https://image.tmdb.org/t/p/w500/below.jpg"
  });

  const images = [scrolledAway, onScreen, onScreenPainted, offToTheSide, nextScreen, farBelow];
  const awayRow = makeRow({ top: -35200, bottom: -35000, left: 0, right: 390 }, [scrolledAway]);
  const visibleRow = makeRow({ top: 100, bottom: 450, left: 0, right: 390 }, [
    onScreen,
    onScreenPainted,
    offToTheSide
  ]);
  const nextRow = makeRow({ top: 1000, bottom: 1400, left: 0, right: 390 }, [nextScreen]);
  const belowRow = makeRow({ top: 6000, bottom: 6400, left: 0, right: 390 }, [farBelow]);

  // The desktop shape that started this: the wrapper reports every catalog row
  // at once while the screen scrolls around it.
  const viewport = {
    getBoundingClientRect: () => ({ top: -35200, bottom: 7000, left: 0, right: 390 })
  };
  const container = {
    querySelector: (selector) => (selector.includes("rows-viewport") ? viewport : null),
    querySelectorAll: () => images
  };
  const screen = Object.assign(Object.create(HomeScreen), {
    container,
    layoutMode: "modern",
    getCurrentFocusedNode: () => null
  });
  screen.hydrateHomeLazyImages(null, { forceFullScan: true });

  // The row that scrolled away gives the pixels back and keeps its source.
  assert.equal(scrolledAway.getAttribute("src"), null);
  assert.equal(scrolledAway.getAttribute("data-src"), "https://image.tmdb.org/t/p/w500/away.jpg");
  assert.equal(scrolledAway.loading, "lazy");

  // The row on screen loads what it was waiting for.
  assert.equal(onScreen.getAttribute("src"), "https://image.tmdb.org/t/p/w500/near.jpg");
  assert.equal(onScreen.getAttribute("data-src"), null);
  assert.equal(onScreen.loading, "eager");

  // A painted poster on screen is left alone.
  assert.equal(
    onScreenPainted.getAttribute("src"),
    "https://image.tmdb.org/t/p/w500/near-painted.jpg"
  );

  // Past the horizontal margin nothing loads yet.
  assert.equal(offToTheSide.getAttribute("src"), null);
  assert.equal(offToTheSide.getAttribute("data-src"), "https://image.tmdb.org/t/p/w500/side.jpg");

  // The row just below the fold preloads: a zero row margin left it blank until
  // it was already on screen.
  assert.equal(nextScreen.getAttribute("src"), "https://image.tmdb.org/t/p/w500/next.jpg");
  assert.equal(nextScreen.getAttribute("data-src"), null);

  // Far below, still waiting: nothing to release, nothing to load.
  assert.equal(farBelow.getAttribute("src"), null);
  assert.equal(farBelow.getAttribute("data-src"), "https://image.tmdb.org/t/p/w500/below.jpg");

  // Every card image is in the index, painted or not. Built from [data-src]
  // alone, a painted poster left it the moment it loaded -- and could never be
  // found again to hand its bitmaps back.
  const indexed = screen.homeLazyImageHydrationIndex.flatMap((entry) => entry.images);
  assert.equal(indexed.length, images.length);
  assert.ok(indexed.includes(scrolledAway));
  assert.ok(indexed.includes(onScreenPainted));

  // Scrolling back re-hydrates the released poster from its data-src.
  awayRow.rect = { top: 100, bottom: 400, left: 0, right: 390 };
  scrolledAway.rect = { top: 120, bottom: 420, left: 0, right: 200 };
  screen.hydrateHomeLazyImages(null, { forceFullScan: true });
  assert.equal(scrolledAway.getAttribute("src"), "https://image.tmdb.org/t/p/w500/away.jpg");
  assert.equal(scrolledAway.loading, "eager");
  assert.ok(visibleRow && nextRow && belowRow);
});

// A scroll target that records its listeners, the way an element does.
function makeScrollTarget(name) {
  const listeners = new Set();
  return {
    name,
    listeners,
    addEventListener: (type, handler) => {
      if (type === "scroll") listeners.add(handler);
    },
    removeEventListener: (type, handler) => {
      if (type === "scroll") listeners.delete(handler);
    },
    scroll() {
      listeners.forEach((handler) => handler({ type: "scroll" }));
    }
  };
}

test("home hydrates on the element that actually scrolls, without dragging focus", () => {
  // The browser layout: the wrapper is in normal flow, the screen scrolls around
  // it. Binding only the wrapper meant no scroll ever reached Home, so nothing
  // past the first screen was hydrated.
  const wrapper = makeScrollTarget("wrapper");
  const screenElement = makeScrollTarget("screen");
  let hydrations = 0;
  let focusSyncs = 0;
  const screen = Object.assign(Object.create(HomeScreen), {
    container: { querySelector: () => null },
    getHomeViewport: () => wrapper,
    getHomeVerticalScrollOwner: () => screenElement,
    shouldSuspendModernViewportFocusSync: () => false,
    scheduleHomeLazyImageHydration: () => {
      hydrations += 1;
    },
    isSidebarFocusActive: () => false,
    isMainNode: () => true,
    isNodeWithinMainViewport: () => true,
    scheduleHomeViewportFocusSync: () => {
      focusSyncs += 1;
    }
  });

  screen.bindHomeViewportEvents();
  assert.equal(wrapper.listeners.size, 1);
  assert.equal(screenElement.listeners.size, 1);

  // The browser's own scrolling feeds the artwork pass...
  screenElement.scroll();
  assert.equal(hydrations, 1);
  // ...but must not pull the page back to a focused card.
  assert.equal(focusSyncs, 0);

  // Where the rows scroll themselves, the wrapper keeps its full handler, focus
  // follow included.
  wrapper.scroll();
  assert.equal(hydrations, 2);
  assert.equal(focusSyncs, 1);

  // Binding the same pair again must not stack a second listener.
  screen.bindHomeViewportEvents();
  assert.equal(screenElement.listeners.size, 1);
  assert.equal(wrapper.listeners.size, 1);

  // A different scroll owner takes over from the previous element.
  const otherOwner = makeScrollTarget("other");
  screen.getHomeVerticalScrollOwner = () => otherOwner;
  screen.bindHomeViewportEvents();
  assert.equal(otherOwner.listeners.size, 1);
  assert.equal(screenElement.listeners.size, 0);
  assert.equal(wrapper.listeners.size, 1, "the rows wrapper keeps its listener");
  otherOwner.scroll();
  assert.equal(hydrations, 3);
  assert.equal(focusSyncs, 1);

  // When the wrapper itself scrolls, there is one handler, not two.
  screen.getHomeVerticalScrollOwner = () => wrapper;
  screen.bindHomeViewportEvents();
  assert.equal(otherOwner.listeners.size, 0);
  assert.equal(wrapper.listeners.size, 1);
  wrapper.scroll();
  assert.equal(hydrations, 4);
});
