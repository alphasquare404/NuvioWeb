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

function makeCard(animated = true) {
  const classes = new Set(["home-collection-card"]);
  const attributes = new Map();
  const image = new globalThis.HTMLImageElement();
  Object.assign(image, {
    dataset: { src: "https://example.org/focused.webp" },
    getAttribute: (key) => attributes.get(key) ?? null,
    setAttribute: (key, value) => attributes.set(key, value),
    removeAttribute: (key) => attributes.delete(key)
  });
  const card = {
    isConnected: true,
    classList: {
      add: (name) => classes.add(name),
      remove: (name) => classes.delete(name),
      contains: (name) => classes.has(name)
    },
    querySelector: () => (animated ? image : null),
    closest: (selector) => (selector.includes("sidebar") ? null : card),
    contains: (node) => node === card || node === image
  };
  image.closest = () => card;
  return { card, image };
}

test("collection animations follow hover and keyboard focus, and release inactive images", (t) => {
  const originalImage = globalThis.HTMLImageElement;
  const originalDocument = globalThis.document;
  globalThis.HTMLImageElement = class {};
  globalThis.document = { activeElement: null };
  t.after(() => {
    globalThis.HTMLImageElement = originalImage;
    globalThis.document = originalDocument;
  });
  const first = makeCard();
  const second = makeCard();
  const staticCard = makeCard(false);
  const cards = [first.card, second.card, staticCard.card];
  const handlers = new Map();
  const screen = Object.assign(Object.create(HomeScreen), {
    container: {
      contains: (node) => cards.includes(node),
      addEventListener: (type, handler) => handlers.set(type, handler),
      removeEventListener: (type) => handlers.delete(type)
    },
    isMainNode: () => true,
    scheduleModernHeroUpdate: () => {},
    scheduleFocusedPosterFlow: () => {},
    getCurrentFocusedNode: () => document.activeElement
  });
  screen.ensureDelegatedEventsBound();
  const dispatch = (type, target, relatedTarget = null) =>
    handlers.get(type)({ type, target, relatedTarget });
  const active = ({ card, image }, expected) => {
    assert.equal(card.classList.contains("is-focus-gif-active"), expected);
    assert.equal(image.getAttribute("src"), expected ? image.dataset.src : null);
  };

  dispatch("mouseover", first.card);
  active(first, true);
  dispatch("mouseout", first.card, first.image);
  active(first, true);
  dispatch("mouseout", first.image, second.card);
  dispatch("mouseover", second.card, first.image);
  active(first, false);
  active(second, true);
  dispatch("mouseout", second.card);
  active(second, false);
  assert.equal(document.activeElement, null, "hover does not move keyboard focus");

  document.activeElement = first.card;
  dispatch("focusin", first.card);
  active(first, true);
  dispatch("mouseover", second.card);
  active(first, false);
  active(second, true);
  dispatch("mouseout", second.card);
  active(first, true);
  active(second, false);
  dispatch("focusout", first.card, second.card);
  document.activeElement = second.card;
  dispatch("focusin", second.card);
  active(first, false);
  active(second, true);
  dispatch("focusout", second.card);
  active(second, false);

  dispatch("mouseover", staticCard.card);
  assert.equal(staticCard.card.classList.contains("is-focus-gif-active"), false);
  dispatch("mouseover", first.card);
  screen.syncFocusedCollectionCardState(null);
  active(first, false);
});
